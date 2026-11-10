// Carga datos de ejemplo en la red local para desarrollar el frontend.
// Requiere un nodo corriendo (npm run node) y el contrato desplegado.
//
//   npx hardhat run scripts/seed.ts --network localhost
//
// Para probar cada rol en MetaMask, importá la clave privada de la cuenta correspondiente.
// Las claves de las cuentas de prueba se muestran al iniciar `npm run node`.

import hre from "hardhat";
import { ADMINS_EQUIPO } from "../config/admins.js";
import {
  CHAIN_ID_LOCAL,
  ROLES,
  VIGENCIA_POR_DEFECTO_DIAS,
  conectarCredenciales,
  explicarError,
  venceEnDias,
} from "./lib/credenciales.js";

const { ethers, networkName, chainId, credenciales } = await conectarCredenciales(hre);
if (chainId !== CHAIN_ID_LOCAL || networkName !== "localhost") {
  throw new Error("El seed es solo para la red local: usá --network localhost");
}

const cuentas = await ethers.getSigners();
const vence = await venceEnDias(ethers, VIGENCIA_POR_DEFECTO_DIAS);
const venceEnCincoMinutos = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 5 * 60);

/** Ejecuta un paso del seed sin cortar todo si falla (por ejemplo, si se corre dos veces). */
async function paso(descripcion: string, accion: () => Promise<unknown>) {
  try {
    await accion();
    console.log(`  ${descripcion}`);
  } catch (error) {
    console.log(`  ${descripcion}: no se pudo (${explicarError(error)})`);
  }
}

// 1. ETH de prueba para las wallets del equipo, así pueden firmar transacciones como admins.
console.log("ETH de prueba:");
for (const [nombre, address] of Object.entries(ADMINS_EQUIPO)) {
  await paso(`100 ETH a ${nombre} (${address})`, async () =>
    (await cuentas[0].sendTransaction({ to: address, value: ethers.parseEther("100") })).wait(),
  );
}

// 2. Empleados e inspectores, emitidos directamente por el admin.
const funcionarios = [
  { cuenta: 1, rol: "EMPLEADO", organismo: 1, nombre: "Ana Pérez", vence, detalle: "empleada de Quilmes" },
  { cuenta: 2, rol: "INSPECTOR", organismo: 2, nombre: "Luis Gómez", vence, detalle: "inspector de Berazategui" },
  { cuenta: 4, rol: "EMPLEADO", organismo: 3, nombre: "Carlos Díaz", vence: venceEnCincoMinutos, detalle: "empleado de Avellaneda, vence en 5 minutos" },
  { cuenta: 5, rol: "EMPLEADO", organismo: 1, nombre: "Marta Ruiz", vence, detalle: "empleada de Quilmes, se revoca" },
];

console.log("\nEmpleados e inspectores:");
for (const f of funcionarios) {
  const wallet = cuentas[f.cuenta].address;
  await paso(`Cuenta #${f.cuenta} ${wallet}  ${f.nombre}, ${f.detalle}`, async () =>
    (await credenciales.emitirFuncionario(wallet, ROLES.indexOf(f.rol as never), f.organismo, f.nombre, f.vence)).wait(),
  );
}

const [tokenRevocado] = await credenciales.credencialDe(cuentas[5].address);
await paso(`Credencial #${tokenRevocado} de la cuenta #5 revocada`, async () =>
  (await credenciales.revocar(tokenRevocado, "Baja en el padrón de empleados (ejemplo)")).wait(),
);

// 3. Proveedores: se inscriben desde su propia wallet y el admin aprueba.
//    Los CUITs coinciden con el padrón de la AFIP simulada (Fase 3).
console.log("\nProveedores:");
await paso(`Cuenta #3 ${cuentas[3].address}  Construcciones del Sur S.A., solicitud aprobada`, async () => {
  await (
    await credenciales
      .connect(cuentas[3])
      .solicitarInscripcion(30712345671n, "Construcciones del Sur S.A.", "Av. Calchaquí 1234, Quilmes", "Construcción, obras viales")
  ).wait();
  const id = await credenciales.solicitudPendienteDe(cuentas[3].address);
  await (await credenciales.aprobarSolicitud(id, vence)).wait();
});

await paso(`Cuenta #6 ${cuentas[6].address}  Obras del Norte S.R.L., solicitud pendiente`, async () =>
  (
    await credenciales
      .connect(cuentas[6])
      .solicitarInscripcion(30709876542n, "Obras del Norte S.R.L.", "Calle 14 N° 456, Berazategui", "Electricidad, iluminación")
  ).wait(),
);

console.log('\nCuentas sin credencial para probar el caso "sin acceso": #7 en adelante.');
