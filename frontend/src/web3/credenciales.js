// Lecturas y transacciones sobre CredencialNFT que usan las pantallas.

import { ROLES, VIGENCIA_POR_DEFECTO_DIAS } from "../config/contracts.js";
import { pedirInscripcion, registrarFuncionario } from "./backend.js";
import { siblingsDe } from "./grupo.js";
import { miIdentidad } from "./identidad.js";
import { ahora, contratosDeLectura, obtenerContrato, obtenerFirmante, obtenerSesion } from "./sesion.js";

const DIA = 24 * 60 * 60;

/** Timestamp de vencimiento a `dias` días de hoy. */
async function venceEn(dias = VIGENCIA_POR_DEFECTO_DIAS) {
  const bloque = await obtenerContrato().runner.provider.getBlock("latest");
  return BigInt(Math.max(ahora(), bloque.timestamp) + dias * DIA);
}

/** Espera la confirmación de una transacción. */
async function confirmar(txPromesa) {
  const tx = await txPromesa;
  await tx.wait();
  return tx;
}

// ---------------------------------------------------------------------------
// Lecturas para el panel de admin
// ---------------------------------------------------------------------------

/**
 * @typedef {object} CredencialListada
 * @property {bigint} tokenId
 * @property {string} wallet
 * @property {"PROVEEDOR" | "EMPLEADO" | "INSPECTOR"} rol
 * @property {string} nombre
 * @property {number} organismoId
 * @property {bigint} cuit
 * @property {number} validaHasta
 * @property {string} datosHash
 * @property {boolean} revocada
 * @property {boolean} vencida
 * @property {"VIGENTE" | "VENCIDA" | "REVOCADA"} estado
 */

/** @returns {Promise<CredencialListada[]>} */
export async function leerCredenciales() {
  const { credenciales: c } = await contratosDeLectura();
  const total = Number(await c.totalEmitidas());
  const ids = Array.from({ length: total }, (_, i) => BigInt(i + 1));

  return Promise.all(
    ids.map(async (tokenId) => {
      const [datos, wallet] = await Promise.all([c.credencial(tokenId), c.ownerOf(tokenId)]);
      const vencida = ahora() > Number(datos.validaHasta);
      return {
        tokenId,
        wallet,
        rol: ROLES[Number(datos.rol)],
        nombre: datos.nombre,
        organismoId: Number(datos.organismoId),
        cuit: datos.cuit,
        validaHasta: Number(datos.validaHasta),
        datosHash: datos.datosHash,
        revocada: datos.revocada,
        vencida,
        estado: datos.revocada ? "REVOCADA" : vencida ? "VENCIDA" : "VIGENTE",
      };
    }),
  );
}

/** Última credencial de una wallet cualquiera (para avisar antes de emitir). */
export async function credencialDeWallet(wallet) {
  const { credenciales } = await contratosDeLectura();
  const [tokenId, datos] = await credenciales.credencialDe(wallet);
  if (tokenId === 0n) return null;
  return { tokenId, revocada: datos.revocada, rol: ROLES[Number(datos.rol)], nombre: datos.nombre };
}

// ---------------------------------------------------------------------------
// Proveedores: inscripción automática
// ---------------------------------------------------------------------------

/**
 * 1. Recupera la identidad anónima (firma). 2. Pide la autorización al backend (que verifica en AFIP).
 * 3. Si la aprueba, manda `inscribirProveedor` con la firma del verificador.
 * @returns {Promise<{ aprobada: boolean, motivo: string }>}
 */
export async function inscribirProveedor(datos, alAvanzar = () => {}) {
  alAvanzar("Firmá en tu wallet para generar tu identidad anónima…");
  const identidad = await miIdentidad();

  alAvanzar("Verificando en AFIP…");
  const r = await pedirInscripcion({ ...datos, wallet: obtenerSesion().cuenta, identityCommitment: identidad.commitment.toString() });
  if (!r.aprobada) return r;

  alAvanzar("Aprobada. Confirmá la transacción en tu wallet para recibir la credencial…");
  await confirmar(obtenerContrato().inscribirProveedor(r.inscripcion, r.firma));
  return r;
}

// ---------------------------------------------------------------------------
// Empleados e inspectores: alta por el admin
// ---------------------------------------------------------------------------

/**
 * Guarda los datos completos en el backend (firma de admin) y emite la credencial con su hash.
 * @param {{ wallet: string, rol: "EMPLEADO" | "INSPECTOR", organismoId: number, nombre: string, dni: string,
 *   area?: string, cargo?: string, resolucion?: string, domicilioLegal?: string }} datos
 */
export async function emitirFuncionario(datos, dias, alAvanzar = () => {}) {
  alAvanzar("Firmá en tu wallet el acceso de administrador (una vez por sesión)…");
  const { datosHash } = await registrarFuncionario(obtenerFirmante(), datos);
  alAvanzar("Confirmá la transacción en tu wallet…");
  return confirmar(
    obtenerContrato().emitirFuncionario(datos.wallet, ROLES.indexOf(datos.rol), datos.organismoId, datos.nombre, await venceEn(dias), datosHash),
  );
}

// ---------------------------------------------------------------------------
// Revocación y renovación
// ---------------------------------------------------------------------------

/** Admin: revoca una credencial. A los proveedores además los saca del grupo de Semaphore. */
export async function revocar(tokenId, motivo) {
  const c = obtenerContrato();
  const { credenciales } = await contratosDeLectura();
  const datos = await credenciales.credencial(tokenId);
  if (ROLES[Number(datos.rol)] !== "PROVEEDOR") return confirmar(c.revocar(tokenId, motivo));
  const [commitment, enGrupo] = await credenciales.compromisoDe(tokenId);
  return confirmar(c.revocarProveedor(tokenId, motivo, enGrupo ? await siblingsDe(commitment) : []));
}

/** Admin: renueva una credencial. */
export async function renovar(tokenId, dias) {
  return confirmar(obtenerContrato().renovar(tokenId, await venceEn(dias)));
}

/** Cualquiera: saca del grupo a un proveedor con la credencial vencida. */
export async function quitarVencidoDelGrupo(tokenId) {
  const { credenciales } = await contratosDeLectura();
  const [commitment] = await credenciales.compromisoDe(tokenId);
  return confirmar(obtenerContrato().quitarVencidoDelGrupo(tokenId, await siblingsDe(commitment)));
}
