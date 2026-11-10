import { CHAIN_ID_LOCAL, comoTask, conectarCredenciales, parseCuit } from "../scripts/lib/credenciales.js";

interface Args {
  cuenta: number;
  cuit: string;
  razonSocial: string;
  domicilio: string;
  rubros: string;
}

/**
 * Simula la inscripción de un proveedor desde la consola (solo red local).
 * En la dApp esto lo hace el proveedor desde el formulario, con su propia wallet.
 */
export default comoTask<Args>(async (args, hre) => {
  const { chainId, credenciales, firmante } = await conectarCredenciales(hre, args.cuenta);
  if (chainId !== CHAIN_ID_LOCAL) {
    throw new Error("Esta task es solo para la red local. En Sepolia los proveedores se inscriben desde la dApp.");
  }
  if (!args.razonSocial || !args.domicilio || !args.rubros) {
    throw new Error("Faltan datos: --razon-social, --domicilio y --rubros son obligatorios.");
  }

  const cuit = parseCuit(args.cuit);
  const tx = await credenciales.solicitarInscripcion(cuit, args.razonSocial, args.domicilio, args.rubros);
  await tx.wait();
  const id = await credenciales.solicitudPendienteDe(firmante.address);
  console.log(`Solicitud #${id} creada desde la cuenta #${args.cuenta} (${firmante.address}). Transacción: ${tx.hash}`);
});
