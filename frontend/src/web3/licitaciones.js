// Lecturas y transacciones del contrato Licitaciones.

import * as ethers from "ethers";
import { ESTADOS_LICITACION, ROLES } from "../shared/protocolo.js";
import { enviarOfertaPorRelayer, leerJsonIpfs, subirArchivo, subirJson } from "./backend.js";
import { probarPertenencia } from "./grupo.js";
import { miIdentidad, miSalDeAutoria, protocolo } from "./identidad.js";
import { ahora, contratosDeLectura, obtenerLicitaciones, obtenerSesion } from "./sesion.js";
import { cifrarOferta, descifrarOferta } from "./timelock.js";

/**
 * @typedef {"RECIBIENDO_OFERTAS" | "APERTURA" | "EVALUACION" | "ADJUDICADA" | "EN_EJECUCION" | "FINALIZADA" | "DESIERTA"} EstadoLicitacion
 *
 * @typedef {object} Licitacion
 * @property {number} id
 * @property {string} titulo
 * @property {number} organismoId
 * @property {string} creador
 * @property {number} publicadaEn
 * @property {number} cierreOfertas
 * @property {number} finApertura
 * @property {number} adjudicadaEn
 * @property {bigint} presupuestoOficial
 * @property {string} metadataCID
 * @property {number[]} porcentajesEtapas En puntos básicos
 * @property {number} ofertaGanadora
 * @property {string} dictamenCID
 * @property {boolean} desierta
 * @property {string} contratista
 * @property {number} etapasAprobadas
 * @property {number} cantidadOfertas
 * @property {EstadoLicitacion} estado
 * @property {Metadata | null} metadata
 *
 * @typedef {object} Metadata
 * @property {string} [description]
 * @property {string} [ubicacion]
 * @property {string} [pliegoCID]
 * @property {{ nombre: string, porcentaje: number }[]} [etapas]
 */

/**
 * Estado calculado con la hora real (igual que `estado()` del contrato). En la red local los bloques
 * solo se crean con transacciones y el timestamp del último puede quedar atrasado.
 * @returns {EstadoLicitacion}
 */
export function estadoDe(l) {
  if (l.desierta) return "DESIERTA";
  if (l.ofertaGanadora) {
    if (l.contratista === ethers.ZeroAddress) return "ADJUDICADA";
    return l.etapasAprobadas === l.porcentajesEtapas.length ? "FINALIZADA" : "EN_EJECUCION";
  }
  const t = ahora();
  if (t <= l.cierreOfertas) return "RECIBIENDO_OFERTAS";
  if (t <= l.finApertura) return "APERTURA";
  return "EVALUACION";
}

export { ESTADOS_LICITACION };

const metadatas = new Map();
async function metadataDe(cid) {
  if (!metadatas.has(cid)) metadatas.set(cid, leerJsonIpfs(cid).catch(() => null));
  return metadatas.get(cid);
}

function normalizar(id, l, cantidadOfertas) {
  const datos = {
    id: Number(id),
    titulo: l.titulo,
    organismoId: Number(l.organismoId),
    creador: l.creador,
    publicadaEn: Number(l.publicadaEn),
    cierreOfertas: Number(l.cierreOfertas),
    finApertura: Number(l.finApertura),
    adjudicadaEn: Number(l.adjudicadaEn),
    presupuestoOficial: l.presupuestoOficial,
    metadataCID: l.metadataCID,
    porcentajesEtapas: l.porcentajesEtapas.map(Number),
    ofertaGanadora: Number(l.ofertaGanadora),
    dictamenCID: l.dictamenCID,
    desierta: l.desierta,
    contratista: l.contratista,
    etapasAprobadas: Number(l.etapasAprobadas),
    cantidadOfertas: Number(cantidadOfertas),
    metadata: null,
  };
  return { ...datos, estado: estadoDe(datos) };
}

/** @returns {Promise<Licitacion[]>} Más recientes primero. */
export async function leerLicitaciones() {
  const { licitaciones: c } = await contratosDeLectura();
  const total = Number(await c.totalLicitaciones());
  const ids = Array.from({ length: total }, (_, i) => i + 1).reverse();
  return Promise.all(
    ids.map(async (id) => {
      const [l, cantidad] = await Promise.all([c.licitacion(id), c.cantidadOfertas(id)]);
      const lic = normalizar(id, l, cantidad);
      lic.metadata = await metadataDe(lic.metadataCID);
      return lic;
    }),
  );
}

/**
 * @typedef {object} Oferta
 * @property {number} id
 * @property {string} nullifier
 * @property {string} cifrado Texto armado de age (tlock)
 * @property {string} compromisoMonto
 * @property {string} compromisoAutoria
 * @property {string} propuestaCID
 * @property {number} enviadaEn
 * @property {boolean} abierta
 * @property {bigint} monto
 * @property {number} plazoDias
 * @property {bigint[]} desglose
 * @property {string} autor
 * @property {string | null} autorNombre
 * @property {string} txHash
 */

/** Detalle completo de una licitación: ofertas, decisiones, inspectores y evaluaciones. */
export async function leerDetalle(id) {
  const { licitaciones: c, credenciales, desde } = await contratosDeLectura();
  const [l, cantidad] = await Promise.all([c.licitacion(id), c.cantidadOfertas(id)]);
  const lic = normalizar(id, l, cantidad);
  lic.metadata = await metadataDe(lic.metadataCID);

  const f = c.filters;
  const [recibidas, adjudicacion, desierta, inspectores, evaluaciones, publicacion] = await Promise.all([
    c.queryFilter(f.OfertaRecibida(id), desde),
    c.queryFilter(f.LicitacionAdjudicada(id), desde),
    c.queryFilter(f.LicitacionDesierta(id), desde),
    c.queryFilter(f.InspectorAsignado(id), desde),
    c.queryFilter(f.EvaluacionRegistrada(id), desde),
    c.queryFilter(f.LicitacionPublicada(id), desde),
  ]);

  const nombres = new Map();
  const nombreDe = async (wallet) => {
    if (!wallet || wallet === ethers.ZeroAddress) return null;
    if (!nombres.has(wallet)) nombres.set(wallet, credenciales.credencialDe(wallet).then(([t, d]) => (t ? d.nombre : null)));
    return nombres.get(wallet);
  };

  /** @type {Oferta[]} */
  const ofertas = await Promise.all(
    recibidas.map(async (e) => {
      const ofertaId = Number(e.args.ofertaId);
      const o = await c.oferta(id, ofertaId);
      const desglose = o.abierta ? (await c.desgloseDe(id, ofertaId)).map(BigInt) : [];
      return {
        id: ofertaId,
        nullifier: String(o.nullifier),
        cifrado: ethers.toUtf8String(e.args.cifrado),
        compromisoMonto: o.compromisoMonto,
        compromisoAutoria: o.compromisoAutoria,
        propuestaCID: o.propuestaCID,
        enviadaEn: Number(o.enviadaEn),
        abierta: o.abierta,
        monto: o.monto,
        plazoDias: Number(o.plazoDias),
        desglose,
        autor: o.autor,
        autorNombre: await nombreDe(o.autor),
        txHash: e.transactionHash,
      };
    }),
  );

  const adj = adjudicacion[0] ?? desierta[0];
  return {
    ...lic,
    creadorNombre: await nombreDe(lic.creador),
    txPublicacion: publicacion[0]?.transactionHash ?? null,
    ofertas,
    decision: adj
      ? {
          empleado: adj.args.empleado,
          empleadoNombre: await nombreDe(adj.args.empleado),
          dictamenCID: adj.args.dictamenCID,
          txHash: adj.transactionHash,
          dictamen: await leerJsonIpfs(adj.args.dictamenCID).catch(() => null),
        }
      : null,
    inspectores: await Promise.all(inspectores.map(async (e) => ({ wallet: e.args.inspector, nombre: await nombreDe(e.args.inspector) }))),
    evaluaciones: await Promise.all(
      evaluaciones.map(async (e) => ({
        etapa: Number(e.args.etapa),
        inspector: e.args.inspector,
        inspectorNombre: await nombreDe(e.args.inspector),
        aprobada: e.args.aprobada,
        informeCID: e.args.informeCID,
        informe: await leerJsonIpfs(e.args.informeCID).catch(() => null),
        txHash: e.transactionHash,
        bloque: e.blockNumber,
      })),
    ),
  };
}

const confirmar = async (txPromesa) => {
  const tx = await txPromesa;
  await tx.wait();
  return tx;
};

// ---------------------------------------------------------------------------
// 1. Publicación (empleado)
// ---------------------------------------------------------------------------

/**
 * @param {{ titulo: string, descripcion: string, ubicacion: string, presupuesto: bigint, cierre: number,
 *   aperturaMinutos: number, etapas: { nombre: string, porcentaje: number }[], pliego: File }} datos
 */
export async function publicarLicitacion(datos, alAvanzar = () => {}) {
  alAvanzar("Subiendo el pliego a IPFS…");
  const pliegoCID = await subirArchivo(datos.pliego, datos.pliego.type || "application/pdf");
  // Metadatos con el formato de NFT (name/description), más los datos de la obra.
  const metadataCID = await subirJson({
    name: datos.titulo,
    description: datos.descripcion,
    ubicacion: datos.ubicacion,
    pliegoCID,
    pliegoNombre: datos.pliego.name,
    etapas: datos.etapas,
  });
  alAvanzar("Confirmá la transacción en tu wallet…");
  return confirmar(
    obtenerLicitaciones().crearLicitacion(
      datos.titulo,
      metadataCID,
      datos.presupuesto,
      BigInt(datos.cierre),
      BigInt(datos.aperturaMinutos * 60),
      datos.etapas.map((e) => Math.round(e.porcentaje * 100)),
    ),
  );
}

// ---------------------------------------------------------------------------
// 2. Ofertas anónimas (proveedor)
// ---------------------------------------------------------------------------

/**
 * Arma la oferta en el navegador y la manda por el relayer. Nunca sale una transacción de la wallet.
 * @param {Licitacion} lic
 * @param {{ monto: bigint, plazoDias: number, desglose: bigint[], propuesta: File }} oferta
 */
export async function ofertar(lic, oferta, alAvanzar = () => {}) {
  const cuenta = obtenerSesion().cuenta;
  alAvanzar("Firmá en tu wallet para recuperar tu identidad anónima…");
  const identidad = await miIdentidad();
  alAvanzar("Firmá en tu wallet para generar tu sal de autoría…");
  const sal2 = await miSalDeAutoria(lic.id);

  alAvanzar("Subiendo la propuesta técnica a IPFS…");
  const propuestaCID = await subirArchivo(oferta.propuesta, oferta.propuesta.type || "application/pdf");

  alAvanzar("Cifrando el monto con timelock (drand)…");
  const sal = protocolo.nuevaSal();
  const cifrado = await cifrarOferta({ ...oferta, sal }, lic.cierreOfertas);
  const cifradoHex = ethers.hexlify(ethers.toUtf8Bytes(cifrado));
  const compromisoMonto = protocolo.compromisoMonto(lic.id, oferta.monto, oferta.plazoDias, oferta.desglose, sal);
  const compromisoAutoria = protocolo.compromisoAutoria(lic.id, cuenta, sal2);
  const mensaje = protocolo.mensajeOferta(lic.id, ethers.keccak256(cifradoHex), compromisoMonto, compromisoAutoria, propuestaCID);

  alAvanzar("Generando la prueba de conocimiento cero (puede tardar unos segundos)…");
  const prueba = await probarPertenencia(identidad, mensaje, BigInt(lic.id));

  const { licitaciones } = await contratosDeLectura();
  if (await licitaciones.nullifierUsado(lic.id, prueba.nullifier)) throw new Error("Tu empresa ya ofertó en esta licitación.");

  alAvanzar("Enviando la oferta por el relayer…");
  return enviarOfertaPorRelayer({
    licitacionId: lic.id,
    cifrado: cifradoHex,
    compromisoMonto,
    compromisoAutoria,
    propuestaCID,
    prueba,
  });
}

/** ¿Cuál de las ofertas es la mía? (Compara con mi compromiso de autoría; pide una firma.) */
export async function miOferta(detalle) {
  const sal2 = await miSalDeAutoria(detalle.id);
  const compromiso = protocolo.compromisoAutoria(detalle.id, obtenerSesion().cuenta, sal2);
  return detalle.ofertas.find((o) => o.compromisoAutoria === compromiso) ?? null;
}

// ---------------------------------------------------------------------------
// 3. Apertura (cualquiera)
// ---------------------------------------------------------------------------

/** Descifra una oferta sin publicarla (para ver los montos apenas vence el plazo). */
export async function verOfertaDescifrada(oferta) {
  return descifrarOferta(oferta.cifrado);
}

/** Descifra y publica en la cadena todas las ofertas que siguen cerradas. Devuelve cuántas abrió. */
export async function abrirOfertas(detalle, alAvanzar = () => {}) {
  const lic = obtenerLicitaciones();
  let abiertas = 0;
  const problemas = [];
  for (const o of detalle.ofertas.filter((x) => !x.abierta)) {
    alAvanzar(`Descifrando la oferta #${o.id}…`);
    let secreto;
    try {
      secreto = await descifrarOferta(o.cifrado);
    } catch (error) {
      problemas.push(`#${o.id}: no se pudo descifrar (${error?.message ?? error})`);
      continue;
    }
    alAvanzar(`Confirmá en tu wallet la apertura de la oferta #${o.id}…`);
    await confirmar(lic.abrirOferta(detalle.id, o.id, secreto.monto, secreto.plazoDias, secreto.desglose, secreto.sal));
    abiertas++;
  }
  return { abiertas, problemas };
}

// ---------------------------------------------------------------------------
// 4. Adjudicación (empleado del organismo)
// ---------------------------------------------------------------------------

async function subirDictamen(texto, archivo) {
  const archivoCID = archivo ? await subirArchivo(archivo, archivo.type || "application/pdf") : null;
  return subirJson({ tipo: "dictamen", texto, archivoCID, archivoNombre: archivo?.name ?? null, fecha: new Date().toISOString() });
}

export async function adjudicar(licitacionId, ofertaId, texto, archivo) {
  const dictamenCID = await subirDictamen(texto, archivo);
  return confirmar(obtenerLicitaciones().adjudicar(licitacionId, ofertaId, dictamenCID));
}

export async function declararDesierta(licitacionId, texto, archivo) {
  const dictamenCID = await subirDictamen(texto, archivo);
  return confirmar(obtenerLicitaciones().declararDesierta(licitacionId, dictamenCID));
}

// ---------------------------------------------------------------------------
// 5. Cierre: revelar autoría (proveedor, desde su wallet real)
// ---------------------------------------------------------------------------

export async function revelarAutoria(detalle) {
  const mia = await miOferta(detalle);
  if (!mia) throw new Error("No encontramos una oferta tuya en esta licitación.");
  const sal2 = await miSalDeAutoria(detalle.id);
  await confirmar(obtenerLicitaciones().revelarAutoria(detalle.id, mia.id, sal2));
  return mia;
}

// ---------------------------------------------------------------------------
// 6. Ejecución: inspectores y etapas
// ---------------------------------------------------------------------------

export const asignarInspector = (licitacionId, wallet) => confirmar(obtenerLicitaciones().asignarInspector(licitacionId, wallet));

export async function registrarEvaluacion(licitacionId, etapa, aprobada, texto, archivo) {
  const archivoCID = archivo ? await subirArchivo(archivo, archivo.type || "application/pdf") : null;
  const informeCID = await subirJson({
    tipo: "informe-de-inspeccion",
    etapa,
    aprobada,
    texto,
    archivoCID,
    archivoNombre: archivo?.name ?? null,
    fecha: new Date().toISOString(),
  });
  return confirmar(obtenerLicitaciones().registrarEvaluacion(licitacionId, etapa, aprobada, informeCID));
}

/** Inspectores con credencial vigente (para elegir a quién asignar). */
export async function inspectoresDisponibles() {
  const { credenciales } = await contratosDeLectura();
  const total = Number(await credenciales.totalEmitidas());
  const lista = [];
  for (let id = 1; id <= total; id++) {
    const [c, wallet] = await Promise.all([credenciales.credencial(id), credenciales.ownerOf(id)]);
    if (ROLES[Number(c.rol)] === "INSPECTOR" && !c.revocada && Number(c.validaHasta) >= ahora()) {
      lista.push({ wallet, nombre: c.nombre, organismoId: Number(c.organismoId) });
    }
  }
  return lista;
}
