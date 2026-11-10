import "./style.css";

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
  detalle: "Detalle de licitación"
};

const roleDetails = {
  proveedor: {
    title: "Registro de proveedor",
    tag: "SECTOR PRIVADO",
    description: "Completá los datos de tu empresa para solicitar la habilitación como oferente.",
    fields: [
      ["Razón social", "text", "Nombre legal de la empresa"],
      ["CUIT", "text", "00-00000000-0"],
      ["Domicilio legal", "text", "Calle, localidad, provincia"],
      ["Rubros de actividad", "text", "Ej. construcción, electricidad"]
    ]
  },
  empleado: {
    title: "Registro de empleado estatal",
    tag: "ORGANISMO PÚBLICO",
    description: "Indicá tus datos y el organismo al que pertenecés para solicitar acceso de gestión.",
    fields: [
      ["Nombre y apellido", "text", "Como figura en tu documento"],
      ["DNI", "text", "Número de documento"],
      ["Organismo y área", "text", "Organismo / área de trabajo"],
      ["Domicilio legal", "text", "Calle, localidad, provincia"],
      ["Número de resolución", "text", "Resolución que acredita el rol"]
    ]
  },
  inspector: {
    title: "Registro de inspector",
    tag: "CONTROL DE OBRA",
    description: "Indicá tus datos y organismo para solicitar acceso a la inspección de obras.",
    fields: [
      ["Nombre y apellido", "text", "Como figura en tu documento"],
      ["DNI", "text", "Número de documento"],
      ["Organismo y área", "text", "Organismo / área de trabajo"],
      ["Domicilio legal", "text", "Calle, localidad, provincia"]
    ]
  }
};

const pageSection = (name) => document.getElementById(`page-${name}`);
const toast = document.getElementById("toast");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function goToPage(name) {
  if (!pages[name] || !pageSection(name)) return;
  document.querySelectorAll(".page-section").forEach((section) => section.classList.remove("active"));
  pageSection(name).classList.add("active");
  document.getElementById("current-section").textContent = pages[name];
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === name || (name === "detalle" && item.dataset.page === "licitaciones")));
  document.querySelector(".sidebar").classList.remove("open");
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

function showRole(role) {
  const details = roleDetails[role];
  if (!details) return;
  document.getElementById("registration-heading").textContent = details.title;
  document.getElementById("registration-tag").textContent = details.tag;
  document.getElementById("registration-description").textContent = details.description;
  document.getElementById("registration-fields").innerHTML = details.fields.map(([label, type, placeholder], index) => `<div class="form-field"><label for="registration-field-${index}">${label}</label><input id="registration-field-${index}" name="field-${index}" type="${type}" placeholder="${placeholder}" autocomplete="off"></div>`).join("");
  document.querySelector(".role-grid").classList.add("hidden");
  document.getElementById("registration-panel").classList.remove("hidden");
  document.getElementById("registration-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.addEventListener("click", (event) => {
  const pageLink = event.target.closest("[data-page]");
  if (pageLink) {
    event.preventDefault();
    goToPage(pageLink.dataset.page);
    if (pageLink.dataset.page === "registro") {
      document.querySelector(".role-grid").classList.remove("hidden");
      document.getElementById("registration-panel").classList.add("hidden");
    }
  }
  const roleButton = event.target.closest("[data-role]");
  if (roleButton) showRole(roleButton.dataset.role);
  const card = event.target.closest("[data-tender]");
  if (card) openTender(card.dataset.tender);
  if (event.target.closest("#mobile-menu")) document.querySelector(".sidebar").classList.toggle("open");
  if (event.target.closest("#back-to-roles")) {
    document.querySelector(".role-grid").classList.remove("hidden");
    document.getElementById("registration-panel").classList.add("hidden");
  }
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
document.getElementById("registration-form").addEventListener("submit", (event) => {
  event.preventDefault();
  showToast("Demostración: el registro no se envió ni se guardó.");
});

renderTenders();
