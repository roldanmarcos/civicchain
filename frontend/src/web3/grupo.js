// Réplica del grupo de proveedores habilitados (Semaphore), armada con los eventos del contrato.
// Hace falta para generar las pruebas de pertenencia y para sacar a un proveedor del grupo.

import { Group, generateProof } from "@semaphore-protocol/core";
import { consultarEventos } from "../shared/eventos.js";
import { contratosDeLectura } from "./sesion.js";

/** Reconstruye el grupo tal como está ahora en la cadena. */
export async function grupoDeProveedores() {
  const { credenciales, semaphore, desde } = await contratosDeLectura();
  const grupoId = await credenciales.grupoProveedores();
  const f = semaphore.filters;
  const listas = await Promise.all([
    consultarEventos(semaphore, f.MemberAdded(grupoId), desde),
    consultarEventos(semaphore, f.MembersAdded(grupoId), desde),
    consultarEventos(semaphore, f.MemberUpdated(grupoId), desde),
    consultarEventos(semaphore, f.MemberRemoved(grupoId), desde),
  ]);
  const eventos = listas.flat().sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

  const grupo = new Group();
  for (const e of eventos) {
    const nombre = e.fragment.name;
    if (nombre === "MemberAdded") grupo.addMember(e.args.identityCommitment);
    else if (nombre === "MembersAdded") grupo.addMembers([...e.args.identityCommitments]);
    else if (nombre === "MemberUpdated") grupo.updateMember(Number(e.args.index), e.args.newIdentityCommitment);
    else grupo.removeMember(Number(e.args.index));
  }

  // Control: la raíz armada tiene que ser la del contrato.
  const raiz = await semaphore.getMerkleTreeRoot(grupoId);
  if (grupo.size > 0 && grupo.root !== raiz) throw new Error("No se pudo reconstruir el grupo de proveedores (la raíz no coincide).");
  return grupo;
}

/** Siblings de la prueba de Merkle de un compromiso (para revocarProveedor y quitarVencidoDelGrupo). */
export async function siblingsDe(commitment) {
  const grupo = await grupoDeProveedores();
  const indice = grupo.indexOf(commitment);
  if (indice < 0) throw new Error("El proveedor no está en el grupo.");
  return grupo.generateMerkleProof(indice).siblings;
}

/**
 * Prueba de que la identidad está en el grupo, atada a `mensaje` y `scope` (la licitación).
 * Los archivos del circuito (.wasm/.zkey) los descarga la librería la primera vez desde el CDN de
 * Semaphore. DUDA: para no depender de ese CDN se podrían servir desde el backend.
 */
export async function probarPertenencia(identidad, mensaje, scope) {
  const grupo = await grupoDeProveedores();
  if (grupo.indexOf(identidad.commitment) < 0) {
    throw new Error("Tu identidad anónima no está en el grupo de proveedores habilitados.");
  }
  const p = await generateProof(identidad, grupo, mensaje, scope, Math.max(grupo.depth, 1));
  return {
    merkleTreeDepth: String(p.merkleTreeDepth),
    merkleTreeRoot: String(p.merkleTreeRoot),
    nullifier: String(p.nullifier),
    message: String(p.message),
    scope: String(p.scope),
    points: p.points.map(String),
  };
}
