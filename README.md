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

Todos los comandos de esta sección se corren **desde la carpeta `contracts/`** (no desde la raíz del repo).

Terminal 1, dejar corriendo el nodo:

```bash
cd contracts
npm run node
```

Terminal 2:

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network localhost   # despliega y exporta dirección + ABI al frontend
npx hardhat run scripts/seed.ts --network localhost     # credenciales de ejemplo + 100 ETH a cada admin
```

Terminal 3, la dApp:

```bash
cd frontend
npm run dev
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
| #5 | Marta Ruiz, de baja en el padrón, credencial revocada |
| #6 | Obras del Norte S.R.L., solicitud pendiente (AFIP ✓) |
| #7 | Electro Sur S.R.L., solicitud pendiente (AFIP ✗: la razón social no coincide) |
| #8 | Viales Bonaerenses S.A., solicitud pendiente (AFIP ✗: CUIT inactivo) |
| #9 | Jorge Medina, de baja en el padrón pero con credencial vigente (la auditoría lo detecta) |
| #10 | Sofía Torres, inspectora activa en el padrón, todavía sin credencial |
| #11 | Pablo Ríos, credencial en su wallet anterior |
| #12 | Pablo Ríos, wallet nueva declarada en el padrón, todavía sin credencial |
| #13 en adelante | Sin credencial ni solicitud |

### Cómo se obtiene cada credencial

- **Empleados e inspectores:** un admin los da de alta con su DNI. Nombre, función, organismo y wallet se
  toman del padrón de empleados. En la cadena queda su nombre y organismo, nunca su DNI.
- **Proveedores:** se inscriben desde su wallet con CUIT, razón social, domicilio legal y rubros. Un admin
  verifica el CUIT en AFIP y aprueba o rechaza la solicitud. El CUIT y la razón social son públicos.

### AFIP simulada

`frontend/src/services/afip/` imita la consulta al padrón de AFIP (servicio `ws_sr_padron_a13`). La usan la
dApp y las tasks de consola. El padrón de ejemplo (`padron.json`) tiene un caso para cada resultado:

| CUIT | Contribuyente | Resultado al verificar |
|---|---|---|
| 30-71234567-1 | Construcciones del Sur S.A. | OK |
| 30-70987654-2 | Obras del Norte S.R.L. | OK |
| 30-71111222-3 | Pinturas Ribera S.A. | OK |
| 30-71999888-3 | Electro Conurbano S.R.L. | OK, o "razón social no coincide" si se escribe otro nombre |
| 30-70555444-3 | Viales Bonaerenses S.A. | CUIT inactivo |
| 20-30111222-0 | García Juan Carlos (persona física) | OK |
| 27-25666777-6 | Fernández Laura (persona física) | OK |
| 30-71222333-9 | — | CUIT inexistente |

La comparación de la razón social ignora mayúsculas, tildes y puntuación ("Construcciones del Sur SA" coincide).
Conectarla a la AFIP real requiere un backend con certificado digital; solo cambiaría `consultarCuit`.

### Padrón de empleados simulado

`frontend/src/services/padron-empleados/` representa la base de Recursos Humanos de los organismos: DNI,
nombre, función, organismo, cargo, resolución, estado (activo o baja) y la **wallet declarada** por cada
persona. El vínculo DNI ↔ wallet vive solo acá, fuera de la cadena.

La auditoría cruza las credenciales vigentes con el padrón y detecta:

| Hallazgo | Acción sugerida |
|---|---|
| Figura de baja y su credencial sigue sin revocar | Revocar |
| Declaró otra wallet | Revocar la anterior y emitir una nueva |
| La wallet de la credencial no figura en el padrón | Revocar |
| Cambió de organismo o de función | Revocar y emitir una nueva |
| Sigue en actividad, pero la credencial venció | Renovar |
| Está en actividad con wallet declarada y no tiene credencial | Emitir |

### Administrar credenciales desde la consola

Empleados e inspectores:

```bash
npx hardhat credencial funcionario --dni 35222333 --network localhost   # toma los datos del padrón
npx hardhat credencial auditar --network localhost                     # inconsistencias con el padrón
```

Solicitudes de proveedores:

```bash
npx hardhat credencial solicitudes [--todas] --network localhost
npx hardhat credencial aprobar  --solicitud 2 --network localhost   # verifica en AFIP; si falla no aprueba (salvo --forzar)
npx hardhat credencial rechazar --solicitud 3 --motivo "La razón social no coincide con AFIP" --network localhost

# Simular la inscripción de un proveedor desde una cuenta de prueba (solo red local)
npx hardhat credencial solicitar --cuenta 13 --cuit 30-71111222-3 --razon-social "Pinturas Ribera S.A." \
  --domicilio "Mitre 100, Avellaneda" --rubros "Pintura" --network localhost
```

Cualquier credencial:

```bash
npx hardhat credencial revocar --wallet 0x... --motivo "Baja en el padrón" --network localhost
npx hardhat credencial renovar --wallet 0x... --dias 90 --network localhost
npx hardhat credencial estado  --wallet 0x... --network localhost
```

- `--dni`: con o sin puntos. La persona tiene que estar activa en el padrón y con wallet declarada.
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

### Cómo funciona el login

No hay usuario ni contraseña: la identidad es la wallet. Al conectar MetaMask, la dApp lee del contrato qué
credencial tiene la wallet y muestra las pantallas que corresponden. El NFT nunca sale de la wallet.

| Quién | Qué ve |
|---|---|
| Sin wallet o sin credencial | Licitaciones públicas y "Registrarse" |
| Proveedor sin credencial | Formulario de inscripción (CUIT verificado en AFIP) o el estado de su solicitud |
| Cualquier wallet conectada | "Mi credencial": estado (vigente, vencida o revocada, con el motivo) |
| Admin (`ADMIN_ROLE`) | "Administración": solicitudes, alta de funcionarios por DNI, auditoría y credenciales |

La dApp escucha los eventos del contrato: si un admin aprueba, rechaza o revoca, la pantalla del usuario se
actualiza sola, sin recargar.

Este chequeo es solo para la interfaz. La seguridad la dan los contratos, que verifican el rol en cada transacción.

### Probar con MetaMask contra la red local

1. Levantar el nodo, desplegar y cargar el seed (ver "Entorno local").
2. En MetaMask, agregar la red `http://127.0.0.1:8545` con chain id `31337` (la dApp ofrece agregarla sola).
3. Importar las cuentas de prueba que se quieran usar (claves privadas en la salida de `npm run node`).
4. `npm run dev` y abrir `http://localhost:5173`.

Si se reinicia el nodo, MetaMask puede quedar con datos viejos de la red local y fallar al enviar
transacciones. Se arregla en MetaMask → Configuración → Avanzado → **Borrar datos de actividad**.
