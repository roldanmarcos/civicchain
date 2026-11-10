import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
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
