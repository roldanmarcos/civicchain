// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ICredencialNFT} from "./interfaces/ICredencialNFT.sol";

/// @dev Interfaz mínima de ERC-5192 (Minimal Soulbound NFTs).
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);

    function locked(uint256 tokenId) external view returns (bool);
}

/// @title Credenciales de CivicChain
/// @notice NFT intransferible (soulbound) que acredita el rol de una wallet:
///         proveedor, empleado estatal o inspector.
/// @dev - Empleados e inspectores: los da de alta ADMIN_ROLE directamente (`emitirFuncionario`).
///        Sus datos personales (DNI, resolución) quedan en la base del backend; acá solo va su hash.
///      - Proveedores: el backend verifica el CUIT en AFIP y, si todo está bien, firma una
///        autorización (EIP-712). El proveedor la presenta con `inscribirProveedor` y recibe la
///        credencial en esa misma transacción: no hay solicitudes pendientes ni aprobación manual.
///        Las inscripciones rechazadas nunca llegan a la cadena (quedan registradas en el backend).
///      - Al inscribirse, el proveedor agrega su compromiso de identidad de Semaphore al grupo de
///        proveedores habilitados. Con eso después oferta de forma anónima.
///      - Una wallet tiene a lo sumo una credencial sin revocar, de un único rol.
///      - Un CUIT tiene a lo sumo una credencial sin revocar: así cada empresa tiene una sola
///        identidad para ofertar.
///      - Las credenciales revocadas no se queman: quedan como historial auditable.
contract CredencialNFT is ERC721, AccessControl, EIP712, ICredencialNFT, IERC5192 {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @notice Cuentas del backend que verifican en AFIP y firman las inscripciones.
    bytes32 public constant VERIFICADOR_ROLE = keccak256("VERIFICADOR_ROLE");

    bytes32 public constant INSCRIPCION_TYPEHASH = keccak256(
        "Inscripcion(address wallet,uint64 cuit,string razonSocial,bytes32 datosHash,uint256 identityCommitment,uint64 validaHasta,uint64 venceFirma)"
    );

    uint256 public constant MAX_NOMBRE = 120;

    /// @notice Tiempo inicial durante el que Semaphore sigue aceptando pruebas hechas con una raíz vieja.
    /// @dev Cada alta o baja de un proveedor cambia la raíz del grupo: una prueba armada justo antes del
    ///      cambio usa la raíz vieja y, sin este margen, sería rechazada (la dApp pide volver a intentar).
    ///      La contracara: un proveedor revocado puede seguir probando con la raíz vieja durante este lapso.
    ///      Armar y mandar una prueba tarda segundos, así que 5 minutos sobran. El admin lo puede cambiar
    ///      con `configurarDuracionRaiz` (con 0 solo vale la raíz actual).
    uint256 public constant DURACION_RAIZ_INICIAL = 5 minutes;

    ISemaphore private immutable _semaphore;
    uint256 private immutable _grupoProveedores;

    /// @dev Los ids empiezan en 1, así 0 significa "ninguno".
    uint256 private _proximoTokenId = 1;

    mapping(uint256 tokenId => Credencial) private _credenciales;
    /// @dev Última credencial emitida a cada wallet (puede estar revocada o vencida).
    mapping(address wallet => uint256 tokenId) private _tokenDeWallet;
    /// @dev Última credencial emitida para cada CUIT.
    mapping(uint64 cuit => uint256 tokenId) private _tokenDeCuit;
    /// @dev Compromiso de identidad de Semaphore de cada credencial de proveedor.
    mapping(uint256 tokenId => uint256 commitment) private _commitments;
    /// @dev true mientras el compromiso del proveedor está en el grupo (puede ofertar).
    mapping(uint256 tokenId => bool) private _enGrupo;
    /// @dev Firmas del verificador ya usadas (evita reutilizar una autorización).
    mapping(bytes32 digest => bool) private _firmaUsada;

    event CredencialEmitida(
        uint256 indexed tokenId,
        address indexed wallet,
        Rol indexed rol,
        uint32 organismoId,
        uint64 cuit,
        string nombre,
        uint64 validaHasta,
        bytes32 datosHash
    );
    event CredencialRevocada(uint256 indexed tokenId, address indexed wallet, string motivo);
    event CredencialRenovada(uint256 indexed tokenId, address indexed wallet, uint64 validaHasta);
    event ProveedorAgregadoAlGrupo(uint256 indexed tokenId, uint256 identityCommitment);
    event ProveedorQuitadoDelGrupo(uint256 indexed tokenId, uint256 identityCommitment);
    event DuracionRaizCambiada(uint256 segundos);

    error CredencialIntransferible();
    error WalletInvalida();
    error CuitInvalido(uint64 cuit);
    error TextoInvalido();
    error FechaInvalida();
    error OrganismoInvalido();
    error RolInvalido();
    error MotivoVacio();
    error WalletConCredencial(uint256 tokenId);
    error CuitConCredencial(uint256 tokenId);
    error CredencialInexistente(uint256 tokenId);
    error CredencialYaRevocada(uint256 tokenId);
    error SinCredencialActiva(address wallet, Rol rol);
    error FirmaInvalida();
    error FirmaVencida();
    error FirmaYaUsada();
    error UsarRevocarProveedor(uint256 tokenId);
    error NoEsProveedor(uint256 tokenId);
    error ProveedorFueraDelGrupo(uint256 tokenId);
    error CredencialNoVencida(uint256 tokenId);

    /// @param admin Recibe DEFAULT_ADMIN_ROLE y ADMIN_ROLE.
    /// @param semaphore_ Contrato Semaphore donde se crea el grupo de proveedores.
    constructor(address admin, ISemaphore semaphore_)
        ERC721("CivicChain Credencial", "CIVIC-ID")
        EIP712("CivicChain Credenciales", "1")
    {
        if (admin == address(0) || address(semaphore_) == address(0)) revert WalletInvalida();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        _semaphore = semaphore_;
        // Este contrato es el admin del grupo: solo él agrega y quita proveedores.
        _grupoProveedores = semaphore_.createGroup(address(this), DURACION_RAIZ_INICIAL);
    }

    // ---------------------------------------------------------------------
    // Empleados e inspectores (alta directa del admin)
    // ---------------------------------------------------------------------

    /// @notice Emite una credencial de empleado o inspector.
    /// @param nombre Nombre y apellido (queda público, para saber quién firma cada acción).
    /// @param validaHasta Timestamp de vencimiento; tiene que ser futuro.
    /// @param datosHash Hash de los datos completos guardados en el backend (DNI, área, resolución...).
    ///        Puede ser 0 si el alta se hace sin backend (por ejemplo, desde la consola).
    function emitirFuncionario(
        address wallet,
        Rol rol,
        uint32 organismoId,
        string calldata nombre,
        uint64 validaHasta,
        bytes32 datosHash
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        if (rol == Rol.PROVEEDOR) revert RolInvalido();
        if (organismoId == 0) revert OrganismoInvalido();
        return _emitir(wallet, rol, organismoId, 0, nombre, validaHasta, datosHash);
    }

    // ---------------------------------------------------------------------
    // Proveedores (inscripción automática con la firma del verificador)
    // ---------------------------------------------------------------------

    /// @notice Datos de una inscripción de proveedor autorizada por el backend.
    /// @param cuit CUIT de la empresa, 11 dígitos sin guiones. Se valida el dígito verificador.
    /// @param razonSocial Razón social tal como figura en AFIP (queda pública).
    /// @param datosHash Hash de la inscripción completa guardada en el backend.
    /// @param identityCommitment Compromiso de identidad de Semaphore del proveedor.
    /// @param validaHasta Vencimiento de la credencial (lo fija el backend).
    /// @param venceFirma Hasta cuándo se puede usar la autorización.
    struct Inscripcion {
        uint64 cuit;
        string razonSocial;
        bytes32 datosHash;
        uint256 identityCommitment;
        uint64 validaHasta;
        uint64 venceFirma;
    }

    /// @notice El proveedor se inscribe con la autorización que le firmó el backend.
    /// @dev La firma cubre todos los datos y la wallet (msg.sender): no sirve para otra wallet
    ///      ni para otros datos, y se puede usar una sola vez.
    /// @param firma Firma EIP-712 de una cuenta con VERIFICADOR_ROLE.
    function inscribirProveedor(Inscripcion calldata datos, bytes calldata firma) external returns (uint256 tokenId) {
        if (block.timestamp > datos.venceFirma) revert FirmaVencida();
        if (!cuitValido(datos.cuit)) revert CuitInvalido(datos.cuit);
        _verificarFirma(datos, firma);

        tokenId = _emitir(msg.sender, Rol.PROVEEDOR, 0, datos.cuit, datos.razonSocial, datos.validaHasta, datos.datosHash);

        // Semaphore revierte si el compromiso es 0, está fuera del campo o ya está en el grupo.
        _semaphore.addMember(_grupoProveedores, datos.identityCommitment);
        _commitments[tokenId] = datos.identityCommitment;
        _enGrupo[tokenId] = true;
        emit ProveedorAgregadoAlGrupo(tokenId, datos.identityCommitment);
    }

    /// @notice Digest EIP-712 que tiene que firmar el verificador (útil para depurar el backend).
    function digestInscripcion(address wallet, Inscripcion calldata datos) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INSCRIPCION_TYPEHASH,
                    wallet,
                    datos.cuit,
                    keccak256(bytes(datos.razonSocial)),
                    datos.datosHash,
                    datos.identityCommitment,
                    datos.validaHasta,
                    datos.venceFirma
                )
            )
        );
    }

    // ---------------------------------------------------------------------
    // Revocación y renovación
    // ---------------------------------------------------------------------

    /// @notice Revoca la credencial de un empleado o inspector. Es definitivo.
    function revocar(uint256 tokenId, string calldata motivo) external onlyRole(ADMIN_ROLE) {
        if (_enGrupo[tokenId]) revert UsarRevocarProveedor(tokenId);
        _revocar(tokenId, motivo);
    }

    /// @notice Revoca la credencial de un proveedor y lo saca del grupo de Semaphore.
    /// @param siblings Prueba de Merkle del compromiso del proveedor en el grupo actual. Se calcula
    ///        fuera de la cadena con los eventos del grupo (la dApp lo hace sola).
    function revocarProveedor(
        uint256 tokenId,
        string calldata motivo,
        uint256[] calldata siblings
    ) external onlyRole(ADMIN_ROLE) {
        if (_credencialExistente(tokenId).rol != Rol.PROVEEDOR) revert NoEsProveedor(tokenId);
        _revocar(tokenId, motivo);
        if (_enGrupo[tokenId]) _quitarDelGrupo(tokenId, siblings);
    }

    /// @notice Saca del grupo a un proveedor con la credencial vencida, para que no pueda seguir
    ///         ofertando. Lo puede llamar cualquiera (un bot de la dApp, un ciudadano).
    /// @dev Semaphore no sabe de vencimientos: sin esto, un proveedor vencido podría seguir probando
    ///      que está en el grupo. Si después se lo quiere renovar, hay que revocar y volver a inscribirlo.
    function quitarVencidoDelGrupo(uint256 tokenId, uint256[] calldata siblings) external {
        Credencial storage c = _credencialExistente(tokenId);
        if (c.rol != Rol.PROVEEDOR) revert NoEsProveedor(tokenId);
        if (block.timestamp <= c.validaHasta) revert CredencialNoVencida(tokenId);
        if (!_enGrupo[tokenId]) revert ProveedorFueraDelGrupo(tokenId);
        _quitarDelGrupo(tokenId, siblings);
    }

    /// @notice Cambia el vencimiento de una credencial no revocada (también sirve si ya venció).
    function renovar(uint256 tokenId, uint64 nuevaFecha) external onlyRole(ADMIN_ROLE) {
        Credencial storage c = _credencialExistente(tokenId);
        if (c.revocada) revert CredencialYaRevocada(tokenId);
        if (c.rol == Rol.PROVEEDOR && !_enGrupo[tokenId]) revert ProveedorFueraDelGrupo(tokenId);
        if (nuevaFecha <= block.timestamp) revert FechaInvalida();

        c.validaHasta = nuevaFecha;
        emit CredencialRenovada(tokenId, ownerOf(tokenId), nuevaFecha);
    }

    /// @notice Cambia cuánto tiempo se aceptan pruebas con una raíz vieja del grupo (ver DURACION_RAIZ_INICIAL).
    /// @dev Ojo: Semaphore aplica el nuevo valor también a las raíces anteriores.
    function configurarDuracionRaiz(uint256 segundos) external onlyRole(ADMIN_ROLE) {
        _semaphore.updateGroupMerkleTreeDuration(_grupoProveedores, segundos);
        emit DuracionRaizCambiada(segundos);
    }

    // ---------------------------------------------------------------------
    // Consultas
    // ---------------------------------------------------------------------

    /// @inheritdoc ICredencialNFT
    function tieneRolActivo(address wallet, Rol rol) public view returns (bool) {
        uint256 tokenId = _tokenDeWallet[wallet];
        if (tokenId == 0) return false;
        Credencial storage c = _credenciales[tokenId];
        return c.rol == rol && !c.revocada && block.timestamp <= c.validaHasta;
    }

    /// @inheritdoc ICredencialNFT
    function organismoDe(address wallet, Rol rol) external view returns (uint32) {
        if (!tieneRolActivo(wallet, rol)) revert SinCredencialActiva(wallet, rol);
        return _credenciales[_tokenDeWallet[wallet]].organismoId;
    }

    /// @inheritdoc ICredencialNFT
    function semaphore() external view returns (address) {
        return address(_semaphore);
    }

    /// @inheritdoc ICredencialNFT
    function grupoProveedores() external view returns (uint256) {
        return _grupoProveedores;
    }

    /// @notice Última credencial emitida a `wallet` (tokenId 0 si nunca tuvo una).
    ///         Puede estar revocada o vencida: sirve para mostrar el estado en la dApp.
    function credencialDe(address wallet) external view returns (uint256 tokenId, Credencial memory datos) {
        tokenId = _tokenDeWallet[wallet];
        if (tokenId != 0) datos = _credenciales[tokenId];
    }

    /// @notice Última credencial emitida para un CUIT (tokenId 0 si nunca tuvo una).
    function credencialDeCuit(uint64 cuit) external view returns (uint256 tokenId, Credencial memory datos) {
        tokenId = _tokenDeCuit[cuit];
        if (tokenId != 0) datos = _credenciales[tokenId];
    }

    /// @notice Datos de una credencial por id.
    function credencial(uint256 tokenId) external view returns (Credencial memory) {
        return _credencialExistente(tokenId);
    }

    /// @notice Compromiso de Semaphore de un proveedor y si sigue en el grupo.
    function compromisoDe(uint256 tokenId) external view returns (uint256 commitment, bool enGrupo) {
        return (_commitments[tokenId], _enGrupo[tokenId]);
    }

    /// @notice Cantidad total de credenciales emitidas (incluye revocadas).
    function totalEmitidas() external view returns (uint256) {
        return _proximoTokenId - 1;
    }

    /// @notice Valida un CUIT: 11 dígitos y dígito verificador correcto.
    function cuitValido(uint64 cuit) public pure returns (bool) {
        if (cuit < 10_000_000_000 || cuit > 99_999_999_999) return false;
        uint8[10] memory pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        uint64 verificador = cuit % 10;
        uint64 resto = cuit / 10;
        uint256 suma;
        for (uint256 i = 10; i > 0; i--) {
            suma += uint256(resto % 10) * pesos[i - 1];
            resto /= 10;
        }
        uint256 esperado = 11 - (suma % 11);
        if (esperado == 11) esperado = 0;
        if (esperado == 10) return false;
        return verificador == esperado;
    }

    /// @inheritdoc IERC5192
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    // ---------------------------------------------------------------------
    // Intransferibilidad
    // ---------------------------------------------------------------------

    /// @dev Solo se permite emitir (from == 0). Transferir y quemar están bloqueados.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert CredencialIntransferible();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert CredencialIntransferible();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert CredencialIntransferible();
    }

    // ---------------------------------------------------------------------
    // Internas
    // ---------------------------------------------------------------------

    function _emitir(
        address wallet,
        Rol rol,
        uint32 organismoId,
        uint64 cuit,
        string memory nombre,
        uint64 validaHasta,
        bytes32 datosHash
    ) private returns (uint256 tokenId) {
        if (wallet == address(0)) revert WalletInvalida();
        if (validaHasta <= block.timestamp) revert FechaInvalida();
        _validarTexto(nombre, MAX_NOMBRE);
        _exigirWalletLibre(wallet);
        if (cuit != 0) _exigirCuitLibre(cuit);

        tokenId = _proximoTokenId++;
        _credenciales[tokenId] = Credencial({
            rol: rol,
            organismoId: organismoId,
            emitidaEn: uint64(block.timestamp),
            validaHasta: validaHasta,
            revocada: false,
            cuit: cuit,
            nombre: nombre,
            datosHash: datosHash
        });
        _tokenDeWallet[wallet] = tokenId;
        if (cuit != 0) _tokenDeCuit[cuit] = tokenId;

        _safeMint(wallet, tokenId);

        emit Locked(tokenId);
        emit CredencialEmitida(tokenId, wallet, rol, organismoId, cuit, nombre, validaHasta, datosHash);
    }

    function _verificarFirma(Inscripcion calldata datos, bytes calldata firma) private {
        bytes32 digest = digestInscripcion(msg.sender, datos);
        if (_firmaUsada[digest]) revert FirmaYaUsada();
        (address firmante, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, firma);
        if (err != ECDSA.RecoverError.NoError || !hasRole(VERIFICADOR_ROLE, firmante)) revert FirmaInvalida();
        _firmaUsada[digest] = true;
    }

    function _revocar(uint256 tokenId, string calldata motivo) private {
        Credencial storage c = _credencialExistente(tokenId);
        if (c.revocada) revert CredencialYaRevocada(tokenId);
        if (bytes(motivo).length == 0) revert MotivoVacio();
        c.revocada = true;
        emit CredencialRevocada(tokenId, ownerOf(tokenId), motivo);
    }

    function _quitarDelGrupo(uint256 tokenId, uint256[] calldata siblings) private {
        uint256 commitment = _commitments[tokenId];
        _semaphore.removeMember(_grupoProveedores, commitment, siblings);
        _enGrupo[tokenId] = false;
        emit ProveedorQuitadoDelGrupo(tokenId, commitment);
    }

    function _exigirWalletLibre(address wallet) private view {
        uint256 previo = _tokenDeWallet[wallet];
        if (previo != 0 && !_credenciales[previo].revocada) revert WalletConCredencial(previo);
    }

    function _exigirCuitLibre(uint64 cuit) private view {
        uint256 previo = _tokenDeCuit[cuit];
        if (previo != 0 && !_credenciales[previo].revocada) revert CuitConCredencial(previo);
    }

    function _validarTexto(string memory texto, uint256 maximo) private pure {
        uint256 largo = bytes(texto).length;
        if (largo == 0 || largo > maximo) revert TextoInvalido();
    }

    function _credencialExistente(uint256 tokenId) private view returns (Credencial storage c) {
        if (_ownerOf(tokenId) == address(0)) revert CredencialInexistente(tokenId);
        return _credenciales[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }
}
