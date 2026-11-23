// Punto de entrada del backend: npm start

import { readFileSync } from "node:fs";
import * as ethers from "ethers";
import { crearClienteAfip } from "./afip/afip.js";
import { crearBotIdentidades } from "./identidades.js";
import { crearCadena } from "./cadena.js";
import { config } from "./config.js";
import { abrirBase } from "./db.js";
import { crearServicioFuncionarios } from "./funcionarios.js";
import { crearServicioInscripciones } from "./inscripciones.js";
import { crearIpfsLocal } from "./ipfs.js";
import { crearRelayer } from "./relayer.js";
import { crearServidor } from "./servidor.js";
import { crearProtocolo } from "../../frontend/src/shared/protocolo.js";

const protocolo = crearProtocolo(ethers);
const db = abrirBase(config.baseDeDatos);
const afip = crearClienteAfip(JSON.parse(readFileSync(new URL("./afip/padron.json", import.meta.url), "utf8")));
const cadena = crearCadena(config);

const servidor = crearServidor({
  config,
  cadena,
  inscripciones: crearServicioInscripciones({ db, afip, cadena, protocolo, config }),
  funcionarios: crearServicioFuncionarios({ db, protocolo }),
  ipfs: crearIpfsLocal(config.carpetaIpfs, db),
  relayer: crearRelayer({ cadena }),
});

servidor.listen(config.puerto, () => {
  console.log(`Backend de CivicChain en http://localhost:${config.puerto}`);
  console.log(`  Blockchain:  ${config.rpcUrl}`);
  console.log(`  Verificador: ${cadena.verificador.address}`);
  console.log(`  Relayer:     ${cadena.relayer.address} (necesita ETH para pagar el gas)`);
});

const bot = crearBotIdentidades({ cadena });
bot.iniciar(config.intervaloBotMs);

process.on("SIGINT", () => {
  bot.detener();
  servidor.close();
  db.cerrar();
  process.exit(0);
});
