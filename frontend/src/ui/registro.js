// Pantalla "Registrarse": inscripción de proveedores e información para empleados e inspectores.

import { afip, cuitValido, denominacion, RESULTADOS } from "../services/afip/index.js";
import { cancelarSolicitud, solicitarInscripcion } from "../web3/credenciales.js";
import { obtenerSesion, refrescar } from "../web3/sesion.js";
import { bloqueConexion } from "./conexion.js";
import {
  ETIQUETAS_ROL,
  acortar,
  badgeEstado,
  ejecutarTx,
  formatearCuit,
  formatearFecha,
  html,
  mostrarToast,
  render,
} from "./dom.js";

const ROLES_UI = {
  proveedor: { tag: "SECTOR PRIVADO", rol: "PROVEEDOR" },
  empleado: { tag: "ORGANISMO PÚBLICO", rol: "EMPLEADO" },
  inspector: { tag: "CONTROL DE OBRA", rol: "INSPECTOR" },
};

/** Perfil elegido en la pantalla (proveedor, empleado o inspector), o null si está en la grilla. */
let perfilActual = null;

export function mostrarRegistro(perfil) {
  perfilActual = perfil;
  document.getElementById("registration-tag").textContent = ROLES_UI[perfil]?.tag ?? "";
  renderRegistro();
}

export function cerrarRegistro() {
  perfilActual = null;
}

/** Vuelve a dibujar el panel (se llama también cuando cambia la sesión). */
export function renderRegistro() {
  if (!perfilActual) return;
  const contenedor = document.getElementById("registration-content");
  if (perfilActual === "proveedor") renderProveedor(contenedor);
  else renderFuncionario(contenedor, ROLES_UI[perfilActual].rol);
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

function renderProveedor(contenedor) {
  const sesion = obtenerSesion();
  const encabezado = html`<h2>Inscripción de proveedor</h2>
    <p>Completá los datos de tu empresa. Verificamos el CUIT en AFIP y un administrador aprueba la solicitud.
      Al aprobarse, recibís en tu wallet la credencial de proveedor.</p>`;

  const conexion = bloqueConexion(sesion);
  if (conexion) return render(contenedor, html`${encabezado}${conexion}`);

  const { credencial, solicitud } = sesion;

  if (credencial && credencial.estado !== "REVOCADA") {
    return render(
      contenedor,
      html`${encabezado}
        <div class="alerta alerta-ok">
          <strong>Esta wallet ya tiene una credencial de ${ETIQUETAS_ROL[credencial.rol].toLowerCase()}</strong>
          <p>${credencial.nombre} · ${badgeEstado(credencial.estado)}</p>
          <button class="button button-outline button-small" data-page="mi-credencial">Ver mi credencial →</button>
        </div>`,
    );
  }

  if (solicitud?.estado === "PENDIENTE") {
    render(
      contenedor,
      html`${encabezado}
        <div class="panel-card">
          <div class="panel-card-head">
            <strong>Solicitud #${solicitud.id}</strong>
            ${badgeEstado("PENDIENTE")}
          </div>
          <dl class="datos">
            <dt>Razón social</dt><dd>${solicitud.razonSocial}</dd>
            <dt>CUIT</dt><dd>${formatearCuit(solicitud.cuit)}</dd>
            <dt>Enviada</dt><dd>${formatearFecha(solicitud.creadaEn)}</dd>
          </dl>
          <p class="texto-suave">Un administrador está revisando tu solicitud. Cuando la apruebe, vas a ver tu
            credencial en "Mi credencial" automáticamente.</p>
          <button class="button button-outline button-small" id="cancelar-solicitud">Cancelar solicitud</button>
        </div>`,
    );
    document.getElementById("cancelar-solicitud").addEventListener("click", async (e) => {
      const ok = await ejecutarTx(() => cancelarSolicitud(solicitud.id), {
        boton: /** @type {HTMLButtonElement} */ (e.currentTarget),
        exito: "Solicitud cancelada.",
      });
      if (ok) await refrescar();
    });
    return;
  }

  const rechazo =
    solicitud?.estado === "RECHAZADA"
      ? html`<div class="alerta alerta-error">
          <strong>Tu solicitud #${solicitud.id} fue rechazada</strong>
          <p>Motivo: “${solicitud.motivoRechazo ?? "sin especificar"}”</p>
          <p>Podés corregir los datos y volver a enviarla.</p>
        </div>`
      : "";

  render(
    contenedor,
    html`${encabezado}${rechazo}
      <form id="form-proveedor" novalidate>
        <div class="form-grid">
          <div class="form-field">
            <label for="prov-cuit">CUIT</label>
            <input id="prov-cuit" name="cuit" inputmode="numeric" placeholder="30-71234567-1" autocomplete="off" required>
            <small class="campo-ayuda" id="prov-cuit-ayuda">Al completarlo lo buscamos en AFIP.</small>
          </div>
          <div class="form-field">
            <label for="prov-razon">Razón social</label>
            <input id="prov-razon" name="razonSocial" placeholder="Como figura en AFIP" maxlength="120" required>
          </div>
          <div class="form-field">
            <label for="prov-domicilio">Domicilio legal</label>
            <input id="prov-domicilio" name="domicilioLegal" placeholder="Calle, localidad, provincia" maxlength="240" required>
          </div>
          <div class="form-field">
            <label for="prov-rubros">Rubros de actividad</label>
            <input id="prov-rubros" name="rubros" placeholder="Ej. construcción, electricidad" maxlength="240" required>
          </div>
        </div>
        <div id="prov-resultado"></div>
        <div class="form-note">
          <span>ⓘ</span>
          <span>El CUIT y la razón social quedan públicos en la blockchain: cualquiera puede ver qué empresas están
            habilitadas. Tus ofertas, en cambio, van a ser anónimas. La solicitud se envía desde tu wallet
            (${acortar(sesion.cuenta)}) y tiene un pequeño costo de gas.</span>
        </div>
        <button class="button button-primary" type="submit">Enviar solicitud <span>→</span></button>
      </form>`,
  );

  conectarFormularioProveedor();
}

function conectarFormularioProveedor() {
  const form = /** @type {HTMLFormElement} */ (document.getElementById("form-proveedor"));
  const campo = (nombre) => /** @type {HTMLInputElement} */ (form.elements.namedItem(nombre));
  const ayuda = document.getElementById("prov-cuit-ayuda");
  const resultado = document.getElementById("prov-resultado");

  // Al completar el CUIT: buscarlo en AFIP y sugerir los datos registrados.
  campo("cuit").addEventListener("change", async () => {
    const cuit = campo("cuit").value.replace(/\D/g, "");
    if (!cuit) return;
    if (!cuitValido(cuit)) {
      ayuda.textContent = "✗ El CUIT no es válido (revisá el dígito verificador).";
      ayuda.className = "campo-ayuda campo-error";
      return;
    }
    campo("cuit").value = formatearCuit(cuit);
    ayuda.textContent = "Consultando AFIP…";
    ayuda.className = "campo-ayuda";

    const persona = await afip.consultarCuit(cuit);
    if (!persona) {
      ayuda.textContent = "✗ El CUIT no figura en el padrón de AFIP.";
      ayuda.className = "campo-ayuda campo-error";
      return;
    }
    if (persona.estadoClave !== "ACTIVO") {
      ayuda.textContent = `✗ ${denominacion(persona)}: CUIT ${persona.estadoClave.toLowerCase()} en AFIP.`;
      ayuda.className = "campo-ayuda campo-error";
      return;
    }

    ayuda.textContent = `✓ En AFIP: ${denominacion(persona)}`;
    ayuda.className = "campo-ayuda campo-ok";
    // Sugerir los datos registrados, sin pisar lo que el usuario ya escribió.
    const { direccion, localidad, descripcionProvincia } = persona.domicilioFiscal;
    if (!campo("razonSocial").value) campo("razonSocial").value = denominacion(persona);
    if (!campo("domicilioLegal").value) campo("domicilioLegal").value = `${direccion}, ${localidad}, ${descripcionProvincia}`;
    if (!campo("rubros").value) campo("rubros").value = persona.actividades.join(", ");
  });

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const datos = {
      cuit: campo("cuit").value.replace(/\D/g, ""),
      razonSocial: campo("razonSocial").value.trim(),
      domicilioLegal: campo("domicilioLegal").value.trim(),
      rubros: campo("rubros").value.trim(),
    };

    if (!datos.cuit || !datos.razonSocial || !datos.domicilioLegal || !datos.rubros) {
      render(resultado, html`<div class="alerta alerta-error"><p>Completá todos los campos.</p></div>`);
      return;
    }

    const boton = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    boton.disabled = true;
    render(resultado, html`<div class="alerta"><p>Verificando en AFIP…</p></div>`);
    const verificacion = await afip.verificarSolicitud(datos);
    boton.disabled = false;

    if (!verificacion.ok) {
      const nombreAfip = verificacion.persona && denominacion(verificacion.persona);
      const puedeCorregir = verificacion.resultado === RESULTADOS.RAZON_SOCIAL_NO_COINCIDE;
      render(
        resultado,
        html`<div class="alerta alerta-error">
          <p>${verificacion.mensaje}</p>
          ${puedeCorregir && html`<button type="button" class="button button-outline button-small" id="usar-afip">Usar "${nombreAfip}"</button>`}
        </div>`,
      );
      document.getElementById("usar-afip")?.addEventListener("click", () => {
        campo("razonSocial").value = nombreAfip;
        resultado.innerHTML = "";
      });
      return;
    }

    render(resultado, html`<div class="alerta alerta-ok"><p>✓ ${verificacion.mensaje}</p></div>`);
    const ok = await ejecutarTx(() => solicitarInscripcion(datos), {
      boton,
      exito: "Solicitud enviada. Un administrador la va a revisar.",
    });
    if (ok) await refrescar();
  });
}

// ---------------------------------------------------------------------------
// Empleados e inspectores
// ---------------------------------------------------------------------------

function renderFuncionario(contenedor, rol) {
  const sesion = obtenerSesion();
  const etiqueta = ETIQUETAS_ROL[rol];
  const credencial = sesion.credencial;
  const yaTiene = credencial && credencial.estado !== "REVOCADA" && credencial.rol === rol;

  render(
    contenedor,
    html`<h2>Acceso como ${etiqueta.toLowerCase()}</h2>
      <p>Las credenciales de ${rol === "EMPLEADO" ? "empleados estatales" : "inspectores"} no se solicitan desde acá:
        las emite un administrador después de verificar tus datos en el padrón de tu organismo.</p>

      ${
        yaTiene
          ? html`<div class="alerta alerta-ok">
              <strong>Ya tenés tu credencial de ${etiqueta.toLowerCase()}</strong>
              <p>${credencial.nombre} · ${badgeEstado(credencial.estado)}</p>
              <button class="button button-outline button-small" data-page="mi-credencial">Ver mi credencial →</button>
            </div>`
          : html`<ol class="pasos">
              <li><strong>Declarás tu wallet en Recursos Humanos</strong>
                <span>Tu área de RR.HH. la registra en el padrón de empleados, junto con tu DNI, cargo y resolución.
                  Tu DNI nunca se publica en la blockchain.</span>
                ${sesion.cuenta && html`<span class="wallet-copiable">Tu wallet: <code>${sesion.cuenta}</code>
                  <button type="button" class="button button-text button-small" data-copiar="${sesion.cuenta}">Copiar</button></span>`}
              </li>
              <li><strong>Un administrador emite tu credencial</strong>
                <span>Verifica en el padrón que estés en actividad y emite el NFT a tu wallet. Quedan públicos tu nombre
                  y tu organismo, para que se sepa quién firma cada acción.</span></li>
              <li><strong>Entrás con MetaMask</strong>
                <span>Al conectar tu wallet, CivicChain reconoce tu credencial y te muestra tus herramientas.</span></li>
            </ol>
            ${bloqueConexion(sesion) ?? ""}`
      }`,
  );

  contenedor.querySelector("[data-copiar]")?.addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(/** @type {HTMLElement} */ (e.currentTarget).dataset.copiar ?? "");
    mostrarToast("Wallet copiada.");
  });
}
