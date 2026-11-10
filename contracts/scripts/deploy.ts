// Despliega CredencialNFT, da los roles de administración al equipo y exporta
// la dirección y el ABI al frontend.
//
//   Red local:  npx hardhat run scripts/deploy.ts --network localhost
//   Sepolia:    npx hardhat run scripts/deploy.ts --network sepolia

import hre from "hardhat";
import { ADMINS_EQUIPO } from "../config/admins.js";
import { CHAIN_ID_LOCAL, guardarDeployment } from "./lib/credenciales.js";

const REDES_PERSISTENTES = ["localhost", "sepolia"];

const { ethers, networkName } = await hre.network.create();
const [deployer] = await ethers.getSigners();
const chainId = Number((await ethers.provider.getNetwork()).chainId);

// En la red local el deployer es la cuenta #0 de Hardhat y queda como admin también,
// así los scripts de la consola funcionan sin configurar nada.
const admins = [...new Set([...(chainId === CHAIN_ID_LOCAL ? [deployer.address] : []), ...Object.values(ADMINS_EQUIPO)])];

console.log(`Red: ${networkName} (chainId ${chainId})`);
console.log(`Deployer: ${deployer.address}`);

const credenciales = await ethers.deployContract("CredencialNFT", [deployer.address]);
const recibo = await credenciales.deploymentTransaction()!.wait();
const address = await credenciales.getAddress();
console.log(`CredencialNFT desplegado en ${address} (bloque ${recibo!.blockNumber})`);

const ADMIN_ROLE = await credenciales.ADMIN_ROLE();
const DEFAULT_ADMIN_ROLE = await credenciales.DEFAULT_ADMIN_ROLE();

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
  const { abi } = await hre.artifacts.readArtifact("CredencialNFT");
  await guardarDeployment(chainId, "CredencialNFT", { address, deployBlock: recibo!.blockNumber, admins }, abi);
  console.log(`Dirección y ABI guardados en frontend/src/config/`);
} else {
  console.log(`Red "${networkName}" temporal: no se guarda nada en el frontend (usá --network localhost o sepolia).`);
}
