import {
  clientePadron,
  comoTask,
  conectarCredenciales,
  leerTodasLasCredenciales,
} from "../scripts/lib/credenciales.js";

/** Cruza las credenciales de empleados e inspectores con el padrón y sugiere qué corregir. */
export default comoTask<object>(async (_args, hre) => {
  const { ethers, credenciales, networkName } = await conectarCredenciales(hre);
  const padron = await clientePadron();
  const red = `--network ${networkName}`;

  const todas = await leerTodasLasCredenciales(credenciales, ethers);
  const hallazgos = await padron.auditar(todas);

  if (hallazgos.length === 0) {
    console.log("Todo en orden: las credenciales coinciden con el padrón.");
    return;
  }

  console.log(`${hallazgos.length} hallazgo(s):\n`);
  for (const h of hallazgos) {
    const id = h.credencial ? `Credencial #${h.credencial.tokenId}` : "Sin credencial";
    console.log(`⚠ ${h.tipo} — ${id}`);
    console.log(`  ${h.mensaje}`);

    const walletCredencial = h.credencial?.wallet;
    const dni = h.empleado?.dni;
    if (h.accion === "REVOCAR" || h.accion === "REVOCAR_Y_EMITIR") {
      console.log(`  → npx hardhat credencial revocar --wallet ${walletCredencial} --motivo "${h.tipo}" ${red}`);
    }
    if ((h.accion === "EMITIR" || h.accion === "REVOCAR_Y_EMITIR") && dni) {
      console.log(`  → npx hardhat credencial funcionario --dni ${dni} ${red}`);
    }
    if (h.accion === "RENOVAR") {
      console.log(`  → npx hardhat credencial renovar --wallet ${walletCredencial} ${red}`);
    }
    console.log();
  }
});
