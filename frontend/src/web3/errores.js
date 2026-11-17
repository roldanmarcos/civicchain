// Traduce los errores de MetaMask y del contrato a mensajes para el usuario.

const MENSAJES_CONTRATO = {
  AccessControlUnauthorizedAccount: "Tu wallet no tiene permisos de administración.",
  WalletConCredencial: "Esta wallet ya tiene una credencial vigente.",
  CuitConCredencial: "Ese CUIT ya tiene una credencial vigente.",
  CuitInvalido: "El CUIT no es válido (revisá el dígito verificador).",
  TextoInvalido: "Hay un campo vacío o demasiado largo.",
  FechaInvalida: "La fecha de vencimiento tiene que ser futura.",
  OrganismoInvalido: "El organismo no es válido.",
  RolInvalido: "El rol no es válido para esta operación.",
  MotivoVacio: "Tenés que indicar un motivo.",
  FirmaInvalida: "La autorización del verificador no es válida para esta wallet.",
  FirmaVencida: "La autorización del verificador venció. Volvé a enviar la inscripción.",
  FirmaYaUsada: "Esa autorización ya se usó.",
  UsarRevocarProveedor: "A los proveedores hay que revocarlos sacándolos del grupo (usá Revocar desde la dApp).",
  NoEsProveedor: "La credencial no es de un proveedor.",
  ProveedorFueraDelGrupo: "El proveedor ya no está en el grupo: hay que revocarlo y volver a inscribirlo.",
  CredencialNoVencida: "La credencial todavía no venció.",
  // Licitaciones
  SinRol: "Tu wallet no tiene la credencial necesaria para esta acción.",
  OtroOrganismo: "La licitación es de otro organismo.",
  LicitacionInexistente: "La licitación no existe.",
  OfertaInexistente: "La oferta no existe.",
  EtapasInvalidas: "Los porcentajes de las etapas tienen que sumar 100 % (y ninguno puede ser 0).",
  PresupuestoInvalido: "El presupuesto tiene que ser mayor a cero.",
  FueraDePlazo: "Esta acción no corresponde a la etapa actual de la licitación.",
  OfertaDuplicada: "Tu empresa ya ofertó en esta licitación.",
  OfertaYaAbierta: "La oferta ya estaba abierta.",
  CompromisoIncorrecto: "Los valores no coinciden con lo que se ofertó.",
  DesgloseInvalido: "El desglose por etapa no suma el monto total.",
  OfertaNoAbierta: "Solo se pueden adjudicar ofertas abiertas.",
  SuperaPresupuesto: "La oferta supera el presupuesto oficial.",
  AutoriaIncorrecta: "Esta wallet no es la autora de esa oferta.",
  AutoriaYaRevelada: "La autoría ya fue revelada.",
  InspectorYaAsignado: "Ese inspector ya está asignado.",
  NoEsInspectorAsignado: "No sos inspector asignado a esta obra.",
  EtapaIncorrecta: "Hay que evaluar las etapas en orden.",
  SinContratista: "El ganador todavía no reveló su identidad.",
  CredencialYaRevocada: "La credencial ya estaba revocada.",
  CredencialInexistente: "La credencial no existe.",
  CredencialIntransferible: "Las credenciales no se pueden transferir.",
};

/** @param {unknown} error */
export function explicarError(error) {
  const e = /** @type {any} */ (error);

  if (e?.code === "ACTION_REJECTED" || e?.code === 4001 || e?.info?.error?.code === 4001) {
    return "Cancelaste la operación en MetaMask.";
  }
  if (e?.code === "INSUFFICIENT_FUNDS") {
    return "Tu wallet no tiene ETH suficiente para pagar el gas.";
  }

  const nombre = e?.revert?.name ?? nombreDesdeMensaje(e);
  if (nombre && MENSAJES_CONTRATO[nombre]) return MENSAJES_CONTRATO[nombre];
  if (nombre) return `El contrato rechazó la operación (${nombre}).`;

  // MetaMask numera las transacciones de cada cuenta (nonce) con su propio historial. Si se reinició el
  // nodo local, ese historial es de la cadena anterior y el nodo rechaza la transacción.
  if (/nonce too (high|low)|invalid nonce/i.test(textoCompleto(e))) {
    return "MetaMask tiene guardado el historial de una cadena anterior (¿reiniciaste el nodo?) y el nodo " +
      "rechazó la transacción. Hay que borrar la actividad de esta cuenta en MetaMask y volver a intentar.";
  }

  // Una lectura que falla sin ningún dato casi nunca es el contrato, sino la conexión con el nodo.
  if (e?.code === "CALL_EXCEPTION" && e?.action === "call" && !e?.data) {
    return "La red no respondió a la consulta. Recargá la página; si usás el nodo local, revisá que siga " +
      "corriendo y que hayas corrido el deploy.";
  }

  return e?.shortMessage ?? e?.message ?? "Ocurrió un error inesperado.";
}

/** Algunos nodos (como el de Hardhat) devuelven el error del contrato solo como texto. */
function nombreDesdeMensaje(e) {
  return textoCompleto(e).match(/custom error '(\w+)\(/)?.[1] ?? null;
}

/** Junta los mensajes que ethers y MetaMask anidan en distintos lugares del error. */
function textoCompleto(e) {
  return `${e?.message ?? ""} ${e?.info?.error?.message ?? ""} ${e?.error?.message ?? ""} ${e?.data?.message ?? ""}`;
}
