// Padrón de empleados estatales simulado.
//
// Representa la base de Recursos Humanos de los organismos: quién trabaja dónde, con qué función,
// si sigue activo y qué wallet declaró. El DNI vive solo acá, nunca en la cadena.
//
// Lo usan el panel de admin (alta de funcionarios y auditoría de credenciales) y las tasks de consola.
// Este módulo no importa el padrón: lo recibe por parámetro, así funciona igual en Vite y en Node.

/**
 * @typedef {object} Empleado
 * @property {string} dni
 * @property {string} nombre
 * @property {"EMPLEADO" | "INSPECTOR"} funcion
 * @property {number} organismoId
 * @property {string} area
 * @property {string} cargo
 * @property {string} resolucion Resolución que acredita el nombramiento
 * @property {"ACTIVO" | "BAJA"} estado
 * @property {string | null} wallet Wallet declarada ante Recursos Humanos (null si no declaró ninguna)
 */

/**
 * Credencial leída de la cadena, en el formato que espera `auditar`.
 * @typedef {object} CredencialAuditable
 * @property {number | bigint} tokenId
 * @property {string} wallet Dueño del NFT
 * @property {"PROVEEDOR" | "EMPLEADO" | "INSPECTOR"} rol
 * @property {number} organismoId
 * @property {string} nombre
 * @property {boolean} revocada
 * @property {boolean} vencida
 */

/**
 * @typedef {object} Hallazgo
 * @property {string} tipo Uno de HALLAZGOS
 * @property {"REVOCAR" | "EMITIR" | "RENOVAR" | "REVOCAR_Y_EMITIR"} accion Acción sugerida al admin
 * @property {string} mensaje
 * @property {CredencialAuditable | null} credencial
 * @property {Empleado | null} empleado
 */

export const RESULTADOS_ALTA = {
  OK: "OK",
  DNI_INEXISTENTE: "DNI_INEXISTENTE",
  BAJA: "BAJA",
  SIN_WALLET: "SIN_WALLET",
};

export const HALLAZGOS = {
  /** Tiene credencial vigente pero figura de baja. */
  BAJA_CON_CREDENCIAL: "BAJA_CON_CREDENCIAL",
  /** La credencial está en una wallet distinta de la que declaró ante RR.HH. */
  WALLET_CAMBIADA: "WALLET_CAMBIADA",
  /** La credencial está en una wallet que no figura en el padrón. */
  WALLET_DESCONOCIDA: "WALLET_DESCONOCIDA",
  /** Figura en otro organismo que el de su credencial. */
  CAMBIO_ORGANISMO: "CAMBIO_ORGANISMO",
  /** Figura con otra función (empleado/inspector) que la de su credencial. */
  CAMBIO_FUNCION: "CAMBIO_FUNCION",
  /** Sigue activo, pero su credencial venció. */
  VENCIDA: "VENCIDA",
  /** Está activo y con wallet, pero no tiene credencial. */
  SIN_CREDENCIAL: "SIN_CREDENCIAL",
};

const mismaWallet = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

/**
 * Crea un cliente del padrón simulado.
 * @param {Empleado[]} registros
 * @param {{ demoraMs?: number }} [opciones] `demoraMs` simula la latencia de un servicio real.
 */
export function crearClientePadron(registros, { demoraMs = 0 } = {}) {
  const esperar = () => (demoraMs > 0 ? new Promise((r) => setTimeout(r, demoraMs)) : Promise.resolve());
  const normalizarDni = (dni) => String(dni).replace(/\D/g, "");

  /**
   * @param {string | number} dni Con o sin puntos.
   * @returns {Promise<Empleado | null>}
   */
  async function consultarDni(dni) {
    await esperar();
    return registros.find((e) => e.dni === normalizarDni(dni)) ?? null;
  }

  /**
   * @param {string} wallet
   * @returns {Promise<Empleado | null>}
   */
  async function buscarPorWallet(wallet) {
    await esperar();
    return registros.find((e) => mismaWallet(e.wallet, wallet)) ?? null;
  }

  /**
   * Verifica si se le puede emitir una credencial a una persona.
   * @param {string | number} dni
   * @returns {Promise<{ resultado: string, ok: boolean, mensaje: string, empleado: Empleado | null }>}
   */
  async function verificarAlta(dni) {
    const empleado = await consultarDni(dni);
    if (!empleado) {
      return { resultado: RESULTADOS_ALTA.DNI_INEXISTENTE, ok: false, mensaje: "El DNI no figura en el padrón.", empleado };
    }
    if (empleado.estado !== "ACTIVO") {
      return { resultado: RESULTADOS_ALTA.BAJA, ok: false, mensaje: `${empleado.nombre} figura de baja en el padrón.`, empleado };
    }
    if (!empleado.wallet) {
      return {
        resultado: RESULTADOS_ALTA.SIN_WALLET,
        ok: false,
        mensaje: `${empleado.nombre} no declaró una wallet ante Recursos Humanos.`,
        empleado,
      };
    }
    return { resultado: RESULTADOS_ALTA.OK, ok: true, mensaje: `${empleado.nombre} está activo en el padrón.`, empleado };
  }

  /**
   * Cruza las credenciales de la cadena con el padrón y devuelve lo que el admin debería corregir.
   * Las credenciales de proveedores y las revocadas se ignoran.
   * @param {CredencialAuditable[]} credenciales
   * @returns {Promise<Hallazgo[]>}
   */
  async function auditar(credenciales) {
    await esperar();
    const vigentes = credenciales.filter((c) => !c.revocada && c.rol !== "PROVEEDOR");
    /** @type {Hallazgo[]} */
    const hallazgos = [];

    for (const credencial of vigentes) {
      const empleado = registros.find((e) => mismaWallet(e.wallet, credencial.wallet));

      if (!empleado) {
        // ¿Es alguien del padrón que declaró otra wallet?
        const mismaPersona = registros.find(
          (e) => e.nombre === credencial.nombre && e.organismoId === credencial.organismoId,
        );
        if (mismaPersona?.wallet) {
          hallazgos.push({
            tipo: HALLAZGOS.WALLET_CAMBIADA,
            accion: "REVOCAR_Y_EMITIR",
            mensaje: `${credencial.nombre} declaró otra wallet (${mismaPersona.wallet}). Revocar la credencial de la wallet anterior y emitir una nueva.`,
            credencial,
            empleado: mismaPersona,
          });
        } else {
          hallazgos.push({
            tipo: HALLAZGOS.WALLET_DESCONOCIDA,
            accion: "REVOCAR",
            mensaje: `La wallet de ${credencial.nombre} no figura en el padrón.`,
            credencial,
            empleado: null,
          });
        }
        continue;
      }

      if (empleado.estado !== "ACTIVO") {
        hallazgos.push({
          tipo: HALLAZGOS.BAJA_CON_CREDENCIAL,
          accion: "REVOCAR",
          mensaje: `${empleado.nombre} figura de baja en el padrón, pero su credencial sigue sin revocar.`,
          credencial,
          empleado,
        });
      } else if (empleado.organismoId !== credencial.organismoId) {
        hallazgos.push({
          tipo: HALLAZGOS.CAMBIO_ORGANISMO,
          accion: "REVOCAR_Y_EMITIR",
          mensaje: `${empleado.nombre} ahora figura en otro organismo. Revocar y emitir una credencial nueva.`,
          credencial,
          empleado,
        });
      } else if (empleado.funcion !== credencial.rol) {
        hallazgos.push({
          tipo: HALLAZGOS.CAMBIO_FUNCION,
          accion: "REVOCAR_Y_EMITIR",
          mensaje: `${empleado.nombre} ahora figura como ${empleado.funcion.toLowerCase()}. Revocar y emitir una credencial nueva.`,
          credencial,
          empleado,
        });
      } else if (credencial.vencida) {
        hallazgos.push({
          tipo: HALLAZGOS.VENCIDA,
          accion: "RENOVAR",
          mensaje: `La credencial de ${empleado.nombre} venció, aunque sigue en actividad según el padrón.`,
          credencial,
          empleado,
        });
      }
    }

    for (const empleado of registros) {
      if (empleado.estado !== "ACTIVO" || !empleado.wallet) continue;
      const tieneCredencial = vigentes.some((c) => mismaWallet(c.wallet, empleado.wallet));
      // Si ya se reportó un cambio de wallet, ese hallazgo incluye emitir la nueva.
      const yaReportado = hallazgos.some((h) => h.tipo === HALLAZGOS.WALLET_CAMBIADA && h.empleado === empleado);
      if (!tieneCredencial && !yaReportado) {
        hallazgos.push({
          tipo: HALLAZGOS.SIN_CREDENCIAL,
          accion: "EMITIR",
          mensaje: `${empleado.nombre} no tiene credencial, aunque está en actividad según el padrón.`,
          credencial: null,
          empleado,
        });
      }
    }

    return hallazgos;
  }

  return { consultarDni, buscarPorWallet, verificarAlta, auditar, listar: async () => (await esperar(), registros) };
}
