// Base de datos fuera de la cadena (SQLite, incluido en Node 22).
//
// Acá quedan los datos completos de cada inscripción y de cada alta de funcionario. En la cadena
// solo va su hash (datosHash): cualquiera que tenga los datos y la sal puede recalcularlo y comprobar
// que nadie los modificó.
//
// DUDA: para producción convendría una base gestionada (por ejemplo Postgres en Supabase). Las
// consultas son simples y el resto del código no depende de SQLite: solo habría que cambiar este archivo.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function abrirBase(ruta) {
  if (ruta !== ":memory:") mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec(`
    CREATE TABLE IF NOT EXISTS inscripciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      cuit TEXT NOT NULL,
      razon_social TEXT NOT NULL,
      datos TEXT NOT NULL,          -- JSON con todo lo que mandó el proveedor y lo que devolvió AFIP
      sal TEXT,
      datos_hash TEXT,
      estado TEXT NOT NULL,         -- AUTORIZADA (firmada) o RECHAZADA
      resultado TEXT NOT NULL,      -- resultado de la verificación (ver afip.js)
      motivo TEXT NOT NULL,
      creada_en INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS inscripciones_wallet ON inscripciones (wallet);
    CREATE INDEX IF NOT EXISTS inscripciones_hash ON inscripciones (datos_hash);

    CREATE TABLE IF NOT EXISTS funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      rol TEXT NOT NULL,
      organismo_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      datos TEXT NOT NULL,          -- JSON con DNI, área, cargo, resolución...
      sal TEXT NOT NULL,
      datos_hash TEXT NOT NULL,
      cargado_por TEXT NOT NULL,    -- wallet del admin
      creado_en INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS funcionarios_hash ON funcionarios (datos_hash);

    CREATE TABLE IF NOT EXISTS archivos (
      cid TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      creado_en INTEGER NOT NULL
    );
  `);

  const ahora = () => Math.floor(Date.now() / 1000);
  const fila = (f) => f && { ...f, datos: JSON.parse(f.datos) };

  return {
    cerrar: () => db.close(),

    guardarInscripcion(i) {
      const r = db
        .prepare(
          `INSERT INTO inscripciones (wallet, cuit, razon_social, datos, sal, datos_hash, estado, resultado, motivo, creada_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          i.wallet.toLowerCase(),
          i.cuit,
          i.razonSocial,
          JSON.stringify(i.datos),
          i.sal ?? null,
          i.datosHash ?? null,
          i.estado,
          i.resultado,
          i.motivo,
          ahora(),
        );
      return Number(r.lastInsertRowid);
    },
    inscripcionesDe: (wallet) =>
      db.prepare(`SELECT * FROM inscripciones WHERE wallet = ? ORDER BY id DESC`).all(wallet.toLowerCase()).map(fila),
    todasLasInscripciones: () => db.prepare(`SELECT * FROM inscripciones ORDER BY id DESC LIMIT 500`).all().map(fila),
    inscripcionPorHash: (hash) => fila(db.prepare(`SELECT * FROM inscripciones WHERE datos_hash = ?`).get(hash)),

    guardarFuncionario(f) {
      const r = db
        .prepare(
          `INSERT INTO funcionarios (wallet, rol, organismo_id, nombre, datos, sal, datos_hash, cargado_por, creado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(f.wallet.toLowerCase(), f.rol, f.organismoId, f.nombre, JSON.stringify(f.datos), f.sal, f.datosHash, f.cargadoPor, ahora());
      return Number(r.lastInsertRowid);
    },
    funcionarioPorHash: (hash) => fila(db.prepare(`SELECT * FROM funcionarios WHERE datos_hash = ?`).get(hash)),

    guardarArchivo: (cid, tipo, bytes) =>
      db.prepare(`INSERT OR IGNORE INTO archivos (cid, tipo, bytes, creado_en) VALUES (?, ?, ?, ?)`).run(cid, tipo, bytes, ahora()),
    archivo: (cid) => db.prepare(`SELECT * FROM archivos WHERE cid = ?`).get(cid),
  };
}
