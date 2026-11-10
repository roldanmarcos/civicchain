import {
  ROLES,
  comoTask,
  conectarCredenciales,
  formatearFecha,
  parseRolFuncionario,
  validarOrganismo,
  venceEnDias,
} from "../scripts/lib/credenciales.js";

interface Args {
  wallet: string;
  rol: string;
  organismo: number;
  nombre: string;
  dias: number;
}

export default comoTask<Args>(async (args, hre) => {
  const { ethers, credenciales, firmante } = await conectarCredenciales(hre);

  if (!ethers.isAddress(args.wallet)) throw new Error(`Wallet inválida: "${args.wallet}"`);
  if (!args.nombre.trim()) throw new Error('Falta --nombre (por ejemplo: --nombre "Ana Pérez")');

  const rol = parseRolFuncionario(args.rol);
  const organismo = await validarOrganismo(args.organismo);
  const validaHasta = await venceEnDias(ethers, args.dias);

  console.log(`Emitiendo credencial de ${ROLES[rol]}`);
  console.log(`  Nombre:    ${args.nombre}`);
  console.log(`  Organismo: ${organismo}`);
  console.log(`  Wallet:    ${args.wallet}`);
  console.log(`  Vence:     ${formatearFecha(validaHasta)} (${args.dias} días)`);
  console.log(`  Firma:     ${firmante.address}`);

  const tx = await credenciales.emitirFuncionario(args.wallet, rol, args.organismo, args.nombre.trim(), validaHasta);
  await tx.wait();
  const [tokenId] = await credenciales.credencialDe(args.wallet);
  console.log(`Credencial #${tokenId} emitida. Transacción: ${tx.hash}`);
});
