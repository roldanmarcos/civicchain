// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Interfaz de las credenciales de CivicChain
/// @notice La usan los demás contratos (licitaciones, core) para verificar roles.
interface ICredencialNFT {
    enum Rol {
        PROVEEDOR,
        EMPLEADO,
        INSPECTOR
    }

    struct Credencial {
        Rol rol;
        uint32 organismoId; // 0 para proveedores
        uint64 emitidaEn;
        uint64 validaHasta;
        bool revocada;
        bytes32 idHash; // hash(DNI o CUIT + sal), calculado fuera de la cadena
    }

    /// @notice true si `wallet` tiene una credencial de `rol` que no está revocada ni vencida.
    function tieneRolActivo(address wallet, Rol rol) external view returns (bool);

    /// @notice Organismo de la credencial vigente de `wallet` para `rol`; revierte si no tiene una activa.
    function organismoDe(address wallet, Rol rol) external view returns (uint32);
}
