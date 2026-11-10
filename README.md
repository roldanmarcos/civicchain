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

### Entorno local

En una terminal, dejar corriendo el nodo:

```bash
npm run node
```

En otra terminal:

```bash
npx hardhat run scripts/deploy.ts --network localhost   # despliega y exporta dirección + ABI al frontend
npx hardhat run scripts/seed.ts --network localhost     # credenciales de ejemplo + 100 ETH a cada admin
```

El nodo local se borra cada vez que se reinicia: hay que volver a correr `deploy` y `seed`.

Las wallets del equipo (`config/admins.ts`) quedan como admins. Para usarlas en MetaMask contra la red local,
agregar la red `http://127.0.0.1:8545` con chain id `31337`. Para probar los otros roles, importar en MetaMask
las cuentas de prueba que crea el seed (sus claves privadas se muestran al iniciar `npm run node`):

| Cuenta | Estado |
|---|---|
| #1 | Ana Pérez, empleada de la Municipalidad de Quilmes |
| #2 | Luis Gómez, inspector de la Municipalidad de Berazategui |
| #3 | Proveedor: Construcciones del Sur S.A. (CUIT 30-71234567-1), solicitud aprobada |
| #4 | Carlos Díaz, empleado de Avellaneda, vence a los 5 minutos |
| #5 | Marta Ruiz, empleada revocada |
| #6 | Obras del Norte S.R.L. (CUIT 30-70987654-2), solicitud pendiente de aprobación |
| #7 en adelante | Sin credencial |

### Cómo se obtiene cada credencial

- **Empleados e inspectores:** un admin los da de alta después de verificarlos en el padrón de empleados.
  En la cadena queda su nombre y organismo (no su DNI).
- **Proveedores:** se inscriben desde su wallet con CUIT, razón social, domicilio legal y rubros. Un admin
  verifica el CUIT en AFIP y aprueba o rechaza la solicitud. El CUIT y la razón social son públicos.

### Administrar credenciales desde la consola

Empleados e inspectores:

```bash
npx hardhat credencial funcionario --wallet 0x... --rol empleado --organismo 1 --nombre "Ana Pérez" --network localhost
```

Solicitudes de proveedores:

```bash
npx hardhat credencial solicitudes [--todas] --network localhost
npx hardhat credencial aprobar  --solicitud 2 --network localhost
npx hardhat credencial rechazar --solicitud 2 --motivo "El CUIT no figura en AFIP" --network localhost

# Simular la inscripción de un proveedor desde una cuenta de prueba (solo red local)
npx hardhat credencial solicitar --cuenta 7 --cuit 30-71111222-3 --razon-social "Pinturas Ribera S.A." \
  --domicilio "Mitre 100, Avellaneda" --rubros "Pintura" --network localhost
```

Cualquier credencial:

```bash
npx hardhat credencial revocar --wallet 0x... --motivo "Baja en el padrón" --network localhost
npx hardhat credencial renovar --wallet 0x... --dias 90 --network localhost
npx hardhat credencial estado  --wallet 0x... --network localhost
```

- `--rol`: `empleado` o `inspector`.
- `--organismo`: id de `frontend/src/config/organismos.json`.
- `--dias`: vigencia; por defecto 90.
- Los CUIT se pueden escribir con o sin guiones; se valida el dígito verificador.

### Sepolia

Cargar las credenciales en el keystore de Hardhat (quedan cifradas, fuera del repo):

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

## Frontend

```bash
cd frontend
npm install
npm run dev      # servidor de desarrollo en http://localhost:5173
npm run build    # build de producción en frontend/dist
```
