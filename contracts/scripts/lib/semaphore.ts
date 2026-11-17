// Despliegue de Semaphore v4 (la misma versión que está en package.json).
//
// Se despliega uno propio en todas las redes para que el contrato y la librería que genera las pruebas
// en el navegador sean siempre de la misma versión. El equipo de PSE mantiene uno ya desplegado en
// Sepolia (https://docs.semaphore.pse.dev/deployed-contracts, 0x697c80d1F2654e88d52B16154929EB976568DB04
// al momento de escribir esto); se podría usar ese pasando su dirección a CredencialNFT.

interface DeployerEthers {
  deployContract(
    nombre: string,
    args?: unknown[],
    opciones?: { libraries?: Record<string, string> },
  ): Promise<{ getAddress(): Promise<string>; waitForDeployment(): Promise<unknown> }>;
}

/** Despliega PoseidonT3, el verificador y Semaphore. Devuelve la dirección de Semaphore. */
export async function desplegarSemaphore(ethers: DeployerEthers): Promise<string> {
  const poseidon = await ethers.deployContract("PoseidonT3");
  await poseidon.waitForDeployment();
  const verificador = await ethers.deployContract("SemaphoreVerifier");
  await verificador.waitForDeployment();
  const semaphore = await ethers.deployContract("Semaphore", [await verificador.getAddress()], {
    libraries: { PoseidonT3: await poseidon.getAddress() },
  });
  await semaphore.waitForDeployment();
  return semaphore.getAddress();
}
