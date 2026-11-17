// Alta de empleados e inspectores: el admin carga los datos completos acá, recibe el hash y con eso
// emite la credencial desde la dApp (`emitirFuncionario`). En la cadena quedan solo el nombre, el
// organismo y el hash; el DNI y el resto quedan en esta base, visibles solo para admins.

import { getAddress, isAddress, verifyMessage } from "ethers";
import { ROLES } from "../../frontend/src/shared/protocolo.js";
import { ErrorDeDatos } from "./inscripciones.js";

export class ErrorDeAcceso extends Error {}

/** Texto que firma el admin con su wallet para identificarse ante el backend. */
export const mensajeAccesoAdmin = (fechaIso) => `CivicChain: acceso de administrador\nFecha: ${fechaIso}`;
const VALIDEZ_ACCESO_MS = 12 * 60 * 60 * 1000;

/**
 * Verifica los encabezados X-Admin-Fecha y X-Admin-Firma: la firma tiene que ser de una wallet con
 * ADMIN_ROLE en CredencialNFT y la fecha, reciente. Devuelve la dirección del admin.
 */
export async function autenticarAdmin(headers, cadena, ahoraMs = Date.now()) {
  const fecha = headers["x-admin-fecha"];
  const firma = headers["x-admin-firma"];
  if (!fecha || !firma) throw new ErrorDeAcceso("Falta la firma de administrador.");
  const ms = Date.parse(fecha);
  if (Number.isNaN(ms) || Math.abs(ahoraMs - ms) > VALIDEZ_ACCESO_MS) throw new ErrorDeAcceso("La firma de administrador venció.");
  let wallet;
  try {
    wallet = verifyMessage(mensajeAccesoAdmin(fecha), firma);
  } catch {
    throw new ErrorDeAcceso("Firma de administrador inválida.");
  }
  const { credenciales } = await cadena.conectar();
  if (!(await credenciales.hasRole(await credenciales.ADMIN_ROLE(), wallet))) {
    throw new ErrorDeAcceso("La wallet no es administradora.");
  }
  return wallet;
}

export function crearServicioFuncionarios({ db, protocolo }) {
  return {
    /** Guarda el alta y devuelve el hash que va en `emitirFuncionario`. */
    registrar(body, admin) {
      const texto = (v, max) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
      if (!isAddress(body?.wallet)) throw new ErrorDeDatos("La wallet no es válida.");
      if (!["EMPLEADO", "INSPECTOR"].includes(body.rol)) throw new ErrorDeDatos("El rol tiene que ser EMPLEADO o INSPECTOR.");
      const organismoId = Number(body.organismoId);
      if (!Number.isInteger(organismoId) || organismoId <= 0) throw new ErrorDeDatos("Elegí un organismo.");
      if (!texto(body.nombre, 120)) throw new ErrorDeDatos("El nombre es obligatorio (hasta 120 caracteres).");
      const dni = String(body.dni ?? "").replace(/\D/g, "");
      if (!/^\d{7,8}$/.test(dni)) throw new ErrorDeDatos("El DNI tiene que tener 7 u 8 dígitos.");

      const datos = {
        wallet: getAddress(body.wallet),
        rol: body.rol,
        rolId: ROLES.indexOf(body.rol),
        organismoId,
        nombre: body.nombre.trim(),
        dni,
        area: String(body.area ?? "").trim(),
        cargo: String(body.cargo ?? "").trim(),
        resolucion: String(body.resolucion ?? "").trim(),
        domicilioLegal: String(body.domicilioLegal ?? "").trim(),
      };
      const sal = protocolo.nuevaSal();
      const datosHash = protocolo.datosHash(datos, sal);
      const id = db.guardarFuncionario({ ...datos, datos, sal, datosHash, cargadoPor: admin });
      return { id, datosHash };
    },

    /** Datos completos (con DNI): solo para admins. */
    porHash(hash) {
      const f = db.funcionarioPorHash(hash);
      if (!f) return null;
      return {
        datos: f.datos,
        sal: f.sal,
        datosHash: f.datos_hash,
        cargadoPor: f.cargado_por,
        verificado: protocolo.datosHash(f.datos, f.sal) === f.datos_hash,
      };
    },
  };
}
