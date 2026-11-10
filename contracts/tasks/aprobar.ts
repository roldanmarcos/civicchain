import {
  clienteAfip,
  comoTask,
  conectarCredenciales,
  formatearCuit,
  formatearFecha,
  venceEnDias,
} from "../scripts/lib/credenciales.js";

interface Args {
  solicitud: number;
  dias: number;
  forzar: boolean;
}

export default comoTask<Args>(async (args, hre) => {
  const { ethers, credenciales } = await conectarCredenciales(hre);
  if (args.solicitud <= 0) throw new Error("Falta --solicitud (el número de solicitud)");

  const s = await credenciales.solicitud(args.solicitud);
  console.log(`Solicitud #${args.solicitud}: ${s.razonSocial} (CUIT ${formatearCuit(s.cuit)})`);

  const afip = await clienteAfip();
  const verificacion = await afip.verificarSolicitud({ cuit: s.cuit.toString(), razonSocial: s.razonSocial });
  console.log(`  AFIP: ${verificacion.ok ? "✓" : "✗"} ${verificacion.mensaje}`);

  if (!verificacion.ok && !args.forzar) {
    throw new Error(
      "No se aprueba porque la verificación en AFIP falló. Rechazala con `credencial rechazar`, " +
        "o usá --forzar si revisaste el caso a mano.",
    );
  }

  const validaHasta = await venceEnDias(ethers, args.dias);
  const tx = await credenciales.aprobarSolicitud(args.solicitud, validaHasta);
  await tx.wait();
  const [tokenId] = await credenciales.credencialDe(s.wallet);
  console.log(`Credencial #${tokenId} emitida a ${s.wallet}, vence ${formatearFecha(validaHasta)}. Transacción: ${tx.hash}`);
});
