// Reglas del protocolo que tienen que coincidir exactamente con los contratos.
// Lo usan la dApp, el backend y los tests de los contratos, así hay una sola definición.
//
// No importa paquetes: recibe `ethers` por parámetro, así funciona igual en Vite y en Node sin
// depender de dónde esté instalado.
//
//   import * as ethers from "ethers";
//   import { crearProtocolo } from "./shared/protocolo.js";
//   const protocolo = crearProtocolo(ethers);

/** Deben coincidir con el orden de los enums de los contratos. */
export const ROLES = ["PROVEEDOR", "EMPLEADO", "INSPECTOR"];
export const ESTADOS_LICITACION = [
  "RECIBIENDO_OFERTAS",
  "APERTURA",
  "EVALUACION",
  "ADJUDICADA",
  "EN_EJECUCION",
  "FINALIZADA",
  "DESIERTA",
];

/** Dominio EIP-712 de CredencialNFT (falta chainId y verifyingContract, que dependen de la red). */
export const DOMINIO_CREDENCIALES = { name: "CivicChain Credenciales", version: "1" };

export const TIPOS_INSCRIPCION = {
  Inscripcion: [
    { name: "wallet", type: "address" },
    { name: "cuit", type: "uint64" },
    { name: "razonSocial", type: "string" },
    { name: "datosHash", type: "bytes32" },
    { name: "identityCommitment", type: "uint256" },
    { name: "validaHasta", type: "uint64" },
    { name: "venceFirma", type: "uint64" },
  ],
};

/**
 * Mensaje que firma el proveedor con su wallet para derivar su identidad de Semaphore.
 * Firmar siempre lo mismo da siempre la misma identidad: no hay que guardar ningún secreto.
 * La firma nunca sale del navegador (solo se publica el compromiso, que no se puede vincular a la wallet).
 */
export const MENSAJE_IDENTIDAD =
  "CivicChain\n\nGenerar mi identidad anónima de proveedor (v1).\n\nNo compartas esta firma con nadie: quien la tenga puede ofertar en tu nombre.";

/** Mensaje que firma el proveedor para derivar la sal de autoría de una licitación (sal2 del RFC). */
export const mensajeAutoria = (licitacionId) =>
  `CivicChain\n\nSal de autoría para la licitación #${licitacionId} (v1).\n\nNo compartas esta firma con nadie.`;

/** JSON con las claves ordenadas, para que los mismos datos den siempre el mismo hash. */
export function jsonCanonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  if (valor && typeof valor === "object") {
    const claves = Object.keys(valor)
      .filter((k) => valor[k] !== undefined)
      .sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(valor[k])}`).join(",")}}`;
  }
  if (typeof valor === "bigint") return JSON.stringify(valor.toString());
  return JSON.stringify(valor);
}

/** @param {typeof import("ethers")} ethers */
export function crearProtocolo(ethers) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const { keccak256, toUtf8Bytes } = ethers;

  return {
    /** Sal aleatoria de 32 bytes, en hex. */
    nuevaSal: () => ethers.hexlify(ethers.randomBytes(32)),

    /**
     * Hash de los datos que quedan fuera de la cadena. Se agrega la sal a los datos antes de
     * serializarlos: sin sal, datos con pocas combinaciones (un DNI) se podrían adivinar probando.
     */
    datosHash: (datos, sal) => keccak256(toUtf8Bytes(jsonCanonico({ ...datos, sal }))),

    compromisoMonto: (licitacionId, monto, plazoDias, desglose, sal) =>
      keccak256(
        abi.encode(["uint256", "uint256", "uint32", "uint256[]", "bytes32"], [licitacionId, monto, plazoDias, desglose, sal]),
      ),

    compromisoAutoria: (licitacionId, wallet, sal) =>
      keccak256(abi.encode(["uint256", "address", "bytes32"], [licitacionId, wallet, sal])),

    /** Igual que Licitaciones.mensajeOferta. */
    mensajeOferta: (licitacionId, cifradoHash, compromisoMonto, compromisoAutoria, propuestaCID) =>
      BigInt(
        keccak256(
          abi.encode(
            ["uint256", "bytes32", "bytes32", "bytes32", "string"],
            [licitacionId, cifradoHash, compromisoMonto, compromisoAutoria, propuestaCID],
          ),
        ),
      ),

    /** Sal de autoría a partir de la firma de `mensajeAutoria(licitacionId)`. */
    salDesdeFirma: (firma) => keccak256(firma),

    dominioCredenciales: (chainId, verifyingContract) => ({ ...DOMINIO_CREDENCIALES, chainId, verifyingContract }),
  };
}
