import "./style.css";
import "./web3.css";

import { NETWORKS } from "./config/contracts.js";
import { renderAdmin } from "./ui/admin.js";
import { ETIQUETAS_ROL, acortar, html, mostrarToast, nombreOrganismo, render } from "./ui/dom.js";
import { licitacionAbierta, renderDetalle, renderEstadisticas, tarjetaLicitacion } from "./ui/licitaciones.js";
import { renderMiCredencial } from "./ui/mi-credencial.js";
import { cuandoSePublique, renderNuevaLicitacion } from "./ui/nueva-licitacion.js";
import { paginasPermitidas } from "./ui/permisos.js";
import { renderRegistro } from "./ui/registro.js";
import { explicarError } from "./web3/errores.js";
import { leerLicitaciones } from "./web3/licitaciones.js";
import {
  alCambiarCadena,
  alCambiarSesion,
  cambiarRed,
  conectar,
  conectarConQR,
  desconectarQR,
  iniciarSesion,
  obtenerSesion,
  qrDisponible,
  rolActivo,
} from "./web3/sesion.js";

const pages = {
  inicio: "Inicio",
  licitaciones: "Licitaciones",
  registro: "Registrarse",
  detalle: "Detalle de licitación",
  "mi-credencial": "Mi credencial",
  "nueva-licitacion": "Publicar licitación",
  admin: "Administración",
};

/** Pantallas que se dibujan con datos de la sesión cada vez que se muestran o cambia la sesión. */
const alMostrar = {
  "mi-credencial": renderMiCredencial,
  admin: renderAdmin,
  registro: renderRegistro,
  "nueva-licitacion": renderNuevaLicitacion,
  detalle: () => renderDetalle(),
};

const pageSection = (name) => document.getElementById(`page-${name}`);
let paginaActual = "inicio";
let permitidas = paginasPermitidas(obtenerSesion());

function goToPage(name) {
  if (!pages[name] || !pageSection(name) || !permitidas.has(name)) return;
  paginaActual = name;
  document.querySelectorAll(".page-section").forEach((section) => section.classList.remove("active"));
  pageSection(name).classList.add("active");
  document.getElementById("current-section").textContent = pages[name];
  document
    .querySelectorAll(".nav-item")
    .forEach((item) => item.classList.toggle("active", item.dataset.page === name || (name === "detalle" && item.dataset.page === "licitaciones")));
  document.querySelector(".sidebar").classList.remove("open");
  alMostrar[name]?.();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// Licitaciones (leídas de la blockchain)
// ---------------------------------------------------------------------------

/** @type {import("./web3/licitaciones.js").Licitacion[]} */
let licitaciones = [];
let cargadas = false;

async function cargarLicitaciones() {
  try {
    licitaciones = await leerLicitaciones();
    cargadas = true;
  } catch (error) {
    document.getElementById("stat-activas-detalle").textContent = "No se pudo leer la blockchain";
    document.getElementById("empty-state-texto").textContent = explicarError(error);
    document.getElementById("empty-state").classList.remove("hidden");
    return;
  }
  renderTenders();
}

/**
 * Lo que ve cada rol en los listados. Es solo de la interfaz: los datos son públicos en la blockchain.
 * - Inspector: las obras en las que está asignado.
 * - Empleado: las de su organismo (las que publicó él se marcan en la tarjeta).
 * - Proveedor, admin y público: todas.
 */
function visiblesParaMiRol() {
  const sesion = obtenerSesion();
  const rol = rolActivo();
  if (rol === "INSPECTOR") return licitaciones.filter((l) => l.inspectoresAsignados?.includes(sesion.cuenta.toLowerCase()));
  if (rol === "EMPLEADO") return licitaciones.filter((l) => l.organismoId === sesion.credencial.organismoId);
  return licitaciones;
}

/** Texto que explica el filtro por rol en la página de licitaciones. */
function textoFiltroRol() {
  const rol = rolActivo();
  const organismo = obtenerSesion().credencial?.organismoId;
  if (rol === "INSPECTOR") return "Ves solo las obras en las que estás asignado como inspector.";
  if (rol === "EMPLEADO") return `Ves las licitaciones de ${nombreOrganismo(organismo)}. Las que publicaste vos están marcadas.`;
  return "Explorá procesos de obra pública y seguí su avance, desde la publicación hasta la adjudicación.";
}

function renderTenders() {
  const visibles = visiblesParaMiRol();
  const destacadas = [...visibles].sort((a, b) => Number(b.estado === "RECIBIENDO_OFERTAS") - Number(a.estado === "RECIBIENDO_OFERTAS")).slice(0, 3);
  render(
    document.getElementById("featured-tenders"),
    destacadas.length
      ? html`${destacadas.map(tarjetaLicitacion)}`
      : html`<div class="empty-state"><span>▤</span><strong>${rolActivo() === "INSPECTOR" ? "Todavía no te asignaron ninguna obra" : "Todavía no hay licitaciones publicadas"}</strong></div>`,
  );
  renderEstadisticas(visibles);
  const contador = document.getElementById("nav-count-licitaciones");
  contador.textContent = String(visibles.length);
  contador.classList.toggle("hidden", visibles.length === 0);
  document.getElementById("tenders-intro").textContent = textoFiltroRol();
  filterTenders();
}

function filterTenders() {
  const query = (/** @type {HTMLInputElement} */ (document.getElementById("tender-search")).value || "").trim().toLocaleLowerCase("es");
  const status = /** @type {HTMLSelectElement} */ (document.getElementById("status-filter")).value || "all";
  const visibles = visiblesParaMiRol();
  const matches = visibles.filter((l) => {
    const texto = `${l.titulo} ${l.metadata?.ubicacion ?? ""} ${l.metadata?.description ?? ""} CC-${String(l.id).padStart(3, "0")}`.toLocaleLowerCase("es");
    return texto.includes(query) && (status === "all" || l.estado === status);
  });
  render(document.getElementById("all-tenders"), html`${matches.map(tarjetaLicitacion)}`);
  document.getElementById("empty-state-texto").textContent = visibles.length
    ? "Probá con otro término o cambiá el filtro."
    : rolActivo() === "INSPECTOR"
      ? "Cuando un empleado de tu organismo te asigne a una obra, va a aparecer acá."
      : "Todavía no hay licitaciones publicadas.";
  document.getElementById("empty-state").classList.toggle("hidden", matches.length > 0 || !cargadas);
}

function openTender(id) {
  renderDetalle(Number(id));
  goToPage("detalle");
}

// ---------------------------------------------------------------------------
// Wallet: botón superior, perfil del menú lateral y menú según el rol
// ---------------------------------------------------------------------------

async function accionWallet() {
  const sesion = obtenerSesion();
  try {
    if (sesion.estado === "SIN_METAMASK") qrDisponible() ? await conectarConQR() : mostrarToast("Instalá MetaMask para conectarte.");
    else if (sesion.estado === "DESCONECTADO") await conectar();
    else if (sesion.estado === "RED_INCORRECTA") await cambiarRed();
    else if (sesion.estado === "CONECTADO") goToPage(paginaDeLaCuenta());
  } catch (error) {
    mostrarToast(explicarError(error), 5000);
  }
}

/** Pantalla propia del usuario conectado: su credencial, el panel de administración o el registro. */
function paginaDeLaCuenta() {
  return ["mi-credencial", "admin", "registro"].find((pagina) => permitidas.has(pagina)) ?? "inicio";
}

/** Actualiza todo lo que depende de la sesión fuera de las pantallas. */
function actualizarInterfaz(sesion) {
  const conectado = sesion.estado === "CONECTADO";
  const rol = rolActivo();

  const textoBoton = {
    CARGANDO: "Conectando…",
    SIN_METAMASK: qrDisponible() ? "Conectar con QR" : "Instalar MetaMask",
    DESCONECTADO: "Conectar wallet",
    RED_INCORRECTA: "Cambiar de red",
    SIN_CONTRATO: "Contrato no encontrado",
    CONECTADO: acortar(sesion.cuenta),
  }[sesion.estado];
  document.getElementById("wallet-button-text").textContent = textoBoton;
  const qr = document.getElementById("qr-button");
  qr.classList.toggle("hidden", !qrDisponible() || (conectado && !sesion.conQR));
  qr.textContent = sesion.conQR ? "Desconectar QR" : "▦ QR";

  document.getElementById("network-label").textContent = conectado
    ? `Conectado a ${NETWORKS[sesion.chainId]?.name ?? `red ${sesion.chainId}`}${sesion.conQR ? " (QR)" : ""}`
    : sesion.estado === "RED_INCORRECTA"
      ? "Red no soportada"
      : "Sin wallet conectada";

  // Perfil del menú lateral
  const credencial = sesion.credencial;
  const nombre = conectado ? (credencial?.nombre ?? (sesion.esAdmin ? "Administración" : acortar(sesion.cuenta))) : "Invitado";
  let detalle = "Conectar para participar";
  if (conectado) {
    if (rol) detalle = ETIQUETAS_ROL[rol];
    else if (credencial) detalle = `Credencial ${credencial.estado.toLowerCase()}`;
    else detalle = sesion.esAdmin ? "Admin" : "Ciudadano";
    if (sesion.esAdmin && rol) detalle += " · Admin";
  }
  const inicial = !conectado ? "?" : nombre.startsWith("0x") ? "◈" : nombre.charAt(0).toUpperCase();
  document.getElementById("profile-avatar").textContent = inicial;
  document.getElementById("profile-name").textContent = nombre;
  document.getElementById("profile-detail").textContent = detalle;

  // Menú y enlaces según el rol: el CSS oculta todo [data-page] que apunte a una pantalla no permitida.
  permitidas = paginasPermitidas(sesion);
  document.body.dataset.paginas = [...permitidas].join(" ");

  // Si estaba en una pantalla que ya no corresponde, llevarlo a donde sí. Por ejemplo: recibió la
  // credencial estando en "Registrarse" → "Mi credencial"; perdió el rol de admin → inicio.
  if (!permitidas.has(paginaActual)) goToPage(paginaActual === "registro" ? paginaDeLaCuenta() : "inicio");
  else alMostrar[paginaActual]?.();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

document.addEventListener("click", (event) => {
  const target = /** @type {HTMLElement} */ (event.target);

  const pageLink = target.closest("[data-page]");
  if (pageLink) {
    event.preventDefault();
    goToPage(pageLink.dataset.page);
  }

  const card = target.closest("[data-tender]");
  if (card) openTender(card.dataset.tender);

  const accion = target.closest("[data-accion]")?.dataset.accion;
  if (accion === "conectar" || accion === "cambiar-red" || accion === "conectar-qr") {
    const promesa = accion === "conectar" ? conectar() : accion === "cambiar-red" ? cambiarRed() : conectarConQR();
    promesa.catch((error) => mostrarToast(explicarError(error), 5000));
  }

  if (target.closest("#qr-button")) {
    (obtenerSesion().conQR ? desconectarQR() : conectarConQR()).catch((error) => mostrarToast(explicarError(error), 5000));
  }
  if (target.closest("#wallet-button") || target.closest("#profile-button")) accionWallet();
  if (target.closest("#mobile-menu")) document.querySelector(".sidebar").classList.toggle("open");
});

document.addEventListener("keydown", (event) => {
  const t = /** @type {HTMLElement} */ (event.target);
  if ((event.key === "Enter" || event.key === " ") && t.matches("[data-tender]")) {
    event.preventDefault();
    openTender(t.dataset.tender);
  }
  if (event.key === "Escape") document.querySelector(".sidebar").classList.remove("open");
});

document.getElementById("tender-search").addEventListener("input", filterTenders);
document.getElementById("status-filter").addEventListener("change", filterTenders);

cuandoSePublique(async () => {
  await cargarLicitaciones();
  if (licitaciones[0]) openTender(licitaciones[0].id);
});

alCambiarSesion(actualizarInterfaz);
// Al cambiar de cuenta o de rol cambia lo que se ve en los listados.
alCambiarSesion(() => cargadas && renderTenders());
// Eventos nuevos en los contratos: refrescar listados y el detalle abierto.
alCambiarCadena(() => {
  cargarLicitaciones();
  if (paginaActual === "detalle" && licitacionAbierta()) renderDetalle();
});
// Las fases cambian con el tiempo aunque no haya transacciones (cierre, fin de la apertura).
setInterval(() => {
  if (document.hidden) return;
  cargarLicitaciones();
  if (paginaActual === "detalle") renderDetalle();
}, 30_000);

actualizarInterfaz(obtenerSesion());
cargarLicitaciones();
iniciarSesion().catch((error) => mostrarToast(explicarError(error), 6000));
