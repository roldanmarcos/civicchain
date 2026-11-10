import { DIA, comoTask, conectarCredenciales, formatearFecha } from "../scripts/lib/credenciales.js";

interface Args {
  wallet: string;
  dias: number;
}

export default comoTask<Args>(async (args, hre) => {
  const { ethers, credenciales } = await conectarCredenciales(hre);

  if (!ethers.isAddress(args.wallet)) throw new Error(`Wallet inválida: "${args.wallet}"`);
  if (args.dias <= 0) throw new Error("--dias tiene que ser mayor a 0");

  const [tokenId] = await credenciales.credencialDe(args.wallet);
  if (tokenId === 0n) throw new Error(`La wallet ${args.wallet} no tiene credenciales.`);

  const ahora = (await ethers.provider.getBlock("latest"))!.timestamp;
  const nuevaFecha = BigInt(ahora + args.dias * DIA);

  const tx = await credenciales.renovar(tokenId, nuevaFecha);
  await tx.wait();
  console.log(`Credencial #${tokenId} renovada hasta ${formatearFecha(nuevaFecha)}. Transacción: ${tx.hash}`);
});
