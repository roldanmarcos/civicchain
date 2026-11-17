// "IPFS" local: guarda los archivos en disco y los identifica por su CID.
//
// El CID es el mismo que daría IPFS para el mismo archivo (CIDv1, códec raw, sha-256) mientras el
// archivo entre en un solo bloque (hasta 1 MiB con `ipfs add --cid-version 1 --raw-leaves`). Así el
// CID que queda en la cadena identifica el contenido sin depender de este servidor: cualquiera puede
// recalcularlo y comprobar que el archivo no cambió.
//
// DUDA: para producción hay que fijar (pin) los archivos en IPFS de verdad, por ejemplo con Pinata o
// Storacha (web3.storage). Bastaría con subirlos también ahí en `guardar`; para archivos de más de
// 1 MiB IPFS los parte en bloques y el CID sería otro (habría que usar el que devuelva el servicio).

import { mkdirSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

export async function calcularCid(bytes) {
  return CID.create(1, raw.code, await sha256.digest(bytes)).toString();
}

export function crearIpfsLocal(carpeta, db) {
  mkdirSync(carpeta, { recursive: true });
  const ruta = (cid) => join(carpeta, cid);

  return {
    /** Guarda el archivo y devuelve su CID. Guardar dos veces lo mismo no duplica nada. */
    async guardar(bytes, tipo = "application/octet-stream") {
      const cid = await calcularCid(bytes);
      if (!existsSync(ruta(cid))) await writeFile(ruta(cid), bytes);
      db.guardarArchivo(cid, tipo, bytes.length);
      return cid;
    },

    /** Devuelve { bytes, tipo } o null. Verifica que el contenido siga correspondiendo al CID. */
    async leer(cid) {
      let parsed;
      try {
        parsed = CID.parse(cid).toString();
      } catch {
        return null;
      }
      if (!existsSync(ruta(parsed))) return null;
      const bytes = await readFile(ruta(parsed));
      if ((await calcularCid(bytes)) !== parsed) throw new Error(`El archivo ${parsed} está corrupto`);
      return { bytes, tipo: db.archivo(parsed)?.tipo ?? "application/octet-stream" };
    },
  };
}
