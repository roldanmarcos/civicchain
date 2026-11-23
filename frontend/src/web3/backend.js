// Cliente del backend: verificador de inscripciones, base de datos, IPFS local y relayer.

import { BACKEND_URL } from "../config/contracts.js";

const mensajeAccesoAdmin = (fechaIso) => `CivicChain: acceso de administrador\nFecha: ${fechaIso}`;

/** Firma de acceso de admin, reutilizada mientras dure la sesión (vale 12 horas en el backend). */
let accesoAdmin = null;

async function pedir(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`${BACKEND_URL}${ruta}`, opciones);
  } catch {
    throw new Error("No se pudo conectar con el backend de CivicChain. ¿Está corriendo? (cd backend && npm start)");
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error ?? `El backend respondió ${respuesta.status}.`);
  return datos;
}

const postJson = (ruta, cuerpo, headers = {}) =>
  pedir(ruta, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(cuerpo) });

/** URL pública de un archivo de IPFS (gateway del backend). */
export const urlIpfs = (cid) => `${BACKEND_URL}/ipfs/${cid}`;

/** Sube un archivo o texto a IPFS y devuelve su CID. */
export async function subirArchivo(contenido, tipo) {
  const cuerpo = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const { cid } = await pedir("/api/ipfs", {
    method: "POST",
    headers: { "Content-Type": tipo ?? (cuerpo.type || "application/octet-stream") },
    body: cuerpo,
  });
  return cid;
}

/** Sube un objeto como JSON. */
export const subirJson = (objeto) => subirArchivo(JSON.stringify(objeto), "application/json");

/** Lee un JSON de IPFS (metadatos de una licitación). */
export async function leerJsonIpfs(cid) {
  const r = await fetch(urlIpfs(cid));
  if (!r.ok) throw new Error(`No se encontró ${cid} en IPFS.`);
  return r.json();
}

/**
 * Pide la autorización para inscribirse como proveedor.
 * @returns {Promise<{ aprobada: boolean, motivo: string, resultado?: string, firma?: string, inscripcion?: Record<string, string> }>}
 */
export const pedirInscripcion = (datos) => postJson("/api/inscripciones", datos);

export const historialDeInscripciones = (wallet) => pedir(`/api/inscripciones?wallet=${wallet}`);

/** Datos completos de una inscripción (para verificar el hash que quedó en la cadena). */
export const datosDeInscripcion = (hash) => pedir(`/api/inscripciones/hash/${hash}`);

/** Encabezados de acceso de admin: pide una firma a la wallet la primera vez. */
async function encabezadosAdmin(firmante) {
  const cuenta = (await firmante.getAddress()).toLowerCase();
  if (!accesoAdmin || accesoAdmin.cuenta !== cuenta || Date.now() - accesoAdmin.ms > 11 * 3600 * 1000) {
    const fecha = new Date().toISOString();
    accesoAdmin = { cuenta, ms: Date.now(), fecha, firma: await firmante.signMessage(mensajeAccesoAdmin(fecha)) };
  }
  return { "X-Admin-Fecha": accesoAdmin.fecha, "X-Admin-Firma": accesoAdmin.firma };
}

/** Admin: guarda los datos completos de un funcionario y devuelve el hash para la credencial. */
export async function registrarFuncionario(firmante, datos) {
  return postJson("/api/funcionarios", datos, await encabezadosAdmin(firmante));
}

/** Admin: datos completos de un funcionario (con DNI). */
export async function datosDeFuncionario(firmante, hash) {
  return pedir(`/api/funcionarios/hash/${hash}`, { headers: await encabezadosAdmin(firmante) });
}

/** Admin: todas las inscripciones procesadas (aprobadas y rechazadas). */
export async function todasLasInscripciones(firmante) {
  return pedir(`/api/inscripciones/todas`, { headers: await encabezadosAdmin(firmante) });
}

/** Manda una oferta anónima a través del relayer. */
export const enviarOfertaPorRelayer = (oferta) =>
  postJson("/api/relayer/ofertas", JSON.parse(JSON.stringify(oferta, (_, v) => (typeof v === "bigint" ? String(v) : v))));
