// Lecturas y transacciones sobre CredencialNFT que usan las pantallas.

import { ROLES, VIGENCIA_POR_DEFECTO_DIAS } from "../config/contracts.js";
import { ESTADOS_SOLICITUD, ahora, bloqueInicial, obtenerContrato } from "./sesion.js";

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
 * @property {boolean} revocada
 * @property {boolean} vencida
 * @property {"VIGENTE" | "VENCIDA" | "REVOCADA"} estado
 */

/** @returns {Promise<CredencialListada[]>} */
export async function leerCredenciales() {
  const c = obtenerContrato();
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
        revocada: datos.revocada,
        vencida,
        estado: datos.revocada ? "REVOCADA" : vencida ? "VENCIDA" : "VIGENTE",
      };
    }),
  );
}

/**
 * @typedef {object} SolicitudListada
 * @property {bigint} id
 * @property {string} wallet
 * @property {bigint} cuit
 * @property {string} razonSocial
 * @property {string} domicilioLegal
 * @property {string} rubros
 * @property {number} creadaEn
 * @property {"PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA"} estado
 * @property {string | null} motivoRechazo
 */

/** @returns {Promise<SolicitudListada[]>} Más recientes primero. */
export async function leerSolicitudes() {
  const c = obtenerContrato();
  const desde = bloqueInicial();
  // Domicilio, rubros y motivos de rechazo solo están en los eventos.
  const [creadas, rechazadas] = await Promise.all([
    c.queryFilter(c.filters.SolicitudCreada(), desde),
    c.queryFilter(c.filters.SolicitudRechazada(), desde),
  ]);
  const motivos = new Map(rechazadas.map((e) => [e.args.solicitudId, e.args.motivo]));

  const solicitudes = await Promise.all(
    creadas.map(async (e) => {
      const s = await c.solicitud(e.args.solicitudId);
      return {
        id: e.args.solicitudId,
        wallet: s.wallet,
        cuit: s.cuit,
        razonSocial: s.razonSocial,
        domicilioLegal: e.args.domicilioLegal,
        rubros: e.args.rubros,
        creadaEn: Number(s.creadaEn),
        estado: ESTADOS_SOLICITUD[Number(s.estado)],
        motivoRechazo: motivos.get(e.args.solicitudId) ?? null,
      };
    }),
  );
  return solicitudes.reverse();
}

/** Última credencial de una wallet cualquiera (para avisar antes de emitir). */
export async function credencialDeWallet(wallet) {
  const [tokenId, datos] = await obtenerContrato().credencialDe(wallet);
  if (tokenId === 0n) return null;
  return { tokenId, revocada: datos.revocada, rol: ROLES[Number(datos.rol)], nombre: datos.nombre };
}

// ---------------------------------------------------------------------------
// Transacciones
// ---------------------------------------------------------------------------

/** Proveedor: pide su credencial. */
export function solicitarInscripcion({ cuit, razonSocial, domicilioLegal, rubros }) {
  return confirmar(obtenerContrato().solicitarInscripcion(BigInt(cuit), razonSocial, domicilioLegal, rubros));
}

/** Proveedor: cancela su solicitud pendiente. */
export function cancelarSolicitud(id) {
  return confirmar(obtenerContrato().cancelarSolicitud(id));
}

/** Admin: aprueba una solicitud y emite la credencial. */
export async function aprobarSolicitud(id, dias) {
  return confirmar(obtenerContrato().aprobarSolicitud(id, await venceEn(dias)));
}

/** Admin: rechaza una solicitud. */
export function rechazarSolicitud(id, motivo) {
  return confirmar(obtenerContrato().rechazarSolicitud(id, motivo));
}

/**
 * Admin: emite la credencial de un empleado o inspector con los datos del padrón.
 * @param {import("../services/padron-empleados/padron.js").Empleado} empleado
 */
export async function emitirFuncionario(empleado, dias) {
  const rol = ROLES.indexOf(empleado.funcion);
  return confirmar(
    obtenerContrato().emitirFuncionario(empleado.wallet, rol, empleado.organismoId, empleado.nombre, await venceEn(dias)),
  );
}

/** Admin: revoca una credencial. */
export function revocar(tokenId, motivo) {
  return confirmar(obtenerContrato().revocar(tokenId, motivo));
}

/** Admin: renueva una credencial. */
export async function renovar(tokenId, dias) {
  return confirmar(obtenerContrato().renovar(tokenId, await venceEn(dias)));
}
