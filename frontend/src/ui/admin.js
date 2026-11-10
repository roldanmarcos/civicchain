// Panel de administración: solicitudes de proveedores, alta de funcionarios, auditoría y credenciales.

import { VIGENCIA_POR_DEFECTO_DIAS } from "../config/contracts.js";
import { afip } from "../services/afip/index.js";
import { padronEmpleados } from "../services/padron-empleados/index.js";
import {
  aprobarSolicitud,
  credencialDeWallet,
  emitirFuncionario,
  leerCredenciales,
  leerSolicitudes,
  rechazarSolicitud,
  renovar,
  revocar,
} from "../web3/credenciales.js";
import { explicarError } from "../web3/errores.js";
import { obtenerSesion } from "../web3/sesion.js";
import { bloqueConexion } from "./conexion.js";
import {
  ETIQUETAS_ROL,
  acortar,
  badgeEstado,
  ejecutarTx,
  formatearCuit,
  formatearFecha,
  html,
  nombreOrganismo,
  pedirTexto,
  render,
} from "./dom.js";

const PESTANAS = {
  solicitudes: "Solicitudes de proveedores",
  alta: "Alta de funcionarios",
  auditoria: "Auditoría",
  credenciales: "Credenciales",
};

let pestanaActual = "solicitudes";
/** Solicitudes pendientes del último render (para verificarlas en AFIP). */
let pendientesMostradas = [];
/** DNI buscado en "Alta de funcionarios" (se conserva si la pantalla se vuelve a dibujar). */
let dniBuscado = "";
/** Evita que un render lento pise a uno más nuevo. */
let renderId = 0;

export function renderAdmin() {
  const contenedor = document.getElementById("admin-content");
  const sesion = obtenerSesion();

  const conexion = bloqueConexion(sesion);
  if (conexion) return render(contenedor, conexion);

  if (!sesion.esAdmin) {
    return render(
      contenedor,
      html`<div class="empty-state"><span>◇</span><strong>No tenés permisos de administración</strong>
        <p>La wallet ${acortar(sesion.cuenta)} no tiene el rol ADMIN_ROLE en el contrato.</p></div>`,
    );
  }

  render(
    contenedor,
    html`<div class="tabs" role="tablist">
        ${Object.entries(PESTANAS).map(
          ([id, titulo]) => html`<button class="tab ${id === pestanaActual ? "active" : ""}" role="tab" data-pestana="${id}">
            ${titulo}${id === "solicitudes" ? html` <span class="tab-count hidden" id="tab-count-solicitudes"></span>` : ""}
          </button>`,
        )}
      </div>
      <div id="admin-pestana"><div class="alerta"><p>Cargando…</p></div></div>`,
  );

  contenedor.querySelectorAll("[data-pestana]").forEach((boton) =>
    boton.addEventListener("click", () => {
      pestanaActual = /** @type {HTMLElement} */ (boton).dataset.pestana ?? "solicitudes";
      renderAdmin();
    }),
  );

  renderPestana();
}

async function renderPestana() {
  const id = ++renderId;
  const contenedor = document.getElementById("admin-pestana");
  try {
    const fragmento = await {
      solicitudes: pestanaSolicitudes,
      alta: pestanaAlta,
      auditoria: pestanaAuditoria,
      credenciales: pestanaCredenciales,
    }[pestanaActual]();
    if (id !== renderId || !contenedor.isConnected) return;
    render(contenedor, fragmento);
    conectarAcciones(contenedor);
    if (pestanaActual === "solicitudes") verificarPendientesEnAfip(contenedor);
    if (pestanaActual === "alta" && dniBuscado) buscarEnPadron(dniBuscado);
  } catch (error) {
    if (id === renderId) render(contenedor, html`<div class="alerta alerta-error"><p>No se pudieron cargar los datos: ${explicarError(error)}</p></div>`);
  }
}

/** Cantidad de solicitudes pendientes (para el contador del menú lateral). */
export async function contarSolicitudesPendientes() {
  return (await leerSolicitudes()).filter((s) => s.estado === "PENDIENTE").length;
}

// ---------------------------------------------------------------------------
// Solicitudes de proveedores
// ---------------------------------------------------------------------------

async function pestanaSolicitudes() {
  const solicitudes = await leerSolicitudes();
  const pendientes = solicitudes.filter((s) => s.estado === "PENDIENTE");
  const resueltas = solicitudes.filter((s) => s.estado !== "PENDIENTE");
  pendientesMostradas = pendientes;

  const contador = document.getElementById("tab-count-solicitudes");
  if (contador) {
    contador.textContent = String(pendientes.length);
    contador.classList.toggle("hidden", pendientes.length === 0);
  }

  return html`
    <p class="texto-suave">Cada solicitud se verifica contra el padrón de AFIP. Aprobarla emite la credencial de
      proveedor (${VIGENCIA_POR_DEFECTO_DIAS} días de vigencia) a la wallet que la envió.</p>

    ${
      pendientes.length === 0
        ? html`<div class="empty-state"><span>✓</span><strong>No hay solicitudes pendientes</strong></div>`
        : pendientes.map(
            (s) => html`<div class="panel-card" data-solicitud="${s.id}">
              <div class="panel-card-head">
                <strong>#${s.id} · ${s.razonSocial}</strong>
                <span class="texto-suave">${formatearFecha(s.creadaEn)}</span>
              </div>
              <dl class="datos">
                <dt>CUIT</dt><dd>${formatearCuit(s.cuit)}</dd>
                <dt>Domicilio</dt><dd>${s.domicilioLegal}</dd>
                <dt>Rubros</dt><dd>${s.rubros}</dd>
                <dt>Wallet</dt><dd><code title="${s.wallet}">${acortar(s.wallet)}</code></dd>
              </dl>
              <div class="verificacion" id="afip-${s.id}">Consultando AFIP…</div>
              <div class="acciones">
                <button class="button button-primary button-small" data-aprobar="${s.id}" disabled>Aprobar</button>
                <button class="button button-outline button-small" data-rechazar="${s.id}">Rechazar</button>
              </div>
            </div>`,
          )
    }

    ${
      resueltas.length > 0 &&
      html`<h3 class="subtitulo">Historial</h3>
        <div class="tabla-scroll"><table class="tabla">
          <thead><tr><th>#</th><th>Razón social</th><th>CUIT</th><th>Estado</th><th>Detalle</th></tr></thead>
          <tbody>${resueltas.map(
            (s) => html`<tr><td>${s.id}</td><td>${s.razonSocial}</td><td>${formatearCuit(s.cuit)}</td>
              <td>${badgeEstado(s.estado)}</td><td class="texto-suave">${s.motivoRechazo ?? ""}</td></tr>`,
          )}</tbody>
        </table></div>`
    }`;
}

/** Consulta AFIP para cada solicitud pendiente y actualiza su tarjeta. */
async function verificarPendientesEnAfip(contenedor) {
  for (const s of pendientesMostradas) {
    const tarjeta = contenedor.querySelector(`[data-solicitud="${s.id}"]`);
    if (!tarjeta) continue;

    const v = await afip.verificarSolicitud({ cuit: s.cuit, razonSocial: s.razonSocial });
    if (!tarjeta.isConnected) return;

    const caja = tarjeta.querySelector(`#afip-${s.id}`);
    const aprobar = /** @type {HTMLButtonElement} */ (tarjeta.querySelector("[data-aprobar]"));
    const rechazar = /** @type {HTMLButtonElement} */ (tarjeta.querySelector("[data-rechazar]"));
    caja.className = `verificacion ${v.ok ? "verificacion-ok" : "verificacion-error"}`;
    caja.textContent = `${v.ok ? "✓" : "✗"} ${v.mensaje}`;
    aprobar.disabled = false;
    if (!v.ok) {
      // Se puede aprobar igual (el admin revisó el caso a mano), pero no es la acción sugerida.
      aprobar.textContent = "Aprobar igual";
      aprobar.className = "button button-outline button-small";
      rechazar.className = "button button-primary button-small";
      rechazar.dataset.motivo = v.mensaje;
    }
  }
}

// ---------------------------------------------------------------------------
// Alta de funcionarios
// ---------------------------------------------------------------------------

async function pestanaAlta() {
  const registros = await padronEmpleados.listar();
  return html`
    <p class="texto-suave">Buscá a la persona por DNI en el padrón de empleados. Nombre, función, organismo y wallet
      salen del padrón; en la blockchain queda solo el nombre y el organismo.</p>
    <form class="busqueda-dni" id="form-dni">
      <div class="form-field">
        <label for="alta-dni">DNI</label>
        <input id="alta-dni" inputmode="numeric" placeholder="35.222.333" value="${dniBuscado}" required>
      </div>
      <button class="button button-primary button-small" type="submit">Buscar en el padrón</button>
    </form>
    <div id="alta-resultado"></div>

    <h3 class="subtitulo">Padrón de empleados</h3>
    <div class="tabla-scroll"><table class="tabla">
      <thead><tr><th>Nombre</th><th>DNI</th><th>Función</th><th>Organismo</th><th>Estado</th><th></th></tr></thead>
      <tbody>${registros.map(
        (e) => html`<tr>
          <td>${e.nombre}</td><td>${e.dni}</td><td>${ETIQUETAS_ROL[e.funcion]}</td>
          <td>${nombreOrganismo(e.organismoId)}</td>
          <td>${e.estado === "ACTIVO" ? "Activo" : "Baja"}</td>
          <td><button class="button button-text button-small" data-usar-dni="${e.dni}">Elegir</button></td>
        </tr>`,
      )}</tbody>
    </table></div>`;
}

async function buscarEnPadron(dni) {
  dniBuscado = dni;
  const resultado = document.getElementById("alta-resultado");
  if (!resultado) return;
  const campoDni = /** @type {HTMLInputElement | null} */ (document.getElementById("alta-dni"));
  if (campoDni) campoDni.value = dni;
  render(resultado, html`<div class="alerta"><p>Consultando el padrón…</p></div>`);

  let v, existente;
  try {
    v = await padronEmpleados.verificarAlta(dni);
    existente = v.empleado?.wallet ? await credencialDeWallet(v.empleado.wallet) : null;
  } catch (error) {
    return render(resultado, html`<div class="alerta alerta-error"><p>No se pudo completar la búsqueda: ${explicarError(error)}</p></div>`);
  }
  const e = v.empleado;
  if (!e) return render(resultado, html`<div class="alerta alerta-error"><p>${v.mensaje}</p></div>`);

  const yaTiene = existente && !existente.revocada;
  const puedeEmitir = v.ok && !yaTiene;

  render(
    resultado,
    html`<div class="panel-card">
      <div class="panel-card-head"><strong>${e.nombre}</strong>
        <span class="card-status ${e.estado === "ACTIVO" ? "" : "status-revoked"}">${e.estado === "ACTIVO" ? "Activo" : "Baja"}</span>
      </div>
      <dl class="datos">
        <dt>Función</dt><dd>${ETIQUETAS_ROL[e.funcion]}</dd>
        <dt>Organismo</dt><dd>${nombreOrganismo(e.organismoId)} — ${e.area}</dd>
        <dt>Cargo</dt><dd>${e.cargo} (${e.resolucion})</dd>
        <dt>Wallet</dt><dd>${e.wallet ? html`<code>${e.wallet}</code>` : "No declaró wallet"}</dd>
      </dl>
      ${!v.ok && html`<div class="verificacion verificacion-error">✗ ${v.mensaje}</div>`}
      ${yaTiene && html`<div class="verificacion verificacion-error">✗ Esa wallet ya tiene la credencial #${existente.tokenId} (${ETIQUETAS_ROL[existente.rol]}).</div>`}
      ${
        puedeEmitir &&
        html`<div class="acciones">
          <label class="dias">Vigencia <input type="number" id="alta-dias" min="1" value="${VIGENCIA_POR_DEFECTO_DIAS}"> días</label>
          <button class="button button-primary button-small" id="alta-emitir">Emitir credencial</button>
        </div>`
      }
    </div>`,
  );

  document.getElementById("alta-emitir")?.addEventListener("click", async (ev) => {
    const dias = Number(/** @type {HTMLInputElement} */ (document.getElementById("alta-dias")).value) || VIGENCIA_POR_DEFECTO_DIAS;
    const ok = await ejecutarTx(() => emitirFuncionario(e, dias), {
      boton: /** @type {HTMLButtonElement} */ (ev.currentTarget),
      exito: `Credencial emitida a ${e.nombre}.`,
    });
    if (ok) {
      dniBuscado = "";
      renderPestana();
    }
  });
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

async function pestanaAuditoria() {
  const hallazgos = await padronEmpleados.auditar(await leerCredenciales());

  if (hallazgos.length === 0) {
    return html`<div class="empty-state"><span>✓</span><strong>Todo en orden</strong>
      <p>Las credenciales de empleados e inspectores coinciden con el padrón.</p></div>`;
  }

  return html`
    <p class="texto-suave">Cruce de las credenciales vigentes con el padrón de empleados. ${hallazgos.length} hallazgo(s).</p>
    ${hallazgos.map((h) => {
      const c = h.credencial;
      const revocar = (h.accion === "REVOCAR" || h.accion === "REVOCAR_Y_EMITIR") && c;
      const emitir = (h.accion === "EMITIR" || h.accion === "REVOCAR_Y_EMITIR") && h.empleado;
      return html`<div class="panel-card hallazgo">
        <div class="panel-card-head">
          <strong>⚠ ${h.empleado?.nombre ?? c?.nombre}</strong>
          <span class="role-tag">${c ? `CREDENCIAL #${c.tokenId}` : "SIN CREDENCIAL"}</span>
        </div>
        <p>${h.mensaje}</p>
        <div class="acciones">
          ${revocar && html`<button class="button button-primary button-small" data-revocar="${c.tokenId}" data-motivo="${h.mensaje}">Revocar</button>`}
          ${emitir && html`<button class="button ${revocar ? "button-outline" : "button-primary"} button-small" data-emitir-dni="${h.empleado.dni}">
            ${revocar ? "Después, emitir la nueva" : "Emitir credencial"}</button>`}
          ${h.accion === "RENOVAR" && c && html`<button class="button button-primary button-small" data-renovar="${c.tokenId}">Renovar</button>`}
        </div>
      </div>`;
    })}`;
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

async function pestanaCredenciales() {
  const credenciales = (await leerCredenciales()).reverse();
  if (credenciales.length === 0) {
    return html`<div class="empty-state"><span>◈</span><strong>Todavía no se emitieron credenciales</strong></div>`;
  }

  return html`<div class="tabla-scroll"><table class="tabla">
    <thead><tr><th>#</th><th>Titular</th><th>Rol</th><th>Organismo / CUIT</th><th>Wallet</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
    <tbody>${credenciales.map(
      (c) => html`<tr>
        <td>${c.tokenId}</td>
        <td>${c.nombre}</td>
        <td>${ETIQUETAS_ROL[c.rol]}</td>
        <td>${c.rol === "PROVEEDOR" ? formatearCuit(c.cuit) : nombreOrganismo(c.organismoId)}</td>
        <td><code title="${c.wallet}">${acortar(c.wallet)}</code></td>
        <td>${formatearFecha(c.validaHasta)}</td>
        <td>${badgeEstado(c.estado)}</td>
        <td class="acciones-tabla">${
          !c.revocada &&
          html`<button class="button button-text button-small" data-renovar="${c.tokenId}">Renovar</button>
            <button class="button button-text button-small texto-peligro" data-revocar="${c.tokenId}">Revocar</button>`
        }</td>
      </tr>`,
    )}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------------------
// Acciones (botones con data-*)
// ---------------------------------------------------------------------------

function conectarAcciones(contenedor) {
  const al = (selector, manejador) =>
    contenedor.querySelectorAll(selector).forEach((el) =>
      el.addEventListener("click", (ev) => manejador(/** @type {HTMLButtonElement} */ (ev.currentTarget))),
    );

  al("[data-aprobar]", async (boton) => {
    const id = BigInt(boton.dataset.aprobar ?? "0");
    const ok = await ejecutarTx(() => aprobarSolicitud(id, VIGENCIA_POR_DEFECTO_DIAS), {
      boton,
      exito: `Solicitud #${id} aprobada: credencial emitida.`,
    });
    if (ok) renderPestana();
  });

  al("[data-rechazar]", async (boton) => {
    const id = BigInt(boton.dataset.rechazar ?? "0");
    // Si la verificación en AFIP todavía no terminó, hacerla ahora para sugerir el motivo.
    let sugerido = boton.dataset.motivo;
    if (sugerido === undefined) {
      const s = pendientesMostradas.find((p) => p.id === id);
      const v = s && (await afip.verificarSolicitud({ cuit: s.cuit, razonSocial: s.razonSocial }));
      sugerido = v && !v.ok ? v.mensaje : "";
    }
    const motivo = await pedirTexto({
      titulo: `Rechazar la solicitud #${id}`,
      descripcion: "El motivo queda público en la blockchain y el proveedor lo ve en su pantalla.",
      etiqueta: "Motivo",
      valor: sugerido,
      confirmar: "Rechazar",
    });
    if (!motivo) return;
    const ok = await ejecutarTx(() => rechazarSolicitud(id, motivo), { boton, exito: `Solicitud #${id} rechazada.` });
    if (ok) renderPestana();
  });

  al("[data-revocar]", async (boton) => {
    const tokenId = BigInt(boton.dataset.revocar ?? "0");
    const motivo = await pedirTexto({
      titulo: `Revocar la credencial #${tokenId}`,
      descripcion: "Es definitivo. El motivo queda público y la credencial se conserva como historial.",
      etiqueta: "Motivo",
      valor: boton.dataset.motivo ?? "",
      confirmar: "Revocar",
    });
    if (!motivo) return;
    const ok = await ejecutarTx(() => revocar(tokenId, motivo), { boton, exito: `Credencial #${tokenId} revocada.` });
    if (ok) renderPestana();
  });

  al("[data-renovar]", async (boton) => {
    const tokenId = BigInt(boton.dataset.renovar ?? "0");
    const dias = await pedirTexto({
      titulo: `Renovar la credencial #${tokenId}`,
      etiqueta: "Días de vigencia desde hoy",
      valor: String(VIGENCIA_POR_DEFECTO_DIAS),
      tipo: "number",
      confirmar: "Renovar",
    });
    if (!dias) return;
    const ok = await ejecutarTx(() => renovar(tokenId, Number(dias)), { boton, exito: `Credencial #${tokenId} renovada.` });
    if (ok) renderPestana();
  });

  al("[data-emitir-dni]", (boton) => {
    pestanaActual = "alta";
    dniBuscado = boton.dataset.emitirDni ?? "";
    renderAdmin();
  });

  al("[data-usar-dni]", (boton) => buscarEnPadron(boton.dataset.usarDni ?? ""));

  contenedor.querySelector("#form-dni")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    buscarEnPadron(/** @type {HTMLInputElement} */ (contenedor.querySelector("#alta-dni")).value);
  });
}
