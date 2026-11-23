// Bot de revelación de identidades.
//
// Cuando vence la fecha límite de adjudicación de una licitación, drand publica la clave de esa ronda y
// cualquiera puede descifrar quién está detrás de cada oferta. Este bot lo hace solo y publica todas las
// identidades juntas con `revelarIdentidades`. No es imprescindible: cualquier ciudadano puede hacer lo
// mismo desde la dApp. Así el ganador no tiene que hacer nada para que se lo conozca.
//
// La apertura de los montos ya NO la hace el bot: la hace el organismo, todos los sobres juntos, en el
// momento de evaluar (ver Licitaciones.abrirSobres).
//
// Las fechas se comparan con la hora más adelantada entre el reloj real y el último bloque: en la red
// local los bloques solo se crean con transacciones (y en las pruebas el reloj de la cadena se adelanta).

import { ethers } from "ethers";
import { consultarEventos } from "../../frontend/src/shared/eventos.js";
import { descifrarIdentidad as descifrarConDrand } from "./timelock.js";
import { explicarRevert } from "./relayer.js";

export function crearBotIdentidades({ cadena, log = console, descifrar = descifrarConDrand, ahora = () => Math.floor(Date.now() / 1000) }) {
  /** Identidades que no se pudieron descifrar y no vale la pena reintentar (cifrado inválido). */
  const descartadas = new Set();

  async function revisar() {
    const { licitaciones, desdeBloque, provider } = await cadena.conectar();
    const bloque = provider ? await provider.getBlock("latest") : null;
    const t = Math.max(ahora(), bloque?.timestamp ?? 0);
    const total = Number(await licitaciones.totalLicitaciones());
    let reveladas = 0;
    for (let id = 1; id <= total; id++) {
      const l = await licitaciones.licitacion(id);
      if (t <= Number(l.limiteAdjudicacion)) continue;
      const cantidad = Number(await licitaciones.cantidadOfertas(id));
      if (cantidad === 0) continue;

      const pendientes = [];
      for (let ofertaId = 1; ofertaId <= cantidad; ofertaId++) {
        const clave = `${id}/${ofertaId}`;
        if (descartadas.has(clave)) continue;
        if ((await licitaciones.oferta(id, ofertaId)).autor !== ethers.ZeroAddress) continue;
        const [evento] = await consultarEventos(licitaciones, licitaciones.filters.OfertaRecibida(id, ofertaId), desdeBloque);
        if (!evento) continue;
        try {
          const { wallet, sal } = await descifrar(ethers.toUtf8String(evento.args.cifradoIdentidad));
          pendientes.push({ ofertaId, wallet, sal });
        } catch (error) {
          // Si la ronda todavía no salió (reloj adelantado) se reintenta; si el contenido es basura, no.
          if (/too early|not yet|future/i.test(String(error?.message))) continue;
          log.warn?.(`Identidad de la oferta ${clave}: no se pudo descifrar (${error?.message}). Queda sin autor.`);
          descartadas.add(clave);
        }
      }
      if (pendientes.length === 0) continue;
      try {
        await (await licitaciones.revelarIdentidades(id, pendientes)).wait();
        reveladas += pendientes.length;
        log.info?.(`Licitación ${id}: ${pendientes.length} identidad(es) reveladas.`);
      } catch (error) {
        // Si alguna no coincide con su compromiso, el contrato rechaza todo el lote: se reintenta de a una.
        for (const p of pendientes) {
          try {
            await (await licitaciones.revelarIdentidades(id, [p])).wait();
            reveladas++;
          } catch (e) {
            log.warn?.(`Identidad de la oferta ${id}/${p.ofertaId}: ${explicarRevert(e, licitaciones)}`);
            descartadas.add(`${id}/${p.ofertaId}`);
          }
        }
        void error;
      }
    }
    return reveladas;
  }

  let temporizador = null;
  return {
    revisar,
    iniciar(intervaloMs) {
      if (!intervaloMs) return;
      const ciclo = async () => {
        try {
          await revisar();
        } catch (error) {
          log.debug?.(`Bot de identidades: ${error?.shortMessage ?? error?.message}`);
        }
        temporizador = setTimeout(ciclo, intervaloMs);
      };
      temporizador = setTimeout(ciclo, 1000);
    },
    detener: () => clearTimeout(temporizador),
  };
}
