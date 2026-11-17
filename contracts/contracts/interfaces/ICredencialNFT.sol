// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Interfaz de las credenciales de CivicChain
/// @notice La usan los demás contratos (licitaciones) para verificar roles.
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
        uint64 cuit; // solo proveedores; 0 para empleados e inspectores
        string nombre; // nombre y apellido (empleado/inspector) o razón social (proveedor)
        /// @dev Hash de los datos completos que quedan fuera de la cadena (base del backend):
        ///      keccak256(JSON canónico + sal). Permite comprobar que nadie los modificó.
        bytes32 datosHash;
    }

    /// @notice true si `wallet` tiene una credencial de `rol` que no está revocada ni vencida.
    function tieneRolActivo(address wallet, Rol rol) external view returns (bool);

    /// @notice Organismo de la credencial vigente de `wallet` para `rol`; revierte si no tiene una activa.
    function organismoDe(address wallet, Rol rol) external view returns (uint32);

    /// @notice Dirección del contrato Semaphore donde vive el grupo de proveedores habilitados.
    function semaphore() external view returns (address);

    /// @notice Id del grupo de Semaphore con los compromisos de identidad de los proveedores.
    function grupoProveedores() external view returns (uint256);
}
