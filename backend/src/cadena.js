// Conexión a la blockchain: proveedor, contratos y las dos cuentas del backend.
//
// - Verificador: solo firma autorizaciones (EIP-712). No manda transacciones ni necesita ETH.
// - Relayer: manda las ofertas anónimas y las revelaciones de identidad, y paga el gas. Necesita ETH.
//
// La conexión es perezosa: el backend arranca aunque el nodo todavía no esté levantado, y toma solo
// las direcciones nuevas si se vuelven a desplegar los contratos.

import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import { leerAbi, leerDeployment } from "./config.js";

export function crearCadena(config) {
  const verificador = new Wallet(config.verificadorKey);
  const relayerWallet = new Wallet(config.relayerKey);
  let contratos = null;

  /** chainId del nodo, con timeout (el proveedor de ethers reintenta para siempre si el nodo no responde). */
  async function chainIdDelNodo() {
    const r = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(3000),
    });
    return BigInt((await r.json()).result);
  }

  async function conectar() {
    let chainId;
    try {
      chainId = await chainIdDelNodo();
    } catch {
      throw Object.assign(new Error(`No se pudo conectar al nodo en ${config.rpcUrl}`), { code: "ECONNREFUSED" });
    }
    // Se relee en cada llamada (es un archivo chico): si se volvió a desplegar, se toman las direcciones nuevas.
    const red = leerDeployment(chainId);
    if (contratos?.chainId === chainId && contratos.direccion === red.Licitaciones.address) return contratos;

    const provider = new JsonRpcProvider(config.rpcUrl, Number(chainId), { staticNetwork: true });
    const relayer = new NonceManager(relayerWallet.connect(provider));
    contratos = {
      chainId,
      direccion: red.Licitaciones.address,
      provider,
      relayer,
      credenciales: new Contract(red.CredencialNFT.address, leerAbi("CredencialNFT"), provider),
      licitaciones: new Contract(red.Licitaciones.address, leerAbi("Licitaciones"), relayer),
      desdeBloque: red.CredencialNFT.deployBlock ?? 0,
    };
    return contratos;
  }

  return {
    verificador,
    /** Solo la dirección; para mandar transacciones se usa contratos.relayer. */
    relayer: { getAddress: async () => relayerWallet.address, address: relayerWallet.address },
    conectar,
    /** Olvida la conexión (por ejemplo, si se reinició el nodo local). */
    reiniciar: () => {
      contratos = null;
    },
  };
}
