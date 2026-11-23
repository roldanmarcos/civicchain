// Relayer: manda las ofertas anónimas desde su propia wallet y paga el gas, para que ninguna
// dirección del proveedor aparezca en la transacción.
//
// El relayer no puede cambiar una oferta (la prueba ZK está atada a su contenido) pero sí podría
// negarse a mandarla (censura). Si eso pasa, el proveedor puede mandar la misma oferta desde
// cualquier otra wallet sin fondos vinculados a él: el contrato acepta ofertas de cualquiera.
//
// DUDA: el relayer ve la IP de quien le manda la oferta. Para el TP no lo resolvemos; en producción
// podría ponerse detrás de Tor o de un servicio que no guarde registros.

import { ErrorDeDatos } from "./inscripciones.js";

const esHex = (v, bytes) => typeof v === "string" && new RegExp(`^0x[0-9a-fA-F]{${bytes ? bytes * 2 : "2,"}}$`).test(v);

function validarOferta(body) {
  const p = body?.prueba;
  if (!/^\d+$/.test(String(body?.licitacionId ?? ""))) throw new ErrorDeDatos("Falta la licitación.");
  if (!esHex(body.cifrado) || !esHex(body.cifradoIdentidad)) throw new ErrorDeDatos("Los cifrados no son válidos.");
  if (body.cifrado.length > 2 + 2 * 8192 || body.cifradoIdentidad.length > 2 + 2 * 8192) throw new ErrorDeDatos("El cifrado es demasiado grande.");
  if (!esHex(body.compromisoMonto, 32) || !esHex(body.compromisoAutoria, 32)) throw new ErrorDeDatos("Compromisos inválidos.");
  if (typeof body.propuestaCID !== "string" || body.propuestaCID.length > 200) throw new ErrorDeDatos("CID inválido.");
  if (!p || !Array.isArray(p.points) || p.points.length !== 8) throw new ErrorDeDatos("La prueba no es válida.");
  try {
    return {
      licitacionId: BigInt(body.licitacionId),
      cifrado: body.cifrado,
      cifradoIdentidad: body.cifradoIdentidad,
      compromisoMonto: body.compromisoMonto,
      compromisoAutoria: body.compromisoAutoria,
      propuestaCID: body.propuestaCID,
      prueba: {
        merkleTreeDepth: BigInt(p.merkleTreeDepth),
        merkleTreeRoot: BigInt(p.merkleTreeRoot),
        nullifier: BigInt(p.nullifier),
        message: BigInt(p.message),
        scope: BigInt(p.scope),
        points: p.points.map(BigInt),
      },
    };
  } catch {
    throw new ErrorDeDatos("La prueba no es válida.");
  }
}

/** Traduce un revert del contrato a un mensaje para el usuario. */
export function explicarRevert(error, contrato) {
  const data = error?.data ?? error?.info?.error?.data ?? error?.error?.data;
  if (data && contrato) {
    try {
      const e = contrato.interface.parseError(data);
      if (e) return MENSAJES[e.name] ?? `El contrato rechazó la oferta (${e.name}).`;
    } catch {
      /* no es un error del contrato */
    }
  }
  if (error?.revert?.name) return MENSAJES[error.revert.name] ?? `El contrato rechazó la oferta (${error.revert.name}).`;
  return error?.shortMessage ?? error?.message ?? String(error);
}

const MENSAJES = {
  FueraDePlazo: "La licitación ya no recibe ofertas.",
  OfertaDuplicada: "Tu empresa ya ofertó en esta licitación.",
  PruebaInvalida: "La prueba de que estás habilitado no es válida.",
  MensajeIncorrecto: "La prueba no corresponde a esta oferta.",
  ScopeIncorrecto: "La prueba es de otra licitación.",
  DemasiadasOfertas: "La licitación alcanzó el máximo de ofertas.",
  Semaphore__MerkleTreeRootIsNotPartOfTheGroup: "Tu identidad no está en el grupo de proveedores habilitados.",
  Semaphore__MerkleTreeRootIsExpired: "La prueba se armó con una versión vieja del grupo. Volvé a intentar.",
};

export function crearRelayer({ cadena }) {
  return {
    direccion: () => cadena.relayer.getAddress(),

    async enviarOferta(body) {
      const o = validarOferta(body);
      const { licitaciones, relayer } = await cadena.conectar();
      const { licitacionId, prueba, ...oferta } = o;
      const args = [licitacionId, oferta, prueba];
      try {
        // Primero se simula: si va a fallar, no se gasta gas y el error es más claro.
        await licitaciones.ofertar.staticCall(...args);
        const tx = await licitaciones.ofertar(...args);
        const recibo = await tx.wait();
        const evento = recibo.logs.map((l) => licitaciones.interface.parseLog(l)).find((e) => e?.name === "OfertaRecibida");
        return { txHash: tx.hash, ofertaId: String(evento?.args.ofertaId ?? "") };
      } catch (error) {
        relayer.reset(); // por si la transacción no salió y el nonce quedó adelantado
        throw new ErrorDeDatos(explicarRevert(error, licitaciones));
      }
    },
  };
}
