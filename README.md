# CivicChain

Plataforma de licitaciones públicas transparentes con ofertas anónimas.
Trabajo Práctico Integrador — Seminario de Blockchain & Smart Contracts, UNQ.

## Estructura

```
civicchain/
├── contracts/   Smart contracts (Hardhat 3 + OpenZeppelin 5)
│   ├── contracts/   código Solidity
│   ├── test/        tests (Mocha + ethers)
│   └── scripts/     despliegue y utilidades
└── frontend/    dApp (Vite + ethers v6)
    └── src/
        ├── main.js
        ├── style.css
        └── config/contracts.js   direcciones y ABIs por red
```

Requisitos: Node.js 22 o superior.

## Contratos

```bash
cd contracts
npm install
npm run build    # compila
npm test         # corre los tests
npm run node     # levanta una blockchain local en http://127.0.0.1:8545
```

Para desplegar en Sepolia, cargar las credenciales en el keystore de Hardhat (quedan cifradas, fuera del repo):

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

## Frontend

```bash
cd frontend
npm install
npm run dev      # servidor de desarrollo en http://localhost:5173
npm run build    # build de producción en frontend/dist
```
