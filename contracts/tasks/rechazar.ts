import { comoTask, conectarCredenciales } from "../scripts/lib/credenciales.js";

interface Args {
  solicitud: number;
  motivo: string;
}

export default comoTask<Args>(async (args, hre) => {
  const { credenciales } = await conectarCredenciales(hre);
  if (args.solicitud <= 0) throw new Error("Falta --solicitud (el número de solicitud)");
  if (!args.motivo) throw new Error('Falta --motivo (por ejemplo: --motivo "El CUIT no figura en AFIP")');

  const tx = await credenciales.rechazarSolicitud(args.solicitud, args.motivo);
  await tx.wait();
  console.log(`Solicitud #${args.solicitud} rechazada. Transacción: ${tx.hash}`);
});
