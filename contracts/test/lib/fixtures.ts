// Utilidades compartidas por los tests: despliegue, firma del verificador y pruebas de Semaphore.

import { createRequire } from "node:module";
import { dirname } from "node:path";
import * as ethersLib from "ethers";
import { Group, Identity, generateProof } from "@semaphore-protocol/core";
import { desplegarSemaphore } from "../../scripts/lib/semaphore.js";
import { TIPOS_INSCRIPCION, crearProtocolo } from "../../../frontend/src/shared/protocolo.js";

export const protocolo = crearProtocolo(ethersLib);

export const Rol = { PROVEEDOR: 0, EMPLEADO: 1, INSPECTOR: 2 } as const;
export const DIA = 24 * 60 * 60;
export const VIGENCIA = 90 * DIA;
export const QUILMES = 1;
export const BERAZATEGUI = 2;

// CUITs con dígito verificador correcto
export const CUIT_SUR = 30712345671n;
export const CUIT_NORTE = 30709876542n;
export const CUIT_DV_INCORRECTO = 30712345678n;

// Los .wasm/.zkey del circuito vienen en el paquete @zk-kit/semaphore-artifacts (sin internet).
const ARTEFACTOS = dirname(createRequire(import.meta.url).resolve("@zk-kit/semaphore-artifacts/package.json"));

type Ethers = Awaited<ReturnType<typeof import("hardhat").network.create>>["ethers"];
type Firmante = Awaited<ReturnType<Ethers["getSigners"]>>[number];

/** Despliega Semaphore y CredencialNFT, con `admin` como admin y `verificador` con VERIFICADOR_ROLE. */
export async function desplegarCredenciales(ethers: Ethers) {
  const [admin, verificador, empleado, inspector, proveedor, otro, proveedor2, empleadoOtro] = await ethers.getSigners();
  const semaphoreAddress = await desplegarSemaphore(ethers);
  const semaphore = await ethers.getContractAt("Semaphore", semaphoreAddress);
  const credenciales = await ethers.deployContract("CredencialNFT", [admin.address, semaphoreAddress]);
  await credenciales.grantRole(await credenciales.VERIFICADOR_ROLE(), verificador.address);
  const grupoId = await credenciales.grupoProveedores();
  const ahora = (await ethers.provider.getBlock("latest"))!.timestamp;
  const vence = BigInt(ahora + VIGENCIA);
  return { credenciales, semaphore, grupoId, admin, verificador, empleado, inspector, proveedor, otro, proveedor2, empleadoOtro, vence };
}

export interface DatosInscripcion {
  cuit: bigint;
  razonSocial: string;
  datosHash: string;
  identityCommitment: bigint;
  validaHasta: bigint;
  venceFirma: bigint;
}

/** Arma una inscripción y la firma como lo haría el backend. */
export async function autorizarInscripcion(
  ethers: Ethers,
  credenciales: { getAddress(): Promise<string> },
  verificador: Firmante,
  wallet: string,
  datos: Partial<DatosInscripcion> & { identityCommitment: bigint },
) {
  const ahora = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const completo: DatosInscripcion = {
    cuit: CUIT_SUR,
    razonSocial: "Construcciones del Sur S.A.",
    datosHash: protocolo.datosHash({ cuit: "30712345671", domicilioLegal: "Av. Calchaquí 123" }, protocolo.nuevaSal()),
    validaHasta: ahora + BigInt(VIGENCIA),
    venceFirma: ahora + 3600n,
    ...datos,
  };
  const { chainId } = await ethers.provider.getNetwork();
  const dominio = protocolo.dominioCredenciales(chainId, await credenciales.getAddress());
  const firma = await verificador.signTypedData(dominio, TIPOS_INSCRIPCION, { wallet, ...completo });
  return { datos: completo, firma };
}

/** Réplica local del grupo de proveedores (en la dApp se arma con los eventos de Semaphore). */
export class GrupoLocal {
  grupo = new Group();
  agregar(commitment: bigint) {
    this.grupo.addMember(commitment);
  }
  /** Siblings para sacar a `commitment` del grupo, y lo saca de la réplica. */
  quitar(commitment: bigint): bigint[] {
    const indice = this.grupo.indexOf(commitment);
    const { siblings } = this.grupo.generateMerkleProof(indice);
    this.grupo.removeMember(indice);
    return siblings;
  }
}

/** Identidad determinística para los tests (en la dApp sale de una firma de la wallet). */
export const identidad = (semilla: string) => new Identity(semilla);

/** Genera una prueba de Semaphore lista para pasarle al contrato. */
export async function probar(id: Identity, grupo: Group, mensaje: bigint, scope: bigint) {
  const profundidad = Math.max(grupo.depth, 1);
  const p = await generateProof(id, grupo, mensaje, scope, profundidad, {
    wasm: `${ARTEFACTOS}/semaphore-${profundidad}.wasm`,
    zkey: `${ARTEFACTOS}/semaphore-${profundidad}.zkey`,
  });
  return {
    merkleTreeDepth: BigInt(p.merkleTreeDepth),
    merkleTreeRoot: BigInt(p.merkleTreeRoot),
    nullifier: BigInt(p.nullifier),
    message: BigInt(p.message),
    scope: BigInt(p.scope),
    points: p.points.map((x) => BigInt(x)),
  };
}
