// Configuración del backend. Todo se puede cambiar con variables de entorno.
//
// En la red local no hace falta configurar nada: el verificador y el relayer usan las cuentas
// #18 y #19 de Hardhat (claves públicamente conocidas, solo sirven en la red local).
// Para Sepolia hay que definir RPC_URL, VERIFICADOR_PRIVATE_KEY y RELAYER_PRIVATE_KEY, y darle
// VERIFICADOR_ROLE a la dirección del verificador (scripts/deploy.ts lo hace si se le pasa).

import { readFileSync } from "node:fs";
import { HDNodeWallet, Mnemonic } from "ethers";

const CONFIG_FRONTEND = new URL("../../frontend/src/config/", import.meta.url);

/** Mnemónico por defecto de Hardhat: sus cuentas son públicas y solo sirven en la red local. */
const MNEMONICO_HARDHAT = "test test test test test test test test test test test junk";
const cuentaHardhat = (indice) =>
  HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(MNEMONICO_HARDHAT), `m/44'/60'/0'/0/${indice}`).privateKey;

export const CUENTA_VERIFICADOR_LOCAL = 18;
export const CUENTA_RELAYER_LOCAL = 19;

export const config = {
  puerto: Number(process.env.PORT ?? 8787),
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  /** Origen de la dApp, para CORS. */
  origenDapp: process.env.ORIGEN_DAPP ?? "*",
  baseDeDatos: process.env.DB_PATH ?? new URL("../data/civicchain.sqlite", import.meta.url).pathname,
  carpetaIpfs: process.env.IPFS_DIR ?? new URL("../data/ipfs/", import.meta.url).pathname,
  verificadorKey: process.env.VERIFICADOR_PRIVATE_KEY ?? cuentaHardhat(CUENTA_VERIFICADOR_LOCAL),
  relayerKey: process.env.RELAYER_PRIVATE_KEY ?? cuentaHardhat(CUENTA_RELAYER_LOCAL),
  /** Vigencia de las credenciales de proveedor que autoriza el verificador. */
  vigenciaProveedorDias: Number(process.env.VIGENCIA_PROVEEDOR_DIAS ?? 365),
  /** Cuánto tiempo tiene el proveedor para usar la autorización firmada. */
  validezFirmaSegundos: Number(process.env.VALIDEZ_FIRMA_SEGUNDOS ?? 3600),
  /** Cada cuánto el bot revisa si hay ofertas para abrir. 0 lo desactiva. */
  intervaloAperturaMs: Number(process.env.INTERVALO_APERTURA_MS ?? 20_000),
  /** Tamaño máximo de un archivo subido a IPFS. */
  maxArchivoBytes: Number(process.env.MAX_ARCHIVO_BYTES ?? 10 * 1024 * 1024),
};

/** Direcciones de los contratos desplegados en `chainId` (las escribe contracts/scripts/deploy.ts). */
export function leerDeployment(chainId) {
  const deployments = JSON.parse(readFileSync(new URL("deployments.json", CONFIG_FRONTEND), "utf8"));
  const red = deployments[String(chainId)];
  if (!red?.CredencialNFT || !red?.Licitaciones) {
    throw new Error(
      `No hay contratos desplegados para la red ${chainId}. Corré: npx hardhat run scripts/deploy.ts --network localhost`,
    );
  }
  return red;
}

export function leerAbi(contrato) {
  return JSON.parse(readFileSync(new URL(`abis/${contrato}.json`, CONFIG_FRONTEND), "utf8"));
}
