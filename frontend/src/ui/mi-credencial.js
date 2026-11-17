// Pantalla "Mi credencial": estado de la credencial de la wallet conectada y qué puede hacer con ella.

import { datosDeInscripcion } from "../web3/backend.js";
import { explicarError } from "../web3/errores.js";
import { protocolo } from "../web3/identidad.js";
import { obtenerSesion } from "../web3/sesion.js";
import { bloqueConexion } from "./conexion.js";
import {
  ETIQUETAS_ROL,
  acortar,
  badgeEstado,
  formatearCuit,
  formatearFecha,
  html,
  mostrarDialogo,
  mostrarToast,
  nombreOrganismo,
  render,
} from "./dom.js";

/** Herramientas de cada rol, con la pantalla donde se usan. */
const HERRAMIENTAS = {
  EMPLEADO: [
    ["Publicar licitaciones", "Una obra con su pliego, presupuesto, fecha de cierre y etapas.", "nueva-licitacion"],
    ["Abrir sobres y adjudicar", "Abrir todas las ofertas juntas después del cierre y adjudicar con un dictamen fundado, antes de la fecha límite.", "licitaciones"],
    ["Depositar los fondos", "Dejar el monto adjudicado en el contrato: se paga solo, etapa por etapa.", "licitaciones"],
    ["Asignar inspectores", "Elegir quién controla cada etapa de la obra adjudicada.", "licitaciones"],
  ],
  INSPECTOR: [["Registrar avances de obra", "Aprobar u observar cada etapa de las obras de tu organismo que tenés asignadas. Al aprobar, se le paga sola al contratista.", "licitaciones"]],
  PROVEEDOR: [
    [
      "Ofertar de forma anónima",
      "La prueba de conocimiento cero demuestra que estás habilitado sin revelar quién sos. El monto queda cifrado hasta el cierre.",
      "licitaciones",
    ],
    ["Cobrar por etapa", "Tu identidad se revela sola en la fecha límite de adjudicación. Si ganás, cada etapa que aprueba el inspector se te paga automáticamente.", "licitaciones"],
  ],
};

const SIN_HASH = "0x" + "0".repeat(64);

export function renderMiCredencial() {
  const contenedor = document.getElementById("mi-credencial-content");
  const sesion = obtenerSesion();

  const conexion = bloqueConexion(sesion);
  if (conexion) return render(contenedor, conexion);

  const avisoAdmin = sesion.esAdmin
    ? html`<div class="notice-card">
        <span class="notice-symbol">◇</span>
        <div><strong>Tenés permisos de administración</strong>
          <p>Podés dar de alta funcionarios, auditar las inscripciones y revocar credenciales.</p></div>
        <button class="button button-text" data-page="admin">Ir al panel <span>→</span></button>
      </div>`
    : "";

  const { credencial, inscripciones } = sesion;

  if (!credencial) {
    const ultima = inscripciones[0];
    return render(
      contenedor,
      html`<div class="empty-state">
          <span>◈</span>
          <strong>Esta wallet no tiene credencial</strong>
          <p>${
            ultima?.estado === "RECHAZADA"
              ? `Tu inscripción de ${ultima.razonSocial} fue rechazada el ${formatearFecha(ultima.creadaEn)}: “${ultima.motivo}”`
              : `Wallet ${acortar(sesion.cuenta)}. Podés recorrer las licitaciones como cualquier ciudadano.`
          }</p>
          <button class="button button-primary button-small" data-page="registro">Inscribirme como proveedor <span>→</span></button>
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
  const activa = credencial.estado === "VIGENTE";

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
                ? html`<dt>CUIT</dt><dd>${formatearCuit(credencial.cuit)}</dd>
                    <dt>Ofertas anónimas</dt><dd>${credencial.enGrupo ? "Habilitado (tu identidad está en el grupo)" : "No habilitado"}</dd>`
                : html`<dt>Organismo</dt><dd>${nombreOrganismo(credencial.organismoId)}</dd>`
            }
            <dt>Wallet</dt><dd><code>${acortar(sesion.cuenta)}</code></dd>
            <dt>Emitida</dt><dd>${formatearFecha(credencial.emitidaEn)}</dd>
            <dt>Vence</dt><dd>${formatearFecha(credencial.validaHasta)}</dd>
            ${credencial.datosHash !== SIN_HASH && html`<dt>Datos</dt><dd><code title="${credencial.datosHash}">${acortar(credencial.datosHash)}</code>
              ${esProveedor && html` <button class="button button-text button-small" id="verificar-datos">Verificar</button>`}</dd>`}
          </dl>
          ${estadoTexto}
        </div>

        <div class="panel-card">
          <span class="role-tag">QUÉ PODÉS HACER</span>
          <ul class="herramientas">
            ${herramientas.map(
              ([titulo, detalle, pagina]) => html`<li><strong>${titulo}</strong><span>${detalle}</span>
                ${activa ? html`<button class="button button-text button-small" data-page="${pagina}">Ir →</button>` : html`<span class="card-status status-done">No disponible</span>`}</li>`,
            )}
          </ul>
        </div>
      </div>
      ${avisoAdmin}`,
  );

  document.getElementById("verificar-datos")?.addEventListener("click", async () => {
    try {
      const r = await datosDeInscripcion(credencial.datosHash);
      const ok = protocolo.datosHash(r.datos, r.sal) === credencial.datosHash;
      mostrarDialogo(
        "Tus datos fuera de la cadena",
        html`<div class="verificacion ${ok ? "verificacion-ok" : "verificacion-error"}">${ok ? "✓ Coinciden con el hash de tu credencial." : "✗ No coinciden con el hash de tu credencial."}</div>
          <pre class="bloque-json">${JSON.stringify(r.datos, null, 2)}</pre>`,
      );
    } catch (error) {
      mostrarToast(explicarError(error), 6000);
    }
  });
}
