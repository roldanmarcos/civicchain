// Qué pantallas ve cada usuario según su sesión.
//
// Es solo para la interfaz (no ofrecer lo que no corresponde): la seguridad real la dan los
// contratos, que verifican el rol en cada transacción.
//
//                         Inicio  Licitaciones  Registrarse  Mi credencial  Publicar  Administración
//   Invitado                ✓          ✓             ✓
//   Conectado sin nada      ✓          ✓             ✓
//   Inscripción rechazada   ✓          ✓             ✓             ✓
//   Credencial revocada     ✓          ✓             ✓             ✓
//   Empleado vigente        ✓          ✓                           ✓            ✓
//   Proveedor / Inspector
//   (o vencida)             ✓          ✓                           ✓
//   Admin                   ✓          ✓                           (si tiene)              ✓
//
// Las licitaciones son públicas: las ve todo el mundo.

/** @typedef {"inicio" | "licitaciones" | "detalle" | "registro" | "mi-credencial" | "nueva-licitacion" | "admin"} Pagina */

/**
 * @param {import("../web3/sesion.js").Sesion} sesion
 * @returns {Set<Pagina>}
 */
export function paginasPermitidas(sesion) {
  /** @type {Set<Pagina>} */
  const paginas = new Set(["inicio", "licitaciones", "detalle"]);
  const conectado = sesion.estado === "CONECTADO";
  const { credencial, inscripciones, esAdmin } = sesion;

  // Fuera de línea (sin wallet, red incorrecta, cargando) se ve el espacio público.
  if (!conectado) return paginas.add("registro");

  // Con una credencial que no fue revocada ya tiene un rol: no tiene sentido registrarse
  // (si está vencida, la renueva un administrador).
  const tieneCredencial = Boolean(credencial && credencial.estado !== "REVOCADA");
  if (!tieneCredencial && !esAdmin) paginas.add("registro");
  if (credencial || inscripciones.length > 0) paginas.add("mi-credencial");
  if (credencial?.rol === "EMPLEADO" && credencial.estado === "VIGENTE") paginas.add("nueva-licitacion");
  if (esAdmin) paginas.add("admin");

  return paginas;
}
