import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ethers from "ethers";
import { crearClienteAfip } from "../src/afip/afip.js";
import { crearBotIdentidades } from "../src/identidades.js";
import { abrirBase } from "../src/db.js";
import { crearServicioFuncionarios, mensajeAccesoAdmin } from "../src/funcionarios.js";
import { crearServicioInscripciones } from "../src/inscripciones.js";
import { calcularCid, crearIpfsLocal } from "../src/ipfs.js";
import { crearServidor } from "../src/servidor.js";
import { TIPOS_INSCRIPCION, crearProtocolo, rondaDrand } from "../../frontend/src/shared/protocolo.js";

const protocolo = crearProtocolo(ethers);
const padron = JSON.parse(readFileSync(new URL("../src/afip/padron.json", import.meta.url), "utf8"));
const CHAIN_ID = 31337n;
const CONTRATO = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const admin = ethers.Wallet.createRandom();
const verificador = ethers.Wallet.createRandom();
const proveedor = ethers.Wallet.createRandom();

/** Cadena simulada: solo lo que usan los servicios. */
function cadenaFalsa({ credencialCuit = 0n, credencialWallet = 0n } = {}) {
  const sinCredencial = { revocada: false };
  const credenciales = {
    getAddress: async () => CONTRATO,
    credencialDeCuit: async () => [credencialCuit, sinCredencial],
    credencialDe: async () => [credencialWallet, sinCredencial],
    ADMIN_ROLE: async () => "0xadmin",
    hasRole: async (_rol, wallet) => wallet === admin.address,
  };
  return {
    verificador,
    relayer: { getAddress: async () => "0x0000000000000000000000000000000000000001" },
    conectar: async () => ({ chainId: CHAIN_ID, credenciales }),
    reiniciar: () => {},
  };
}

const CONFIG = { vigenciaProveedorDias: 365, validezFirmaSegundos: 3600 };
const commitment = 123456789n;
const pedido = {
  wallet: proveedor.address,
  cuit: "30-71234567-1",
  razonSocial: "Construcciones del Sur SA",
  domicilioLegal: "Av. Calchaquí 1234, Quilmes",
  rubros: "Construcción",
  claveFiscal: "DEMO-7123",
  identityCommitment: String(commitment),
};

function servicio(cadena = cadenaFalsa()) {
  const db = abrirBase(":memory:");
  return { db, inscripciones: crearServicioInscripciones({ db, afip: crearClienteAfip(padron), cadena, protocolo, config: CONFIG }) };
}

describe("inscripción automática", () => {
  it("aprueba y firma una autorización que recupera al verificador", async () => {
    const { inscripciones } = servicio();
    const r = await inscripciones.inscribir(pedido);
    assert.equal(r.aprobada, true);
    // Queda el nombre oficial de AFIP
    assert.equal(r.inscripcion.razonSocial, "CONSTRUCCIONES DEL SUR S.A.");
    assert.equal(r.inscripcion.identityCommitment, String(commitment));

    const dominio = protocolo.dominioCredenciales(CHAIN_ID, CONTRATO);
    const firmante = ethers.verifyTypedData(dominio, TIPOS_INSCRIPCION, { wallet: proveedor.address, ...r.inscripcion }, r.firma);
    assert.equal(firmante, verificador.address);
  });

  it("guarda los datos completos y el hash se puede recalcular", async () => {
    const { inscripciones } = servicio();
    const r = await inscripciones.inscribir(pedido);
    const guardado = inscripciones.porHash(r.inscripcion.datosHash);
    assert.equal(guardado.verificado, true);
    assert.equal(guardado.datos.domicilioLegal, pedido.domicilioLegal);
    assert.equal(protocolo.datosHash(guardado.datos, guardado.sal), r.inscripcion.datosHash);
    // La clave fiscal no se guarda
    assert.equal(JSON.stringify(guardado).includes("DEMO-7123"), false);
  });

  it("rechaza solo, con motivo, y lo deja en el historial", async () => {
    const { inscripciones } = servicio();
    const casos = [
      [{ claveFiscal: "otra" }, "REPRESENTACION_NO_VERIFICADA"],
      [{ razonSocial: "Otra empresa S.A." }, "RAZON_SOCIAL_NO_COINCIDE"],
      [{ cuit: "30-70555444-3", razonSocial: "Viales Bonaerenses S.A.", claveFiscal: "DEMO-7055" }, "CUIT_INACTIVO"],
      [{ cuit: "30-71222333-9" }, "CUIT_INEXISTENTE"],
      [{ cuit: "30-71234567-8" }, "CUIT_INVALIDO"],
    ];
    for (const [cambio, resultado] of casos) {
      const r = await inscripciones.inscribir({ ...pedido, ...cambio });
      assert.equal(r.aprobada, false, resultado);
      assert.equal(r.resultado, resultado);
      assert.equal(r.firma, undefined);
    }
    const historial = inscripciones.historial(proveedor.address);
    assert.equal(historial.length, casos.length);
    assert.ok(historial.every((h) => h.estado === "RECHAZADA" && h.motivo));
  });

  it("rechaza si el CUIT o la wallet ya tienen credencial vigente", async () => {
    let r = await servicio(cadenaFalsa({ credencialCuit: 4n })).inscripciones.inscribir(pedido);
    assert.equal(r.resultado, "YA_INSCRIPTO");
    r = await servicio(cadenaFalsa({ credencialWallet: 2n })).inscripciones.inscribir(pedido);
    assert.equal(r.resultado, "YA_INSCRIPTO");
  });

  it("valida los datos de entrada", async () => {
    const { inscripciones } = servicio();
    await assert.rejects(inscripciones.inscribir({ ...pedido, wallet: "x" }), /wallet/);
    await assert.rejects(inscripciones.inscribir({ ...pedido, identityCommitment: "0" }), /compromiso/);
    await assert.rejects(inscripciones.inscribir({ ...pedido, rubros: "" }), /rubros/);
  });
});

describe("alta de funcionarios", () => {
  it("guarda DNI y resolución fuera de la cadena y devuelve el hash", () => {
    const db = abrirBase(":memory:");
    const funcionarios = crearServicioFuncionarios({ db, protocolo });
    const { datosHash } = funcionarios.registrar(
      { wallet: proveedor.address, rol: "EMPLEADO", organismoId: 1, nombre: "Ana Pérez", dni: "30.111.222", resolucion: "Res. 12/2026" },
      admin.address,
    );
    const guardado = funcionarios.porHash(datosHash);
    assert.equal(guardado.verificado, true);
    assert.equal(guardado.datos.dni, "30111222");
    assert.throws(() => funcionarios.registrar({ wallet: proveedor.address, rol: "PROVEEDOR" }, admin.address), /rol/);
  });
});

describe("IPFS local", () => {
  it("calcula el mismo CID que IPFS (CIDv1, raw, sha-256)", async () => {
    // `ipfs add --cid-version 1 --raw-leaves` de "hello world" sin salto de línea
    assert.equal(await calcularCid(Buffer.from("hello world")), "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
  });
});

describe("rondas de drand", () => {
  it("la ronda elegida se publica en el cierre o justo después", () => {
    const cierre = 1_800_000_000;
    const ronda = rondaDrand(cierre);
    const publicada = 1692803367 + (ronda - 1) * 3;
    assert.ok(publicada >= cierre && publicada < cierre + 3);
  });
});

describe("bot de identidades", () => {
  it("después de la fecha límite revela juntas las identidades que puede descifrar", async () => {
    const llamadas = [];
    const autores = {};
    const licitaciones = {
      totalLicitaciones: async () => 1n,
      licitacion: async () => ({ limiteAdjudicacion: 900n }),
      cantidadOfertas: async () => 3n,
      oferta: async (_id, o) => ({ autor: autores[o] ?? ethers.ZeroAddress }),
      filters: { OfertaRecibida: (l, o) => ({ l, o }) },
      queryFilter: async ({ o }) => [{ args: { cifradoIdentidad: ethers.toUtf8Bytes(o === 2 ? "basura" : `id-${o}`) } }],
      revelarIdentidades: async (id, lista) => {
        llamadas.push(lista);
        for (const p of lista) autores[p.ofertaId] = p.wallet;
        return { wait: async () => {} };
      },
    };
    const wallet = (n) => `0x${String(n).repeat(40)}`;
    let ahora = 800;
    const bot = crearBotIdentidades({
      cadena: { conectar: async () => ({ licitaciones, desdeBloque: 0 }) },
      ahora: () => ahora,
      log: {},
      descifrar: async (texto) => {
        if (!texto.startsWith("id-")) throw new Error("formato inválido");
        return { wallet: wallet(texto.slice(3)), sal: ethers.ZeroHash };
      },
    });
    // Antes de la fecha límite no hace nada
    assert.equal(await bot.revisar(), 0);
    ahora = 1000;
    assert.equal(await bot.revisar(), 2);
    assert.deepEqual(
      llamadas[0].map((p) => p.ofertaId),
      [1, 3],
    );
    // La que no se pudo descifrar queda descartada y las reveladas no se repiten
    assert.equal(await bot.revisar(), 0);
    assert.equal(llamadas.length, 1);
  });
});

describe("API HTTP", () => {
  let servidor, base, carpeta;
  before(async () => {
    const db = abrirBase(":memory:");
    const cadena = cadenaFalsa();
    carpeta = mkdtempSync(join(tmpdir(), "civic-ipfs-"));
    servidor = crearServidor({
      config: { origenDapp: "*", maxArchivoBytes: 1024 },
      cadena,
      inscripciones: crearServicioInscripciones({ db, afip: crearClienteAfip(padron), cadena, protocolo, config: CONFIG }),
      funcionarios: crearServicioFuncionarios({ db, protocolo }),
      ipfs: crearIpfsLocal(carpeta, db),
      relayer: { direccion: async () => "0x1", enviarOferta: async () => ({ ok: true }) },
    });
    await new Promise((r) => servidor.listen(0, r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(() => servidor.close());

  const post = (ruta, cuerpo, headers = {}) =>
    fetch(base + ruta, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(cuerpo) });

  it("inscripciones: aprueba, rechaza y devuelve 422 con datos inválidos", async () => {
    let r = await post("/api/inscripciones", pedido);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).aprobada, true);
    r = await post("/api/inscripciones", { ...pedido, claveFiscal: "mal" });
    assert.equal((await r.json()).aprobada, false);
    r = await post("/api/inscripciones", { ...pedido, wallet: "no" });
    assert.equal(r.status, 422);
    r = await fetch(`${base}/api/inscripciones?wallet=${proveedor.address}`);
    assert.equal((await r.json()).length, 2);
  });

  it("funcionarios: exige la firma de un admin", async () => {
    const cuerpo = { wallet: proveedor.address, rol: "INSPECTOR", organismoId: 2, nombre: "Luis Gómez", dni: "28999000" };
    let r = await post("/api/funcionarios", cuerpo);
    assert.equal(r.status, 401);

    const fecha = new Date().toISOString();
    const intruso = ethers.Wallet.createRandom();
    r = await post("/api/funcionarios", cuerpo, {
      "X-Admin-Fecha": fecha,
      "X-Admin-Firma": await intruso.signMessage(mensajeAccesoAdmin(fecha)),
    });
    assert.equal(r.status, 401);

    const headers = { "X-Admin-Fecha": fecha, "X-Admin-Firma": await admin.signMessage(mensajeAccesoAdmin(fecha)) };
    r = await post("/api/funcionarios", cuerpo, headers);
    assert.equal(r.status, 200);
    const { datosHash } = await r.json();
    r = await fetch(`${base}/api/funcionarios/hash/${datosHash}`, { headers });
    assert.equal((await r.json()).datos.dni, "28999000");
    r = await fetch(`${base}/api/inscripciones/todas`, { headers });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(await r.json()));
    r = await fetch(`${base}/api/inscripciones/todas`);
    assert.equal(r.status, 401);
  });

  it("ipfs: sube y descarga por CID, con límite de tamaño", async () => {
    let r = await fetch(`${base}/api/ipfs`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hello world" });
    const { cid } = await r.json();
    assert.equal(cid, "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
    r = await fetch(`${base}/ipfs/${cid}`);
    assert.equal(r.headers.get("content-type"), "text/plain");
    assert.equal(await r.text(), "hello world");
    r = await fetch(`${base}/api/ipfs`, { method: "POST", body: "x".repeat(2000) });
    assert.equal(r.status, 413);
  });
});
