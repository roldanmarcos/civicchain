// Cifrado con timelock (tlock + drand quicknet) en el navegador.
//
// Cada oferta lleva dos cifrados:
// - el contenido (monto, plazo, desglose), para la ronda de drand del cierre de ofertas;
// - la identidad (wallet y sal de autoría), para la ronda de la fecha límite de adjudicación.
// Nadie (ni la empresa) puede descifrarlos antes de su ronda. Cuando la red drand publica la firma de
// esa ronda, cualquiera puede abrirlos.

import { Buffer, mainnetClient, timelockDecrypt, timelockEncrypt } from "tlock-js";
import {
  leerIdentidadSecreta,
  leerOfertaSecreta,
  rondaDrand,
  serializarIdentidadSecreta,
  serializarOfertaSecreta,
} from "../shared/protocolo.js";

let cliente = null;
const drand = () => (cliente ??= mainnetClient());

/** Cifra la oferta para el cierre. Devuelve el texto armado de age (lo que va a la cadena como bytes). */
export function cifrarOferta(oferta, cierreOfertas) {
  return timelockEncrypt(rondaDrand(Number(cierreOfertas)), Buffer.from(serializarOfertaSecreta(oferta)), drand());
}

/** Descifra una oferta. Falla si la ronda de drand todavía no se publicó o si el contenido es inválido. */
export async function descifrarOferta(cifrado) {
  const texto = (await timelockDecrypt(cifrado, drand())).toString("utf8");
  return leerOfertaSecreta(texto);
}

/** Cifra la identidad ({wallet, sal}) para la fecha límite de adjudicación. */
export function cifrarIdentidad(identidad, limiteAdjudicacion) {
  return timelockEncrypt(rondaDrand(Number(limiteAdjudicacion)), Buffer.from(serializarIdentidadSecreta(identidad)), drand());
}

/** Descifra una identidad. Falla si la ronda de la fecha límite todavía no se publicó. */
export async function descifrarIdentidad(cifrado) {
  const texto = (await timelockDecrypt(cifrado, drand())).toString("utf8");
  return leerIdentidadSecreta(texto);
}
