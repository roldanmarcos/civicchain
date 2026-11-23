// Sesión: wallet conectada, red, rol y credencial; y la conexión de solo lectura a la cadena.
//
// La dApp nunca mueve el NFT: el "login" es leer del contrato qué credencial tiene la wallet.
// Este chequeo es solo para la interfaz; la seguridad real la dan los contratos, que vuelven a
// verificar el rol en cada transacción.
//
// Sin wallet también se puede leer todo (espacio público): las lecturas van directo a un nodo
// (NETWORKS[red].rpcUrl) y MetaMask solo se usa para firmar.

import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { DEFAULT_CHAIN_ID, NETWORKS, ROLES, WALLETCONNECT_PROJECT_ID, getAbi, getDeployment } from "../config/contracts.js";
import { historialDeInscripciones } from "./backend.js";
import { consultarEventos } from "../shared/eventos.js";

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
 * @property {string} datosHash
 * @property {boolean} enGrupo Solo proveedores: si su identidad está en el grupo de Semaphore
 * @property {EstadoCredencial} estado
 * @property {string | null} motivoRevocacion
 *
 * @typedef {object} InscripcionBackend
 * @property {number} id
 * @property {string} cuit
 * @property {string} razonSocial
 * @property {"AUTORIZADA" | "RECHAZADA"} estado
 * @property {string} resultado
 * @property {string} motivo
 * @property {number} creadaEn
 *
 * @typedef {object} Sesion
 * @property {"CARGANDO" | "SIN_METAMASK" | "DESCONECTADO" | "RED_INCORRECTA" | "SIN_CONTRATO" | "CONECTADO"} estado
 * @property {string | null} cuenta
 * @property {number | null} chainId
 * @property {boolean} esAdmin
 * @property {CredencialPropia | null} credencial Última credencial de la wallet (puede estar vencida o revocada)
 * @property {InscripcionBackend[]} inscripciones Historial de inscripciones de la wallet en el backend
 * @property {boolean} conQR Si la wallet está conectada por WalletConnect (QR)
 */

const EVENTOS_CREDENCIALES = ["CredencialEmitida", "CredencialRevocada", "CredencialRenovada"];
const EVENTOS_LICITACIONES = [
  "LicitacionPublicada",
  "OfertaRecibida",
  "OfertaAbierta",
  "LicitacionAdjudicada",
  "LicitacionDesierta",
  "AutoriaRevelada",
  "InspectorAsignado",
  "EvaluacionRegistrada",
];

/** @type {Sesion} */
let sesion = { estado: "CARGANDO", cuenta: null, chainId: null, esAdmin: false, credencial: null, inscripciones: [], conQR: false };

/** Contratos conectados a la wallet (para firmar). */
let escritura = null;
/** Contratos de solo lectura (siempre disponibles si la red tiene rpcUrl). */
let lectura = null;
/** @type {import("ethers").JsonRpcSigner | null} */
let firmante = null;
/** Proveedor EIP-1193 de WalletConnect, si se conectó por QR. */
let walletConnect = null;

const suscriptores = new Set();
const suscriptoresCadena = new Set();

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

/** Avisa cuando hay eventos nuevos en los contratos (para refrescar listados). */
export function alCambiarCadena(fn) {
  suscriptoresCadena.add(fn);
  return () => suscriptoresCadena.delete(fn);
}

function actualizar(cambios) {
  sesion = { ...sesion, ...cambios };
  for (const fn of suscriptores) fn(sesion);
}

/** CredencialNFT conectado con la wallet (para firmar transacciones). */
export function obtenerContrato() {
  if (!escritura) throw new Error("Conectá tu wallet primero.");
  return escritura.credenciales;
}

/** Licitaciones conectado con la wallet (para firmar transacciones). */
export function obtenerLicitaciones() {
  if (!escritura) throw new Error("Conectá tu wallet primero.");
  return escritura.licitaciones;
}

/** Firmante de la wallet conectada (para firmar mensajes). */
export function obtenerFirmante() {
  if (!firmante) throw new Error("Conectá tu wallet primero.");
  return firmante;
}

/**
 * Contratos de solo lectura y el bloque desde donde buscar eventos.
 * @returns {Promise<{ chainId: number, provider: JsonRpcProvider, credenciales: Contract, licitaciones: Contract, semaphore: Contract, desde: number }>}
 */
export async function contratosDeLectura() {
  if (lectura) return lectura;
  const chainId = redObjetivo();
  const dep = (nombre) => getDeployment(chainId, nombre);
  if (!dep("CredencialNFT") || !dep("Licitaciones")) throw new Error("Los contratos no están desplegados. Corré el script de despliegue.");
  const provider = new JsonRpcProvider(NETWORKS[chainId].rpcUrl, chainId, { staticNetwork: true, pollingInterval: 2000 });
  const [abiCred, abiLic, abiSem] = await Promise.all([getAbi("CredencialNFT"), getAbi("Licitaciones"), getAbi("Semaphore")]);
  lectura = {
    chainId,
    provider,
    credenciales: new Contract(dep("CredencialNFT").address, abiCred, provider),
    licitaciones: new Contract(dep("Licitaciones").address, abiLic, provider),
    semaphore: new Contract(dep("Semaphore").address, abiSem, provider),
    desde: dep("CredencialNFT").deployBlock ?? 0,
  };
  // Eventos: refrescan la sesión y avisan a las pantallas.
  for (const e of EVENTOS_CREDENCIALES) lectura.credenciales.on(e, refrescarConDemora);
  for (const e of EVENTOS_LICITACIONES) lectura.licitaciones.on(e, avisarCambioCadena);
  return lectura;
}

/** Chain id donde está desplegado el proyecto. */
export function redObjetivo() {
  if (getDeployment(DEFAULT_CHAIN_ID, "CredencialNFT")) return DEFAULT_CHAIN_ID;
  return Number(Object.keys(NETWORKS).find((id) => getDeployment(id, "CredencialNFT")) ?? DEFAULT_CHAIN_ID);
}

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

const ethereumActivo = () => walletConnect ?? /** @type {any} */ (window).ethereum;

/** Se llama al cargar la página: reconecta sin abrir MetaMask si el usuario ya había autorizado. */
export async function iniciarSesion() {
  contratosDeLectura().catch(() => {});
  const ethereum = /** @type {any} */ (window).ethereum;
  if (!ethereum) {
    actualizar({ estado: "SIN_METAMASK" });
    return;
  }
  ethereum.on?.("accountsChanged", () => !walletConnect && cargar());
  ethereum.on?.("chainChanged", () => !walletConnect && cargar());
  await cargar();
}

/** Abre MetaMask para pedir acceso a la wallet. */
export async function conectar() {
  const ethereum = /** @type {any} */ (window).ethereum;
  if (!ethereum) throw new Error("Necesitás la extensión MetaMask para conectarte (o usá el QR).");
  await ethereum.request({ method: "eth_requestAccounts" });
  await cargar();
}

/** ¿Se puede conectar con QR? Hace falta el project id de WalletConnect y una red pública. */
export const qrDisponible = () => Boolean(WALLETCONNECT_PROJECT_ID) && redObjetivo() !== 31337;

/**
 * Conecta una wallet del celular (MetaMask Mobile u otra) escaneando un QR, con WalletConnect.
 * DUDA: necesita VITE_WALLETCONNECT_PROJECT_ID (gratis en cloud.reown.com) y no sirve con la red
 * local: el celular no llega a 127.0.0.1. Para la demo con QR hay que desplegar en Sepolia.
 */
export async function conectarConQR() {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error("Para conectar con QR falta configurar VITE_WALLETCONNECT_PROJECT_ID (ver README).");
  }
  const chainId = redObjetivo();
  if (chainId === 31337) throw new Error("El QR solo funciona en una red pública (Sepolia): el celular no ve la red local.");
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const wc = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [chainId],
    showQrModal: true,
    rpcMap: { [chainId]: NETWORKS[chainId].rpcUrl },
    metadata: {
      name: "CivicChain",
      description: "Licitaciones públicas con ofertas anónimas",
      url: window.location.origin,
      icons: [],
    },
  });
  await wc.connect();
  wc.on("accountsChanged", () => cargar());
  wc.on("disconnect", () => {
    walletConnect = null;
    cargar();
  });
  walletConnect = wc;
  await cargar();
}

/** Desconecta la sesión de WalletConnect (MetaMask de escritorio no tiene "desconectar" desde la dApp). */
export async function desconectarQR() {
  await walletConnect?.disconnect();
  walletConnect = null;
  await cargar();
}

/** Pide a MetaMask cambiar a la red donde está desplegado el contrato (y la agrega si hace falta). */
export async function cambiarRed() {
  const ethereum = ethereumActivo();
  const chainId = redObjetivo();
  const chainIdHex = `0x${chainId.toString(16)}`;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (error) {
    if (/** @type {any} */ (error)?.code !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: NETWORKS[chainId].name,
          rpcUrls: [NETWORKS[chainId].rpcUrl],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        },
      ],
    });
  }
}

async function cargar() {
  escritura = null;
  firmante = null;
  const ethereum = ethereumActivo();
  const provider = new BrowserProvider(ethereum);
  const cuentas = await provider.send("eth_accounts", []);
  const chainId = Number((await provider.getNetwork()).chainId);
  const base = { cuenta: cuentas[0] ?? null, chainId, esAdmin: false, credencial: null, inscripciones: [], conQR: Boolean(walletConnect) };

  if (!base.cuenta) {
    actualizar({ ...base, estado: "DESCONECTADO" });
    return;
  }

  const deployment = getDeployment(chainId, "CredencialNFT");
  if (!deployment) {
    actualizar({ ...base, estado: "RED_INCORRECTA" });
    return;
  }

  firmante = await provider.getSigner(base.cuenta);
  const runner = crearRunner(chainId, firmante);

  if ((await runner.provider.getCode(deployment.address)) === "0x") {
    // Pasa si se reinició el nodo local y no se volvió a correr el deploy.
    actualizar({ ...base, estado: "SIN_CONTRATO" });
    return;
  }

  escritura = {
    credenciales: new Contract(deployment.address, await getAbi("CredencialNFT"), runner),
    licitaciones: new Contract(getDeployment(chainId, "Licitaciones").address, await getAbi("Licitaciones"), runner),
  };
  await contratosDeLectura();

  actualizar({ ...base, estado: "CONECTADO", ...(await leerDatosDeCuenta(base.cuenta)) });
}

/**
 * Con quién habla el contrato. Las lecturas, los eventos y la estimación de gas van directo al nodo
 * y la wallet solo firma y envía las transacciones.
 * @param {number} chainId
 * @param {import("ethers").JsonRpcSigner} signer
 * @returns {import("ethers").ContractRunner & { provider: import("ethers").Provider }}
 */
function crearRunner(chainId, signer) {
  const rpcUrl = NETWORKS[chainId]?.rpcUrl;
  if (!rpcUrl) return /** @type {any} */ (signer);

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
  temporizador = setTimeout(() => {
    refrescar();
    avisarCambioCadena();
  }, 300);
}

let temporizadorCadena = null;
function avisarCambioCadena() {
  clearTimeout(temporizadorCadena);
  temporizadorCadena = setTimeout(() => suscriptoresCadena.forEach((fn) => fn()), 400);
}

/** Vuelve a leer rol, credencial e inscripciones de la wallet conectada. */
export async function refrescar() {
  if (sesion.estado !== "CONECTADO" || !sesion.cuenta) return;
  actualizar(await leerDatosDeCuenta(sesion.cuenta));
}

// ---------------------------------------------------------------------------
// Lecturas de la cuenta conectada
// ---------------------------------------------------------------------------

async function leerDatosDeCuenta(cuenta) {
  const { credenciales: c, desde } = await contratosDeLectura();
  const [esAdmin, [tokenId, datos]] = await Promise.all([c.hasRole(await c.ADMIN_ROLE(), cuenta), c.credencialDe(cuenta)]);

  /** @type {CredencialPropia | null} */
  let credencial = null;
  if (tokenId !== 0n) {
    const estado = datos.revocada ? "REVOCADA" : ahora() > Number(datos.validaHasta) ? "VENCIDA" : "VIGENTE";
    const rol = ROLES[Number(datos.rol)];
    const motivo = async () => {
      const eventos = await consultarEventos(c, c.filters.CredencialRevocada(tokenId), desde);
      return eventos.at(-1)?.args?.motivo ?? null;
    };
    credencial = {
      tokenId,
      rol,
      nombre: datos.nombre,
      organismoId: Number(datos.organismoId),
      cuit: datos.cuit,
      emitidaEn: Number(datos.emitidaEn),
      validaHasta: Number(datos.validaHasta),
      datosHash: datos.datosHash,
      enGrupo: rol === "PROVEEDOR" ? (await c.compromisoDe(tokenId))[1] : false,
      estado,
      motivoRevocacion: estado === "REVOCADA" ? await motivo() : null,
    };
  }

  // El historial del backend solo hace falta si todavía no tiene una credencial vigente.
  const inscripciones = credencial && credencial.estado !== "REVOCADA" ? [] : await historialDeInscripciones(cuenta).catch(() => []);
  return { esAdmin, credencial, inscripciones };
}
