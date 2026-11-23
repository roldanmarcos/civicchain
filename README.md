# CivicChain

Plataforma de licitaciones públicas transparentes con ofertas anónimas.
Trabajo Práctico Integrador — Seminario de Blockchain & Smart Contracts, UNQ.

## Cómo funciona

| Fase | Qué pasa | Dónde |
|---|---|---|
| 0. Habilitación | El proveedor se inscribe; el backend verifica en AFIP y firma una autorización; recibe su credencial (NFT intransferible) y su identidad anónima entra al grupo de Semaphore. Empleados e inspectores los da de alta un admin. | `CredencialNFT` + backend |
| 1. Publicación | Un empleado publica la licitación (NFT ERC-721 con tokenURI a IPFS) con dos fechas: **cierre de ofertas** y **fecha límite de adjudicación**. Carga el **monto oficial de cada etapa**: la suma es el presupuesto oficial (tope para adjudicar). Cada oferente cotiza su propio monto por etapa. | `crearLicitacion` |
| 2. Ofertas | El proveedor prueba con Semaphore que está habilitado y manda dos cifrados con timelock (drand): el contenido de la oferta (se puede abrir desde el cierre) y su identidad (desde la fecha límite). La oferta la manda el relayer. El nullifier impide ofertar dos veces. | dApp + relayer |
| 3. Apertura de sobres | Después del cierre, un empleado del organismo abre **todos los sobres juntos**, en una sola transacción, cuando va a evaluar. El ofertante no puede abrir nada; los sobres que no se pueden descifrar quedan descartados. Cualquiera puede verificar la apertura. | `abrirSobres` |
| 4. Adjudicación | El empleado elige una oferta por número y publica su dictamen, antes de la fecha límite (después solo puede declararla desierta). | `adjudicar` |
| 5. Identidades | En la fecha límite drand libera la segunda clave y las identidades de todas las ofertas se revelan solas (las publica el bot del backend o cualquiera desde la dApp). El ganador puede revelarse antes si quiere arrancar la obra. | `revelarIdentidades` |
| 6. Ejecución | El organismo deposita el monto adjudicado en el contrato (escrow, en ETH: 1 peso = 1 gwei). El organismo asigna la cantidad de inspectores **del mismo organismo** que fijó al publicar (ni más ni menos: hasta tenerlos a todos no se aprueba nada). Las etapas se aprueban en orden y cada una tiene que aprobarla **cada uno** de los inspectores; cuando aprueba el último, el contrato le paga solo al contratista lo que cotizó para esa etapa. | `depositarFondos`, `registrarEvaluacion` |

## Estructura

```
civicchain/
├── contracts/   Smart contracts (Hardhat 3 + OpenZeppelin 5 + Semaphore 4)
│   ├── contracts/   CredencialNFT.sol, Licitaciones.sol
│   ├── test/        tests (Mocha + ethers), con pruebas ZK reales
│   ├── scripts/     deploy, seed y utilidades
│   └── tasks/       tasks de consola (credenciales)
├── backend/     Node 22, sin frameworks
│   └── src/         verificador AFIP + firma EIP-712, base SQLite, IPFS local, relayer, bot de identidades
└── frontend/    dApp (Vite + ethers v6 + Semaphore + tlock)
    └── src/
        ├── shared/      reglas del protocolo compartidas con backend y tests (hashes, EIP-712)
        ├── web3/        sesión, contratos, backend, identidad anónima, grupo, timelock
        └── ui/          pantallas
```

Requisitos: Node.js 22.13 o superior.

## Levantar todo en local

```bash
cd contracts && npm install && cd ../backend && npm install && cd ../frontend && npm install && cd ..
```

Cuatro terminales:

```bash
# 1. Blockchain local (se borra al reiniciarla)
cd contracts && npm run node

# 2. Contratos (Semaphore + CredencialNFT + Licitaciones). Escribe direcciones y ABIs en frontend/src/config/
cd contracts && npx hardhat run scripts/deploy.ts --network localhost

# 3. Backend en http://localhost:8787 (toma solo las direcciones nuevas si se vuelve a desplegar)
cd backend && npm start

# 4. Datos de ejemplo (necesita el backend corriendo) y la dApp en http://localhost:5173
cd contracts && npx hardhat run scripts/seed.ts --network localhost
cd frontend && npm run dev
```

En MetaMask: agregar la red `http://127.0.0.1:8545` (chain id `31337`; la dApp ofrece agregarla) e importar
las cuentas de prueba que se quieran usar (sus claves se muestran al iniciar `npm run node`). Si se reinicia el
nodo, MetaMask → Configuración → Avanzado → **Borrar datos de actividad**.

### Cuentas del seed

| Cuenta | Estado |
|---|---|
| #0 | Admin (deployer). Las wallets del equipo (`contracts/config/admins.ts`) también son admins y reciben 100 ETH |
| #1 | Ana Pérez, empleada de la Municipalidad de Quilmes (publicó las licitaciones de ejemplo) |
| #2 | Luis Gómez, inspector de la Municipalidad de Berazategui |
| #17 | Laura Benítez, inspectora de Quilmes (la que puede controlar las obras de Ana) |
| #3 | Proveedor: Construcciones del Sur S.A. (inscripción aprobada sola) |
| #4 | Carlos Díaz, empleado de Avellaneda, vence a los 5 minutos |
| #5 | Marta Ruiz, de baja en el padrón, credencial revocada |
| #6 | Proveedor: Obras del Norte S.R.L. (inscripción aprobada sola) |
| #7 | Electro Sur S.R.L.: inscripción rechazada sola (la razón social no coincide con AFIP) |
| #8 | Viales Bonaerenses S.A.: inscripción rechazada sola (CUIT inactivo) |
| #9 | Jorge Medina, de baja en el padrón pero con credencial vigente (la auditoría lo detecta) |
| #10 | Sofía Torres, inspectora activa en el padrón, todavía sin credencial |
| #11 / #12 | Pablo Ríos: credencial en su wallet anterior / wallet nueva declarada |
| #13 en adelante | Sin credencial (para probar una inscripción nueva o un alta manual) |
| #18 / #19 | Verificador y relayer del backend (no usar) |

Licitaciones de ejemplo: una cierra 15 minutos después del seed y tiene fecha límite de adjudicación a los 35
(para mostrar todo el flujo en una clase); la otra cierra en una semana.

## Credenciales

- **Proveedores (inscripción automática):** completan CUIT, razón social, domicilio, rubros y clave fiscal. El
  backend verifica en la AFIP simulada que el CUIT exista y esté activo, que la razón social coincida y que quien
  se inscribe represente a la empresa (clave fiscal). Si todo está bien firma una autorización EIP-712 y el
  proveedor la presenta en `inscribirProveedor`: recibe la credencial en esa misma transacción. Si algo falla, el
  rechazo queda en la base con su motivo y no llega a la cadena. No hay aprobación manual.
- **Empleados e inspectores (alta por el admin):** Administración → Alta de funcionarios. Se cargan wallet, rol,
  organismo, nombre, DNI, área, cargo y resolución (o se importan del padrón de RR.HH. por DNI). Ya no hay
  formulario de registro para ellos.
- **Datos fuera de la cadena:** los datos completos quedan en la base del backend (SQLite) junto con una sal; en la
  credencial va `datosHash = keccak256(JSON canónico + sal)`. Cualquiera con los datos puede recalcular el hash
  ("Datos" en el panel de admin, "Verificar" en Mi credencial). Se usa un hash por registro y no un árbol de Merkle
  porque se ancla un registro por transacción; el Merkle tree ya está en el grupo de Semaphore.
- **Revocar un proveedor** lo saca también del grupo de Semaphore (la dApp calcula la prueba de Merkle sola).
  Un proveedor con la credencial vencida lo puede sacar del grupo cualquiera (`quitarVencidoDelGrupo`).

### AFIP simulada

`backend/src/afip/` imita el servicio `ws_sr_padron_a13`. La clave fiscal de cada CUIT de prueba está en
`padron.json` (`claveFiscalDemo`):

| CUIT | Contribuyente | Clave fiscal demo | Resultado |
|---|---|---|---|
| 30-71234567-1 | Construcciones del Sur S.A. | DEMO-7123 | OK (ya inscripta por el seed) |
| 30-70987654-2 | Obras del Norte S.R.L. | DEMO-7098 | OK (ya inscripta por el seed) |
| 30-71111222-3 | Pinturas Ribera S.A. | DEMO-7111 | OK |
| 30-71999888-3 | Electro Conurbano S.R.L. | DEMO-7199 | OK, o "razón social no coincide" |
| 30-70555444-3 | Viales Bonaerenses S.A. | DEMO-7055 | CUIT inactivo |
| 20-30111222-0 | García Juan Carlos | DEMO-3011 | OK |
| 30-71222333-9 | — | — | CUIT inexistente |

### Consola

```bash
npx hardhat credencial funcionario --dni 35222333 --network localhost   # alta desde el padrón (guarda los datos en el backend)
npx hardhat credencial auditar --network localhost
npx hardhat credencial revocar --wallet 0x... --motivo "Baja" --network localhost   # a proveedores los saca del grupo
npx hardhat credencial renovar --wallet 0x... --dias 90 --network localhost
npx hardhat credencial estado  --wallet 0x... --network localhost
```

## Backend

| Ruta | Para qué |
|---|---|
| `POST /api/inscripciones` | Verifica en AFIP y firma la autorización (o rechaza con motivo) |
| `GET /api/inscripciones?wallet=` | Historial de una wallet |
| `GET /api/inscripciones/hash/:hash` | Datos completos + sal de una inscripción (son datos públicos de la empresa) |
| `GET /api/inscripciones/todas` | (admin) Todas las decisiones del verificador |
| `POST /api/funcionarios` / `GET /api/funcionarios/hash/:hash` | (admin) Alta de funcionarios y sus datos (con DNI) |
| `POST /api/ipfs` · `GET /ipfs/:cid` | IPFS local con CIDs compatibles (CIDv1 raw sha-256) |
| `POST /api/relayer/ofertas` | Manda una oferta anónima a la cadena |

El acceso de admin se prueba firmando un mensaje con la wallet (se verifica `ADMIN_ROLE` en el contrato).
Variables de entorno: `RPC_URL`, `VERIFICADOR_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `PORT`, `ORIGEN_DAPP`,
`DB_PATH`, `IPFS_DIR`, `INTERVALO_BOT_MS` (ver `backend/src/config.js`). En local no hace falta ninguna.

## dApp

| Quién | Qué ve |
|---|---|
| Cualquiera (sin wallet) | Inicio con estadísticas reales, licitaciones, detalle con ofertas, decisiones, etapas y transacciones |
| Sin credencial | Inscripción de proveedor (con el motivo del último rechazo, si hubo) |
| Cualquiera con wallet | "Verificar apertura" (descifra los sobres y compara) y "Revelar identidades" después de la fecha límite |
| Proveedor | Ofertar de forma anónima; si ganó, revelarse antes de la fecha límite (opcional) |
| Empleado | Publicar licitación; abrir los sobres, adjudicar o declarar desierta, depositar los fondos y asignar inspectores (solo su organismo). En el listado ve solo las licitaciones de su organismo, con las que publicó él marcadas |
| Inspector asignado | En el listado ve solo las obras en las que está asignado. Aprueba u observa la siguiente etapa, con informe en IPFS; cuando aprueban todos los inspectores se le paga al contratista |
| Admin | Alta de funcionarios, decisiones del verificador, auditoría contra el padrón, credenciales |

El filtro de los listados por rol es solo de la interfaz: los datos de las licitaciones son públicos en la blockchain.

La identidad anónima del proveedor no se guarda en ningún lado: sale de firmar siempre el mismo mensaje con la
wallet. Lo mismo la sal de autoría de cada licitación. Así se recupera desde cualquier navegador.

Conexión por **QR** (WalletConnect): definir `VITE_WALLETCONNECT_PROJECT_ID` (gratis en cloud.reown.com) en
`frontend/.env`. Solo funciona en Sepolia: el celular no llega a la red local.

## Tests

```bash
cd contracts && npm test   # 99 tests: credenciales, licitaciones (con pruebas ZK reales), AFIP y padrón
cd backend && npm test     # verificador, firma, base, IPFS, bot de identidades y API HTTP
```

Si no se puede descargar el compilador (sin internet): `npm i -D solc@0.8.28` y
`SOLC_JS_PATH=node_modules/solc/soljson.js npm test`.

## Sepolia

### Despliegue actual

Desplegado el 23/11/2026 en el bloque 12197858 (las direcciones y ABIs están en `frontend/src/config/`).

| Contrato | Dirección |
|---|---|
| Semaphore | [`0x2D11105cfB96A537Cc01200D18b5020c79C52c05`](https://sepolia.etherscan.io/address/0x2D11105cfB96A537Cc01200D18b5020c79C52c05) |
| CredencialNFT | [`0x0946701CFD4f8031c7790F3561A2C96e358FBD6f`](https://sepolia.etherscan.io/address/0x0946701CFD4f8031c7790F3561A2C96e358FBD6f) |
| Licitaciones | [`0x33D584F0DCf0be7B4506AF0E9979ad170aE880fE`](https://sepolia.etherscan.io/address/0x33D584F0DCf0be7B4506AF0E9979ad170aE880fE) |

Semaphore se desplegó junto con su librería PoseidonT3 y su SemaphoreVerifier.

| Wallet | Dirección | Rol |
|---|---|---|
| Verificador (backend) | [`0x1dcD1a54610cC4B523f6b136027e43F24d37DC30`](https://sepolia.etherscan.io/address/0x1dcD1a54610cC4B523f6b136027e43F24d37DC30) | `VERIFICADOR_ROLE`: firma las inscripciones de proveedores |
| Relayer (backend) | [`0x347fb54a16dc15efAAcFe12d9Eb7973944466C3c`](https://sepolia.etherscan.io/address/0x347fb54a16dc15efAAcFe12d9Eb7973944466C3c) | Paga el gas de las ofertas anónimas (hay que mantenerle ETH de prueba) |
| Deployer | [`0x3cCF250aDb7839Fe6569B97279f547A63F3de66D`](https://sepolia.etherscan.io/address/0x3cCF250aDb7839Fe6569B97279f547A63F3de66D) | Ninguno: renunció a sus roles después del despliegue |

Los admins (`ADMIN_ROLE` y `DEFAULT_ADMIN_ROLE`) son las wallets del equipo de `contracts/config/admins.ts`.
Las claves privadas no están en el repo: quedan en archivos locales ignorados por git
(`contracts/.env.sepolia` y `backend/.env`).

### Usar el despliegue actual

```bash
# backend/.env (lo lee `npm start`)
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VERIFICADOR_PRIVATE_KEY=0x...
RELAYER_PRIVATE_KEY=0x...

# frontend/.env.local
VITE_CHAIN_ID=11155111
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_BACKEND_URL=http://localhost:8787
```

Después `npm start` en `backend/` y `npm run dev` en `frontend/`, con MetaMask en Sepolia. Para volver a la red
local, sacar (o renombrar) esos dos archivos. `scripts/seed.ts` usa cuentas de Hardhat: no sirve en Sepolia.

Los RPC públicos limitan el rango de `eth_getLogs` (publicnode: 50.000 bloques); la dApp y el backend consultan
los eventos en tramos (`frontend/src/shared/eventos.js`).

### Volver a desplegar

Con variables de entorno (o con `npx hardhat keystore set SEPOLIA_RPC_URL` / `SEPOLIA_PRIVATE_KEY`):

```powershell
cd contracts
$env:SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
$env:SEPOLIA_PRIVATE_KEY="0x..."          # el deployer, con ETH de prueba (~0,15 si el gas está alto)
$env:VERIFICADOR_ADDRESS="0x..."          # la dirección de VERIFICADOR_PRIVATE_KEY del backend
npx hardhat run scripts/deploy.ts --network sepolia
```

El despliegue usa ~16,7M de gas. Después hay que mandarle ETH de prueba al relayer. Ojo: mandar ETH a una cuenta
nueva cuesta más de 21.000 de gas en Sepolia, así que no hay que fijar el gas a mano.
