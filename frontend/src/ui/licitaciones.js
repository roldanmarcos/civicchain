// Licitaciones: tarjetas, estadísticas del inicio y la pantalla de detalle con las acciones de cada rol.
// Todo se lee de la blockchain (y los documentos, de IPFS).

import { NETWORKS } from "../config/contracts.js";
import { urlIpfs } from "../web3/backend.js";
import { explicarError } from "../web3/errores.js";
import {
  abrirOfertas,
  adjudicar,
  asignarInspector,
  declararDesierta,
  inspectoresDisponibles,
  leerDetalle,
  miOferta,
  ofertar,
  registrarEvaluacion,
  revelarAutoria,
  verOfertaDescifrada,
} from "../web3/licitaciones.js";
import { obtenerSesion, redObjetivo, rolActivo } from "../web3/sesion.js";
import {
  acortar,
  formatearFechaHora,
  formatearPesos,
  html,
  mostrarToast,
  nombreOrganismo,
  pesosCortos,
  render,
  tiempoRelativo,
} from "./dom.js";

export const ETIQUETAS_ESTADO = {
  RECIBIENDO_OFERTAS: ["Recibiendo ofertas", ""],
  APERTURA: ["Apertura de ofertas", "status-evaluating"],
  EVALUACION: ["En evaluación", "status-evaluating"],
  ADJUDICADA: ["Adjudicada", "status-executing"],
  EN_EJECUCION: ["En ejecución", "status-executing"],
  FINALIZADA: ["Finalizada", "status-done"],
  DESIERTA: ["Desierta", "status-revoked"],
};

const TEMAS = ["green", "blue", "orange", "purple"];
const FASES = [
  ["Publicación", []],
  ["Ofertas", ["RECIBIENDO_OFERTAS"]],
  ["Apertura", ["APERTURA"]],
  ["Evaluación", ["EVALUACION"]],
  ["Adjudicación", ["ADJUDICADA", "DESIERTA"]],
  ["Ejecución", ["EN_EJECUCION"]],
  ["Finalizada", ["FINALIZADA"]],
];
const indiceFase = (estado) => FASES.findIndex(([, estados]) => estados.includes(estado));

export const badgeLicitacion = (estado) => {
  const [texto, clase] = ETIQUETAS_ESTADO[estado];
  return html`<span class="card-status ${clase}">${texto}</span>`;
};

/** @param {import("../web3/licitaciones.js").Licitacion} l */
export function tarjetaLicitacion(l) {
  const lugar = l.metadata?.ubicacion?.split(",")[0];
  return html`<article class="tender-card" tabindex="0" role="button" data-tender="${l.id}" aria-label="Ver ${l.titulo}">
    <div class="tender-visual visual-${TEMAS[l.id % TEMAS.length]}"><span class="visual-tag">CC-${String(l.id).padStart(3, "0")}</span><span class="visual-building"></span><span class="visual-number">CIVICCHAIN · NFT #${l.id}</span></div>
    ${badgeLicitacion(l.estado)}
    <h3>${l.titulo}</h3><p class="agency">${nombreOrganismo(l.organismoId)}${lugar ? ` · ${lugar}` : ""}</p>
    <div class="card-meta"><span>${l.estado === "RECIBIENDO_OFERTAS" ? `Cierra ${tiempoRelativo(l.cierreOfertas)}` : `${l.cantidadOfertas} oferta(s)`}</span><strong>${pesosCortos(l.presupuestoOficial)}</strong></div>
  </article>`;
}

/** Estadísticas del inicio. */
export function renderEstadisticas(lista) {
  const activas = lista.filter((l) => ["RECIBIENDO_OFERTAS", "APERTURA", "EVALUACION", "ADJUDICADA", "EN_EJECUCION"].includes(l.estado));
  const texto = (id, t) => (document.getElementById(id).textContent = t);
  texto("stat-activas", String(activas.length).padStart(2, "0"));
  texto("stat-activas-detalle", `${lista.length} publicadas en total`);
  texto("stat-presupuesto", pesosCortos(lista.reduce((s, l) => s + l.presupuestoOficial, 0n)));
  texto("stat-ofertas", String(lista.reduce((s, l) => s + l.cantidadOfertas, 0)));
  const proxima = lista.filter((l) => l.estado === "RECIBIENDO_OFERTAS").sort((a, b) => a.cierreOfertas - b.cierreOfertas)[0];
  texto("stat-cierre", proxima ? tiempoRelativo(proxima.cierreOfertas).replace("en ", "") : "—");
  texto("stat-cierre-detalle", proxima ? proxima.titulo : "Sin licitaciones abiertas");
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

const enlaceTx = (hash) => {
  const explorador = NETWORKS[redObjetivo()]?.explorador;
  if (!hash) return "";
  return explorador
    ? html`<a href="${explorador}/tx/${hash}" target="_blank" rel="noopener"><code>${acortar(hash)}</code> ↗</a>`
    : html`<code title="${hash}">${acortar(hash)}</code>`;
};
const enlaceIpfs = (cid, texto = acortar(cid)) => (cid ? html`<a href="${urlIpfs(cid)}" target="_blank" rel="noopener">${texto} ↗</a>` : "—");

let detalleActual = null;
let renderId = 0;

export const licitacionAbierta = () => detalleActual;

export async function renderDetalle(id = detalleActual) {
  if (!id) return;
  detalleActual = id;
  const actual = ++renderId;
  const contenedor = document.getElementById("detalle-content");
  if (!contenedor.dataset.id || contenedor.dataset.id !== String(id)) {
    contenedor.dataset.id = String(id);
    render(contenedor, html`<div class="alerta"><p>Leyendo la licitación de la blockchain…</p></div>`);
  }
  let d;
  try {
    d = await leerDetalle(id);
  } catch (error) {
    if (actual === renderId) render(contenedor, html`<div class="alerta alerta-error"><p>${explicarError(error)}</p></div>`);
    return;
  }
  if (actual !== renderId) return;
  // No pisar un formulario que el usuario está completando.
  if (contenedor.querySelector("form[data-ocupado]")) return;

  const fase = indiceFase(d.estado);
  const meta = d.metadata ?? {};
  const etapas = d.porcentajesEtapas.map((p, i) => ({ nombre: meta.etapas?.[i]?.nombre ?? `Etapa ${i + 1}`, porcentaje: p / 100 }));
  const ganadora = d.ofertas.find((o) => o.id === d.ofertaGanadora);
  const progreso = d.estado === "FINALIZADA" ? 100 : Math.round(((fase < 0 ? 0 : fase) / (FASES.length - 1)) * 100);

  render(
    contenedor,
    html`<div class="detail-layout">
      <div class="detail-main">
        <div class="detail-status">${badgeLicitacion(d.estado)}</div>
        <div class="eyebrow eyebrow-muted">CC-${String(d.id).padStart(3, "0")} · ${nombreOrganismo(d.organismoId).toLocaleUpperCase("es")}</div>
        <h1>${d.titulo}</h1>
        ${meta.ubicacion && html`<p class="detail-location">⌖  ${meta.ubicacion}</p>`}
        <div class="detail-progress">
          <div class="progress-heading"><strong>Estado del proceso</strong><span>${ETIQUETAS_ESTADO[d.estado][0]}</span></div>
          <div class="progress-track"><span style="width:${progreso}%"></span></div>
          <div class="phase-list">${FASES.map(([nombre], i) => html`<span class="phase ${i < fase || d.estado === "FINALIZADA" ? "done" : ""} ${i === fase ? "current" : ""}">${nombre}</span>`)}</div>
        </div>
        <div class="detail-description"><h2>Sobre esta obra</h2><p>${meta.description ?? "Sin descripción."}</p></div>
        ${
          meta.pliegoCID
            ? html`<a class="detail-document" href="${urlIpfs(meta.pliegoCID)}" target="_blank" rel="noopener"><span class="document-icon">▤</span><span><strong>Pliego de condiciones</strong><small>IPFS · ${acortar(meta.pliegoCID)}</small></span><span class="document-arrow">↗</span></a>`
            : ""
        }

        <div id="panel-accion"></div>

        <h2 class="subtitulo">Ofertas (${d.ofertas.length})</h2>
        ${seccionOfertas(d)}

        <h2 class="subtitulo">Etapas de la obra</h2>
        ${seccionEtapas(d, etapas)}

        <h2 class="subtitulo">Registro en la blockchain</h2>
        ${seccionRegistro(d)}
      </div>
      <aside class="detail-aside">
        <div class="aside-card">
          <span class="aside-label">PRESUPUESTO OFICIAL</span><strong>${formatearPesos(d.presupuestoOficial)}</strong>
          <div class="aside-divider"></div>
          <span class="aside-label">CIERRE DE OFERTAS</span><strong class="aside-date">${formatearFechaHora(d.cierreOfertas)}</strong>
          <small class="texto-suave">${tiempoRelativo(d.cierreOfertas)}</small>
          <div class="aside-divider"></div>
          <span class="aside-label">APERTURA HASTA</span><strong class="aside-date">${formatearFechaHora(d.finApertura)}</strong>
          <div class="aside-divider"></div>
          ${
            ganadora
              ? html`<span class="aside-label">ADJUDICADA A</span><strong>Oferta #${ganadora.id} · ${formatearPesos(ganadora.monto)}</strong>
                  <small class="texto-suave">${d.contratista !== "0x0000000000000000000000000000000000000000" ? `${ganadora.autorNombre ?? acortar(d.contratista)}` : "El ganador todavía no reveló su identidad"}</small>`
              : html`<div class="sealed-info"><span>⌑</span><p><strong>Ofertas selladas</strong><br>Cifradas con timelock: nadie puede ver los montos antes del cierre.</p></div>`
          }
        </div>
        <div class="aside-card audit-card"><span class="mini-icon green-icon">✓</span><strong>Proceso auditable</strong>
          <p>Publicada por ${d.creadorNombre ?? acortar(d.creador)}. Licitación NFT #${d.id} · metadatos ${enlaceIpfs(d.metadataCID)}</p></div>
      </aside>
    </div>`,
  );

  renderPanelAccion(d, etapas);
  contenedor.querySelectorAll("[data-ver-descifrada]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      const boton = /** @type {HTMLButtonElement} */ (e.currentTarget);
      const oferta = d.ofertas.find((o) => o.id === Number(boton.dataset.verDescifrada));
      boton.disabled = true;
      boton.textContent = "Descifrando…";
      try {
        const s = await verOfertaDescifrada(oferta);
        boton.replaceWith(Object.assign(document.createElement("span"), { textContent: `${formatearPesos(s.monto)} (sin publicar)` }));
      } catch (error) {
        boton.disabled = false;
        boton.textContent = "Ver monto";
        mostrarToast(`No se pudo descifrar: ${error?.message ?? error}`, 6000);
      }
    }),
  );
}

function seccionOfertas(d) {
  if (d.ofertas.length === 0) {
    return html`<p class="texto-suave">${d.estado === "RECIBIENDO_OFERTAS" ? "Todavía no se recibieron ofertas." : "No se recibieron ofertas."}</p>`;
  }
  const verMonto = d.estado === "APERTURA" || d.estado === "EVALUACION";
  return html`<div class="tabla-scroll"><table class="tabla">
    <thead><tr><th>#</th><th>Enviada</th><th>Monto</th><th>Plazo</th><th>Propuesta técnica</th><th>Autor</th></tr></thead>
    <tbody>${d.ofertas.map(
      (o) => html`<tr class="${o.id === d.ofertaGanadora ? "fila-ganadora" : ""}">
        <td>${o.id}${o.id === d.ofertaGanadora ? " ★" : ""}</td>
        <td>${formatearFechaHora(o.enviadaEn)}</td>
        <td>${
          o.abierta
            ? formatearPesos(o.monto)
            : verMonto
              ? html`<button class="button button-text button-small" data-ver-descifrada="${o.id}">Ver monto</button>`
              : html`<span title="Cifrado con timelock hasta el cierre">⌑ Cifrado</span>`
        }</td>
        <td>${o.abierta ? `${o.plazoDias} días` : "—"}</td>
        <td>${enlaceIpfs(o.propuestaCID, "Ver")}</td>
        <td>${o.autor !== "0x0000000000000000000000000000000000000000" ? html`${o.autorNombre ?? ""} <code>${acortar(o.autor)}</code>` : html`<span class="texto-suave">Anónimo</span>`}</td>
      </tr>`,
    )}</tbody>
  </table></div>
  <p class="texto-suave">Cada oferta trae una prueba de conocimiento cero: el contrato verificó que la mandó un proveedor habilitado sin saber cuál. Las mandó el relayer, no la wallet del proveedor.</p>`;
}

function seccionEtapas(d, etapas) {
  return html`<ol class="etapas">${etapas.map((e, i) => {
    const evaluaciones = d.evaluaciones.filter((x) => x.etapa === i);
    const aprobada = i < d.etapasAprobadas;
    return html`<li class="${aprobada ? "etapa-aprobada" : i === d.etapasAprobadas && d.estado === "EN_EJECUCION" ? "etapa-actual" : ""}">
      <div><strong>${e.nombre}</strong> <span class="texto-suave">· ${e.porcentaje}% del pago${
        d.ofertaGanadora && d.ofertas.find((o) => o.id === d.ofertaGanadora)?.desglose[i] !== undefined
          ? ` · ${formatearPesos(d.ofertas.find((o) => o.id === d.ofertaGanadora).desglose[i])}`
          : ""
      }</span> ${aprobada ? html`<span class="card-status">Aprobada</span>` : ""}</div>
      ${evaluaciones.map(
        (ev) => html`<div class="evaluacion ${ev.aprobada ? "" : "evaluacion-observada"}">
          ${ev.aprobada ? "✓ Aprobada" : "⚠ Observada"} por ${ev.inspectorNombre ?? acortar(ev.inspector)}: ${ev.informe?.texto ?? ""}
          ${ev.informe?.archivoCID ? enlaceIpfs(ev.informe.archivoCID, "adjunto") : ""} · ${enlaceTx(ev.txHash)}
        </div>`,
      )}
    </li>`;
  })}</ol>
  ${d.inspectores.length > 0 && html`<p class="texto-suave">Inspectores asignados: ${d.inspectores.map((i, n) => html`${n ? ", " : ""}${i.nombre ?? acortar(i.wallet)}`)}</p>`}`;
}

function seccionRegistro(d) {
  const filas = [["Publicación", `${d.creadorNombre ?? acortar(d.creador)} publicó la licitación`, d.txPublicacion]];
  for (const o of d.ofertas) filas.push([`Oferta #${o.id}`, `Recibida (nullifier ${acortar(o.nullifier)})`, o.txHash]);
  if (d.decision) {
    filas.push([
      d.desierta ? "Desierta" : "Adjudicación",
      html`${d.decision.empleadoNombre ?? acortar(d.decision.empleado)}: ${d.decision.dictamen?.texto ?? ""} ${
        d.decision.dictamen?.archivoCID ? enlaceIpfs(d.decision.dictamen.archivoCID, "dictamen") : enlaceIpfs(d.decision.dictamenCID, "dictamen")
      }`,
      d.decision.txHash,
    ]);
  }
  return html`<div class="tabla-scroll"><table class="tabla"><tbody>${filas.map(
    ([evento, detalle, tx]) => html`<tr><td><strong>${evento}</strong></td><td>${detalle}</td><td>${enlaceTx(tx)}</td></tr>`,
  )}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// Acciones según rol y estado
// ---------------------------------------------------------------------------

function renderPanelAccion(d, etapas) {
  const panel = document.getElementById("panel-accion");
  const sesion = obtenerSesion();
  const rol = rolActivo();
  const conectado = sesion.estado === "CONECTADO";
  const esEmpleadoDelOrganismo = rol === "EMPLEADO" && sesion.credencial.organismoId === d.organismoId;
  const esInspectorAsignado = rol === "INSPECTOR" && d.inspectores.some((i) => i.wallet.toLowerCase() === sesion.cuenta.toLowerCase());
  const bloques = [];

  if (d.estado === "RECIBIENDO_OFERTAS") {
    const previa = rol === "PROVEEDOR" ? ofertaRecordada(sesion.cuenta, d.id) : null;
    if (previa)
      bloques.push(html`<div class="alerta alerta-ok"><strong>Ya enviaste tu oferta (#${previa}) desde este navegador</strong>
        <p>Es anónima: nadie puede ver el monto hasta el cierre ni saber que es tuya. Una segunda oferta sería rechazada.</p></div>`);
    else if (rol === "PROVEEDOR") bloques.push(formularioOferta(d, etapas));
    else if (!conectado || !rol)
      bloques.push(html`<div class="alerta"><strong>¿Sos proveedor?</strong><p>Para ofertar necesitás tu credencial de proveedor. Tu oferta va a ser anónima.</p>
        <button class="button button-outline button-small" data-page="registro">Inscribirme →</button></div>`);
  }

  if (d.estado === "APERTURA" && d.ofertas.some((o) => !o.abierta)) {
    bloques.push(html`<div class="panel-card"><div class="panel-card-head"><strong>Apertura de ofertas</strong></div>
      <p>El plazo venció y drand ya publicó la clave: cualquiera puede descifrar los montos y publicarlos en la cadena.
        El bot de CivicChain lo hace solo; también podés hacerlo vos (pagás el gas).</p>
      ${conectado ? html`<button class="button button-primary button-small" id="abrir-ofertas">Descifrar y publicar las ofertas</button>` : html`<p class="texto-suave">Conectá tu wallet para publicarlas.</p>`}
      <div id="apertura-resultado"></div></div>`);
  }

  if (d.estado === "EVALUACION" && esEmpleadoDelOrganismo) bloques.push(formularioAdjudicacion(d));

  if (["ADJUDICADA", "EN_EJECUCION", "FINALIZADA", "DESIERTA"].includes(d.estado) && rol === "PROVEEDOR" && d.ofertas.length > 0) {
    bloques.push(html`<div class="panel-card"><div class="panel-card-head"><strong>Revelar tu autoría</strong></div>
      <p>La decisión ya está tomada. Si ofertaste, demostrá desde tu wallet cuál era tu oferta. ${d.estado === "ADJUDICADA" ? "Si ganaste, es necesario para empezar la obra." : ""}</p>
      <button class="button button-primary button-small" id="revelar-autoria">Buscar mi oferta y revelar</button>
      <div id="revelar-resultado"></div></div>`);
  }

  if (esEmpleadoDelOrganismo && ["ADJUDICADA", "EN_EJECUCION"].includes(d.estado)) {
    bloques.push(html`<div class="panel-card"><div class="panel-card-head"><strong>Asignar inspector</strong></div>
      <form id="form-inspector" class="busqueda-dni"><div class="form-field"><label for="inspector-wallet">Inspector</label>
        <select id="inspector-wallet"><option value="">Cargando inspectores…</option></select></div>
        <button class="button button-outline button-small" type="submit">Asignar</button></form></div>`);
  }

  if (esInspectorAsignado && d.estado === "EN_EJECUCION") bloques.push(formularioEvaluacion(d, etapas));

  render(panel, html`${bloques}`);
  conectarPanel(d, etapas);
}

// Recordatorio local (solo en este navegador) de que la wallet ya ofertó. No es un dato de seguridad:
// el contrato rechaza igual una segunda oferta por el nullifier.
const claveOferta = (cuenta, id) => `civicchain:oferta:${cuenta.toLowerCase()}:${id}`;
function ofertaRecordada(cuenta, id) {
  try {
    return localStorage.getItem(claveOferta(cuenta, id));
  } catch {
    return null;
  }
}
function recordarOferta(cuenta, id, ofertaId) {
  try {
    localStorage.setItem(claveOferta(cuenta, id), String(ofertaId));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

function formularioOferta(d, etapas) {
  return html`<form class="panel-card" id="form-oferta" novalidate>
    <div class="panel-card-head"><strong>Presentar oferta anónima</strong><span class="role-tag">⌑ CIFRADA HASTA EL CIERRE</span></div>
    <p class="texto-suave">El monto se cifra en tu navegador para el momento del cierre (drand) y la oferta sale por el relayer
      con una prueba de que estás habilitado, sin revelar quién sos. Vas a firmar dos mensajes con tu wallet (no son transacciones ni cuestan gas).</p>
    <div class="form-grid">
      ${etapas.map(
        (e, i) => html`<div class="form-field"><label for="oferta-etapa-${i}">${e.nombre} (${e.porcentaje}%)</label>
          <input id="oferta-etapa-${i}" name="etapa-${i}" inputmode="numeric" placeholder="Monto en pesos" required></div>`,
      )}
      <div class="form-field"><label for="oferta-plazo">Plazo de ejecución (días)</label><input id="oferta-plazo" name="plazo" type="number" min="1" required></div>
      <div class="form-field"><label for="oferta-propuesta">Propuesta técnica anonimizada (PDF)</label><input id="oferta-propuesta" name="propuesta" type="file" accept="application/pdf" required>
        <small class="campo-ayuda">Sin logos, nombres ni datos de la empresa: si no, se pierde el anonimato.</small></div>
    </div>
    <p><strong>Total: <span id="oferta-total">$ 0</span></strong> <span class="texto-suave">· presupuesto oficial ${formatearPesos(d.presupuestoOficial)}</span></p>
    <div id="oferta-resultado"></div>
    <button class="button button-primary" type="submit">Enviar oferta anónima <span>→</span></button>
  </form>`;
}

function formularioAdjudicacion(d) {
  const abiertas = d.ofertas.filter((o) => o.abierta).sort((a, b) => (a.monto < b.monto ? -1 : 1));
  return html`<form class="panel-card" id="form-adjudicacion" novalidate>
    <div class="panel-card-head"><strong>Evaluación y adjudicación</strong><span class="role-tag">SOLO TU ORGANISMO</span></div>
    <p class="texto-suave">Elegí una oferta por número. La identidad de los oferentes se conoce recién después de adjudicar.
      Si no elegís la más baja, el dictamen tiene que fundamentarlo.</p>
    ${
      abiertas.length
        ? html`<div class="opciones-oferta">${abiertas.map(
            (o, i) => html`<label class="opcion-oferta"><input type="radio" name="oferta" value="${o.id}" ${i === 0 ? "checked" : ""}>
              <span><strong>Oferta #${o.id} · ${formatearPesos(o.monto)}</strong> <span class="texto-suave">${o.plazoDias} días ${
                o.monto > d.presupuestoOficial ? "· supera el presupuesto" : ""
              } · ${enlaceIpfs(o.propuestaCID, "propuesta")}</span></span></label>`,
          )}</div>`
        : html`<p>No hay ofertas abiertas: se puede declarar desierta.</p>`
    }
    <div class="form-field"><label for="dictamen-texto">Dictamen</label><textarea id="dictamen-texto" name="dictamen" rows="4" required placeholder="Fundamentos de la decisión"></textarea></div>
    <div class="form-field"><label for="dictamen-archivo">Dictamen firmado (PDF, opcional)</label><input id="dictamen-archivo" name="archivo" type="file" accept="application/pdf"></div>
    <div id="adjudicacion-resultado"></div>
    <div class="acciones">
      ${abiertas.length > 0 && html`<button class="button button-primary button-small" type="submit" value="adjudicar">Adjudicar</button>`}
      <button class="button button-outline button-small" type="submit" value="desierta">Declarar desierta</button>
    </div>
  </form>`;
}

function formularioEvaluacion(d, etapas) {
  const etapa = d.etapasAprobadas;
  return html`<form class="panel-card" id="form-evaluacion" novalidate>
    <div class="panel-card-head"><strong>Evaluar etapa ${etapa + 1}: ${etapas[etapa].nombre}</strong><span class="role-tag">INSPECCIÓN</span></div>
    <div class="form-field"><label for="informe-texto">Informe</label><textarea id="informe-texto" rows="3" required></textarea></div>
    <div class="form-field"><label for="informe-archivo">Acta o fotos (PDF, opcional)</label><input id="informe-archivo" type="file" accept="application/pdf,image/*"></div>
    <div id="evaluacion-resultado"></div>
    <div class="acciones">
      <button class="button button-primary button-small" type="submit" value="aprobar">Aprobar etapa</button>
      <button class="button button-outline button-small" type="submit" value="observar">Registrar observación</button>
    </div>
  </form>`;
}

function conectarPanel(d, etapas) {
  const mensaje = (id, texto, tipo = "") => {
    const el = document.getElementById(id);
    if (el) render(el, html`<div class="alerta ${tipo}"><p>${texto}</p></div>`);
  };
  const ocupar = (form, ocupado) => {
    if (ocupado) form.dataset.ocupado = "1";
    else delete form.dataset.ocupado;
    form.querySelectorAll("button").forEach((b) => (b.disabled = ocupado));
  };

  // Oferta
  const formOferta = /** @type {HTMLFormElement | null} */ (document.getElementById("form-oferta"));
  if (formOferta) {
    const montos = () => etapas.map((_, i) => BigInt(/** @type {HTMLInputElement} */ (formOferta.elements.namedItem(`etapa-${i}`)).value.replace(/\D/g, "") || "0"));
    formOferta.addEventListener("input", () => {
      formOferta.dataset.ocupado = "1";
      document.getElementById("oferta-total").textContent = formatearPesos(montos().reduce((a, b) => a + b, 0n));
    });
    formOferta.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const desglose = montos();
      const monto = desglose.reduce((a, b) => a + b, 0n);
      const plazoDias = Number(/** @type {HTMLInputElement} */ (formOferta.elements.namedItem("plazo")).value);
      const propuesta = /** @type {HTMLInputElement} */ (formOferta.elements.namedItem("propuesta")).files?.[0];
      if (desglose.some((m) => m === 0n) || !plazoDias || !propuesta) return mensaje("oferta-resultado", "Completá el monto de cada etapa, el plazo y la propuesta técnica.", "alerta-error");
      if (monto > d.presupuestoOficial && !confirm("Tu oferta supera el presupuesto oficial: no se va a poder adjudicar. ¿Enviarla igual?")) return;
      ocupar(formOferta, true);
      try {
        const r = await ofertar(d, { monto, plazoDias, desglose, propuesta }, (t) => mensaje("oferta-resultado", t));
        mensaje("oferta-resultado", `✓ Oferta #${r.ofertaId} recibida. Nadie puede ver el monto hasta el cierre, ni saber que es tuya.`, "alerta-ok");
        mostrarToast("Oferta enviada.");
        recordarOferta(obtenerSesion().cuenta, d.id, r.ofertaId);
        delete formOferta.dataset.ocupado;
        setTimeout(() => renderDetalle(), 2500);
      } catch (error) {
        mensaje("oferta-resultado", explicarError(error), "alerta-error");
        ocupar(formOferta, false);
        formOferta.dataset.ocupado = "1";
      }
    });
  }

  // Apertura
  document.getElementById("abrir-ofertas")?.addEventListener("click", async (ev) => {
    const boton = /** @type {HTMLButtonElement} */ (ev.currentTarget);
    boton.disabled = true;
    try {
      const { abiertas, problemas } = await abrirOfertas(d, (t) => mensaje("apertura-resultado", t));
      mensaje("apertura-resultado", `${abiertas} oferta(s) publicadas.${problemas.length ? ` Problemas: ${problemas.join("; ")}` : ""}`, problemas.length ? "alerta-aviso" : "alerta-ok");
      renderDetalle();
    } catch (error) {
      mensaje("apertura-resultado", explicarError(error), "alerta-error");
      boton.disabled = false;
    }
  });

  // Adjudicación
  const formAdj = /** @type {HTMLFormElement | null} */ (document.getElementById("form-adjudicacion"));
  if (formAdj) {
    formAdj.addEventListener("input", () => (formAdj.dataset.ocupado = "1"));
    formAdj.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const accion = /** @type {HTMLButtonElement} */ (/** @type {SubmitEvent} */ (ev).submitter)?.value;
      const texto = /** @type {HTMLTextAreaElement} */ (formAdj.elements.namedItem("dictamen")).value.trim();
      const archivo = /** @type {HTMLInputElement} */ (formAdj.elements.namedItem("archivo")).files?.[0];
      if (!texto) return mensaje("adjudicacion-resultado", "El dictamen es obligatorio.", "alerta-error");
      ocupar(formAdj, true);
      try {
        mensaje("adjudicacion-resultado", "Subiendo el dictamen a IPFS y esperando tu firma…");
        if (accion === "desierta") await declararDesierta(d.id, texto, archivo);
        else {
          const ofertaId = Number(/** @type {RadioNodeList} */ (formAdj.elements.namedItem("oferta")).value);
          await adjudicar(d.id, ofertaId, texto, archivo);
        }
        mostrarToast(accion === "desierta" ? "Licitación declarada desierta." : "Licitación adjudicada.");
        delete formAdj.dataset.ocupado;
        renderDetalle();
      } catch (error) {
        mensaje("adjudicacion-resultado", explicarError(error), "alerta-error");
        ocupar(formAdj, false);
        formAdj.dataset.ocupado = "1";
      }
    });
  }

  // Revelar autoría
  document.getElementById("revelar-autoria")?.addEventListener("click", async (ev) => {
    const boton = /** @type {HTMLButtonElement} */ (ev.currentTarget);
    boton.disabled = true;
    try {
      mensaje("revelar-resultado", "Firmá en tu wallet para recalcular tu sal de autoría…");
      const mia = await miOferta(d);
      if (!mia) {
        mensaje("revelar-resultado", "No encontramos ninguna oferta tuya en esta licitación.", "alerta-aviso");
        return;
      }
      if (mia.autor !== "0x0000000000000000000000000000000000000000") {
        mensaje("revelar-resultado", `Tu oferta es la #${mia.id} y ya está revelada.`, "alerta-ok");
        return;
      }
      mensaje("revelar-resultado", `Tu oferta es la #${mia.id}. Confirmá la transacción para revelarla…`);
      await revelarAutoria(d);
      mostrarToast(`Revelaste tu autoría de la oferta #${mia.id}.`);
      renderDetalle();
    } catch (error) {
      mensaje("revelar-resultado", explicarError(error), "alerta-error");
      boton.disabled = false;
    }
  });

  // Asignar inspector
  const formInsp = /** @type {HTMLFormElement | null} */ (document.getElementById("form-inspector"));
  if (formInsp) {
    const select = /** @type {HTMLSelectElement} */ (document.getElementById("inspector-wallet"));
    inspectoresDisponibles().then((lista) => {
      const libres = lista.filter((i) => !d.inspectores.some((a) => a.wallet === i.wallet));
      render(
        select,
        libres.length
          ? html`${libres.map((i) => html`<option value="${i.wallet}">${i.nombre} · ${nombreOrganismo(i.organismoId)}</option>`)}`
          : html`<option value="">No hay inspectores disponibles</option>`,
      );
    });
    formInsp.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!select.value) return;
      ocupar(formInsp, true);
      try {
        await asignarInspector(d.id, select.value);
        mostrarToast("Inspector asignado.");
        delete formInsp.dataset.ocupado;
        renderDetalle();
      } catch (error) {
        mostrarToast(explicarError(error), 6000);
        ocupar(formInsp, false);
      }
    });
  }

  // Evaluación de etapa
  const formEval = /** @type {HTMLFormElement | null} */ (document.getElementById("form-evaluacion"));
  if (formEval) {
    formEval.addEventListener("input", () => (formEval.dataset.ocupado = "1"));
    formEval.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const aprobada = /** @type {HTMLButtonElement} */ (/** @type {SubmitEvent} */ (ev).submitter)?.value === "aprobar";
      const texto = /** @type {HTMLTextAreaElement} */ (document.getElementById("informe-texto")).value.trim();
      const archivo = /** @type {HTMLInputElement} */ (document.getElementById("informe-archivo")).files?.[0];
      if (!texto) return mensaje("evaluacion-resultado", "El informe es obligatorio.", "alerta-error");
      ocupar(formEval, true);
      try {
        mensaje("evaluacion-resultado", "Subiendo el informe a IPFS y esperando tu firma…");
        await registrarEvaluacion(d.id, d.etapasAprobadas, aprobada, texto, archivo);
        mostrarToast(aprobada ? "Etapa aprobada." : "Observación registrada.");
        delete formEval.dataset.ocupado;
        renderDetalle();
      } catch (error) {
        mensaje("evaluacion-resultado", explicarError(error), "alerta-error");
        ocupar(formEval, false);
        formEval.dataset.ocupado = "1";
      }
    });
  }
}
