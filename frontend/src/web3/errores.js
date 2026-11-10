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
