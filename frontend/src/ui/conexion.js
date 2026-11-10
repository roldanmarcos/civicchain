// Bloque común que se muestra cuando la wallet no está lista para operar.
// Los botones usan data-accion="conectar" / "cambiar-red", que maneja main.js.

import { NETWORKS } from "../config/contracts.js";
import { redObjetivo } from "../web3/sesion.js";
import { html } from "./dom.js";

/**
 * @param {import("../web3/sesion.js").Sesion} sesion
 * @returns {ReturnType<typeof html> | null} null si la wallet está conectada a la red correcta.
 */
export function bloqueConexion(sesion) {
  const red = NETWORKS[redObjetivo()]?.name ?? "la red del proyecto";

  switch (sesion.estado) {
    case "CONECTADO":
      return null;
    case "CARGANDO":
      return html`<div class="alerta">Conectando con la wallet…</div>`;
    case "SIN_METAMASK":
      return html`<div class="alerta alerta-aviso">
        <strong>Necesitás MetaMask</strong>
        <p>Instalá la extensión de MetaMask en tu navegador para participar.
          <a href="https://metamask.io/download/" target="_blank" rel="noopener">Descargar MetaMask ↗</a></p>
      </div>`;
    case "DESCONECTADO":
      return html`<div class="alerta">
        <strong>Conectá tu wallet</strong>
        <p>Tu wallet es tu identidad en CivicChain: no hay usuario ni contraseña.</p>
        <button class="button button-primary button-small" data-accion="conectar">◈ Conectar con MetaMask</button>
      </div>`;
    case "RED_INCORRECTA":
      return html`<div class="alerta alerta-aviso">
        <strong>Red incorrecta</strong>
        <p>CivicChain funciona en ${red}. Cambiá de red en MetaMask para continuar.</p>
        <button class="button button-primary button-small" data-accion="cambiar-red">Cambiar a ${red}</button>
      </div>`;
    case "SIN_CONTRATO":
      return html`<div class="alerta alerta-error">
        <strong>El contrato no está desplegado en esta red</strong>
        <p>Si estás usando el nodo local, puede que se haya reiniciado. Corré
          <code>npx hardhat run scripts/deploy.ts --network localhost</code> y recargá la página.</p>
      </div>`;
    default:
      return null;
  }
}
