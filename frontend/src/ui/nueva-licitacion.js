// Pantalla "Publicar licitación" (empleados estatales con credencial vigente).

import { explicarError } from "../web3/errores.js";
import { publicarLicitacion } from "../web3/licitaciones.js";
import { obtenerSesion, rolActivo } from "../web3/sesion.js";
import { bloqueConexion } from "./conexion.js";
import { formatearPesos, html, mostrarToast, nombreOrganismo, render } from "./dom.js";

/** Monto en pesos de cada etapa, como texto con solo dígitos (vacío si no se cargó). */
let etapas = [
  { nombre: "Obra gruesa", monto: "" },
  { nombre: "Instalaciones", monto: "" },
  { nombre: "Terminaciones", monto: "" },
];
const soloDigitos = (t) => String(t ?? "").replace(/\D/g, "");
const totalEtapas = () => etapas.reduce((s, e) => s + BigInt(soloDigitos(e.monto) || "0"), 0n);

/** Se llama al publicar: para abrir la licitación nueva. */
let alPublicar = () => {};
export const cuandoSePublique = (fn) => (alPublicar = fn);

export function renderNuevaLicitacion() {
  const contenedor = document.getElementById("nueva-licitacion-content");
  if (contenedor.querySelector("form[data-ocupado]")) return;
  const sesion = obtenerSesion();
  const conexion = bloqueConexion(sesion);
  if (conexion) return render(contenedor, conexion);
  if (rolActivo() !== "EMPLEADO") {
    return render(contenedor, html`<div class="empty-state"><span>✎</span><strong>Solo empleados estatales con credencial vigente pueden publicar.</strong></div>`);
  }

  // Por defecto: cierre en 7 días y fecha límite de adjudicación una semana después, a las 12:00.
  const aLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const cierre = new Date(Date.now() + 7 * 86400_000);
  cierre.setHours(12, 0, 0, 0);
  const limite = new Date(cierre.getTime() + 7 * 86400_000);

  render(
    contenedor,
    html`<form class="panel-card" id="form-licitacion" novalidate>
      <div class="panel-card-head"><strong>Nueva licitación de ${nombreOrganismo(sesion.credencial.organismoId)}</strong><span class="role-tag">NFT ERC-721</span></div>
      <div class="form-grid">
        <div class="form-field form-field-ancho"><label for="lic-titulo">Título</label><input id="lic-titulo" name="titulo" maxlength="160" required></div>
        <div class="form-field form-field-ancho"><label for="lic-descripcion">Descripción</label><textarea id="lic-descripcion" name="descripcion" rows="3" required></textarea></div>
        <div class="form-field"><label for="lic-ubicacion">Ubicación</label><input id="lic-ubicacion" name="ubicacion" placeholder="Localidad, provincia" required></div>
        <div class="form-field"><label for="lic-cierre">Cierre de ofertas</label><input id="lic-cierre" name="cierre" type="datetime-local" value="${aLocal(cierre)}" required>
          <small class="campo-ayuda">Antes de esta fecha nadie puede descifrar los montos (drand). Después, tu organismo abre todos los sobres juntos.</small></div>
        <div class="form-field"><label for="lic-limite">Fecha límite de adjudicación</label><input id="lic-limite" name="limite" type="datetime-local" value="${aLocal(limite)}" required>
          <small class="campo-ayuda">Hay que adjudicar antes. En ese momento se revelan solas las identidades de los oferentes. Al menos 5 minutos después del cierre.</small></div>
        <div class="form-field"><label for="lic-inspectores">Inspectores requeridos</label><input id="lic-inspectores" name="inspectores" type="number" min="1" max="10" step="1" value="1" required>
          <small class="campo-ayuda">Cuántos inspectores de tu organismo controlan la obra. Hasta tenerlos a todos asignados no se puede aprobar ninguna etapa.</small></div>
        <div class="form-field form-field-ancho"><label for="lic-pliego">Pliego de condiciones (PDF)</label><input id="lic-pliego" name="pliego" type="file" accept="application/pdf" required></div>
      </div>

      <h3 class="subtitulo">Etapas y monto oficial</h3>
      <p class="texto-suave">Cargá cuánto vale cada etapa. La suma es el presupuesto oficial: no se pueden adjudicar ofertas que lo superen.
        Cada oferente cotiza su propio monto por etapa.</p>
      <div id="lic-etapas">${filasEtapas()}</div>
      <div class="acciones"><button type="button" class="button button-text button-small" id="agregar-etapa">+ Agregar etapa</button>
        <span id="lic-suma"></span></div>

      <div id="lic-resultado"></div>
      <button class="button button-primary" type="submit">Publicar licitación <span>→</span></button>
    </form>`,
  );
  conectar();
}

function filasEtapas() {
  return html`${etapas.map(
    (e, i) => html`<div class="fila-etapa">
      <input aria-label="Nombre de la etapa ${i + 1}" data-etapa-nombre="${i}" value="${e.nombre}" placeholder="Etapa ${i + 1}">
      $ <input aria-label="Monto de la etapa ${i + 1} en pesos" data-etapa-monto="${i}" inputmode="numeric" placeholder="Monto en pesos" value="${e.monto}">
      ${etapas.length > 1 && html`<button type="button" class="button button-text button-small" data-quitar-etapa="${i}">Quitar</button>`}
    </div>`,
  )}`;
}

function conectar() {
  const form = /** @type {HTMLFormElement} */ (document.getElementById("form-licitacion"));
  const resultado = document.getElementById("lic-resultado");
  const valor = (n) => /** @type {HTMLInputElement} */ (form.elements.namedItem(n)).value.trim();

  const actualizarSuma = () => {
    const total = totalEtapas();
    render(document.getElementById("lic-suma"), total ? html`Presupuesto oficial: <strong>${formatearPesos(total)}</strong>` : html``);
  };
  const redibujarEtapas = () => {
    render(document.getElementById("lic-etapas"), filasEtapas());
    actualizarSuma();
  };
  actualizarSuma();

  form.addEventListener("input", (ev) => {
    form.dataset.ocupado = "1";
    const t = /** @type {HTMLInputElement} */ (ev.target);
    if (t.dataset.etapaNombre !== undefined) etapas[Number(t.dataset.etapaNombre)].nombre = t.value;
    if (t.dataset.etapaMonto !== undefined) {
      etapas[Number(t.dataset.etapaMonto)].monto = soloDigitos(t.value);
      actualizarSuma();
    }
  });
  form.addEventListener("click", (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (t.id === "agregar-etapa") {
      etapas.push({ nombre: "", monto: "" });
      redibujarEtapas();
    }
    if (t.dataset.quitarEtapa !== undefined) {
      etapas.splice(Number(t.dataset.quitarEtapa), 1);
      redibujarEtapas();
    }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const error = (texto) => render(resultado, html`<div class="alerta alerta-error"><p>${texto}</p></div>`);
    const cierre = Math.floor(new Date(valor("cierre")).getTime() / 1000);
    const limite = Math.floor(new Date(valor("limite")).getTime() / 1000);
    const pliego = /** @type {HTMLInputElement} */ (form.elements.namedItem("pliego")).files?.[0];
    const inspectores = Number(valor("inspectores"));

    if (!valor("titulo") || !valor("descripcion") || !valor("ubicacion")) return error("Completá título, descripción y ubicación.");
    if (!cierre || cierre <= Date.now() / 1000 + 60) return error("El cierre tiene que ser al menos dentro de un minuto.");
    if (!limite || limite < cierre + 5 * 60) return error("La fecha límite de adjudicación tiene que ser al menos 5 minutos después del cierre.");
    if (!Number.isInteger(inspectores) || inspectores < 1 || inspectores > 10) return error("La obra tiene que requerir entre 1 y 10 inspectores.");
    if (!pliego) return error("Adjuntá el pliego.");
    if (etapas.some((e) => !e.nombre.trim() || !(BigInt(soloDigitos(e.monto) || "0") > 0n))) return error("Cada etapa necesita nombre y un monto mayor a cero.");

    const boton = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    boton.disabled = true;
    try {
      await publicarLicitacion(
        {
          titulo: valor("titulo"),
          descripcion: valor("descripcion"),
          ubicacion: valor("ubicacion"),
          cierre,
          limite,
          inspectores,
          etapas: etapas.map((e) => ({ nombre: e.nombre.trim(), monto: BigInt(soloDigitos(e.monto)) })),
          pliego,
        },
        (t) => render(resultado, html`<div class="alerta"><p>${t}</p></div>`),
      );
      mostrarToast("Licitación publicada.");
      delete form.dataset.ocupado;
      form.reset();
      alPublicar();
    } catch (e) {
      error(explicarError(e));
    } finally {
      if (boton.isConnected) boton.disabled = false;
    }
  });
}
