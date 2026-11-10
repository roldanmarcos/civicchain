// Utilidades de interfaz compartidas por las pantallas.

import { organismos } from "../config/contracts.js";
import { explicarError } from "../web3/errores.js";

// ---------------------------------------------------------------------------
// HTML seguro
// ---------------------------------------------------------------------------

const SEGURO = Symbol("html-seguro");

/** Marca un fragmento como HTML ya seguro (no se vuelve a escapar). */
export function seguro(texto) {
  return { [SEGURO]: true, texto: String(texto) };
}

export function escapar(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function interpolar(valor) {
  if (Array.isArray(valor)) return valor.map(interpolar).join("");
  if (valor && typeof valor === "object" && valor[SEGURO]) return valor.texto;
  if (valor === false || valor === null || valor === undefined) return "";
  return escapar(valor);
}

/**
 * Template tag que escapa todo lo interpolado, salvo otros `html` o `seguro(...)`.
 * Los datos de la cadena (razón social, nombres, motivos) los escriben usuarios: nunca se insertan sin escapar.
 */
export function html(partes, ...valores) {
  return seguro(partes.reduce((acc, parte, i) => acc + parte + (i < valores.length ? interpolar(valores[i]) : ""), ""));
}

/** Reemplaza el contenido de un elemento con un fragmento `html`. */
export function render(elemento, fragmento) {
  elemento.innerHTML = fragmento.texto;
}

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------

export const acortar = (wallet) => (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "");

export const formatearFecha = (timestamp) =>
  new Date(Number(timestamp) * 1000).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

export function formatearCuit(cuit) {
  const s = String(cuit).padStart(11, "0");
  return `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}`;
}

export const nombreOrganismo = (id) => organismos.find((o) => o.id === Number(id))?.nombre ?? "—";

export const ETIQUETAS_ROL = { PROVEEDOR: "Proveedor", EMPLEADO: "Empleado estatal", INSPECTOR: "Inspector" };

/** Badge de estado (reutiliza .card-status del diseño). */
export function badgeEstado(estado) {
  const clases = {
    VIGENTE: "",
    APROBADA: "",
    PENDIENTE: "status-evaluating",
    VENCIDA: "status-evaluating",
    REVOCADA: "status-revoked",
    RECHAZADA: "status-revoked",
    CANCELADA: "status-done",
  };
  const texto = estado.charAt(0) + estado.slice(1).toLowerCase();
  return html`<span class="card-status ${clases[estado] ?? ""}">${texto}</span>`;
}

// ---------------------------------------------------------------------------
// Toast y transacciones
// ---------------------------------------------------------------------------

let temporizadorToast;

export function mostrarToast(mensaje, duracionMs = 3200) {
  const toast = document.getElementById("toast");
  toast.textContent = mensaje;
  toast.classList.add("show");
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => toast.classList.remove("show"), duracionMs);
}

/**
 * Ejecuta una acción que firma una transacción, con feedback para el usuario.
 * Deshabilita el botón mientras tanto. Devuelve true si salió bien.
 * @param {() => Promise<unknown>} accion
 * @param {{ boton?: HTMLButtonElement | null, exito: string }} opciones
 */
export async function ejecutarTx(accion, { boton, exito }) {
  const textoOriginal = boton?.innerHTML;
  if (boton) {
    boton.disabled = true;
    boton.textContent = "Confirmá en MetaMask…";
  }
  mostrarToast("Confirmá la transacción en MetaMask…", 60_000);
  try {
    await accion();
    mostrarToast(exito);
    return true;
  } catch (error) {
    mostrarToast(explicarError(error), 6000);
    return false;
  } finally {
    if (boton && boton.isConnected) {
      boton.disabled = false;
      boton.innerHTML = textoOriginal;
    }
  }
}

// ---------------------------------------------------------------------------
// Diálogo para pedir un texto (motivo de rechazo o revocación, días de vigencia)
// ---------------------------------------------------------------------------

/**
 * @param {{ titulo: string, descripcion?: string, etiqueta: string, valor?: string, tipo?: "text" | "number", confirmar: string }} opciones
 * @returns {Promise<string | null>} El texto ingresado, o null si se canceló.
 */
export function pedirTexto({ titulo, descripcion = "", etiqueta, valor = "", tipo = "text", confirmar }) {
  const dialogo = document.createElement("dialog");
  dialogo.className = "dialogo";
  render(
    dialogo,
    html`<form method="dialog">
      <h3>${titulo}</h3>
      ${descripcion && html`<p>${descripcion}</p>`}
      <div class="form-field">
        <label for="dialogo-valor">${etiqueta}</label>
        <input id="dialogo-valor" name="valor" type="${tipo}" value="${valor}" required ${tipo === "number" ? seguro('min="1"') : ""}>
      </div>
      <div class="dialogo-acciones">
        <button class="button button-outline button-small" value="cancelar" formnovalidate>Cancelar</button>
        <button class="button button-primary button-small" value="ok">${confirmar}</button>
      </div>
    </form>`,
  );
  document.body.append(dialogo);

  return new Promise((resolve) => {
    dialogo.addEventListener("close", () => {
      const texto = dialogo.querySelector("input").value.trim();
      resolve(dialogo.returnValue === "ok" && texto ? texto : null);
      dialogo.remove();
    });
    dialogo.showModal();
    dialogo.querySelector("input").select();
  });
}
