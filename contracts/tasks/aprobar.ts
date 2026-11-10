import { comoTask, conectarCredenciales, formatearCuit, formatearFecha, venceEnDias } from "../scripts/lib/credenciales.js";

interface Args {
  solicitud: number;
  dias: number;
}

export default comoTask<Args>(async (args, hre) => {
  const { ethers, credenciales } = await conectarCredenciales(hre);
  if (args.solicitud <= 0) throw new Error("Falta --solicitud (el número de solicitud)");

  const s = await credenciales.solicitud(args.solicitud);
  const validaHasta = await venceEnDias(ethers, args.dias);

  // TODO (Fase 3): consultar el CUIT en la AFIP simulada antes de aprobar.
  console.log(`Aprobando solicitud #${args.solicitud}: ${s.razonSocial} (CUIT ${formatearCuit(s.cuit)})`);

  const tx = await credenciales.aprobarSolicitud(args.solicitud, validaHasta);
  await tx.wait();
  const [tokenId] = await credenciales.credencialDe(s.wallet);
  console.log(`Credencial #${tokenId} emitida a ${s.wallet}, vence ${formatearFecha(validaHasta)}. Transacción: ${tx.hash}`);
});
