// Qué pantallas ve cada usuario según su sesión.
//
// Es solo para la interfaz (no ofrecer lo que no corresponde): la seguridad real la dan los
// contratos, que verifican el rol en cada transacción.
//
//                         Inicio  Licitaciones  Registrarse  Mi credencial  Administración
//   Invitado                ✓          ✓             ✓
//   Conectado sin nada      ✓          ✓             ✓
//   Solicitud en curso      ✓          ✓             ✓             ✓
//   Credencial revocada     ✓          ✓             ✓             ✓
//   Proveedor / Empleado /
//   Inspector (o vencida)   ✓          ✓                           ✓
//   Admin sin credencial    ✓                                                     ✓
//   Admin con credencial    ✓          ✓                           ✓              ✓

/** @typedef {"inicio" | "licitaciones" | "detalle" | "registro" | "mi-credencial" | "admin"} Pagina */

/**
 * @param {import("../web3/sesion.js").Sesion} sesion
 * @returns {Set<Pagina>}
 */
export function paginasPermitidas(sesion) {
  /** @type {Set<Pagina>} */
  const paginas = new Set(["inicio"]);
  const conectado = sesion.estado === "CONECTADO";
  const { credencial, solicitud, esAdmin } = sesion;

  // Fuera de línea (sin wallet, red incorrecta, cargando) se ve el espacio público.
  if (!conectado) {
    paginas.add("licitaciones").add("detalle").add("registro");
    return paginas;
  }

  // Con una credencial que no fue revocada ya tiene un rol: no tiene sentido registrarse
  // (si está vencida, la renueva un administrador).
  const tieneCredencial = Boolean(credencial && credencial.estado !== "REVOCADA");
  const soloAdmin = esAdmin && !credencial;

  if (!soloAdmin) paginas.add("licitaciones").add("detalle");
  if (!tieneCredencial && !esAdmin) paginas.add("registro");
  if (credencial || solicitud) paginas.add("mi-credencial");
  if (esAdmin) paginas.add("admin");

  return paginas;
}
