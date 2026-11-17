# CivicChain

Plataforma de licitaciones públicas transparentes con ofertas anónimas.
Trabajo Práctico Integrador — Seminario de Blockchain & Smart Contracts, UNQ.

## Cómo funciona

| Fase | Qué pasa | Dónde |
|---|---|---|
| 0. Habilitación | El proveedor se inscribe; el backend verifica en AFIP y firma una autorización; recibe su credencial (NFT intransferible) y su identidad anónima entra al grupo de Semaphore. Empleados e inspectores los da de alta un admin. | `CredencialNFT` + backend |
| 1. Publicación | Un empleado publica la licitación (NFT ERC-721 con tokenURI a IPFS: pliego, descripción, etapas). | `Licitaciones` |
| 2. Ofertas | El proveedor cifra monto, plazo y desglose con timelock (drand) y prueba con Semaphore que está habilitado. La oferta la manda el relayer: ninguna wallet identificable aparece. El nullifier impide ofertar dos veces. | dApp + relayer |
| 3. Apertura | Al vencer el plazo cualquiera descifra y publica los montos; el contrato verifica el compromiso. Lo hace solo el bot del backend o cualquier ciudadano desde la dApp. | `abrirOferta` |
| 4. Adjudicación | Un empleado del organismo elige una oferta por número y publica su dictamen en IPFS (o la declara desierta). | `adjudicar` |
| 5. Cierre | Ganador y perdedores revelan desde su wallet real qué oferta era suya. | `revelarAutoria` |
| 6. Ejecución | Un empleado asigna inspectores, que aprueban u observan cada etapa en orden hasta finalizar la obra. | `registrarEvaluacion` |

## Estructura

```
civicchain/
├── contracts/   Smart contracts (Hardhat 3 + OpenZeppelin 5 + Semaphore 4)
│   ├── contracts/   CredencialNFT.sol, Licitaciones.sol
│   ├── test/        tests (Mocha + ethers), con pruebas ZK reales
│   ├── scripts/     deploy, seed y utilidades
│   └── tasks/       tasks de consola (credenciales)
├── backend/     Node 22, sin frameworks
│   └── src/         verificador AFIP + firma EIP-712, base SQLite, IPFS local, relayer, bot de apertura
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

Licitaciones de ejemplo: una cierra 15 minutos después del seed (para mostrar ofertas y apertura en clase) y otra
en una semana.

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
`DB_PATH`, `IPFS_DIR`, `INTERVALO_APERTURA_MS` (ver `backend/src/config.js`). En local no hace falta ninguna.

## dApp

| Quién | Qué ve |
|---|---|
| Cualquiera (sin wallet) | Inicio con estadísticas reales, licitaciones, detalle con ofertas, decisiones, etapas y transacciones |
| Sin credencial | Inscripción de proveedor (con el motivo del último rechazo, si hubo) |
| Proveedor | Ofertar de forma anónima; después de adjudicar, "Buscar mi oferta y revelar" |
| Empleado | Publicar licitación; adjudicar o declarar desierta las de su organismo; asignar inspectores |
| Inspector asignado | Aprobar u observar la siguiente etapa, con informe en IPFS |
| Admin | Alta de funcionarios, decisiones del verificador, auditoría contra el padrón, credenciales |

La identidad anónima del proveedor no se guarda en ningún lado: sale de firmar siempre el mismo mensaje con la
wallet. Lo mismo la sal de autoría de cada licitación. Así se recupera desde cualquier navegador.

Conexión por **QR** (WalletConnect): definir `VITE_WALLETCONNECT_PROJECT_ID` (gratis en cloud.reown.com) en
`frontend/.env`. Solo funciona en Sepolia: el celular no llega a la red local.

## Tests

```bash
cd contracts && npm test   # 90 tests: credenciales, licitaciones (con pruebas ZK reales), AFIP y padrón
cd backend && npm test     # verificador, firma, base, IPFS, bot de apertura y API HTTP
```

Si no se puede descargar el compilador (sin internet): `npm i -D solc@0.8.28` y
`SOLC_JS_PATH=node_modules/solc/soljson.js npm test`.

## Sepolia

```bash
cd contracts
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
VERIFICADOR_ADDRESS=0x... npx hardhat run scripts/deploy.ts --network sepolia
```

Después: el backend con `RPC_URL`, `VERIFICADOR_PRIVATE_KEY` (la de `VERIFICADOR_ADDRESS`) y `RELAYER_PRIVATE_KEY`
(con ETH de prueba), y la dApp con `VITE_CHAIN_ID=11155111` y `VITE_BACKEND_URL`.

## Dudas y limitaciones (marcadas con `DUDA` / `LIMITACIÓN` en el código)

- **Apertura selectiva** (`Licitaciones.abrirOferta`): el contrato verifica el compromiso, no que el cifrado sea
  correcto. Una empresa podría cifrar basura y abrir su oferta ella misma solo si le conviene. Mitigaciones: una
  garantía que se pierde si la oferta no se abre, o una prueba ZK de cifrado correcto.
- **Revelación obligatoria** (`revelarAutoria`): no hay forma de forzar al ganador a revelar. Falta definir el plazo y
  qué pasa si no lo hace (¿se readjudica a la segunda?).
- **Préstamo de autoría**: dos proveedores habilitados podrían ponerse de acuerdo para que uno revele la oferta del
  otro. Evitarlo sin romper el anonimato requiere otra prueba ZK al revelar.
- **Raíces viejas de Semaphore** (`DURACION_RAIZ = 1 hora`): un proveedor revocado puede seguir probando durante ese
  lapso. ¿Alcanza o conviene bajarla?
- **Inspectores**: hoy se puede asignar cualquier inspector vigente. ¿Tiene que ser del mismo organismo?
- **Ventana de apertura mínima**: 5 minutos, para poder hacer la demo. En producción, días.
- **Inscripciones sin camino de excepción**: una empresa que AFIP todavía no lista queda rechazada.
- **Pagos por hitos (escrow)**: siguen fuera de alcance; `registrarEvaluacion` es donde se liberaría cada pago.
- **Producción**: base gestionada en lugar de SQLite, *pinning* real en IPFS (Pinata/Storacha), RPC propio para
  Sepolia, el relayer ve la IP de quien oferta, artefactos ZK servidos por nosotros en lugar del CDN de Semaphore,
  wallets que no firman de forma determinística (hardware/multisig).
