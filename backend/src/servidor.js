// API HTTP del backend (sin frameworks: node:http alcanza para estas pocas rutas).
//
//   GET  /api/salud                          estado del backend y de la conexión a la cadena
//   POST /api/inscripciones                  verifica en AFIP y, si está todo bien, firma la autorización
//   GET  /api/inscripciones?wallet=0x...     historial de inscripciones de una wallet
//   GET  /api/inscripciones/todas            (admin) todas las inscripciones procesadas
//   GET  /api/inscripciones/hash/:hash       datos completos + sal, para verificar el datosHash de la cadena
//   POST /api/funcionarios                   (admin) guarda los datos de un empleado/inspector y devuelve el hash
//   GET  /api/funcionarios/hash/:hash        (admin) datos completos de un funcionario
//   POST /api/ipfs                           sube un archivo (cuerpo crudo) y devuelve su CID
//   GET  /ipfs/:cid                          descarga un archivo
//   POST /api/relayer/ofertas                manda una oferta anónima a la cadena
//   GET  /api/relayer                        dirección del relayer (para cargarle ETH)

import { createServer } from "node:http";
import { ErrorDeDatos } from "./inscripciones.js";
import { ErrorDeAcceso, autenticarAdmin } from "./funcionarios.js";

class ErrorHttp extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

async function leerCuerpo(req, max) {
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > max) throw new ErrorHttp(413, "El archivo es demasiado grande.");
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

async function leerJson(req) {
  const cuerpo = await leerCuerpo(req, 256 * 1024);
  try {
    return JSON.parse(cuerpo.toString("utf8") || "{}");
  } catch {
    throw new ErrorHttp(400, "El cuerpo no es JSON válido.");
  }
}

export function crearServidor({ config, cadena, inscripciones, funcionarios, ipfs, relayer }) {
  const cors = {
    "Access-Control-Allow-Origin": config.origenDapp,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Fecha, X-Admin-Firma",
  };
  const responder = (res, status, cuerpo) => {
    res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(cuerpo, (_, v) => (typeof v === "bigint" ? String(v) : v)));
  };

  const rutas = [
    [
      "GET",
      /^\/api\/salud$/,
      async () => {
        let cadenaOk = false;
        let chainId = null;
        try {
          chainId = String((await cadena.conectar()).chainId);
          cadenaOk = true;
        } catch {
          cadena.reiniciar();
        }
        return { ok: true, cadena: cadenaOk, chainId, verificador: cadena.verificador.address, relayer: await relayer.direccion() };
      },
    ],
    ["POST", /^\/api\/inscripciones$/, async ({ req }) => inscripciones.inscribir(await leerJson(req))],
    [
      "GET",
      /^\/api\/inscripciones$/,
      async ({ url }) => {
        const wallet = url.searchParams.get("wallet");
        if (!wallet) throw new ErrorHttp(400, "Falta ?wallet=");
        return inscripciones.historial(wallet);
      },
    ],
    [
      "GET",
      /^\/api\/inscripciones\/todas$/,
      async ({ req }) => {
        await autenticarAdmin(req.headers, cadena);
        return inscripciones.todas();
      },
    ],
    [
      "GET",
      /^\/api\/inscripciones\/hash\/(0x[0-9a-fA-F]{64})$/,
      async ({ m }) => inscripciones.porHash(m[1].toLowerCase()) ?? Promise.reject(new ErrorHttp(404, "No hay datos con ese hash.")),
    ],
    [
      "POST",
      /^\/api\/funcionarios$/,
      async ({ req }) => {
        const admin = await autenticarAdmin(req.headers, cadena);
        return funcionarios.registrar(await leerJson(req), admin);
      },
    ],
    [
      "GET",
      /^\/api\/funcionarios\/hash\/(0x[0-9a-fA-F]{64})$/,
      async ({ req, m }) => {
        await autenticarAdmin(req.headers, cadena);
        return funcionarios.porHash(m[1].toLowerCase()) ?? Promise.reject(new ErrorHttp(404, "No hay datos con ese hash."));
      },
    ],
    [
      "POST",
      /^\/api\/ipfs$/,
      async ({ req }) => {
        const bytes = await leerCuerpo(req, config.maxArchivoBytes);
        if (bytes.length === 0) throw new ErrorHttp(400, "El archivo está vacío.");
        return { cid: await ipfs.guardar(bytes, req.headers["content-type"] ?? "application/octet-stream") };
      },
    ],
    ["GET", /^\/api\/relayer$/, async () => ({ direccion: await relayer.direccion() })],
    ["POST", /^\/api\/relayer\/ofertas$/, async ({ req }) => relayer.enviarOferta(await leerJson(req))],
  ];

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        return res.end();
      }
      const ipfsMatch = req.method === "GET" && url.pathname.match(/^\/ipfs\/([a-zA-Z0-9]+)$/);
      if (ipfsMatch) {
        const archivo = await ipfs.leer(ipfsMatch[1]);
        if (!archivo) throw new ErrorHttp(404, "No existe ese archivo.");
        res.writeHead(200, { ...cors, "Content-Type": archivo.tipo, "Cache-Control": "public, max-age=31536000, immutable" });
        return res.end(archivo.bytes);
      }
      for (const [metodo, patron, manejar] of rutas) {
        const m = url.pathname.match(patron);
        if (m && req.method === metodo) return responder(res, 200, await manejar({ req, url, m }));
      }
      throw new ErrorHttp(404, "Ruta inexistente.");
    } catch (error) {
      if (error instanceof ErrorHttp) return responder(res, error.status, { error: error.message });
      if (error instanceof ErrorDeDatos) return responder(res, 422, { error: error.message });
      if (error instanceof ErrorDeAcceso) return responder(res, 401, { error: error.message });
      if (error?.code === "ECONNREFUSED" || /could not detect network|No hay contratos/i.test(String(error?.message))) {
        cadena.reiniciar();
        return responder(res, 503, { error: "El backend no se puede conectar a la blockchain. ¿Está levantado el nodo y desplegados los contratos?" });
      }
      console.error(error);
      return responder(res, 500, { error: "Error interno del backend." });
    }
  });
}
