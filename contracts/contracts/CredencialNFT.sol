// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
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
/// @dev - Empleados e inspectores: los da de alta ADMIN_ROLE directamente (`emitirFuncionario`),
///        después de verificarlos en el padrón de empleados. No se guarda su DNI.
///      - Proveedores: se inscriben ellos mismos con `solicitarInscripcion` (CUIT y razón social,
///        que son datos públicos). ADMIN_ROLE verifica el CUIT en AFIP y aprueba o rechaza.
///      - Una wallet tiene a lo sumo una credencial sin revocar, de un único rol.
///      - Un CUIT tiene a lo sumo una credencial sin revocar: así cada empresa tiene una sola
///        identidad para ofertar.
///      - Las credenciales revocadas no se queman: quedan como historial auditable.
contract CredencialNFT is ERC721, AccessControl, ICredencialNFT, IERC5192 {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint256 public constant MAX_NOMBRE = 120;
    uint256 public constant MAX_TEXTO = 240;

    enum EstadoSolicitud {
        PENDIENTE,
        APROBADA,
        RECHAZADA,
        CANCELADA
    }

    struct Solicitud {
        address wallet;
        uint64 cuit;
        uint64 creadaEn;
        EstadoSolicitud estado;
        string razonSocial;
    }

    /// @dev Los ids empiezan en 1, así 0 significa "ninguno".
    uint256 private _proximoTokenId = 1;
    uint256 private _proximaSolicitudId = 1;

    mapping(uint256 tokenId => Credencial) private _credenciales;
    /// @dev Última credencial emitida a cada wallet (puede estar revocada o vencida).
    mapping(address wallet => uint256 tokenId) private _tokenDeWallet;
    /// @dev Última credencial emitida para cada CUIT.
    mapping(uint64 cuit => uint256 tokenId) private _tokenDeCuit;

    mapping(uint256 solicitudId => Solicitud) private _solicitudes;
    /// @dev Solicitud pendiente de cada wallet (0 si no tiene).
    mapping(address wallet => uint256 solicitudId) private _solicitudPendiente;

    event CredencialEmitida(
        uint256 indexed tokenId,
        address indexed wallet,
        Rol indexed rol,
        uint32 organismoId,
        uint64 cuit,
        string nombre,
        uint64 validaHasta
    );
    event CredencialRevocada(uint256 indexed tokenId, address indexed wallet, string motivo);
    event CredencialRenovada(uint256 indexed tokenId, address indexed wallet, uint64 validaHasta);

    /// @dev Domicilio y rubros solo van en el evento (no se guardan en storage, para ahorrar gas).
    event SolicitudCreada(
        uint256 indexed solicitudId,
        address indexed wallet,
        uint64 indexed cuit,
        string razonSocial,
        string domicilioLegal,
        string rubros
    );
    event SolicitudAprobada(uint256 indexed solicitudId, uint256 indexed tokenId);
    event SolicitudRechazada(uint256 indexed solicitudId, string motivo);
    event SolicitudCancelada(uint256 indexed solicitudId);

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
    error SolicitudPendienteExistente(uint256 solicitudId);
    error SolicitudInexistente(uint256 solicitudId);
    error SolicitudNoPendiente(uint256 solicitudId);
    error NoEsTuSolicitud(uint256 solicitudId);

    constructor(address admin) ERC721("CivicChain Credencial", "CIVIC-ID") {
        if (admin == address(0)) revert WalletInvalida();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Empleados e inspectores (alta directa del admin)
    // ---------------------------------------------------------------------

    /// @notice Emite una credencial de empleado o inspector.
    /// @param nombre Nombre y apellido (queda público, para saber quién firma cada acción).
    /// @param validaHasta Timestamp de vencimiento; tiene que ser futuro.
    function emitirFuncionario(
        address wallet,
        Rol rol,
        uint32 organismoId,
        string calldata nombre,
        uint64 validaHasta
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        if (rol == Rol.PROVEEDOR) revert RolInvalido();
        if (organismoId == 0) revert OrganismoInvalido();
        return _emitir(wallet, rol, organismoId, 0, nombre, validaHasta);
    }

    // ---------------------------------------------------------------------
    // Proveedores (inscripción con solicitud)
    // ---------------------------------------------------------------------

    /// @notice Un proveedor pide su credencial desde su propia wallet.
    /// @param cuit CUIT de la empresa, 11 dígitos sin guiones. Se valida el dígito verificador.
    function solicitarInscripcion(
        uint64 cuit,
        string calldata razonSocial,
        string calldata domicilioLegal,
        string calldata rubros
    ) external returns (uint256 solicitudId) {
        if (!cuitValido(cuit)) revert CuitInvalido(cuit);
        _validarTexto(razonSocial, MAX_NOMBRE);
        _validarTexto(domicilioLegal, MAX_TEXTO);
        _validarTexto(rubros, MAX_TEXTO);

        uint256 pendiente = _solicitudPendiente[msg.sender];
        if (pendiente != 0) revert SolicitudPendienteExistente(pendiente);
        _exigirWalletLibre(msg.sender);
        _exigirCuitLibre(cuit);

        solicitudId = _proximaSolicitudId++;
        _solicitudes[solicitudId] = Solicitud({
            wallet: msg.sender,
            cuit: cuit,
            creadaEn: uint64(block.timestamp),
            estado: EstadoSolicitud.PENDIENTE,
            razonSocial: razonSocial
        });
        _solicitudPendiente[msg.sender] = solicitudId;

        emit SolicitudCreada(solicitudId, msg.sender, cuit, razonSocial, domicilioLegal, rubros);
    }

    /// @notice Aprueba una solicitud (después de verificar el CUIT en AFIP) y emite la credencial.
    function aprobarSolicitud(
        uint256 solicitudId,
        uint64 validaHasta
    ) external onlyRole(ADMIN_ROLE) returns (uint256 tokenId) {
        Solicitud storage s = _solicitudPendienteExistente(solicitudId);
        s.estado = EstadoSolicitud.APROBADA;
        delete _solicitudPendiente[s.wallet];

        tokenId = _emitir(s.wallet, Rol.PROVEEDOR, 0, s.cuit, s.razonSocial, validaHasta);
        emit SolicitudAprobada(solicitudId, tokenId);
    }

    /// @notice Rechaza una solicitud. El proveedor puede volver a solicitar después.
    function rechazarSolicitud(uint256 solicitudId, string calldata motivo) external onlyRole(ADMIN_ROLE) {
        if (bytes(motivo).length == 0) revert MotivoVacio();
        Solicitud storage s = _solicitudPendienteExistente(solicitudId);
        s.estado = EstadoSolicitud.RECHAZADA;
        delete _solicitudPendiente[s.wallet];
        emit SolicitudRechazada(solicitudId, motivo);
    }

    /// @notice El propio proveedor cancela su solicitud pendiente (por ejemplo, para corregir un dato).
    function cancelarSolicitud(uint256 solicitudId) external {
        Solicitud storage s = _solicitudPendienteExistente(solicitudId);
        if (s.wallet != msg.sender) revert NoEsTuSolicitud(solicitudId);
        s.estado = EstadoSolicitud.CANCELADA;
        delete _solicitudPendiente[msg.sender];
        emit SolicitudCancelada(solicitudId);
    }

    // ---------------------------------------------------------------------
    // Revocación y renovación (todos los roles)
    // ---------------------------------------------------------------------

    /// @notice Revoca una credencial. Es definitivo: para volver a habilitar hay que emitir una nueva.
    function revocar(uint256 tokenId, string calldata motivo) external onlyRole(ADMIN_ROLE) {
        Credencial storage c = _credencialExistente(tokenId);
        if (c.revocada) revert CredencialYaRevocada(tokenId);
        if (bytes(motivo).length == 0) revert MotivoVacio();

        c.revocada = true;
        emit CredencialRevocada(tokenId, ownerOf(tokenId), motivo);
    }

    /// @notice Cambia el vencimiento de una credencial no revocada (también sirve si ya venció).
    function renovar(uint256 tokenId, uint64 nuevaFecha) external onlyRole(ADMIN_ROLE) {
        Credencial storage c = _credencialExistente(tokenId);
        if (c.revocada) revert CredencialYaRevocada(tokenId);
        if (nuevaFecha <= block.timestamp) revert FechaInvalida();

        c.validaHasta = nuevaFecha;
        emit CredencialRenovada(tokenId, ownerOf(tokenId), nuevaFecha);
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

    /// @notice Datos de una solicitud por id.
    function solicitud(uint256 solicitudId) external view returns (Solicitud memory) {
        if (solicitudId == 0 || solicitudId >= _proximaSolicitudId) revert SolicitudInexistente(solicitudId);
        return _solicitudes[solicitudId];
    }

    /// @notice Id de la solicitud pendiente de `wallet` (0 si no tiene).
    function solicitudPendienteDe(address wallet) external view returns (uint256) {
        return _solicitudPendiente[wallet];
    }

    /// @notice Cantidad total de credenciales emitidas (incluye revocadas).
    function totalEmitidas() external view returns (uint256) {
        return _proximoTokenId - 1;
    }

    /// @notice Cantidad total de solicitudes recibidas (en cualquier estado).
    function totalSolicitudes() external view returns (uint256) {
        return _proximaSolicitudId - 1;
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
        uint64 validaHasta
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
            nombre: nombre
        });
        _tokenDeWallet[wallet] = tokenId;
        if (cuit != 0) _tokenDeCuit[cuit] = tokenId;

        _safeMint(wallet, tokenId);

        emit Locked(tokenId);
        emit CredencialEmitida(tokenId, wallet, rol, organismoId, cuit, nombre, validaHasta);
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

    function _solicitudPendienteExistente(uint256 solicitudId) private view returns (Solicitud storage s) {
        if (solicitudId == 0 || solicitudId >= _proximaSolicitudId) revert SolicitudInexistente(solicitudId);
        s = _solicitudes[solicitudId];
        if (s.estado != EstadoSolicitud.PENDIENTE) revert SolicitudNoPendiente(solicitudId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }
}
