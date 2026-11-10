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

  task(["credencial", "solicitudes"], "Lista las solicitudes de inscripción de proveedores")
    .addFlag({ name: "todas", description: "Incluir aprobadas, rechazadas y canceladas" })
    .setAction(() => import("./tasks/solicitudes.js"))
    .build(),

  task(["credencial", "aprobar"], "Verifica una solicitud en AFIP, la aprueba y emite la credencial (requiere ADMIN_ROLE)")
    .addOption({ name: "solicitud", description: "Número de solicitud", type: ArgumentType.INT, defaultValue: 0 })
    .addOption({ name: "dias", description: "Días de vigencia", type: ArgumentType.INT, defaultValue: VIGENCIA_POR_DEFECTO_DIAS })
    .addFlag({ name: "forzar", description: "Aprobar aunque la verificación en AFIP falle" })
    .setAction(() => import("./tasks/aprobar.js"))
    .build(),

  task(["credencial", "rechazar"], "Rechaza una solicitud de proveedor (requiere ADMIN_ROLE)")
    .addOption({ name: "solicitud", description: "Número de solicitud", type: ArgumentType.INT, defaultValue: 0 })
    .addOption({ name: "motivo", description: "Motivo del rechazo (queda público)", defaultValue: "" })
    .setAction(() => import("./tasks/rechazar.js"))
    .build(),

  task(["credencial", "solicitar"], "Simula la inscripción de un proveedor (solo red local)")
    .addOption({ name: "cuenta", description: "Cuenta de prueba que firma (#1, #2, ...)", type: ArgumentType.INT, defaultValue: 1 })
    .addOption({ name: "cuit", description: "CUIT de la empresa", defaultValue: "" })
    .addOption({ name: "razonSocial", description: "Razón social", defaultValue: "" })
    .addOption({ name: "domicilio", description: "Domicilio legal", defaultValue: "" })
    .addOption({ name: "rubros", description: "Rubros de actividad", defaultValue: "" })
    .setAction(() => import("./tasks/solicitar.js"))
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
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
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
