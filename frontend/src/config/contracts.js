// Direcciones y ABIs de los contratos por red.
// Los scripts de despliegue de Hardhat (contracts/scripts) van a completar este archivo
// a partir de la Fase 2. Por ahora queda vacío.

export const NETWORKS = {
  // Nodo local de Hardhat (npx hardhat node)
  31337: {
    name: "Hardhat local",
    contracts: {},
  },
  // Sepolia testnet
  11155111: {
    name: "Sepolia",
    contracts: {},
  },
};

export const DEFAULT_CHAIN_ID = 31337;
