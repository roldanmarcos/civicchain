// Pantalla "Publicar licitación" (empleados estatales con credencial vigente).

import { explicarError } from "../web3/errores.js";
import { publicarLicitacion } from "../web3/licitaciones.js";
import { obtenerSesion, rolActivo } from "../web3/sesion.js";
import { bloqueConexion } from "./conexion.js";
import { formatearPesos, html, mostrarToast, nombreOrganismo, render } from "./dom.js";

let etapas = [
  { nombre: "Obra gruesa", porcentaje: 40 },
  { nombre: "Instalaciones", porcentaje: 35 },
  { nombre: "Terminaciones", porcentaje: 25 },
];

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

  // Por defecto: cierre en 7 días, a las 12:00.
  const cierre = new Date(Date.now() + 7 * 86400_000);
  cierre.setHours(12, 0, 0, 0);
  const local = new Date(cierre.getTime() - cierre.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  render(
    contenedor,
    html`<form class="panel-card" id="form-licitacion" novalidate>
      <div class="panel-card-head"><strong>Nueva licitación de ${nombreOrganismo(sesion.credencial.organismoId)}</strong><span class="role-tag">NFT ERC-721</span></div>
      <div class="form-grid">
        <div class="form-field form-field-ancho"><label for="lic-titulo">Título</label><input id="lic-titulo" name="titulo" maxlength="160" required></div>
        <div class="form-field form-field-ancho"><label for="lic-descripcion">Descripción</label><textarea id="lic-descripcion" name="descripcion" rows="3" required></textarea></div>
        <div class="form-field"><label for="lic-ubicacion">Ubicación</label><input id="lic-ubicacion" name="ubicacion" placeholder="Localidad, provincia" required></div>
        <div class="form-field"><label for="lic-presupuesto">Presupuesto oficial (pesos)</label><input id="lic-presupuesto" name="presupuesto" inputmode="numeric" required>
          <small class="campo-ayuda" id="lic-presupuesto-ayuda">Es el máximo: no se pueden adjudicar ofertas que lo superen.</small></div>
        <div class="form-field"><label for="lic-cierre">Cierre de ofertas</label><input id="lic-cierre" name="cierre" type="datetime-local" value="${local}" required>
          <small class="campo-ayuda">También fija la ronda de drand: antes de esta fecha nadie puede descifrar los montos.</small></div>
        <div class="form-field"><label for="lic-apertura">Ventana de apertura (minutos)</label><input id="lic-apertura" name="apertura" type="number" min="5" value="60" required>
          <small class="campo-ayuda">Tiempo para publicar los montos descifrados antes de evaluar (mínimo 5).</small></div>
        <div class="form-field form-field-ancho"><label for="lic-pliego">Pliego de condiciones (PDF)</label><input id="lic-pliego" name="pliego" type="file" accept="application/pdf" required></div>
      </div>

      <h3 class="subtitulo">Etapas y porcentaje de pago</h3>
      <div id="lic-etapas">${filasEtapas()}</div>
      <div class="acciones"><button type="button" class="button button-text button-small" id="agregar-etapa">+ Agregar etapa</button>
        <span class="texto-suave" id="lic-suma"></span></div>

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
      <input aria-label="Porcentaje de la etapa ${i + 1}" data-etapa-porcentaje="${i}" type="number" min="1" max="100" step="0.01" value="${e.porcentaje}"> %
      ${etapas.length > 1 && html`<button type="button" class="button button-text button-small" data-quitar-etapa="${i}">Quitar</button>`}
    </div>`,
  )}`;
}

function conectar() {
  const form = /** @type {HTMLFormElement} */ (document.getElementById("form-licitacion"));
  const resultado = document.getElementById("lic-resultado");
  const valor = (n) => /** @type {HTMLInputElement} */ (form.elements.namedItem(n)).value.trim();

  const actualizarSuma = () => {
    const suma = etapas.reduce((s, e) => s + Number(e.porcentaje || 0), 0);
    const el = document.getElementById("lic-suma");
    el.textContent = `Suma: ${Math.round(suma * 100) / 100}% ${Math.abs(suma - 100) < 0.001 ? "✓" : "(tiene que dar 100%)"}`;
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
    if (t.dataset.etapaPorcentaje !== undefined) {
      etapas[Number(t.dataset.etapaPorcentaje)].porcentaje = Number(t.value);
      actualizarSuma();
    }
    if (t.name === "presupuesto") {
      const n = t.value.replace(/\D/g, "");
      document.getElementById("lic-presupuesto-ayuda").textContent = n ? formatearPesos(BigInt(n)) : "";
    }
  });
  form.addEventListener("click", (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (t.id === "agregar-etapa") {
      etapas.push({ nombre: "", porcentaje: 0 });
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
    const presupuesto = valor("presupuesto").replace(/\D/g, "");
    const cierre = Math.floor(new Date(valor("cierre")).getTime() / 1000);
    const pliego = /** @type {HTMLInputElement} */ (form.elements.namedItem("pliego")).files?.[0];
    const suma = etapas.reduce((s, e) => s + Number(e.porcentaje || 0), 0);

    if (!valor("titulo") || !valor("descripcion") || !valor("ubicacion")) return error("Completá título, descripción y ubicación.");
    if (!presupuesto || BigInt(presupuesto) === 0n) return error("El presupuesto tiene que ser mayor a cero.");
    if (!cierre || cierre <= Date.now() / 1000 + 60) return error("El cierre tiene que ser al menos dentro de un minuto.");
    if (Number(valor("apertura")) < 5) return error("La ventana de apertura tiene que ser de al menos 5 minutos.");
    if (!pliego) return error("Adjuntá el pliego.");
    if (etapas.some((e) => !e.nombre.trim() || !(e.porcentaje > 0))) return error("Cada etapa necesita nombre y un porcentaje mayor a 0.");
    if (Math.abs(suma - 100) > 0.001) return error("Los porcentajes de las etapas tienen que sumar 100%.");

    const boton = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    boton.disabled = true;
    try {
      await publicarLicitacion(
        {
          titulo: valor("titulo"),
          descripcion: valor("descripcion"),
          ubicacion: valor("ubicacion"),
          presupuesto: BigInt(presupuesto),
          cierre,
          aperturaMinutos: Number(valor("apertura")),
          etapas: etapas.map((e) => ({ nombre: e.nombre.trim(), porcentaje: e.porcentaje })),
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
