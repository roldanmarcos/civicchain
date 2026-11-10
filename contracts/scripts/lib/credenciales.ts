import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { crearClienteAfip, cuitValido } from "../../../frontend/src/services/afip/afip.js";
import { crearClientePadron } from "../../../frontend/src/services/padron-empleados/padron.js";

// ---------------------------------------------------------------------------
// Constantes compartidas con el frontend
// ---------------------------------------------------------------------------

export const VIGENCIA_POR_DEFECTO_DIAS = 90;
export const DIA = 24 * 60 * 60;
export const CHAIN_ID_LOCAL = 31337;

/** Deben coincidir con el orden de los enums del contrato. */
export const ROLES = ["PROVEEDOR", "EMPLEADO", "INSPECTOR"] as const;
export const ESTADOS_SOLICITUD = ["PENDIENTE", "APROBADA", "RECHAZADA", "CANCELADA"] as const;

// ---------------------------------------------------------------------------
// CUIT
// ---------------------------------------------------------------------------

/** "30-71234567-1" → 30712345671n. Valida el dígito verificador. */
export function parseCuit(texto: string): bigint {
  const digitos = texto.replace(/\D/g, "");
  if (!cuitValido(digitos)) throw new Error(`CUIT inválido: "${texto}" (revisá el dígito verificador)`);
  return BigInt(digitos);
}

/** 30712345671n → "30-71234567-1" */
export function formatearCuit(cuit: bigint | number): string {
  const s = String(cuit).padStart(11, "0");
  return `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}`;
}

// ---------------------------------------------------------------------------
// Archivos del frontend
// ---------------------------------------------------------------------------

const CONFIG_FRONTEND = new URL("../../../frontend/src/config/", import.meta.url);
const DEPLOYMENTS = new URL("deployments.json", CONFIG_FRONTEND);
const ORGANISMOS = new URL("organismos.json", CONFIG_FRONTEND);
const ABIS = new URL("abis/", CONFIG_FRONTEND);

export interface Deployment {
  address: string;
  deployBlock: number;
  admins: string[];
}

type Deployments = Record<string, Record<string, Deployment>>;

async function leerDeployments(): Promise<Deployments> {
  try {
    return JSON.parse(await readFile(DEPLOYMENTS, "utf8"));
  } catch {
    return {};
  }
}

export async function guardarDeployment(chainId: number, contrato: string, datos: Deployment, abi: unknown) {
  const deployments = await leerDeployments();
  deployments[chainId] = { ...deployments[chainId], [contrato]: datos };
  await writeFile(DEPLOYMENTS, JSON.stringify(deployments, null, 2) + "\n");

  await mkdir(ABIS, { recursive: true });
  await writeFile(new URL(`${contrato}.json`, ABIS), JSON.stringify(abi, null, 2) + "\n");
}

export async function leerDeployment(chainId: number, contrato: string): Promise<Deployment> {
  const datos = (await leerDeployments())[chainId]?.[contrato];
  if (!datos) {
    throw new Error(
      `${contrato} no está desplegado en la red ${chainId}. Corré primero: npx hardhat run scripts/deploy.ts --network <red>`,
    );
  }
  return datos;
}

/** Cliente de la AFIP simulada (el mismo módulo que usa la dApp), con el padrón leído del disco. */
export async function clienteAfip() {
  const padron = JSON.parse(await readFile(new URL("../../../frontend/src/services/afip/padron.json", import.meta.url), "utf8"));
  return crearClienteAfip(padron);
}

/** Cliente del padrón de empleados simulado (el mismo módulo que usa la dApp). */
export async function clientePadron() {
  const registros = JSON.parse(
    await readFile(new URL("../../../frontend/src/services/padron-empleados/padron.json", import.meta.url), "utf8"),
  );
  return crearClientePadron(registros);
}

interface ContratoCredenciales {
  totalEmitidas(): Promise<bigint>;
  ownerOf(tokenId: bigint): Promise<string>;
  credencial(tokenId: bigint): Promise<{
    rol: bigint;
    organismoId: bigint;
    validaHasta: bigint;
    revocada: boolean;
    nombre: string;
  }>;
}

/** Lee todas las credenciales emitidas, en el formato que espera `auditar` del padrón. */
export async function leerTodasLasCredenciales(credenciales: ContratoCredenciales, ethers: ConProvider) {
  const ahora = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const total = await credenciales.totalEmitidas();
  const resultado = [];
  for (let tokenId = 1n; tokenId <= total; tokenId++) {
    const [c, wallet] = await Promise.all([credenciales.credencial(tokenId), credenciales.ownerOf(tokenId)]);
    resultado.push({
      tokenId,
      wallet,
      rol: ROLES[Number(c.rol)],
      organismoId: Number(c.organismoId),
      nombre: c.nombre,
      revocada: c.revocada,
      vencida: ahora > c.validaHasta,
    });
  }
  return resultado;
}

export async function leerOrganismos(): Promise<{ id: number; nombre: string }[]> {
  return JSON.parse(await readFile(ORGANISMOS, "utf8"));
}

/** Devuelve el nombre del organismo, o falla mostrando las opciones válidas. */
export async function validarOrganismo(organismoId: number): Promise<string> {
  const organismos = await leerOrganismos();
  const organismo = organismos.find((o) => o.id === organismoId);
  if (!organismo) {
    const lista = organismos.map((o) => `  ${o.id}: ${o.nombre}`).join("\n");
    throw new Error(`Organismo ${organismoId} inexistente. Opciones:\n${lista}`);
  }
  return organismo.nombre;
}

// ---------------------------------------------------------------------------
// Conexión al contrato desplegado
// ---------------------------------------------------------------------------

/**
 * @param cuenta Índice de la cuenta que firma (0 = la primera, que es admin).
 *               Distinto de 0 solo tiene sentido en la red local, para simular otros usuarios.
 */
export async function conectarCredenciales(hre: HardhatRuntimeEnvironment, cuenta = 0) {
  const conexion = await hre.network.create();
  const { ethers } = conexion;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const { address } = await leerDeployment(chainId, "CredencialNFT");
  const firmantes = await ethers.getSigners();
  const firmante = firmantes[cuenta];
  if (!firmante) throw new Error(`No existe la cuenta #${cuenta} en esta red.`);
  const credenciales = await ethers.getContractAt("CredencialNFT", address, firmante);
  return { ...conexion, chainId, credenciales, firmante };
}

interface ConProvider {
  provider: { getBlock(bloque: "latest"): Promise<{ timestamp: number } | null> };
}

/** Timestamp de vencimiento a `dias` días del último bloque. */
export async function venceEnDias(ethers: ConProvider, dias: number): Promise<bigint> {
  if (dias <= 0) throw new Error("--dias tiene que ser mayor a 0");
  const ahora = (await ethers.provider.getBlock("latest"))!.timestamp;
  return BigInt(ahora + dias * DIA);
}

/** Traduce los errores del contrato a algo legible. */
export function explicarError(error: unknown): string {
  const e = error as { revert?: { name: string; args: unknown[] }; shortMessage?: string; message?: string };
  if (e.revert) return `El contrato rechazó la operación: ${e.revert.name}(${e.revert.args.join(", ")})`;
  return e.shortMessage ?? e.message ?? String(error);
}

/**
 * Envuelve la acción de una task: si algo falla, muestra solo el mensaje
 * (sin el "unexpected error / report a bug" de Hardhat) y termina con código 1.
 */
export function comoTask<A>(accion: (args: A, hre: HardhatRuntimeEnvironment) => Promise<void>) {
  return async (args: A, hre: HardhatRuntimeEnvironment) => {
    try {
      await accion(args, hre);
    } catch (error) {
      console.error(explicarError(error));
      process.exitCode = 1;
    }
  };
}

export function formatearFecha(timestamp: bigint | number): string {
  return new Date(Number(timestamp) * 1000).toLocaleString("es-AR");
}
