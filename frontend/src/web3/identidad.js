// Identidad anónima del proveedor (Semaphore) y sal de autoría.
//
// No se guarda ningún secreto: la identidad sale de firmar siempre el mismo mensaje con la wallet.
// Firmar lo mismo da siempre la misma firma (las wallets usan firmas determinísticas, RFC 6979), así
// que desde cualquier navegador con la misma wallet se recupera la misma identidad.
// La firma nunca sale del navegador; a la cadena y al backend solo va el compromiso (commitment),
// que no se puede vincular a la wallet.
//
// DUDA: algunas wallets de hardware o de contrato (multisig) no firman de forma determinística. Con
// esas habría que generar la identidad al azar y pedir que la respalden (descargar un archivo).

import { Identity } from "@semaphore-protocol/core";
import * as ethers from "ethers";
import { MENSAJE_IDENTIDAD, crearProtocolo, mensajeAutoria } from "../shared/protocolo.js";
import { obtenerFirmante } from "./sesion.js";

export const protocolo = crearProtocolo(ethers);

/** Cache en memoria por wallet (se pierde al recargar, a propósito). */
const identidades = new Map();
const sales = new Map();

/** Identidad de Semaphore de la wallet conectada. Pide una firma la primera vez. */
export async function miIdentidad() {
  const firmante = obtenerFirmante();
  const cuenta = (await firmante.getAddress()).toLowerCase();
  if (!identidades.has(cuenta)) identidades.set(cuenta, new Identity(await firmante.signMessage(MENSAJE_IDENTIDAD)));
  return identidades.get(cuenta);
}

/** Sal de autoría (sal2 del RFC) de la wallet conectada para una licitación. Pide una firma. */
export async function miSalDeAutoria(licitacionId) {
  const firmante = obtenerFirmante();
  const clave = `${(await firmante.getAddress()).toLowerCase()}/${licitacionId}`;
  if (!sales.has(clave)) sales.set(clave, protocolo.salDesdeFirma(await firmante.signMessage(mensajeAutoria(licitacionId))));
  return sales.get(clave);
}
