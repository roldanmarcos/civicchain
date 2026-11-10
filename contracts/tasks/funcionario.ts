import {
  ROLES,
  clientePadron,
  comoTask,
  conectarCredenciales,
  formatearFecha,
  validarOrganismo,
  venceEnDias,
} from "../scripts/lib/credenciales.js";

interface Args {
  dni: string;
  dias: number;
}

/** Emite la credencial de un empleado o inspector a partir de sus datos en el padrón. */
export default comoTask<Args>(async (args, hre) => {
  const { ethers, credenciales, firmante } = await conectarCredenciales(hre);
  if (!args.dni) throw new Error("Falta --dni");

  const padron = await clientePadron();
  const verificacion = await padron.verificarAlta(args.dni);
  if (!verificacion.ok || !verificacion.empleado?.wallet) throw new Error(`Padrón: ${verificacion.mensaje}`);

  const empleado = verificacion.empleado;
  const wallet = empleado.wallet!;
  const rol = ROLES.indexOf(empleado.funcion);
  const organismo = await validarOrganismo(empleado.organismoId);
  const validaHasta = await venceEnDias(ethers, args.dias);

  console.log(`Emitiendo credencial de ${empleado.funcion} (datos del padrón)`);
  console.log(`  Nombre:     ${empleado.nombre}`);
  console.log(`  Organismo:  ${organismo} — ${empleado.area}`);
  console.log(`  Cargo:      ${empleado.cargo} (${empleado.resolucion})`);
  console.log(`  Wallet:     ${wallet}`);
  console.log(`  Vence:      ${formatearFecha(validaHasta)} (${args.dias} días)`);
  console.log(`  Firma:      ${firmante.address}`);

  const tx = await credenciales.emitirFuncionario(wallet, rol, empleado.organismoId, empleado.nombre, validaHasta);
  await tx.wait();
  const [tokenId] = await credenciales.credencialDe(wallet);
  console.log(`Credencial #${tokenId} emitida. Transacción: ${tx.hash}`);
});
