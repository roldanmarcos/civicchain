// Panel de administración: alta de funcionarios, inscripciones automáticas de proveedores, auditoría
// contra el padrón y listado de credenciales.

import { VIGENCIA_POR_DEFECTO_DIAS, organismos } from "../config/contracts.js";
import { padronEmpleados } from "../services/padron-empleados/index.js";
import { datosDeFuncionario, datosDeInscripcion, todasLasInscripciones } from "../web3/backend.js";
import { credencialDeWallet, emitirFuncionario, leerCredenciales, renovar, revocar } from "../web3/credenciales.js";
import { explicarError } from "../web3/errores.js";
import { protocolo } from "../web3/identidad.js";
import { obtenerFirmante, obtenerSesion } from "../web3/sesion.js";
import { bloqueConexion } from "./conexion.js";
import {
  ETIQUETAS_ROL,
  acortar,
  badgeEstado,
  ejecutarTx,
  formatearCuit,
  formatearFecha,
  html,
  mostrarDialogo,
  mostrarToast,
  nombreOrganismo,
  pedirTexto,
  render,
} from "./dom.js";

const PESTANAS = {
  alta: "Alta de funcionarios",
  inscripciones: "Inscripciones de proveedores",
  auditoria: "Auditoría",
  credenciales: "Credenciales",
};

let pestanaActual = "alta";
/** Datos para precargar el formulario de alta (por ejemplo, desde el padrón o la auditoría). */
let precarga = null;
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
          ([id, titulo]) => html`<button class="tab ${id === pestanaActual ? "active" : ""}" role="tab" data-pestana="${id}">${titulo}</button>`,
        )}
      </div>
      <div id="admin-pestana"><div class="alerta"><p>Cargando…</p></div></div>`,
  );

  contenedor.querySelectorAll("[data-pestana]").forEach((boton) =>
    boton.addEventListener("click", () => {
      pestanaActual = /** @type {HTMLElement} */ (boton).dataset.pestana ?? "alta";
      renderAdmin();
    }),
  );

  renderPestana();
}

async function renderPestana() {
  const id = ++renderId;
  const contenedor = document.getElementById("admin-pestana");
  try {
    const fragmento = await { alta: pestanaAlta, inscripciones: pestanaInscripciones, auditoria: pestanaAuditoria, credenciales: pestanaCredenciales }[
      pestanaActual
    ]();
    if (id !== renderId || !contenedor.isConnected) return;
    render(contenedor, fragmento);
    conectarAcciones(contenedor);
  } catch (error) {
    if (id === renderId) render(contenedor, html`<div class="alerta alerta-error"><p>No se pudieron cargar los datos: ${explicarError(error)}</p></div>`);
  }
}

// ---------------------------------------------------------------------------
// Alta de funcionarios (manual, con importación opcional desde el padrón)
// ---------------------------------------------------------------------------

async function pestanaAlta() {
  const p = precarga ?? {};
  const opcion = (valor, texto, actual) => html`<option value="${valor}" ${String(valor) === String(actual) ? "selected" : ""}>${texto}</option>`;
  return html`
    <p class="texto-suave">Cargá los datos del empleado o inspector y la wallet que declaró. En la blockchain quedan
      públicos su nombre y su organismo (para saber quién firma cada acción); el DNI, el cargo y la resolución
      quedan en la base de CivicChain y en la cadena va solo su huella (hash).</p>

    <form class="busqueda-dni" id="form-dni">
      <div class="form-field">
        <label for="alta-dni-buscar">Importar desde el padrón de RR.HH. (opcional)</label>
        <input id="alta-dni-buscar" inputmode="numeric" placeholder="DNI, ej. 35.222.333">
      </div>
      <button class="button button-outline button-small" type="submit">Buscar en el padrón</button>
    </form>
    <div id="alta-padron"></div>

    <form id="form-alta" class="panel-card" novalidate>
      <div class="form-grid">
        <div class="form-field">
          <label for="alta-wallet">Wallet</label>
          <input id="alta-wallet" name="wallet" placeholder="0x…" value="${p.wallet ?? ""}" autocomplete="off" required>
        </div>
        <div class="form-field">
          <label for="alta-rol">Rol</label>
          <select id="alta-rol" name="rol">${opcion("EMPLEADO", "Empleado estatal", p.rol)}${opcion("INSPECTOR", "Inspector", p.rol)}</select>
        </div>
        <div class="form-field">
          <label for="alta-nombre">Nombre y apellido</label>
          <input id="alta-nombre" name="nombre" maxlength="120" value="${p.nombre ?? ""}" required>
        </div>
        <div class="form-field">
          <label for="alta-dni">DNI</label>
          <input id="alta-dni" name="dni" inputmode="numeric" value="${p.dni ?? ""}" required>
        </div>
        <div class="form-field">
          <label for="alta-organismo">Organismo</label>
          <select id="alta-organismo" name="organismoId">${organismos.map((o) => opcion(o.id, o.nombre, p.organismoId))}</select>
        </div>
        <div class="form-field">
          <label for="alta-area">Área</label>
          <input id="alta-area" name="area" value="${p.area ?? ""}">
        </div>
        <div class="form-field">
          <label for="alta-cargo">Cargo</label>
          <input id="alta-cargo" name="cargo" value="${p.cargo ?? ""}">
        </div>
        <div class="form-field">
          <label for="alta-resolucion">Número de resolución</label>
          <input id="alta-resolucion" name="resolucion" placeholder="Res. 123/2026" value="${p.resolucion ?? ""}">
        </div>
        <div class="form-field">
          <label for="alta-domicilio">Domicilio legal</label>
          <input id="alta-domicilio" name="domicilioLegal" value="${p.domicilioLegal ?? ""}">
        </div>
        <div class="form-field">
          <label for="alta-dias">Vigencia (días)</label>
          <input id="alta-dias" name="dias" type="number" min="1" value="${VIGENCIA_POR_DEFECTO_DIAS}">
        </div>
      </div>
      <div id="alta-resultado"></div>
      <button class="button button-primary" type="submit">Emitir credencial <span>→</span></button>
    </form>`;
}

async function buscarEnPadron(dni) {
  const contenedor = document.getElementById("alta-padron");
  render(contenedor, html`<div class="alerta"><p>Consultando el padrón…</p></div>`);
  const v = await padronEmpleados.verificarAlta(dni);
  const e = v.empleado;
  if (!e) return render(contenedor, html`<div class="alerta alerta-error"><p>${v.mensaje}</p></div>`);
  precarga = {
    wallet: e.wallet ?? "",
    rol: e.funcion,
    nombre: e.nombre,
    dni: e.dni,
    organismoId: e.organismoId,
    area: e.area,
    cargo: e.cargo,
    resolucion: e.resolucion,
  };
  await renderPestana();
  render(
    document.getElementById("alta-padron"),
    v.ok
      ? html`<div class="alerta alerta-ok"><p>✓ ${e.nombre}: datos cargados desde el padrón. Revisalos y emití la credencial.</p></div>`
      : html`<div class="alerta alerta-aviso"><p>${v.mensaje} Se cargaron los datos igual: revisalos antes de emitir.</p></div>`,
  );
}

async function enviarAlta(form) {
  const valor = (n) => /** @type {HTMLInputElement} */ (form.elements.namedItem(n)).value.trim();
  const datos = {
    wallet: valor("wallet"),
    rol: /** @type {"EMPLEADO" | "INSPECTOR"} */ (valor("rol")),
    organismoId: Number(valor("organismoId")),
    nombre: valor("nombre"),
    dni: valor("dni"),
    area: valor("area"),
    cargo: valor("cargo"),
    resolucion: valor("resolucion"),
    domicilioLegal: valor("domicilioLegal"),
  };
  const resultado = document.getElementById("alta-resultado");
  const error = (texto) => render(resultado, html`<div class="alerta alerta-error"><p>${texto}</p></div>`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(datos.wallet)) return error("La wallet no es válida.");
  if (!datos.nombre) return error("Falta el nombre.");
  if (!/^\d{7,8}$/.test(datos.dni.replace(/\D/g, ""))) return error("El DNI tiene que tener 7 u 8 dígitos.");

  const existente = await credencialDeWallet(datos.wallet);
  if (existente && !existente.revocada) {
    return error(`Esa wallet ya tiene la credencial #${existente.tokenId} (${ETIQUETAS_ROL[existente.rol]}, ${existente.nombre}).`);
  }

  const boton = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
  boton.disabled = true;
  try {
    await emitirFuncionario(datos, Number(valor("dias")) || VIGENCIA_POR_DEFECTO_DIAS, (t) =>
      render(resultado, html`<div class="alerta"><p>${t}</p></div>`),
    );
    mostrarToast(`Credencial emitida a ${datos.nombre}.`);
    precarga = null;
    renderPestana();
  } catch (e) {
    error(explicarError(e));
  } finally {
    if (boton.isConnected) boton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Inscripciones de proveedores (decisiones automáticas del verificador)
// ---------------------------------------------------------------------------

async function pestanaInscripciones() {
  const inscripciones = await todasLasInscripciones(obtenerFirmante());
  if (inscripciones.length === 0) {
    return html`<div class="empty-state"><span>◈</span><strong>Todavía no hubo inscripciones</strong>
      <p>Las inscripciones de proveedores se aprueban o rechazan solas, verificando en AFIP.</p></div>`;
  }
  return html`
    <p class="texto-suave">El verificador aprueba o rechaza solo cada inscripción según AFIP. Acá queda el registro
      de todas las decisiones para auditarlas. Las autorizadas se convierten en credencial cuando el proveedor
      confirma la transacción.</p>
    <div class="tabla-scroll"><table class="tabla">
      <thead><tr><th>#</th><th>Fecha</th><th>Empresa</th><th>CUIT</th><th>Wallet</th><th>Decisión</th><th>Motivo</th><th></th></tr></thead>
      <tbody>${inscripciones.map(
        (i) => html`<tr>
          <td>${i.id}</td>
          <td>${formatearFecha(i.creadaEn)}</td>
          <td>${i.razonSocial}</td>
          <td>${formatearCuit(i.cuit)}</td>
          <td><code title="${i.wallet}">${acortar(i.wallet)}</code></td>
          <td>${badgeEstado(i.estado === "AUTORIZADA" ? "APROBADA" : "RECHAZADA")}</td>
          <td>${i.motivo}</td>
          <td>${i.datosHash && html`<button class="button button-text button-small" data-datos-proveedor="${i.datosHash}">Datos</button>`}</td>
        </tr>`,
      )}</tbody>
    </table></div>`;
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
      const revocarla = (h.accion === "REVOCAR" || h.accion === "REVOCAR_Y_EMITIR") && c;
      const emitir = (h.accion === "EMITIR" || h.accion === "REVOCAR_Y_EMITIR") && h.empleado;
      return html`<div class="panel-card hallazgo">
        <div class="panel-card-head">
          <strong>⚠ ${h.empleado?.nombre ?? c?.nombre}</strong>
          <span class="role-tag">${c ? `CREDENCIAL #${c.tokenId}` : "SIN CREDENCIAL"}</span>
        </div>
        <p>${h.mensaje}</p>
        <div class="acciones">
          ${revocarla && html`<button class="button button-primary button-small" data-revocar="${c.tokenId}" data-motivo="${h.mensaje}">Revocar</button>`}
          ${emitir && html`<button class="button ${revocarla ? "button-outline" : "button-primary"} button-small" data-emitir-dni="${h.empleado.dni}">
            ${revocarla ? "Después, emitir la nueva" : "Emitir credencial"}</button>`}
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
  const sinHash = "0x" + "0".repeat(64);

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
        <td class="acciones-tabla">
          ${c.datosHash !== sinHash && html`<button class="button button-text button-small" ${c.rol === "PROVEEDOR" ? html`data-datos-proveedor` : html`data-datos-funcionario`}="${c.datosHash}">Datos</button>`}
          ${!c.revocada && html`<button class="button button-text button-small" data-renovar="${c.tokenId}">Renovar</button>
            <button class="button button-text button-small texto-peligro" data-revocar="${c.tokenId}">Revocar</button>`}
        </td>
      </tr>`,
    )}</tbody>
  </table></div>`;
}

/** Muestra los datos guardados fuera de la cadena y si su hash coincide con el de la credencial. */
async function mostrarDatos(hash, tipo) {
  try {
    const r = tipo === "proveedor" ? await datosDeInscripcion(hash) : await datosDeFuncionario(obtenerFirmante(), hash);
    const recalculado = protocolo.datosHash(r.datos, r.sal);
    const ok = recalculado === hash;
    mostrarDialogo(
      "Datos fuera de la cadena",
      html`<p class="texto-suave">Hash en la blockchain: <code>${hash}</code></p>
        <div class="verificacion ${ok ? "verificacion-ok" : "verificacion-error"}">${ok ? "✓ El hash recalculado coincide: nadie modificó estos datos." : "✗ El hash no coincide."}</div>
        <pre class="bloque-json">${JSON.stringify(r.datos, null, 2)}</pre>`,
    );
  } catch (error) {
    mostrarToast(explicarError(error), 6000);
  }
}

// ---------------------------------------------------------------------------
// Acciones (botones con data-*)
// ---------------------------------------------------------------------------

function conectarAcciones(contenedor) {
  const al = (selector, manejador) =>
    contenedor.querySelectorAll(selector).forEach((el) =>
      el.addEventListener("click", (ev) => manejador(/** @type {HTMLButtonElement} */ (ev.currentTarget))),
    );

  al("[data-revocar]", async (boton) => {
    const tokenId = BigInt(boton.dataset.revocar ?? "0");
    const motivo = await pedirTexto({
      titulo: `Revocar la credencial #${tokenId}`,
      descripcion: "Es definitivo. El motivo queda público y la credencial se conserva como historial. A un proveedor además se lo saca del grupo de ofertantes anónimos.",
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
    renderAdmin();
    setTimeout(() => buscarEnPadron(boton.dataset.emitirDni ?? ""), 50);
  });

  al("[data-datos-proveedor]", (boton) => mostrarDatos(boton.dataset.datosProveedor, "proveedor"));
  al("[data-datos-funcionario]", (boton) => mostrarDatos(boton.dataset.datosFuncionario, "funcionario"));

  contenedor.querySelector("#form-dni")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    buscarEnPadron(/** @type {HTMLInputElement} */ (contenedor.querySelector("#alta-dni-buscar")).value);
  });
  contenedor.querySelector("#form-alta")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    enviarAlta(/** @type {HTMLFormElement} */ (ev.currentTarget));
  });
}
