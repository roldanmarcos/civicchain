// Cliente del padrón de empleados simulado para la dApp.
// Uso: import { padronEmpleados } from "./services/padron-empleados";

import registros from "./padron.json";
import { crearClientePadron } from "./padron.js";

export { HALLAZGOS, RESULTADOS_ALTA } from "./padron.js";

export const padronEmpleados = crearClientePadron(registros, { demoraMs: 400 });
