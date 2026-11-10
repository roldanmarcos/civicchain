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
/// @dev - Solo ADMIN_ROLE emite, revoca y renueva (validando antes contra la base de datos fuera de la cadena).
///      - Una wallet tiene a lo sumo una credencial vigente (no revocada), de un único rol.
///      - Las credenciales revocadas no se queman: quedan como historial auditable.
///      - Un mismo idHash (persona o empresa) no puede tener dos credenciales sin revocar.
contract CredencialNFT is ERC721, AccessControl, ICredencialNFT, IERC5192 {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @dev Los ids empiezan en 1, así 0 significa "sin credencial".
    uint256 private _proximoId = 1;

    mapping(uint256 tokenId => Credencial) private _credenciales;
    /// @dev Última credencial emitida a cada wallet (puede estar revocada o vencida).
    mapping(address wallet => uint256 tokenId) private _tokenDeWallet;
    /// @dev Última credencial emitida para cada idHash.
    mapping(bytes32 idHash => uint256 tokenId) private _tokenDeIdHash;

    event CredencialEmitida(
        uint256 indexed tokenId,
        address indexed wallet,
        Rol indexed rol,
        uint32 organismoId,
        uint64 validaHasta
    );
    event CredencialRevocada(uint256 indexed tokenId, address indexed wallet, string motivo);
    event CredencialRenovada(uint256 indexed tokenId, address indexed wallet, uint64 validaHasta);

    error CredencialIntransferible();
    error WalletInvalida();
    error IdHashInvalido();
    error FechaInvalida();
    error OrganismoInvalido();
    error MotivoVacio();
    error WalletConCredencial(uint256 tokenId);
    error IdHashConCredencial(uint256 tokenId);
    error CredencialInexistente(uint256 tokenId);
    error CredencialYaRevocada(uint256 tokenId);
    error SinCredencialActiva(address wallet, Rol rol);

    constructor(address admin) ERC721("CivicChain Credencial", "CIVIC-ID") {
        if (admin == address(0)) revert WalletInvalida();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Administración
    // ---------------------------------------------------------------------

    /// @notice Emite una credencial a `wallet`.
    /// @param organismoId Debe ser > 0 para empleados e inspectores, y 0 para proveedores.
    /// @param idHash hash(DNI o CUIT + sal), calculado fuera de la cadena. Nunca el dato en claro.
    /// @param validaHasta Timestamp de vencimiento; tiene que ser futuro.
    function emitir(
        address wallet,
        Rol rol,
        uint32 organismoId,
        bytes32 idHash,
        uint64 validaHasta
    ) external onlyRole(ADMIN_ROLE) returns (uint256 tokenId) {
        if (wallet == address(0)) revert WalletInvalida();
        if (idHash == bytes32(0)) revert IdHashInvalido();
        if (validaHasta <= block.timestamp) revert FechaInvalida();
        if (rol == Rol.PROVEEDOR ? organismoId != 0 : organismoId == 0) revert OrganismoInvalido();

        uint256 previoWallet = _tokenDeWallet[wallet];
        if (previoWallet != 0 && !_credenciales[previoWallet].revocada) revert WalletConCredencial(previoWallet);

        uint256 previoId = _tokenDeIdHash[idHash];
        if (previoId != 0 && !_credenciales[previoId].revocada) revert IdHashConCredencial(previoId);

        tokenId = _proximoId++;
        _credenciales[tokenId] = Credencial({
            rol: rol,
            organismoId: organismoId,
            emitidaEn: uint64(block.timestamp),
            validaHasta: validaHasta,
            revocada: false,
            idHash: idHash
        });
        _tokenDeWallet[wallet] = tokenId;
        _tokenDeIdHash[idHash] = tokenId;

        _safeMint(wallet, tokenId);

        emit Locked(tokenId);
        emit CredencialEmitida(tokenId, wallet, rol, organismoId, validaHasta);
    }

    /// @notice Revoca una credencial. Es definitivo: para volver a habilitar a la persona hay que emitir una nueva.
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

    /// @notice Datos de una credencial por id.
    function credencial(uint256 tokenId) external view returns (Credencial memory) {
        return _credencialExistente(tokenId);
    }

    /// @notice Cantidad total de credenciales emitidas (incluye revocadas).
    function totalEmitidas() external view returns (uint256) {
        return _proximoId - 1;
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

    function _credencialExistente(uint256 tokenId) private view returns (Credencial storage c) {
        if (_ownerOf(tokenId) == address(0)) revert CredencialInexistente(tokenId);
        return _credenciales[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }
}
