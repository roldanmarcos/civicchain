// Pantalla "Mi credencial": estado de la credencial de la wallet conectada y qué puede hacer con ella.

import { obtenerSesion } from "../web3/sesion.js";
import { bloqueConexion } from "./conexion.js";
import {
  ETIQUETAS_ROL,
  acortar,
  badgeEstado,
  formatearCuit,
  formatearFecha,
  html,
  nombreOrganismo,
  render,
} from "./dom.js";

/** Herramientas de cada rol. Se implementan en la siguiente etapa (contratos de licitaciones). */
const HERRAMIENTAS = {
  EMPLEADO: [
    ["Crear licitaciones", "Publicar una obra con su pliego, presupuesto, fecha de cierre y etapas."],
    ["Evaluar y adjudicar", "Ver las ofertas abiertas al cierre y adjudicar con un dictamen fundado."],
  ],
  INSPECTOR: [
    ["Registrar avances de obra", "Validar cada etapa completada para liberar el pago correspondiente."],
  ],
  PROVEEDOR: [
    ["Ofertar en licitaciones abiertas", "Enviar ofertas anónimas: la prueba de conocimiento cero demuestra que estás habilitado sin revelar quién sos."],
  ],
};

export function renderMiCredencial() {
  const contenedor = document.getElementById("mi-credencial-content");
  const sesion = obtenerSesion();

  const conexion = bloqueConexion(sesion);
  if (conexion) return render(contenedor, conexion);

  const avisoAdmin = sesion.esAdmin
    ? html`<div class="notice-card">
        <span class="notice-symbol">◇</span>
        <div><strong>Tenés permisos de administración</strong>
          <p>Podés aprobar proveedores, dar de alta funcionarios y revocar credenciales.</p></div>
        <button class="button button-text" data-page="admin">Ir al panel <span>→</span></button>
      </div>`
    : "";

  const { credencial, solicitud } = sesion;

  if (!credencial) {
    const pendiente = solicitud?.estado === "PENDIENTE";
    return render(
      contenedor,
      html`<div class="empty-state">
          <span>◈</span>
          <strong>${pendiente ? "Tu solicitud está en revisión" : "Esta wallet no tiene credencial"}</strong>
          <p>${
            pendiente
              ? `Solicitud #${solicitud.id} de ${solicitud.razonSocial}, enviada el ${formatearFecha(solicitud.creadaEn)}.`
              : `Wallet ${acortar(sesion.cuenta)}. Podés recorrer las licitaciones como cualquier ciudadano.`
          }</p>
          <button class="button button-primary button-small" data-page="registro">
            ${pendiente ? "Ver solicitud" : "Cómo participar"} <span>→</span></button>
        </div>
        ${avisoAdmin}`,
    );
  }

  const esProveedor = credencial.rol === "PROVEEDOR";
  const estadoTexto = {
    VIGENTE: html`<p class="texto-suave">Tu credencial está activa. Los contratos la verifican en cada operación que hacés.</p>`,
    VENCIDA: html`<div class="alerta alerta-aviso"><strong>Tu credencial venció el ${formatearFecha(credencial.validaHasta)}</strong>
      <p>Pedile a un administrador que la renueve. Mientras tanto no podés operar con este rol.</p></div>`,
    REVOCADA: html`<div class="alerta alerta-error"><strong>Tu credencial fue revocada</strong>
      <p>Motivo: “${credencial.motivoRevocacion ?? "sin especificar"}”</p>
      <p>Ya no podés operar con este rol. La credencial queda en tu wallet como registro histórico.</p></div>`,
  }[credencial.estado];

  const herramientas = HERRAMIENTAS[credencial.rol] ?? [];

  render(
    contenedor,
    html`<div class="credencial-layout">
        <div class="panel-card credencial-card">
          <div class="panel-card-head">
            <span class="role-tag">${ETIQUETAS_ROL[credencial.rol].toUpperCase()} · CREDENCIAL #${credencial.tokenId}</span>
            ${badgeEstado(credencial.estado)}
          </div>
          <h2>${credencial.nombre}</h2>
          <dl class="datos">
            ${
              esProveedor
                ? html`<dt>CUIT</dt><dd>${formatearCuit(credencial.cuit)}</dd>`
                : html`<dt>Organismo</dt><dd>${nombreOrganismo(credencial.organismoId)}</dd>`
            }
            <dt>Wallet</dt><dd><code>${acortar(sesion.cuenta)}</code></dd>
            <dt>Emitida</dt><dd>${formatearFecha(credencial.emitidaEn)}</dd>
            <dt>Vence</dt><dd>${formatearFecha(credencial.validaHasta)}</dd>
          </dl>
          ${estadoTexto}
        </div>

        <div class="panel-card">
          <span class="role-tag">QUÉ VAS A PODER HACER</span>
          <ul class="herramientas">
            ${herramientas.map(
              ([titulo, detalle]) => html`<li><strong>${titulo}</strong><span>${detalle}</span>
                <span class="card-status status-done">Próximamente</span></li>`,
            )}
          </ul>
        </div>
      </div>
      ${avisoAdmin}`,
  );
}
