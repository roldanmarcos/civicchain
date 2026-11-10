// Cliente de la AFIP simulada para la dApp.
// Uso: import { afip } from "./services/afip";  →  await afip.verificarSolicitud({ cuit, razonSocial })

import padron from "./padron.json";
import { crearClienteAfip } from "./afip.js";

export { RESULTADOS, cuitValido, denominacion } from "./afip.js";

/** La demora hace que en la dApp se vea el estado "consultando AFIP...", como con un servicio real. */
export const afip = crearClienteAfip(padron, { demoraMs: 600 });
