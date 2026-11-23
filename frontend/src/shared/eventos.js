// Consulta de eventos en tramos de bloques. La usan la dApp y el backend.
//
// Los RPC públicos limitan el rango de eth_getLogs (publicnode en Sepolia: 50.000 bloques, una
// semana). Consultar desde el bloque del despliegue hasta "latest" deja de funcionar cuando el
// contrato tiene más que eso, así que se parte la consulta en tramos.

/** Tramo por defecto: por debajo del límite de publicnode (50.000) con margen. */
export const TRAMO_BLOQUES = 45_000;

/**
 * Igual que `contrato.queryFilter(filtro, desde)`, pero en tramos de a lo sumo `tramo` bloques.
 * @param {{ queryFilter: Function, runner?: any }} contrato contrato de ethers v6
 * @param {any} filtro
 * @param {number} desde bloque inicial (el del despliegue)
 */
export async function consultarEventos(contrato, filtro, desde = 0, tramo = TRAMO_BLOQUES) {
  const provider = contrato.runner?.provider ?? contrato.runner;
  // Sin provider (por ejemplo, un contrato simulado en los tests) se consulta de una sola vez.
  if (typeof provider?.getBlockNumber !== "function") return contrato.queryFilter(filtro, desde);
  const hasta = await provider.getBlockNumber();
  if (hasta - desde < tramo) return contrato.queryFilter(filtro, desde, hasta);
  const eventos = [];
  for (let inicio = desde; inicio <= hasta; inicio += tramo) {
    eventos.push(...(await contrato.queryFilter(filtro, inicio, Math.min(inicio + tramo - 1, hasta))));
  }
  return eventos;
}
