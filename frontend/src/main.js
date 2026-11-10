import "./style.css";
import "./web3.css";

import { NETWORKS } from "./config/contracts.js";
import { contarSolicitudesPendientes, renderAdmin } from "./ui/admin.js";
import { ETIQUETAS_ROL, acortar, mostrarToast } from "./ui/dom.js";
import { renderMiCredencial } from "./ui/mi-credencial.js";
import { paginasPermitidas } from "./ui/permisos.js";
import { cerrarRegistro, mostrarRegistro, renderRegistro } from "./ui/registro.js";
import { explicarError } from "./web3/errores.js";
import { alCambiarSesion, cambiarRed, conectar, iniciarSesion, obtenerSesion, rolActivo } from "./web3/sesion.js";

// ---------------------------------------------------------------------------
// Licitaciones de ejemplo (se reemplazan por datos de la blockchain en la siguiente etapa)
// ---------------------------------------------------------------------------

const tenders = [
  { id: "CC-2026-014", title: "Ampliación del Centro de Salud San Martín", agency: "Municipalidad de Quilmes", location: "Quilmes, Buenos Aires", budget: "$ 48.500.000", status: "Recibiendo ofertas", deadline: "24 de noviembre de 2026", progress: 34, description: "Ampliación de consultorios y renovación de las instalaciones eléctricas y sanitarias del Centro de Salud San Martín. El proyecto contempla nuevas áreas de atención y accesibilidad para pacientes.", theme: "green", phase: 1, closeIn: "12 días" },
  { id: "CC-2026-012", title: "Pavimentación de calles — Barrio Los Aromos", agency: "Municipalidad de Berazategui", location: "Berazategui, Buenos Aires", budget: "$ 76.200.000", status: "En evaluación", deadline: "Cierre: 6 de noviembre de 2026", progress: 56, description: "Pavimentación y obras pluviales en calles del Barrio Los Aromos. Se incluyen tareas de preparación del terreno, desagües y construcción de calzada.", theme: "blue", phase: 2, closeIn: "Evaluación" },
  { id: "CC-2026-009", title: "Renovación de luminarias LED", agency: "Municipalidad de Avellaneda", location: "Avellaneda, Buenos Aires", budget: "$ 31.800.000", status: "En ejecución", deadline: "Adjudicada: 18 de octubre de 2026", progress: 75, description: "Reemplazo de luminarias por tecnología LED en corredores urbanos. La obra incluye provisión, instalación y verificación de los equipos.", theme: "orange", phase: 3, closeIn: "En ejecución" },
  { id: "CC-2026-006", title: "Mejoras en la Escuela Primaria N.º 18", agency: "Consejo Escolar de Florencio Varela", location: "Florencio Varela, Buenos Aires", budget: "$ 92.000.000", status: "Finalizada", deadline: "Finalizada: 30 de septiembre de 2026", progress: 100, description: "Renovación de sanitarios, reparación de cubiertas y mejoras de accesibilidad de la Escuela Primaria N.º 18. Los trabajos fueron informados como finalizados.", theme: "purple", phase: 4, closeIn: "Finalizada" }
];

const pages = {
  inicio: "Inicio",
  licitaciones: "Licitaciones",
  registro: "Registrarse",
  detalle: "Detalle de licitación",
  "mi-credencial": "Mi credencial",
  admin: "Administración"
};

/** Pantallas que se dibujan con datos de la sesión cada vez que se muestran o cambia la sesión. */
const alMostrar = {
  "mi-credencial": renderMiCredencial,
  admin: renderAdmin,
  registro: renderRegistro
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
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === name || (name === "detalle" && item.dataset.page === "licitaciones")));
  document.querySelector(".sidebar").classList.remove("open");
  alMostrar[name]?.();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function statusClass(status) {
  if (status === "En evaluación") return "status-evaluating";
  if (status === "En ejecución") return "status-executing";
  if (status === "Finalizada") return "status-done";
  return "";
}

function tenderCard(tender) {
  return `<article class="tender-card" tabindex="0" role="button" data-tender="${tender.id}" aria-label="Ver ${tender.title}">
    <div class="tender-visual visual-${tender.theme}"><span class="visual-tag">${tender.id}</span><span class="visual-building"></span><span class="visual-number">CIVICCHAIN · ${String(tender.phase).padStart(2, "0")}</span></div>
    <span class="card-status ${statusClass(tender.status)}">${tender.status}</span>
    <h3>${tender.title}</h3><p class="agency">${tender.agency} · ${tender.location.split(",")[0]}</p>
    <div class="card-meta"><span>Presupuesto oficial</span><strong>${tender.budget}</strong></div>
  </article>`;
}

function renderTenders() {
  document.getElementById("featured-tenders").innerHTML = tenders.slice(0, 3).map(tenderCard).join("");
  filterTenders();
}

function filterTenders() {
  const query = (document.getElementById("tender-search")?.value || "").trim().toLocaleLowerCase("es");
  const status = document.getElementById("status-filter")?.value || "all";
  const matches = tenders.filter((tender) => {
    const searchable = `${tender.title} ${tender.agency} ${tender.location} ${tender.id}`.toLocaleLowerCase("es");
    return searchable.includes(query) && (status === "all" || tender.status === status);
  });
  document.getElementById("all-tenders").innerHTML = matches.map(tenderCard).join("");
  document.getElementById("empty-state").classList.toggle("hidden", matches.length > 0);
}

function openTender(id) {
  const tender = tenders.find((item) => item.id === id);
  if (!tender) return;
  document.getElementById("detail-status").innerHTML = `<span class="card-status ${statusClass(tender.status)}">${tender.status}</span>`;
  document.getElementById("detail-agency").textContent = `${tender.id} · ${tender.agency.toLocaleUpperCase("es")}`;
  document.getElementById("detail-title").textContent = tender.title;
  document.getElementById("detail-location").textContent = `⌖  ${tender.location}`;
  document.getElementById("detail-progress-label").textContent = `${tender.progress}% completado`;
  document.getElementById("detail-progress-bar").style.width = `${tender.progress}%`;
  document.getElementById("detail-budget").textContent = tender.budget;
  document.getElementById("detail-deadline").textContent = tender.deadline;
  document.getElementById("detail-description").textContent = tender.description;
  const phaseNames = ["Publicación", "Ofertas", "Evaluación", "Adjudicación"];
  document.getElementById("detail-phases").innerHTML = phaseNames.map((phase, index) => `<span class="phase ${index + 1 < tender.phase ? "done" : ""} ${index + 1 === tender.phase ? "current" : ""}">${phase}</span>`).join("");
  goToPage("detalle");
}

// ---------------------------------------------------------------------------
// Registro: grilla de perfiles y panel
// ---------------------------------------------------------------------------

function mostrarGrillaDePerfiles() {
  cerrarRegistro();
  document.querySelector(".role-grid").classList.remove("hidden");
  document.getElementById("registration-panel").classList.add("hidden");
}

function abrirPerfil(perfil) {
  document.querySelector(".role-grid").classList.add("hidden");
  document.getElementById("registration-panel").classList.remove("hidden");
  mostrarRegistro(perfil);
  document.getElementById("registration-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Wallet: botón superior, perfil del menú lateral y menú según el rol
// ---------------------------------------------------------------------------

async function accionWallet() {
  const sesion = obtenerSesion();
  try {
    if (sesion.estado === "SIN_METAMASK") mostrarToast("Instalá MetaMask para conectarte.");
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
    SIN_METAMASK: "Instalar MetaMask",
    DESCONECTADO: "Conectar wallet",
    RED_INCORRECTA: "Cambiar de red",
    SIN_CONTRATO: "Contrato no encontrado",
    CONECTADO: acortar(sesion.cuenta)
  }[sesion.estado];
  document.getElementById("wallet-button-text").textContent = textoBoton;

  document.getElementById("network-label").textContent = conectado
    ? `Conectado a ${NETWORKS[sesion.chainId]?.name ?? `red ${sesion.chainId}`}`
    : sesion.estado === "RED_INCORRECTA" ? "Red no soportada" : "Sin wallet conectada";

  // Perfil del menú lateral
  const credencial = sesion.credencial;
  const nombre = conectado ? (credencial?.nombre ?? (sesion.esAdmin ? "Administración" : acortar(sesion.cuenta))) : "Invitado";
  let detalle = "Conectar para participar";
  if (conectado) {
    if (rol) detalle = ETIQUETAS_ROL[rol];
    else if (credencial) detalle = `Credencial ${credencial.estado.toLowerCase()}`;
    else if (sesion.solicitud?.estado === "PENDIENTE") detalle = "Solicitud en revisión";
    else detalle = sesion.esAdmin ? "Admin" : "Ciudadano";
    if (sesion.esAdmin && rol) detalle += " · Admin";
  }
  const inicial = !conectado ? "?" : nombre.startsWith("0x") ? "◈" : nombre.charAt(0).toUpperCase();
  document.getElementById("profile-avatar").textContent = inicial;
  document.getElementById("profile-name").textContent = nombre;
  document.getElementById("profile-detail").textContent = detalle;

  // Menú y enlaces según el rol: el CSS oculta todo [data-page] que apunte a una pantalla no permitida
  // (también los botones que las pantallas dibujan después, como "Ver mi credencial").
  permitidas = paginasPermitidas(sesion);
  document.body.dataset.paginas = [...permitidas].join(" ");
  if (permitidas.has("admin")) actualizarContadorAdmin();

  // Si estaba en una pantalla que ya no corresponde, llevarlo a donde sí. Por ejemplo: le aprobaron la
  // solicitud estando en "Registrarse" → "Mi credencial"; perdió el rol de admin → inicio.
  if (!permitidas.has(paginaActual)) goToPage(paginaActual === "registro" ? paginaDeLaCuenta() : "inicio");
  else alMostrar[paginaActual]?.();
}

async function actualizarContadorAdmin() {
  const contador = document.getElementById("admin-count");
  try {
    const pendientes = await contarSolicitudesPendientes();
    contador.textContent = String(pendientes);
    contador.classList.toggle("hidden", pendientes === 0);
  } catch {
    contador.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

document.addEventListener("click", (event) => {
  const target = /** @type {HTMLElement} */ (event.target);

  const pageLink = target.closest("[data-page]");
  if (pageLink) {
    event.preventDefault();
    if (pageLink.dataset.page === "registro") mostrarGrillaDePerfiles();
    goToPage(pageLink.dataset.page);
  }

  const roleButton = target.closest("[data-role]");
  if (roleButton) abrirPerfil(roleButton.dataset.role);

  const card = target.closest("[data-tender]");
  if (card) openTender(card.dataset.tender);

  const accion = target.closest("[data-accion]")?.dataset.accion;
  if (accion === "conectar" || accion === "cambiar-red") {
    (accion === "conectar" ? conectar() : cambiarRed()).catch((error) => mostrarToast(explicarError(error), 5000));
  }

  if (target.closest("#wallet-button") || target.closest("#profile-button")) accionWallet();
  if (target.closest("#mobile-menu")) document.querySelector(".sidebar").classList.toggle("open");
  if (target.closest("#back-to-roles")) mostrarGrillaDePerfiles();
});

document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-tender]")) {
    event.preventDefault();
    openTender(event.target.dataset.tender);
  }
  if (event.key === "Escape") document.querySelector(".sidebar").classList.remove("open");
});

document.getElementById("tender-search").addEventListener("input", filterTenders);
document.getElementById("status-filter").addEventListener("change", filterTenders);

renderTenders();
alCambiarSesion(actualizarInterfaz);
iniciarSesion().catch((error) => mostrarToast(explicarError(error), 5000));
