// Cifrado con timelock (tlock + drand quicknet).
//
// Un monto cifrado para la ronda R solo se puede descifrar cuando la red drand publica la firma de
// esa ronda, que pasa en un momento fijo. Nadie, ni el que cifró, puede abrirlo antes.

import { Buffer, mainnetClient, timelockDecrypt, timelockEncrypt } from "tlock-js";
import { leerIdentidadSecreta, leerOfertaSecreta, rondaDrand, serializarOfertaSecreta } from "../../frontend/src/shared/protocolo.js";

const cliente = mainnetClient();

export async function cifrarOferta(oferta, cierreOfertas) {
  return timelockEncrypt(rondaDrand(Number(cierreOfertas)), Buffer.from(serializarOfertaSecreta(oferta)), cliente);
}

/** Descifra un cifrado (texto armado de age). Falla si la ronda todavía no se publicó. */
export async function descifrarOferta(cifrado) {
  const texto = (await timelockDecrypt(cifrado, cliente)).toString("utf8");
  return leerOfertaSecreta(texto);
}

/** Descifra la identidad de una oferta ({wallet, sal}). Falla si la ronda de la fecha límite no salió. */
export async function descifrarIdentidad(cifrado) {
  const texto = (await timelockDecrypt(cifrado, cliente)).toString("utf8");
  return leerIdentidadSecreta(texto);
}
