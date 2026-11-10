// Direcciones y ABIs de los contratos por red.
// `deployments.json` y `abis/` los genera el script de despliegue (contracts/scripts/deploy.ts):
// no editarlos a mano.

import deployments from "./deployments.json";
import organismos from "./organismos.json";

export const NETWORKS = {
  31337: { name: "Hardhat local" },
  11155111: { name: "Sepolia" },
};

export const DEFAULT_CHAIN_ID = 31337;

/** Vigencia por defecto de una credencial nueva o renovada. */
export const VIGENCIA_POR_DEFECTO_DIAS = 90;

/** Debe coincidir con el orden del enum `Rol` en ICredencialNFT.sol. */
export const ROLES = ["PROVEEDOR", "EMPLEADO", "INSPECTOR"];

export { organismos };

/**
 * Datos de despliegue de un contrato en una red, o null si no está desplegado ahí.
 * @returns {{ address: string, deployBlock: number } | null}
 */
export function getDeployment(chainId, contractName) {
  return deployments[String(chainId)]?.[contractName] ?? null;
}

/** Carga el ABI de un contrato (solo existe después del primer despliegue). */
export async function getAbi(contractName) {
  const abis = import.meta.glob("./abis/*.json", { import: "default" });
  const loader = abis[`./abis/${contractName}.json`];
  if (!loader) throw new Error(`No hay ABI para ${contractName}. ¿Corriste el script de despliegue?`);
  return loader();
}
