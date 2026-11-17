// Lecturas y transacciones del contrato Licitaciones.

import * as ethers from "ethers";
import { ESTADOS_LICITACION, ROLES, WEI_POR_PESO } from "../shared/protocolo.js";
import { enviarOfertaPorRelayer, leerJsonIpfs, subirArchivo, subirJson } from "./backend.js";
import { probarPertenencia } from "./grupo.js";
import { miIdentidad, miSalDeAutoria, protocolo } from "./identidad.js";
import { ahora, contratosDeLectura, obtenerLicitaciones, obtenerSesion } from "./sesion.js";
import { cifrarIdentidad, cifrarOferta, descifrarIdentidad, descifrarOferta } from "./timelock.js";

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
 * @property {number} limiteAdjudicacion También es cuando se revelan solas las identidades
 * @property {number} adjudicadaEn
 * @property {bigint} presupuestoOficial
 * @property {string} metadataCID
 * @property {number[]} porcentajesEtapas En puntos básicos
 * @property {boolean} sobresAbiertos
 * @property {number} ofertaGanadora
 * @property {string} dictamenCID
 * @property {boolean} desierta
 * @property {string} contratista
 * @property {number} etapasAprobadas
 * @property {bigint} fondos Wei en escrow todavía sin pagar
 * @property {boolean} financiada
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

export { ESTADOS_LICITACION, WEI_POR_PESO };

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
  if (ahora() <= l.cierreOfertas) return "RECIBIENDO_OFERTAS";
  return l.sobresAbiertos ? "EVALUACION" : "APERTURA";
}

/** ¿Ya pasó la fecha límite de adjudicación? (Desde ahí las identidades se pueden descifrar.) */
export const vencioLimite = (l) => ahora() > l.limiteAdjudicacion;

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
    limiteAdjudicacion: Number(l.limiteAdjudicacion),
    adjudicadaEn: Number(l.adjudicadaEn),
    presupuestoOficial: l.presupuestoOficial,
    metadataCID: l.metadataCID,
    porcentajesEtapas: l.porcentajesEtapas.map(Number),
    sobresAbiertos: l.sobresAbiertos,
    ofertaGanadora: Number(l.ofertaGanadora),
    dictamenCID: l.dictamenCID,
    desierta: l.desierta,
    contratista: l.contratista,
    etapasAprobadas: Number(l.etapasAprobadas),
    fondos: l.fondos,
    financiada: l.financiada,
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
 * @property {string} cifrado Contenido cifrado (texto armado de age, tlock)
 * @property {string} cifradoIdentidad Identidad cifrada
 * @property {string} compromisoMonto
 * @property {string} compromisoAutoria
 * @property {string} propuestaCID
 * @property {number} enviadaEn
 * @property {boolean} abierta
 * @property {boolean} descartada
 * @property {bigint} monto
 * @property {number} plazoDias
 * @property {bigint[]} desglose
 * @property {string} autor
 * @property {string | null} autorNombre
 * @property {string} txHash
 */

/** Detalle completo de una licitación: ofertas, decisiones, fondos, inspectores, evaluaciones y pagos. */
export async function leerDetalle(id) {
  const { licitaciones: c, credenciales, desde } = await contratosDeLectura();
  const [l, cantidad] = await Promise.all([c.licitacion(id), c.cantidadOfertas(id)]);
  const lic = normalizar(id, l, cantidad);
  lic.metadata = await metadataDe(lic.metadataCID);

  const f = c.filters;
  const [recibidas, apertura, adjudicacion, desierta, inspectores, evaluaciones, publicacion, fondos, pagos, autorias] = await Promise.all([
    c.queryFilter(f.OfertaRecibida(id), desde),
    c.queryFilter(f.SobresAbiertos(id), desde),
    c.queryFilter(f.LicitacionAdjudicada(id), desde),
    c.queryFilter(f.LicitacionDesierta(id), desde),
    c.queryFilter(f.InspectorAsignado(id), desde),
    c.queryFilter(f.EvaluacionRegistrada(id), desde),
    c.queryFilter(f.LicitacionPublicada(id), desde),
    c.queryFilter(f.FondosDepositados(id), desde),
    c.queryFilter(f.PagoRealizado(id), desde),
    c.queryFilter(f.AutoriaRevelada(id), desde),
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
        cifradoIdentidad: ethers.toUtf8String(e.args.cifradoIdentidad),
        compromisoMonto: o.compromisoMonto,
        compromisoAutoria: o.compromisoAutoria,
        propuestaCID: o.propuestaCID,
        enviadaEn: Number(o.enviadaEn),
        abierta: o.abierta,
        descartada: o.descartada,
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
    apertura: apertura[0]
      ? { empleado: apertura[0].args.empleado, empleadoNombre: await nombreDe(apertura[0].args.empleado), txHash: apertura[0].transactionHash }
      : null,
    decision: adj
      ? {
          empleado: adj.args.empleado,
          empleadoNombre: await nombreDe(adj.args.empleado),
          dictamenCID: adj.args.dictamenCID,
          txHash: adj.transactionHash,
          dictamen: await leerJsonIpfs(adj.args.dictamenCID).catch(() => null),
        }
      : null,
    autorias: autorias.map((e) => ({ ofertaId: Number(e.args.ofertaId), txHash: e.transactionHash })),
    deposito: fondos[0] ? { monto: fondos[0].args.monto, txHash: fondos[0].transactionHash } : null,
    pagos: pagos.map((e) => ({ etapa: Number(e.args.etapa), monto: e.args.monto, txHash: e.transactionHash })),
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
 *   limite: number, etapas: { nombre: string, porcentaje: number }[], pliego: File }} datos
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
      BigInt(datos.limite),
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

  alAvanzar("Cifrando la oferta y tu identidad con timelock (drand)…");
  const sal = protocolo.nuevaSal();
  const cifrado = ethers.hexlify(ethers.toUtf8Bytes(await cifrarOferta({ ...oferta, sal }, lic.cierreOfertas)));
  const cifradoIdentidad = ethers.hexlify(ethers.toUtf8Bytes(await cifrarIdentidad({ wallet: cuenta, sal: sal2 }, lic.limiteAdjudicacion)));
  const compromisoMonto = protocolo.compromisoMonto(lic.id, oferta.monto, oferta.plazoDias, oferta.desglose, sal);
  const compromisoAutoria = protocolo.compromisoAutoria(lic.id, cuenta, sal2);
  const mensaje = protocolo.mensajeOferta(
    lic.id,
    ethers.keccak256(cifrado),
    ethers.keccak256(cifradoIdentidad),
    compromisoMonto,
    compromisoAutoria,
    propuestaCID,
  );

  alAvanzar("Generando la prueba de conocimiento cero (puede tardar unos segundos)…");
  const prueba = await probarPertenencia(identidad, mensaje, BigInt(lic.id));

  const { licitaciones } = await contratosDeLectura();
  if (await licitaciones.nullifierUsado(lic.id, prueba.nullifier)) throw new Error("Tu empresa ya ofertó en esta licitación.");

  alAvanzar("Enviando la oferta por el relayer…");
  return enviarOfertaPorRelayer({ licitacionId: lic.id, cifrado, cifradoIdentidad, compromisoMonto, compromisoAutoria, propuestaCID, prueba });
}

/** ¿Cuál de las ofertas es la mía? (Compara con mi compromiso de autoría; pide una firma.) */
export async function miOferta(detalle) {
  const sal2 = await miSalDeAutoria(detalle.id);
  const compromiso = protocolo.compromisoAutoria(detalle.id, obtenerSesion().cuenta, sal2);
  return detalle.ofertas.find((o) => o.compromisoAutoria === compromiso) ?? null;
}

// ---------------------------------------------------------------------------
// 3. Apertura de sobres (empleado del organismo, todos juntos)
// ---------------------------------------------------------------------------

const SOBRE_DESCARTADO = { valido: false, monto: 0n, plazoDias: 0, desglose: [], sal: ethers.ZeroHash };

/** Descifra un sobre y comprueba que coincida con su compromiso. Devuelve null si no sirve. */
async function descifrarSobre(licitacionId, o) {
  try {
    const s = await descifrarOferta(o.cifrado);
    if (protocolo.compromisoMonto(licitacionId, s.monto, s.plazoDias, s.desglose, s.sal) !== o.compromisoMonto) return null;
    return s;
  } catch (error) {
    // Si drand todavía no publicó la ronda, no es un sobre inválido: hay que esperar.
    if (/too early|not yet|future|beacon/i.test(String(error?.message))) throw new Error("drand todavía no publicó la clave del cierre. Probá en unos segundos.");
    return null;
  }
}

/**
 * Descifra TODOS los sobres en el navegador y los publica en una sola transacción. Los que no se pueden
 * descifrar (o no coinciden con su compromiso) van como descartados.
 */
export async function abrirSobres(detalle, alAvanzar = () => {}) {
  const sobres = [];
  for (const o of detalle.ofertas) {
    alAvanzar(`Descifrando el sobre #${o.id} de ${detalle.ofertas.length}…`);
    const s = await descifrarSobre(detalle.id, o);
    sobres.push(s ? { valido: true, ...s } : SOBRE_DESCARTADO);
  }
  alAvanzar("Confirmá en tu wallet la apertura de todos los sobres…");
  await confirmar(obtenerLicitaciones().abrirSobres(detalle.id, sobres));
  return { validas: sobres.filter((s) => s.valido).length, descartadas: sobres.filter((s) => !s.valido).length };
}

/**
 * Control ciudadano: descifra cada sobre por su cuenta y compara con lo que publicó el organismo.
 * @returns {Promise<{ id: number, ok: boolean, detalle: string }[]>}
 */
export async function verificarApertura(detalle) {
  const resultado = [];
  for (const o of detalle.ofertas) {
    const s = await descifrarSobre(detalle.id, o);
    if (o.descartada) {
      resultado.push(
        s
          ? { id: o.id, ok: false, detalle: `Se descartó, pero se puede descifrar: $ ${s.monto.toLocaleString("es-AR")}` }
          : { id: o.id, ok: true, detalle: "Descartada: efectivamente no se puede descifrar" },
      );
    } else if (!s) {
      resultado.push({ id: o.id, ok: false, detalle: "Se publicó, pero el cifrado no da esos valores" });
    } else {
      const coincide = s.monto === o.monto && s.plazoDias === o.plazoDias;
      resultado.push({ id: o.id, ok: coincide, detalle: coincide ? "Coincide con el cifrado" : "No coincide con el cifrado" });
    }
  }
  return resultado;
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
// 5. Identidades
// ---------------------------------------------------------------------------

/** Después de la fecha límite: descifra las identidades que faltan y las publica (cualquiera). */
export async function revelarIdentidades(detalle, alAvanzar = () => {}) {
  const pendientes = [];
  const problemas = [];
  for (const o of detalle.ofertas.filter((x) => x.autor === ethers.ZeroAddress)) {
    alAvanzar(`Descifrando la identidad de la oferta #${o.id}…`);
    try {
      const { wallet, sal } = await descifrarIdentidad(o.cifradoIdentidad);
      if (protocolo.compromisoAutoria(detalle.id, wallet, sal) !== o.compromisoAutoria) throw new Error("no coincide con el compromiso");
      pendientes.push({ ofertaId: o.id, wallet, sal });
    } catch (error) {
      problemas.push(`#${o.id}: ${error?.message ?? error}`);
    }
  }
  if (pendientes.length) {
    alAvanzar("Confirmá en tu wallet la publicación de las identidades…");
    await confirmar(obtenerLicitaciones().revelarIdentidades(detalle.id, pendientes));
  }
  return { reveladas: pendientes.length, problemas };
}

/** El proveedor revela por su cuenta (para empezar la obra sin esperar la fecha límite). */
export async function revelarAutoria(detalle) {
  const mia = await miOferta(detalle);
  if (!mia) throw new Error("No encontramos una oferta tuya en esta licitación.");
  const sal2 = await miSalDeAutoria(detalle.id);
  await confirmar(obtenerLicitaciones().revelarAutoria(detalle.id, mia.id, sal2));
  return mia;
}

// ---------------------------------------------------------------------------
// 6. Ejecución: fondos, inspectores, etapas y pagos
// ---------------------------------------------------------------------------

/** Pesos → wei (1 peso = 1 gwei, igual que el contrato). */
export const pesosAWei = (pesos) => BigInt(pesos) * WEI_POR_PESO;

/** El organismo deposita en el contrato el monto adjudicado. */
export async function depositarFondos(licitacionId) {
  const { licitaciones } = await contratosDeLectura();
  const valor = await licitaciones.montoAdjudicadoEnWei(licitacionId);
  return confirmar(obtenerLicitaciones().depositarFondos(licitacionId, { value: valor }));
}

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

/** Inspectores con credencial vigente de un organismo (para elegir a quién asignar). */
export async function inspectoresDisponibles(organismoId) {
  const { credenciales } = await contratosDeLectura();
  const total = Number(await credenciales.totalEmitidas());
  const lista = [];
  for (let id = 1; id <= total; id++) {
    const [c, wallet] = await Promise.all([credenciales.credencial(id), credenciales.ownerOf(id)]);
    if (ROLES[Number(c.rol)] === "INSPECTOR" && !c.revocada && Number(c.validaHasta) >= ahora() && Number(c.organismoId) === organismoId) {
      lista.push({ wallet, nombre: c.nombre, organismoId: Number(c.organismoId) });
    }
  }
  return lista;
}
