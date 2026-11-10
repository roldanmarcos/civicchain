import {
  ROLES,
  comoTask,
  conectarCredenciales,
  formatearCuit,
  formatearFecha,
  leerOrganismos,
} from "../scripts/lib/credenciales.js";

interface Args {
  wallet: string;
}

export default comoTask<Args>(async (args, hre) => {
  const { ethers, credenciales } = await conectarCredenciales(hre);

  if (!ethers.isAddress(args.wallet)) throw new Error(`Wallet inválida: "${args.wallet}"`);

  const esAdmin = await credenciales.hasRole(await credenciales.ADMIN_ROLE(), args.wallet);
  const [tokenId, c] = await credenciales.credencialDe(args.wallet);
  const solicitudPendiente = await credenciales.solicitudPendienteDe(args.wallet);

  console.log(`Wallet: ${args.wallet}`);
  console.log(`Admin:  ${esAdmin ? "sí" : "no"}`);
  if (solicitudPendiente !== 0n) console.log(`Solicitud de inscripción pendiente: #${solicitudPendiente}`);

  if (tokenId === 0n) {
    console.log("Credencial: ninguna");
    return;
  }

  const ahora = (await ethers.provider.getBlock("latest"))!.timestamp;
  const estado = c.revocada ? "REVOCADA" : BigInt(ahora) > c.validaHasta ? "VENCIDA" : "VIGENTE";
  const rol = ROLES[Number(c.rol)];

  console.log(`Credencial #${tokenId}: ${estado}`);
  console.log(`  Rol:       ${rol}`);
  if (rol === "PROVEEDOR") {
    console.log(`  Empresa:   ${c.nombre}`);
    console.log(`  CUIT:      ${formatearCuit(c.cuit)}`);
  } else {
    const organismo = (await leerOrganismos()).find((o) => o.id === Number(c.organismoId))?.nombre ?? "—";
    console.log(`  Nombre:    ${c.nombre}`);
    console.log(`  Organismo: ${organismo}`);
  }
  console.log(`  Emitida:   ${formatearFecha(c.emitidaEn)}`);
  console.log(`  Vence:     ${formatearFecha(c.validaHasta)}`);
});
