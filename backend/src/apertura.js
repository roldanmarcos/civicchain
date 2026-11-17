// Bot de apertura automática.
//
// Cada tanto busca licitaciones en ventana de apertura, descifra las ofertas cerradas (la clave de
// drand ya es pública) y publica los valores con `abrirOferta`. No es imprescindible: cualquier
// ciudadano puede hacer lo mismo desde la dApp. Así la apertura no depende de las empresas.
//
// Las fases se calculan con la hora real y no con el último bloque: en la red local los bloques solo
// se crean cuando hay transacciones, y el timestamp del último puede quedar atrasado.

import { ethers } from "ethers";
import { descifrarOferta as descifrarConDrand } from "./timelock.js";
import { explicarRevert } from "./relayer.js";

export function crearBotApertura({ cadena, log = console, descifrar = descifrarConDrand, ahora = () => Math.floor(Date.now() / 1000) }) {
  /** Ofertas que no se pudieron abrir y no vale la pena reintentar (cifrado inválido). */
  const descartadas = new Set();

  async function cifradoDe(licitaciones, licitacionId, ofertaId, desdeBloque) {
    const eventos = await licitaciones.queryFilter(licitaciones.filters.OfertaRecibida(licitacionId, ofertaId), desdeBloque);
    return eventos[0] ? ethers.toUtf8String(eventos[0].args.cifrado) : null;
  }

  async function revisar() {
    const { licitaciones, desdeBloque } = await cadena.conectar();
    const total = Number(await licitaciones.totalLicitaciones());
    let abiertas = 0;
    for (let id = 1; id <= total; id++) {
      const l = await licitaciones.licitacion(id);
      const t = ahora();
      if (l.desierta || l.ofertaGanadora !== 0n || t <= Number(l.cierreOfertas) || t > Number(l.finApertura)) continue;

      const cantidad = Number(await licitaciones.cantidadOfertas(id));
      for (let ofertaId = 1; ofertaId <= cantidad; ofertaId++) {
        const clave = `${id}/${ofertaId}`;
        if (descartadas.has(clave) || (await licitaciones.oferta(id, ofertaId)).abierta) continue;
        const cifrado = await cifradoDe(licitaciones, id, ofertaId, desdeBloque);
        if (!cifrado) continue;

        let o;
        try {
          o = await descifrar(cifrado);
        } catch (error) {
          // Si la ronda todavía no salió (reloj adelantado) se reintenta; si el contenido es basura, no.
          if (/too early|not yet|future/i.test(String(error?.message))) continue;
          log.warn?.(`Oferta ${clave}: no se pudo descifrar (${error?.message}). Queda descartada.`);
          descartadas.add(clave);
          continue;
        }
        try {
          await (await licitaciones.abrirOferta(id, ofertaId, o.monto, o.plazoDias, o.desglose, o.sal)).wait();
          abiertas++;
          log.info?.(`Oferta ${clave} abierta: $ ${o.monto}`);
        } catch (error) {
          log.warn?.(`Oferta ${clave}: ${explicarRevert(error, licitaciones)}`);
          descartadas.add(clave);
        }
      }
    }
    return abiertas;
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
          log.debug?.(`Bot de apertura: ${error?.shortMessage ?? error?.message}`);
        }
        temporizador = setTimeout(ciclo, intervaloMs);
      };
      temporizador = setTimeout(ciclo, 1000);
    },
    detener: () => clearTimeout(temporizador),
  };
}
