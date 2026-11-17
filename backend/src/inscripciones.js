// Inscripción automática de proveedores.
//
// 1. El proveedor manda sus datos, su clave fiscal (simulada) y el compromiso de su identidad de Semaphore.
// 2. Se verifica en AFIP que el CUIT exista, esté activo, la razón social coincida y quien se inscribe
//    represente a la empresa. También que el CUIT y la wallet no tengan ya una credencial vigente.
// 3. Si todo está bien, se guardan los datos completos (con una sal) y se firma una autorización EIP-712
//    con el hash. El proveedor la presenta en `inscribirProveedor` y recibe la credencial en el momento.
// 4. Si algo falla, se guarda el rechazo con su motivo y no se firma nada (no llega a la cadena).
//
// No hay revisión manual. DUDA: ¿quieren un camino de excepción (por ejemplo, empresas recién
// inscriptas en AFIP que todavía no figuran en el padrón)? Hoy esas quedan rechazadas.

import { getAddress, isAddress } from "ethers";
import { RESULTADOS, cuitValido, denominacion } from "./afip/afip.js";
import { TIPOS_INSCRIPCION } from "../../frontend/src/shared/protocolo.js";

/** Orden del campo escalar de la curva BN254: los compromisos de Semaphore tienen que ser menores. */
const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export class ErrorDeDatos extends Error {}

function validar(body) {
  const texto = (v, max) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
  if (!isAddress(body?.wallet)) throw new ErrorDeDatos("La wallet no es válida.");
  if (!texto(body.cuit, 13)) throw new ErrorDeDatos("Falta el CUIT.");
  if (!texto(body.razonSocial, 120)) throw new ErrorDeDatos("La razón social es obligatoria (hasta 120 caracteres).");
  if (!texto(body.domicilioLegal, 240)) throw new ErrorDeDatos("El domicilio legal es obligatorio (hasta 240 caracteres).");
  if (!texto(body.rubros, 240)) throw new ErrorDeDatos("Los rubros son obligatorios (hasta 240 caracteres).");
  if (!texto(body.claveFiscal, 64)) throw new ErrorDeDatos("Falta la clave fiscal.");
  let commitment;
  try {
    commitment = BigInt(body.identityCommitment);
  } catch {
    throw new ErrorDeDatos("El compromiso de identidad no es válido.");
  }
  if (commitment <= 0n || commitment >= SNARK_FIELD) throw new ErrorDeDatos("El compromiso de identidad no es válido.");
  return {
    wallet: getAddress(body.wallet),
    cuit: body.cuit.replace(/\D/g, ""),
    razonSocial: body.razonSocial.trim(),
    domicilioLegal: body.domicilioLegal.trim(),
    rubros: body.rubros.trim(),
    claveFiscal: body.claveFiscal.trim(),
    identityCommitment: commitment,
  };
}

/**
 * @param {object} deps
 * @param {ReturnType<import("./db.js").abrirBase>} deps.db
 * @param {ReturnType<import("./afip/afip.js").crearClienteAfip>} deps.afip
 * @param {{ verificador: import("ethers").Wallet, conectar(): Promise<any> }} deps.cadena
 * @param {ReturnType<import("../../frontend/src/shared/protocolo.js").crearProtocolo>} deps.protocolo
 * @param {{ vigenciaProveedorDias: number, validezFirmaSegundos: number }} deps.config
 * @param {() => number} [deps.ahora] segundos
 */
export function crearServicioInscripciones({ db, afip, cadena, protocolo, config, ahora = () => Math.floor(Date.now() / 1000) }) {
  function rechazar(datos, resultado, motivo) {
    const id = db.guardarInscripcion({
      wallet: datos.wallet,
      cuit: datos.cuit,
      razonSocial: datos.razonSocial,
      datos: { domicilioLegal: datos.domicilioLegal, rubros: datos.rubros },
      estado: "RECHAZADA",
      resultado,
      motivo,
    });
    return { aprobada: false, id, resultado, motivo };
  }

  async function yaTieneCredencial(datos) {
    const { credenciales } = await cadena.conectar();
    const [tokenCuit, porCuit] = await credenciales.credencialDeCuit(BigInt(datos.cuit));
    if (tokenCuit !== 0n && !porCuit.revocada) return `El CUIT ya tiene la credencial #${tokenCuit}.`;
    const [tokenWallet, porWallet] = await credenciales.credencialDe(datos.wallet);
    if (tokenWallet !== 0n && !porWallet.revocada) return `Esta wallet ya tiene la credencial #${tokenWallet}.`;
    return null;
  }

  return {
    async inscribir(body) {
      const datos = validar(body);
      if (!cuitValido(datos.cuit)) return rechazar(datos, RESULTADOS.CUIT_INVALIDO, "El CUIT no es válido.");

      const v = await afip.verificarSolicitud(datos);
      if (!v.ok) return rechazar(datos, v.resultado, v.mensaje);

      const duplicado = await yaTieneCredencial(datos);
      if (duplicado) return rechazar(datos, "YA_INSCRIPTO", duplicado);

      // En la cadena queda el nombre tal como figura en AFIP (así no hay dos grafías para la misma empresa).
      const razonSocial = denominacion(v.persona);
      const completos = {
        wallet: datos.wallet,
        cuit: datos.cuit,
        razonSocial,
        razonSocialDeclarada: datos.razonSocial,
        domicilioLegal: datos.domicilioLegal,
        rubros: datos.rubros,
        afip: { domicilioFiscal: v.persona.domicilioFiscal, actividades: v.persona.actividades },
      };
      const sal = protocolo.nuevaSal();
      const datosHash = protocolo.datosHash(completos, sal);

      const inscripcion = {
        cuit: BigInt(datos.cuit),
        razonSocial,
        datosHash,
        identityCommitment: datos.identityCommitment,
        validaHasta: BigInt(ahora() + config.vigenciaProveedorDias * 86400),
        venceFirma: BigInt(ahora() + config.validezFirmaSegundos),
      };
      const { chainId, credenciales } = await cadena.conectar();
      const dominio = protocolo.dominioCredenciales(chainId, await credenciales.getAddress());
      const firma = await cadena.verificador.signTypedData(dominio, TIPOS_INSCRIPCION, { wallet: datos.wallet, ...inscripcion });

      const id = db.guardarInscripcion({
        wallet: datos.wallet,
        cuit: datos.cuit,
        razonSocial,
        datos: completos,
        sal,
        datosHash,
        estado: "AUTORIZADA",
        resultado: RESULTADOS.OK,
        motivo: v.mensaje,
      });

      return {
        aprobada: true,
        id,
        motivo: v.mensaje,
        firma,
        inscripcion: Object.fromEntries(Object.entries(inscripcion).map(([k, x]) => [k, String(x)])),
      };
    },

    /** Historial de una wallet (para mostrarle el motivo de un rechazo). Sin sal ni datos completos. */
    historial: (wallet) =>
      db.inscripcionesDe(wallet).map(({ id, cuit, razon_social, estado, resultado, motivo, creada_en, datos_hash }) => ({
        id,
        cuit,
        razonSocial: razon_social,
        estado,
        resultado,
        motivo,
        creadaEn: creada_en,
        datosHash: datos_hash,
      })),

    /**
     * Datos completos de una inscripción autorizada, con la sal, para que cualquiera pueda recalcular
     * el hash que quedó en la cadena. Los datos de una empresa (CUIT, domicilio, rubros) son públicos.
     */
    porHash(hash) {
      const f = db.inscripcionPorHash(hash);
      if (!f) return null;
      return { datos: f.datos, sal: f.sal, datosHash: f.datos_hash, verificado: protocolo.datosHash(f.datos, f.sal) === f.datos_hash };
    },
  };
}
