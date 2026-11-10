// Sesión con MetaMask: wallet conectada, red, rol y credencial.
//
// La dApp nunca mueve el NFT: el "login" es leer del contrato qué credencial tiene la wallet.
// Este chequeo es solo para la interfaz; la seguridad real la dan los contratos, que vuelven a
// verificar el rol en cada transacción.

import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { DEFAULT_CHAIN_ID, NETWORKS, ROLES, getAbi, getDeployment } from "../config/contracts.js";

/**
 * @typedef {"VIGENTE" | "VENCIDA" | "REVOCADA"} EstadoCredencial
 *
 * @typedef {object} CredencialPropia
 * @property {bigint} tokenId
 * @property {"PROVEEDOR" | "EMPLEADO" | "INSPECTOR"} rol
 * @property {string} nombre
 * @property {number} organismoId
 * @property {bigint} cuit
 * @property {number} emitidaEn
 * @property {number} validaHasta
 * @property {EstadoCredencial} estado
 * @property {string | null} motivoRevocacion
 *
 * @typedef {object} SolicitudPropia
 * @property {bigint} id
 * @property {"PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA"} estado
 * @property {string} razonSocial
 * @property {bigint} cuit
 * @property {number} creadaEn
 * @property {string | null} motivoRechazo
 *
 * @typedef {object} Sesion
 * @property {"CARGANDO" | "SIN_METAMASK" | "DESCONECTADO" | "RED_INCORRECTA" | "SIN_CONTRATO" | "CONECTADO"} estado
 * @property {string | null} cuenta
 * @property {number | null} chainId
 * @property {boolean} esAdmin
 * @property {CredencialPropia | null} credencial Última credencial de la wallet (puede estar vencida o revocada)
 * @property {SolicitudPropia | null} solicitud Última solicitud de inscripción de la wallet
 */

export const ESTADOS_SOLICITUD = ["PENDIENTE", "APROBADA", "RECHAZADA", "CANCELADA"];

const EVENTOS_CONTRATO = [
  "CredencialEmitida",
  "CredencialRevocada",
  "CredencialRenovada",
  "SolicitudCreada",
  "SolicitudAprobada",
  "SolicitudRechazada",
  "SolicitudCancelada",
];

/** @type {Sesion} */
let sesion = { estado: "CARGANDO", cuenta: null, chainId: null, esAdmin: false, credencial: null, solicitud: null };

/** @type {BrowserProvider | null} */
let provider = null;
/** @type {Contract | null} */
let contrato = null;
let deployBlock = 0;
const suscriptores = new Set();

export const ahora = () => Math.floor(Date.now() / 1000);

export function obtenerSesion() {
  return sesion;
}

/** Rol con credencial vigente, o null. */
export function rolActivo() {
  return sesion.credencial?.estado === "VIGENTE" ? sesion.credencial.rol : null;
}

/** @param {(s: Sesion) => void} fn */
export function alCambiarSesion(fn) {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

function actualizar(cambios) {
  sesion = { ...sesion, ...cambios };
  for (const fn of suscriptores) fn(sesion);
}

/** Contrato conectado con la wallet (para leer y para firmar transacciones). */
export function obtenerContrato() {
  if (!contrato) throw new Error("Conectá tu wallet primero.");
  return contrato;
}

/** Bloque en que se desplegó el contrato: desde ahí se buscan los eventos. */
export function bloqueInicial() {
  return deployBlock;
}

/** Chain id al que hay que cambiar si la red actual no tiene el contrato. */
export function redObjetivo() {
  if (getDeployment(DEFAULT_CHAIN_ID, "CredencialNFT")) return DEFAULT_CHAIN_ID;
  return Number(Object.keys(NETWORKS).find((id) => getDeployment(id, "CredencialNFT")) ?? DEFAULT_CHAIN_ID);
}

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

/** Se llama al cargar la página: reconecta sin abrir MetaMask si el usuario ya había autorizado. */
export async function iniciarSesion() {
  const ethereum = /** @type {any} */ (window).ethereum;
  if (!ethereum) {
    actualizar({ estado: "SIN_METAMASK" });
    return;
  }

  ethereum.on?.("accountsChanged", () => cargar());
  ethereum.on?.("chainChanged", () => cargar());
  await cargar();
}

/** Abre MetaMask para pedir acceso a la wallet. */
export async function conectar() {
  const ethereum = /** @type {any} */ (window).ethereum;
  if (!ethereum) throw new Error("Necesitás la extensión MetaMask para conectarte.");
  await ethereum.request({ method: "eth_requestAccounts" });
  await cargar();
}

/** Pide a MetaMask cambiar a la red donde está desplegado el contrato (y la agrega si es la local). */
export async function cambiarRed() {
  const ethereum = /** @type {any} */ (window).ethereum;
  const chainId = redObjetivo();
  const chainIdHex = `0x${chainId.toString(16)}`;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (error) {
    if (/** @type {any} */ (error)?.code !== 4902 || chainId !== 31337) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: "Hardhat local",
          rpcUrls: [NETWORKS[chainId].rpcUrl],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        },
      ],
    });
  }
}

async function cargar() {
  const ethereum = /** @type {any} */ (window).ethereum;
  contrato?.removeAllListeners();
  contrato = null;

  provider = new BrowserProvider(ethereum);
  const cuentas = await provider.send("eth_accounts", []);
  const chainId = Number((await provider.getNetwork()).chainId);
  const base = { cuenta: cuentas[0] ?? null, chainId, esAdmin: false, credencial: null, solicitud: null };

  if (!base.cuenta) {
    actualizar({ ...base, estado: "DESCONECTADO" });
    return;
  }

  const deployment = getDeployment(chainId, "CredencialNFT");
  if (!deployment) {
    actualizar({ ...base, estado: "RED_INCORRECTA" });
    return;
  }

  const signer = await provider.getSigner(base.cuenta);
  const runner = crearRunner(chainId, signer);

  if ((await runner.provider.getCode(deployment.address)) === "0x") {
    // Pasa si se reinició el nodo local y no se volvió a correr el deploy.
    actualizar({ ...base, estado: "SIN_CONTRATO" });
    return;
  }

  contrato = new Contract(deployment.address, await getAbi("CredencialNFT"), runner);
  deployBlock = deployment.deployBlock;

  for (const evento of EVENTOS_CONTRATO) contrato.on(evento, refrescarConDemora);

  actualizar({ ...base, estado: "CONECTADO", ...(await leerDatosDeCuenta(base.cuenta)) });
}

/**
 * Con quién habla el contrato. Si la red tiene `rpcUrl`, las lecturas, los eventos y la estimación de gas
 * van directo al nodo y MetaMask solo firma y envía las transacciones. Si no, todo pasa por MetaMask.
 * @param {number} chainId
 * @param {import("ethers").JsonRpcSigner} signer
 * @returns {import("ethers").ContractRunner & { provider: import("ethers").Provider }}
 */
function crearRunner(chainId, signer) {
  const rpcUrl = NETWORKS[chainId]?.rpcUrl;
  if (!rpcUrl) return signer;

  const nodo = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const conRemitente = (tx) => ({ ...tx, from: signer.address });
  return {
    provider: nodo,
    call: (tx) => nodo.call(conRemitente(tx)),
    estimateGas: (tx) => nodo.estimateGas(conRemitente(tx)),
    resolveName: (nombre) => nodo.resolveName(nombre),
    sendTransaction: (tx) => signer.sendTransaction(tx),
  };
}

let temporizador = null;
/** Varios eventos llegan juntos: espera un momento y refresca una sola vez. */
function refrescarConDemora() {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => refrescar(), 300);
}

/** Vuelve a leer rol, credencial y solicitud de la wallet conectada. */
export async function refrescar() {
  if (sesion.estado !== "CONECTADO" || !sesion.cuenta) return;
  actualizar(await leerDatosDeCuenta(sesion.cuenta));
}

// ---------------------------------------------------------------------------
// Lecturas de la cuenta conectada
// ---------------------------------------------------------------------------

async function leerDatosDeCuenta(cuenta) {
  const c = obtenerContrato();
  const [esAdmin, [tokenId, datos]] = await Promise.all([
    c.hasRole(await c.ADMIN_ROLE(), cuenta),
    c.credencialDe(cuenta),
  ]);

  /** @type {CredencialPropia | null} */
  let credencial = null;
  if (tokenId !== 0n) {
    const estado = datos.revocada ? "REVOCADA" : ahora() > Number(datos.validaHasta) ? "VENCIDA" : "VIGENTE";
    credencial = {
      tokenId,
      rol: ROLES[Number(datos.rol)],
      nombre: datos.nombre,
      organismoId: Number(datos.organismoId),
      cuit: datos.cuit,
      emitidaEn: Number(datos.emitidaEn),
      validaHasta: Number(datos.validaHasta),
      estado,
      motivoRevocacion: estado === "REVOCADA" ? await motivoDeRevocacion(tokenId) : null,
    };
  }

  return { esAdmin, credencial, solicitud: await ultimaSolicitud(cuenta) };
}

async function motivoDeRevocacion(tokenId) {
  const c = obtenerContrato();
  const eventos = await c.queryFilter(c.filters.CredencialRevocada(tokenId), deployBlock);
  return eventos.at(-1)?.args?.motivo ?? null;
}

/** @returns {Promise<SolicitudPropia | null>} */
async function ultimaSolicitud(cuenta) {
  const c = obtenerContrato();
  const creadas = await c.queryFilter(c.filters.SolicitudCreada(null, cuenta), deployBlock);
  const ultima = creadas.at(-1);
  if (!ultima) return null;

  const id = ultima.args.solicitudId;
  const s = await c.solicitud(id);
  const estado = ESTADOS_SOLICITUD[Number(s.estado)];
  let motivoRechazo = null;
  if (estado === "RECHAZADA") {
    const rechazos = await c.queryFilter(c.filters.SolicitudRechazada(id), deployBlock);
    motivoRechazo = rechazos.at(-1)?.args?.motivo ?? null;
  }
  return { id, estado, razonSocial: s.razonSocial, cuit: s.cuit, creadaEn: Number(s.creadaEn), motivoRechazo };
}
