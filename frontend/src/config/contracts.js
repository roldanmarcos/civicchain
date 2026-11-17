// Direcciones y ABIs de los contratos por red.
// `deployments.json` y `abis/` los genera el script de despliegue (contracts/scripts/deploy.ts):
// no editarlos a mano.

import deployments from "./deployments.json";
import organismos from "./organismos.json";

export { ROLES } from "../shared/protocolo.js";

/**
 * `rpcUrl`: nodo desde donde la dApp lee la cadena (también sin wallet conectada, para el espacio
 * público). MetaMask se usa solo para firmar. En el nodo local además evita que MetaMask consulte
 * bloques de una cadena anterior después de reiniciarlo.
 * @type {Record<number, { name: string, rpcUrl: string, explorador?: string }>}
 */
export const NETWORKS = {
  31337: { name: "Hardhat local", rpcUrl: "http://127.0.0.1:8545" },
  11155111: {
    name: "Sepolia",
    // DUDA: RPC público gratuito; para la entrega conviene uno propio (Alchemy/Infura) en VITE_SEPOLIA_RPC_URL.
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    explorador: "https://sepolia.etherscan.io",
  },
};

export const DEFAULT_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);

/** Backend: verificador de inscripciones, base de datos, IPFS local y relayer. */
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8787";

/** Project id de WalletConnect (cloud.reown.com) para conectarse escaneando un QR. Sin él, no hay QR. */
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "";

/** Vigencia por defecto de una credencial nueva o renovada. */
export const VIGENCIA_POR_DEFECTO_DIAS = 90;

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
