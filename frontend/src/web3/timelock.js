// Cifrado con timelock (tlock + drand quicknet) en el navegador.
//
// El contenido secreto de la oferta se cifra para la ronda de drand del cierre: nadie (ni la empresa)
// puede descifrarlo antes. Al vencer, la red drand publica la firma de esa ronda y cualquiera puede abrirlo.

import { Buffer, mainnetClient, timelockDecrypt, timelockEncrypt } from "tlock-js";
import { leerOfertaSecreta, rondaDrand, serializarOfertaSecreta } from "../shared/protocolo.js";

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
