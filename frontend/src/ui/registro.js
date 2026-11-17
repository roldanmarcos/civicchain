// Pantalla "Registrarse": inscripción automática de proveedores.
//
// Empleados e inspectores no se registran desde acá: los da de alta un administrador
// (Administración → Alta de funcionarios).

import { cuitValido } from "../shared/cuit.js";
import { inscribirProveedor } from "../web3/credenciales.js";
import { explicarError } from "../web3/errores.js";
import { obtenerSesion, refrescar } from "../web3/sesion.js";
import { bloqueConexion } from "./conexion.js";
import { ETIQUETAS_ROL, acortar, badgeEstado, formatearCuit, formatearFecha, html, mostrarToast, render } from "./dom.js";

/** Vuelve a dibujar la pantalla (se llama también cuando cambia la sesión). */
export function renderRegistro() {
  const sesion = obtenerSesion();
  const miWallet = document.getElementById("registro-mi-wallet");
  render(
    miWallet,
    sesion.cuenta
      ? html`<button type="button" class="button button-text button-small" data-copiar="${sesion.cuenta}">Copiar mi wallet (${acortar(sesion.cuenta)})</button>`
      : html``,
  );
  miWallet.querySelector("[data-copiar]")?.addEventListener("click", copiar);

  renderProveedor(document.getElementById("registration-content"));
}

async function copiar(e) {
  await navigator.clipboard.writeText(/** @type {HTMLElement} */ (e.currentTarget).dataset.copiar ?? "");
  mostrarToast("Wallet copiada.");
}

function renderProveedor(contenedor) {
  const sesion = obtenerSesion();
  const encabezado = html`<h2>Datos de la empresa</h2>
    <p>Verificamos en AFIP que el CUIT esté activo, que la razón social coincida y que representes a la empresa.
      Si todo está bien, en la misma operación recibís en tu wallet la credencial de proveedor.</p>`;

  const conexion = bloqueConexion(sesion);
  if (conexion) return render(contenedor, html`${encabezado}${conexion}`);

  const { credencial, inscripciones } = sesion;
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

  const ultima = inscripciones[0];
  const rechazo =
    ultima?.estado === "RECHAZADA"
      ? html`<div class="alerta alerta-error">
          <strong>Tu última inscripción fue rechazada (${formatearFecha(ultima.creadaEn)})</strong>
          <p>Motivo: “${ultima.motivo}”</p>
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
            <small class="campo-ayuda" id="prov-cuit-ayuda">Con guiones o sin ellos.</small>
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
          <div class="form-field">
            <label for="prov-clave">Clave fiscal (simulada)</label>
            <input id="prov-clave" name="claveFiscal" type="password" autocomplete="off" placeholder="DEMO-…" required>
            <small class="campo-ayuda">Prueba que representás a la empresa. En la demo, ver <code>claveFiscalDemo</code> en el padrón de AFIP simulado.</small>
          </div>
        </div>
        <div id="prov-resultado"></div>
        <div class="form-note">
          <span>ⓘ</span>
          <span>El CUIT y la razón social quedan públicos en la blockchain: cualquiera puede ver qué empresas están
            habilitadas. El resto de los datos queda en la base de CivicChain y en la cadena va solo su huella (hash).
            Tus ofertas van a ser anónimas: vas a firmar un mensaje con tu wallet para generar una identidad
            anónima que no se puede vincular a ella. La credencial se emite desde tu wallet
            (${acortar(sesion.cuenta)}) y tiene un pequeño costo de gas.</span>
        </div>
        <button class="button button-primary" type="submit">Inscribirme <span>→</span></button>
      </form>`,
  );

  conectarFormularioProveedor();
}

function conectarFormularioProveedor() {
  const form = /** @type {HTMLFormElement} */ (document.getElementById("form-proveedor"));
  const campo = (nombre) => /** @type {HTMLInputElement} */ (form.elements.namedItem(nombre));
  const ayuda = document.getElementById("prov-cuit-ayuda");
  const resultado = document.getElementById("prov-resultado");

  campo("cuit").addEventListener("change", () => {
    const cuit = campo("cuit").value.replace(/\D/g, "");
    if (!cuit) return;
    if (!cuitValido(cuit)) {
      ayuda.textContent = "✗ El CUIT no es válido (revisá el dígito verificador).";
      ayuda.className = "campo-ayuda campo-error";
      return;
    }
    campo("cuit").value = formatearCuit(cuit);
    ayuda.textContent = "✓ CUIT válido. Lo verificamos en AFIP al enviar.";
    ayuda.className = "campo-ayuda campo-ok";
  });

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const datos = Object.fromEntries(["cuit", "razonSocial", "domicilioLegal", "rubros", "claveFiscal"].map((k) => [k, campo(k).value.trim()]));
    if (Object.values(datos).some((v) => !v)) {
      render(resultado, html`<div class="alerta alerta-error"><p>Completá todos los campos.</p></div>`);
      return;
    }
    if (!cuitValido(datos.cuit)) {
      render(resultado, html`<div class="alerta alerta-error"><p>El CUIT no es válido.</p></div>`);
      return;
    }

    const boton = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    boton.disabled = true;
    const avance = (texto) => render(resultado, html`<div class="alerta"><p>${texto}</p></div>`);
    try {
      const r = await inscribirProveedor(datos, avance);
      if (!r.aprobada) {
        render(resultado, html`<div class="alerta alerta-error"><strong>Inscripción rechazada</strong><p>${r.motivo}</p></div>`);
        await refrescar();
        return;
      }
      render(resultado, html`<div class="alerta alerta-ok"><strong>¡Listo!</strong><p>${r.motivo}. Ya tenés tu credencial de proveedor.</p></div>`);
      mostrarToast("Credencial de proveedor emitida.");
      await refrescar();
    } catch (error) {
      render(resultado, html`<div class="alerta alerta-error"><p>${explicarError(error)}</p></div>`);
    } finally {
      if (boton.isConnected) boton.disabled = false;
    }
  });
}
