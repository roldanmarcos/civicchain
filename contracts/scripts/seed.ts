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
  clientePadron,
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

// 2. Empleados e inspectores, con los datos del padrón simulado.
//    Algunos casos simulan historia: credenciales emitidas antes de una baja o de un cambio de wallet,
//    para que `credencial auditar` y el panel de admin tengan algo que detectar.
const padron = await clientePadron();
const funcionarios = [
  { dni: "30111222", cuenta: 1, vence, detalle: "empleada de Quilmes" },
  { dni: "28999000", cuenta: 2, vence, detalle: "inspector de Berazategui" },
  { dni: "33444555", cuenta: 4, vence: venceEnCincoMinutos, detalle: "empleado de Avellaneda, vence en 5 minutos" },
  { dni: "27666777", cuenta: 5, vence, detalle: "de baja en el padrón, se revoca" },
  { dni: "25888999", cuenta: 9, vence, detalle: "de baja en el padrón, pero la credencial sigue sin revocar" },
  { dni: "31555666", cuenta: 11, vence, detalle: "credencial en su wallet anterior (en el padrón declaró la #12)" },
];

console.log("\nEmpleados e inspectores:");
for (const f of funcionarios) {
  const empleado = (await padron.consultarDni(f.dni))!;
  const wallet = cuentas[f.cuenta].address;
  await paso(`Cuenta #${f.cuenta} ${wallet}  ${empleado.nombre}, ${f.detalle}`, async () =>
    (
      await credenciales.emitirFuncionario(wallet, ROLES.indexOf(empleado.funcion), empleado.organismoId, empleado.nombre, f.vence)
    ).wait(),
  );
}

const [tokenRevocado] = await credenciales.credencialDe(cuentas[5].address);
await paso(`Credencial #${tokenRevocado} de la cuenta #5 revocada`, async () =>
  (await credenciales.revocar(tokenRevocado, "Baja en el padrón de empleados")).wait(),
);
console.log("  Cuenta #10 Sofía Torres: activa en el padrón, todavía sin credencial (para emitir en la demo)");

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

// Solicitudes pendientes, una por cada resultado posible de la verificación en AFIP.
const pendientes = [
  { cuenta: 6, cuit: 30709876542n, razonSocial: "Obras del Norte S.R.L.", domicilio: "Calle 14 N° 456, Berazategui", rubros: "Electricidad, iluminación", afip: "AFIP OK" },
  { cuenta: 7, cuit: 30719998883n, razonSocial: "Electro Sur S.R.L.", domicilio: "San Martín 789, Lanús", rubros: "Electricidad", afip: "la razón social no coincide con AFIP" },
  { cuenta: 8, cuit: 30705554443n, razonSocial: "Viales Bonaerenses S.A.", domicilio: "Ruta 2 km 40, Florencio Varela", rubros: "Obras viales", afip: "CUIT inactivo en AFIP" },
];

for (const p of pendientes) {
  await paso(`Cuenta #${p.cuenta} ${cuentas[p.cuenta].address}  ${p.razonSocial}, solicitud pendiente (${p.afip})`, async () =>
    (await credenciales.connect(cuentas[p.cuenta]).solicitarInscripcion(p.cuit, p.razonSocial, p.domicilio, p.rubros)).wait(),
  );
}

console.log('\nCuentas sin credencial ni solicitud, para probar el caso "sin acceso": #13 en adelante.');
