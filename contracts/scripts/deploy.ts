// Despliega Semaphore, CredencialNFT y Licitaciones, da los roles de administración al equipo,
// habilita al verificador del backend y exporta direcciones y ABIs al frontend (y al backend).
//
//   Red local:  npx hardhat run scripts/deploy.ts --network localhost
//   Sepolia:    VERIFICADOR_ADDRESS=0x... npx hardhat run scripts/deploy.ts --network sepolia
//
// En la red local el verificador y el relayer del backend son las cuentas #18 y #19 de Hardhat, y el
// relayer recibe ETH para pagar el gas de las ofertas. En Sepolia hay que pasar VERIFICADOR_ADDRESS
// (la dirección de VERIFICADOR_PRIVATE_KEY del backend) y mandarle ETH de prueba al relayer a mano.

import hre from "hardhat";
import { ADMINS_EQUIPO } from "../config/admins.js";
import { CHAIN_ID_LOCAL, guardarDeployments } from "./lib/credenciales.js";
import { desplegarSemaphore } from "./lib/semaphore.js";

const REDES_PERSISTENTES = ["localhost", "sepolia"];
const CUENTA_VERIFICADOR_LOCAL = 18;
const CUENTA_RELAYER_LOCAL = 19;

const { ethers, networkName } = await hre.network.create();
const cuentas = await ethers.getSigners();
const [deployer] = cuentas;
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const esLocal = chainId === CHAIN_ID_LOCAL;

// En la red local el deployer es la cuenta #0 de Hardhat y queda como admin también,
// así los scripts de la consola funcionan sin configurar nada.
const admins = [...new Set([...(esLocal ? [deployer.address] : []), ...Object.values(ADMINS_EQUIPO)])];

console.log(`Red: ${networkName} (chainId ${chainId})`);
console.log(`Deployer: ${deployer.address}`);

const bloqueInicial = await ethers.provider.getBlockNumber();

const semaphoreAddress = await desplegarSemaphore(ethers);
console.log(`Semaphore desplegado en ${semaphoreAddress}`);

const credenciales = await ethers.deployContract("CredencialNFT", [deployer.address, semaphoreAddress]);
await credenciales.waitForDeployment();
const credencialesAddress = await credenciales.getAddress();
console.log(`CredencialNFT desplegado en ${credencialesAddress}`);

const licitaciones = await ethers.deployContract("Licitaciones", [credencialesAddress]);
await licitaciones.waitForDeployment();
const licitacionesAddress = await licitaciones.getAddress();
console.log(`Licitaciones desplegado en ${licitacionesAddress}`);

const ADMIN_ROLE = await credenciales.ADMIN_ROLE();
const DEFAULT_ADMIN_ROLE = await credenciales.DEFAULT_ADMIN_ROLE();
const VERIFICADOR_ROLE = await credenciales.VERIFICADOR_ROLE();

const verificador = esLocal ? cuentas[CUENTA_VERIFICADOR_LOCAL].address : process.env.VERIFICADOR_ADDRESS;
if (verificador) {
  await (await credenciales.grantRole(VERIFICADOR_ROLE, verificador)).wait();
  console.log(`  VERIFICADOR_ROLE otorgado al backend (${verificador})`);
} else {
  console.log(`  Ojo: sin VERIFICADOR_ADDRESS nadie puede autorizar inscripciones de proveedores.`);
}

if (esLocal) {
  const relayer = cuentas[CUENTA_RELAYER_LOCAL].address;
  console.log(`  Relayer del backend: ${relayer} (cuenta #${CUENTA_RELAYER_LOCAL}, ya tiene ETH de prueba)`);
}

for (const admin of admins) {
  if (admin === deployer.address) continue;
  const nombre = Object.entries(ADMINS_EQUIPO).find(([, a]) => a === admin)?.[0] ?? admin;
  await (await credenciales.grantRole(DEFAULT_ADMIN_ROLE, admin)).wait();
  await (await credenciales.grantRole(ADMIN_ROLE, admin)).wait();
  console.log(`  Roles de administración otorgados a ${nombre} (${admin})`);
}

// Si quien desplegó no es parte del equipo, renuncia a sus roles.
// DEFAULT_ADMIN_ROLE va último: después de eso ya no podría hacer nada más.
if (!admins.includes(deployer.address)) {
  await (await credenciales.renounceRole(ADMIN_ROLE, deployer.address)).wait();
  await (await credenciales.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();
  console.log(`  El deployer renunció a sus roles`);
}

if (REDES_PERSISTENTES.includes(networkName)) {
  const abi = async (nombre: string) => (await hre.artifacts.readArtifact(nombre)).abi;
  await guardarDeployments(chainId, {
    Semaphore: { address: semaphoreAddress, deployBlock: bloqueInicial, abi: await abi("Semaphore") },
    CredencialNFT: { address: credencialesAddress, deployBlock: bloqueInicial, admins, abi: await abi("CredencialNFT") },
    Licitaciones: { address: licitacionesAddress, deployBlock: bloqueInicial, abi: await abi("Licitaciones") },
  });
  console.log(`Direcciones y ABIs guardados en frontend/src/config/ (los lee también el backend).`);
} else {
  console.log(`Red "${networkName}" temporal: no se guarda nada en el frontend (usá --network localhost o sepolia).`);
}
