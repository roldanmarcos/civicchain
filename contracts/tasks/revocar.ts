import { comoTask, conectarCredenciales } from "../scripts/lib/credenciales.js";

interface Args {
  wallet: string;
  motivo: string;
}

export default comoTask<Args>(async (args, hre) => {
  const { ethers, credenciales } = await conectarCredenciales(hre);

  if (!ethers.isAddress(args.wallet)) throw new Error(`Wallet inválida: "${args.wallet}"`);
  if (!args.motivo) throw new Error('Falta --motivo (por ejemplo: --motivo "Baja en el padrón")');

  const [tokenId] = await credenciales.credencialDe(args.wallet);
  if (tokenId === 0n) throw new Error(`La wallet ${args.wallet} no tiene credenciales.`);

  const tx = await credenciales.revocar(tokenId, args.motivo);
  await tx.wait();
  console.log(`Credencial #${tokenId} de ${args.wallet} revocada. Transacción: ${tx.hash}`);
});
