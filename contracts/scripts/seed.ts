// Carga datos de ejemplo en la red local para desarrollar el frontend.
// Requiere un nodo corriendo (npm run node), los contratos desplegados y el backend corriendo
// (cd backend && npm start): los proveedores se inscriben a través del verificador del backend,
// igual que desde la dApp, y los pliegos se suben a su IPFS local.
//
//   npx hardhat run scripts/seed.ts --network localhost
//
// Para probar cada rol en MetaMask, importá la clave privada de la cuenta correspondiente.
// Las claves de las cuentas de prueba se muestran al iniciar `npm run node`.

import hre from "hardhat";
import { ADMINS_EQUIPO } from "../config/admins.js";
import { Identity } from "@semaphore-protocol/core";
import {
  BACKEND_URL,
  CHAIN_ID_LOCAL,
  ROLES,
  VIGENCIA_POR_DEFECTO_DIAS,
  clientePadron,
  conectarCredenciales,
  explicarError,
  leerDeployment,
  llamarBackend,
  venceEnDias,
} from "./lib/credenciales.js";
import { MENSAJE_IDENTIDAD } from "../../frontend/src/shared/protocolo.js";

const { ethers, networkName, chainId, credenciales } = await conectarCredenciales(hre);
if (chainId !== CHAIN_ID_LOCAL || networkName !== "localhost") {
  throw new Error("El seed es solo para la red local: usá --network localhost");
}

const cuentas = await ethers.getSigners();
const vence = await venceEnDias(ethers, VIGENCIA_POR_DEFECTO_DIAS);
const venceEnCincoMinutos = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 5 * 60);

/** Ejecuta un paso del seed sin cortar todo si falla (por ejemplo, si se corre dos veces). */
async function paso(descripcion: string, accion: () => Promise<unknown>) {
  console.log(`  ${descripcion}`);
  try {
    await accion();
  } catch (error) {
    console.log(`    no se pudo: ${explicarError(error)}`);
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

let backendOk = true;
try {
  const r = await fetch(`${BACKEND_URL}/api/salud`);
  backendOk = r.ok && ((await r.json()) as { cadena: boolean }).cadena;
} catch {
  backendOk = false;
}
if (!backendOk) {
  console.log(`\nAviso: el backend no responde en ${BACKEND_URL} (o no ve los contratos).`);
  console.log("Se cargan solo empleados e inspectores, sin datos fuera de la cadena. Levantalo con: cd backend && npm start\n");
}

console.log("\nEmpleados e inspectores:");
for (const f of funcionarios) {
  const empleado = (await padron.consultarDni(f.dni))!;
  const wallet = cuentas[f.cuenta].address;
  await paso(`Cuenta #${f.cuenta} ${wallet}  ${empleado.nombre}, ${f.detalle}`, async () => {
    let datosHash = ethers.ZeroHash;
    if (backendOk) {
      ({ datosHash } = await llamarBackend<{ datosHash: string }>(
        "/api/funcionarios",
        { wallet, rol: empleado.funcion, organismoId: empleado.organismoId, nombre: empleado.nombre, dni: empleado.dni, area: empleado.area, cargo: empleado.cargo, resolucion: empleado.resolucion },
        cuentas[0],
      ));
    }
    await (
      await credenciales.emitirFuncionario(wallet, ROLES.indexOf(empleado.funcion), empleado.organismoId, empleado.nombre, f.vence, datosHash)
    ).wait();
  });
}

const [tokenRevocado] = await credenciales.credencialDe(cuentas[5].address);
await paso(`Credencial #${tokenRevocado} de la cuenta #5 revocada`, async () =>
  (await credenciales.revocar(tokenRevocado, "Baja en el padrón de empleados")).wait(),
);
console.log("  Cuenta #10 Sofía Torres: activa en el padrón, todavía sin credencial (para emitir en la demo)");

if (!backendOk) process.exit(0);

// 3. Proveedores: se inscriben como desde la dApp. El backend verifica en AFIP y firma o rechaza solo.
//    La identidad de Semaphore sale de firmar MENSAJE_IDENTIDAD con la wallet (igual que en la dApp).
console.log("\nProveedores (inscripción automática):");
interface Autorizacion {
  aprobada: boolean;
  motivo: string;
  firma?: string;
  inscripcion?: {
    cuit: string;
    razonSocial: string;
    datosHash: string;
    identityCommitment: string;
    validaHasta: string;
    venceFirma: string;
  };
}
const proveedores = [
  { cuenta: 3, cuit: "30-71234567-1", razonSocial: "Construcciones del Sur S.A.", domicilio: "Av. Calchaquí 1234, Quilmes", rubros: "Construcción, obras viales", clave: "DEMO-7123" },
  { cuenta: 6, cuit: "30-70987654-2", razonSocial: "Obras del Norte S.R.L.", domicilio: "Calle 14 N° 456, Berazategui", rubros: "Electricidad, iluminación", clave: "DEMO-7098" },
  { cuenta: 7, cuit: "30-71999888-3", razonSocial: "Electro Sur S.R.L.", domicilio: "San Martín 789, Lanús", rubros: "Electricidad", clave: "DEMO-7199" },
  { cuenta: 8, cuit: "30-70555444-3", razonSocial: "Viales Bonaerenses S.A.", domicilio: "Ruta 2 km 40, Florencio Varela", rubros: "Obras viales", clave: "DEMO-7055" },
];
for (const p of proveedores) {
  const cuenta = cuentas[p.cuenta];
  await paso(`Cuenta #${p.cuenta} ${cuenta.address}  ${p.razonSocial}`, async () => {
    const identidad = new Identity(await cuenta.signMessage(MENSAJE_IDENTIDAD));
    const r = await llamarBackend<Autorizacion>("/api/inscripciones", {
      wallet: cuenta.address,
      cuit: p.cuit,
      razonSocial: p.razonSocial,
      domicilioLegal: p.domicilio,
      rubros: p.rubros,
      claveFiscal: p.clave,
      identityCommitment: identidad.commitment.toString(),
    });
    if (!r.aprobada) {
      console.log(`    rechazada por el verificador: ${r.motivo}`);
      return;
    }
    await (await credenciales.connect(cuenta).inscribirProveedor(r.inscripcion!, r.firma!)).wait();
    console.log(`    aprobada: ${r.motivo}`);
  });
}

// 4. Licitaciones de ejemplo, publicadas por Ana Pérez (cuenta #1, Municipalidad de Quilmes).
//    Una cierra en 15 minutos (para mostrar ofertas y apertura en una clase) y otra en una semana.
console.log("\nLicitaciones:");
const { address: licitacionesAddress } = await leerDeployment(chainId, "Licitaciones");
const licitaciones = await ethers.getContractAt("Licitaciones", licitacionesAddress, cuentas[1]);

async function subirAlBackend(bytes: Uint8Array | string, tipo: string): Promise<string> {
  const r = await fetch(`${BACKEND_URL}/api/ipfs`, { method: "POST", headers: { "Content-Type": tipo }, body: bytes });
  const datos = (await r.json()) as { cid: string; error?: string };
  if (!r.ok) throw new Error(datos.error);
  return datos.cid;
}

const ejemplos = [
  {
    titulo: "Ampliación del Centro de Salud San Martín",
    descripcion:
      "Ampliación de consultorios y renovación de las instalaciones eléctricas y sanitarias del Centro de Salud San Martín. Contempla nuevas áreas de atención y accesibilidad para pacientes.",
    ubicacion: "Quilmes, Buenos Aires",
    presupuesto: 48_500_000n,
    cierreEnMinutos: 15,
    aperturaMinutos: 10,
    etapas: [
      { nombre: "Demolición y obra gruesa", porcentaje: 30 },
      { nombre: "Instalaciones eléctricas y sanitarias", porcentaje: 40 },
      { nombre: "Terminaciones y accesibilidad", porcentaje: 30 },
    ],
  },
  {
    titulo: "Pavimentación de calles — Barrio Los Aromos",
    descripcion: "Pavimentación y obras pluviales en 12 cuadras del Barrio Los Aromos: preparación del terreno, desagües y calzada de hormigón.",
    ubicacion: "Quilmes, Buenos Aires",
    presupuesto: 76_200_000n,
    cierreEnMinutos: 7 * 24 * 60,
    aperturaMinutos: 24 * 60,
    etapas: [
      { nombre: "Movimiento de suelos", porcentaje: 20 },
      { nombre: "Desagües pluviales", porcentaje: 35 },
      { nombre: "Calzada de hormigón", porcentaje: 45 },
    ],
  },
];

for (const e of ejemplos) {
  await paso(`"${e.titulo}" (cierra en ${e.cierreEnMinutos >= 1440 ? `${e.cierreEnMinutos / 1440} días` : `${e.cierreEnMinutos} minutos`})`, async () => {
    const pliegoCID = await subirAlBackend(pliegoPdf(e.titulo, e.descripcion, e.etapas), "application/pdf");
    const metadata = {
      name: e.titulo,
      description: e.descripcion,
      ubicacion: e.ubicacion,
      pliegoCID,
      etapas: e.etapas,
    };
    const metadataCID = await subirAlBackend(JSON.stringify(metadata), "application/json");
    // Fechas según el reloj real (y no el del último bloque), igual que la dApp y la ronda de drand.
    const cierre = BigInt(Math.floor(Date.now() / 1000) + e.cierreEnMinutos * 60);
    await (
      await licitaciones.crearLicitacion(e.titulo, metadataCID, e.presupuesto, cierre, e.aperturaMinutos * 60, e.etapas.map((x) => x.porcentaje * 100))
    ).wait();
  });
}

console.log('\nCuentas sin credencial, para probar el caso "sin acceso" o una inscripción nueva: #13 en adelante.');
console.log("Claves fiscales de demo (para inscribirse desde la dApp): ver backend/src/afip/padron.json (claveFiscalDemo).");

/** PDF mínimo de una página con el texto del pliego (para no depender de archivos binarios en el repo). */
function pliegoPdf(titulo: string, descripcion: string, etapas: { nombre: string; porcentaje: number }[]): Uint8Array {
  const limpiar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[()\\]/g, "").replace(/—/g, "-");
  const lineas = [
    "PLIEGO DE BASES Y CONDICIONES (ejemplo)",
    "",
    limpiar(titulo),
    "",
    ...(limpiar(descripcion).match(/.{1,85}(\s|$)/g) ?? []).map((l) => l.trim()),
    "",
    "Etapas y porcentaje de pago:",
    ...etapas.map((x, i) => `${i + 1}. ${limpiar(x.nombre)} - ${x.porcentaje}%`),
    "",
    "Las ofertas se presentan de forma anonima a traves de CivicChain.",
  ];
  const texto = lineas.map((l, i) => `BT /F1 ${i === 0 ? 14 : 11} Tf 50 ${780 - i * 18} Td (${l}) Tj ET`).join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
