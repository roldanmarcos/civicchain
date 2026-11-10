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
  SolicitudPendienteExistente: "Ya tenés una solicitud pendiente.",
  SolicitudNoPendiente: "La solicitud ya fue resuelta.",
  SolicitudInexistente: "La solicitud no existe.",
  NoEsTuSolicitud: "Solo podés cancelar tus propias solicitudes.",
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

  return e?.shortMessage ?? e?.message ?? "Ocurrió un error inesperado.";
}

/** Algunos nodos (como el de Hardhat) devuelven el error del contrato solo como texto. */
function nombreDesdeMensaje(e) {
  const texto = `${e?.message ?? ""} ${e?.info?.error?.message ?? ""} ${e?.error?.message ?? ""}`;
  return texto.match(/custom error '(\w+)\(/)?.[1] ?? null;
}
