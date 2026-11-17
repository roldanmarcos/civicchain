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

  console.log(`Wallet: ${args.wallet}`);
  console.log(`Admin:  ${esAdmin ? "sí" : "no"}`);

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
    const [, enGrupo] = await credenciales.compromisoDe(tokenId);
    console.log(`  Grupo ZK:  ${enGrupo ? "sí (puede ofertar)" : "no"}`);
  } else {
    const organismo = (await leerOrganismos()).find((o) => o.id === Number(c.organismoId))?.nombre ?? "—";
    console.log(`  Nombre:    ${c.nombre}`);
    console.log(`  Organismo: ${organismo}`);
  }
  console.log(`  Emitida:   ${formatearFecha(c.emitidaEn)}`);
  console.log(`  Vence:     ${formatearFecha(c.validaHasta)}`);
  if (c.datosHash !== ethers.ZeroHash) console.log(`  Datos:     ${c.datosHash} (hash de los datos guardados en el backend)`);
});
