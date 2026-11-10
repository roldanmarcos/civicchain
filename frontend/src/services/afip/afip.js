// AFIP (ARCA) simulada.
//
// Imita la consulta del padrón de contribuyentes (servicio ws_sr_padron_a13 de AFIP):
// dado un CUIT devuelve la persona inscripta, o null si no existe.
// La usan el panel de admin y el formulario de inscripción de la dApp, y las tasks de consola.
//
// Para conectarla a la AFIP real habría que reemplazar `consultarCuit` por una llamada a un
// backend propio, porque el servicio real exige certificado digital y no se puede llamar
// desde el navegador. El resto del código (verificarSolicitud) no cambia.
//
// Este módulo no importa el padrón: lo recibe por parámetro, así funciona igual en Vite y en Node.

/**
 * @typedef {object} PersonaAfip
 * @property {number} idPersona CUIT
 * @property {"JURIDICA" | "FISICA"} tipoPersona
 * @property {"ACTIVO" | "INACTIVO"} estadoClave
 * @property {string} [razonSocial] Solo personas jurídicas
 * @property {string} [apellido] Solo personas físicas
 * @property {string} [nombre] Solo personas físicas
 * @property {{ direccion: string, localidad: string, descripcionProvincia: string }} domicilioFiscal
 * @property {string[]} actividades
 */

/**
 * @typedef {object} Verificacion
 * @property {string} resultado Uno de RESULTADOS
 * @property {boolean} ok
 * @property {string} mensaje Texto para mostrar al usuario
 * @property {PersonaAfip | null} persona
 */

export const RESULTADOS = {
  OK: "OK",
  CUIT_INVALIDO: "CUIT_INVALIDO",
  CUIT_INEXISTENTE: "CUIT_INEXISTENTE",
  CUIT_INACTIVO: "CUIT_INACTIVO",
  RAZON_SOCIAL_NO_COINCIDE: "RAZON_SOCIAL_NO_COINCIDE",
};

/** Mismo algoritmo que `cuitValido` del contrato: 11 dígitos y dígito verificador. */
export function cuitValido(cuit) {
  const digitos = String(cuit).replace(/\D/g, "");
  if (!/^\d{11}$/.test(digitos)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((total, peso, i) => total + peso * Number(digitos[i]), 0);
  let esperado = 11 - (suma % 11);
  if (esperado === 11) esperado = 0;
  return esperado !== 10 && esperado === Number(digitos[10]);
}

/**
 * Nombre con el que figura en AFIP: razón social (jurídicas) o "APELLIDO NOMBRE" (físicas).
 * @param {PersonaAfip} persona
 * @returns {string}
 */
export function denominacion(persona) {
  return persona.tipoPersona === "JURIDICA" ? persona.razonSocial : `${persona.apellido} ${persona.nombre}`;
}

/**
 * Normaliza un nombre para compararlo: sin tildes, mayúsculas y signos de puntuación.
 * "Construcciones del Sur S.A." y "CONSTRUCCIONES DEL SUR SA" quedan iguales.
 */
export function normalizarNombre(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Crea un cliente de la AFIP simulada.
 * @param {PersonaAfip[]} padron Lista de personas (ver padron.json).
 * @param {{ demoraMs?: number }} [opciones] `demoraMs` simula la latencia de un servicio real.
 */
export function crearClienteAfip(padron, { demoraMs = 0 } = {}) {
  const porCuit = new Map(padron.map((p) => [String(p.idPersona), p]));
  const esperar = () => (demoraMs > 0 ? new Promise((r) => setTimeout(r, demoraMs)) : Promise.resolve());

  /**
   * Devuelve la persona inscripta con ese CUIT, o null si no existe.
   * @param {string | number | bigint} cuit
   * @returns {Promise<PersonaAfip | null>}
   */
  async function consultarCuit(cuit) {
    await esperar();
    return porCuit.get(String(cuit).replace(/\D/g, "")) ?? null;
  }

  /**
   * Verifica los datos de una solicitud de inscripción contra el padrón.
   * @param {{ cuit: string | number | bigint, razonSocial: string }} solicitud
   * @returns {Promise<Verificacion>}
   */
  async function verificarSolicitud({ cuit, razonSocial }) {
    if (!cuitValido(cuit)) {
      return { resultado: RESULTADOS.CUIT_INVALIDO, ok: false, mensaje: "El CUIT no es válido.", persona: null };
    }

    const persona = await consultarCuit(cuit);
    if (!persona) {
      return {
        resultado: RESULTADOS.CUIT_INEXISTENTE,
        ok: false,
        mensaje: "El CUIT no figura en el padrón de AFIP.",
        persona: null,
      };
    }

    const nombreAfip = denominacion(persona);
    if (persona.estadoClave !== "ACTIVO") {
      return {
        resultado: RESULTADOS.CUIT_INACTIVO,
        ok: false,
        mensaje: `El CUIT está ${persona.estadoClave.toLowerCase()} en AFIP (${nombreAfip}).`,
        persona,
      };
    }

    if (normalizarNombre(razonSocial) !== normalizarNombre(nombreAfip)) {
      return {
        resultado: RESULTADOS.RAZON_SOCIAL_NO_COINCIDE,
        ok: false,
        mensaje: `La razón social no coincide: en AFIP figura "${nombreAfip}".`,
        persona,
      };
    }

    return { resultado: RESULTADOS.OK, ok: true, mensaje: `Verificado en AFIP (${nombreAfip})`, persona };
  }

  return { consultarCuit, verificarSolicitud };
}
