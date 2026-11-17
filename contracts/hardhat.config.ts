import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig, emptyTask, task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";

const VIGENCIA_POR_DEFECTO_DIAS = 90;

// Tasks para administrar credenciales desde la consola. Ver el README para ejemplos.
const tasks = [
  emptyTask("credencial", "Administrar credenciales de CivicChain").build(),

  task(["credencial", "funcionario"], "Emite la credencial de un empleado o inspector según el padrón (requiere ADMIN_ROLE)")
    .addOption({ name: "dni", description: "DNI de la persona en el padrón de empleados", defaultValue: "" })
    .addOption({ name: "dias", description: "Días de vigencia", type: ArgumentType.INT, defaultValue: VIGENCIA_POR_DEFECTO_DIAS })
    .setAction(() => import("./tasks/funcionario.js"))
    .build(),

  task(["credencial", "auditar"], "Cruza las credenciales de funcionarios con el padrón de empleados")
    .setAction(() => import("./tasks/auditar.js"))
    .build(),

  task(["credencial", "revocar"], "Revoca la credencial de una wallet (requiere ADMIN_ROLE)")
    .addOption({ name: "wallet", description: "Wallet a revocar", defaultValue: "" })
    .addOption({ name: "motivo", description: "Motivo de la revocación (queda público)", defaultValue: "" })
    .setAction(() => import("./tasks/revocar.js"))
    .build(),

  task(["credencial", "renovar"], "Renueva la credencial de una wallet (requiere ADMIN_ROLE)")
    .addOption({ name: "wallet", description: "Wallet a renovar", defaultValue: "" })
    .addOption({ name: "dias", description: "Días de vigencia desde hoy", type: ArgumentType.INT, defaultValue: VIGENCIA_POR_DEFECTO_DIAS })
    .setAction(() => import("./tasks/renovar.js"))
    .build(),

  task(["credencial", "estado"], "Muestra la credencial de una wallet")
    .addOption({ name: "wallet", description: "Wallet a consultar", defaultValue: "" })
    .setAction(() => import("./tasks/estado.js"))
    .build(),
];

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  tasks,
  solidity: {
    version: "0.8.28",
    // Si no se puede descargar el compilador (por ejemplo, sin internet), se puede usar el solc de npm:
    //   npm i -D solc@0.8.28 && SOLC_JS_PATH=node_modules/solc/soljson.js npm test
    ...(process.env.SOLC_JS_PATH ? { path: process.env.SOLC_JS_PATH } : {}),
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
    // Contratos de Semaphore que se despliegan tal cual vienen en npm (red local y tests).
    // En Sepolia se usa el Semaphore que ya está desplegado (ver scripts/deploy.ts).
    npmFilesToBuild: [
      "@semaphore-protocol/contracts/Semaphore.sol",
      "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol",
      "poseidon-solidity/PoseidonT3.sol",
    ],
  },
  networks: {
    // Red simulada en memoria que usan los tests
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // `localhost` (nodo levantado con `npm run node`) viene incluida en Hardhat.
    // Sepolia: los valores se cargan con `npx hardhat keystore set SEPOLIA_RPC_URL`
    // y `npx hardhat keystore set SEPOLIA_PRIVATE_KEY` (nunca en el código)
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
});
