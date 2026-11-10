import { expect } from "chai";
import { readFile } from "node:fs/promises";
import { network } from "hardhat";
import {
  HALLAZGOS,
  RESULTADOS_ALTA,
  crearClientePadron,
} from "../../frontend/src/services/padron-empleados/padron.js";

const registros = JSON.parse(
  await readFile(new URL("../../frontend/src/services/padron-empleados/padron.json", import.meta.url), "utf8"),
);
const padron = crearClientePadron(registros);

const ANA = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const JORGE = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
const PABLO_ANTERIOR = "0x71bE63f3384f5fb98995898A86B02Fb2426c5788";

type Rol = "PROVEEDOR" | "EMPLEADO" | "INSPECTOR";

/** Credencial vigente de ejemplo; los parámetros pisan los valores por defecto. */
function credencial(datos: { tokenId: number; wallet: string; nombre: string; rol?: Rol; organismoId?: number; revocada?: boolean; vencida?: boolean }) {
  return { rol: "EMPLEADO" as Rol, organismoId: 1, revocada: false, vencida: false, ...datos };
}

const anaEnRegla = credencial({ tokenId: 1, wallet: ANA, nombre: "Ana Pérez" });

describe("Padrón de empleados simulado", () => {
  it("las wallets del padrón son cuentas de prueba de Hardhat (para importarlas en MetaMask)", async () => {
    const { ethers } = await network.create();
    const cuentas = new Set((await ethers.getSigners()).map((s) => s.address.toLowerCase()));
    for (const e of registros) {
      if (e.wallet) expect(cuentas.has(e.wallet.toLowerCase()), e.nombre).to.equal(true);
    }
  });

  it("un DNI aparece una sola vez y una wallet pertenece a una sola persona", () => {
    const dnis = registros.map((e: { dni: string }) => e.dni);
    const wallets = registros.filter((e: { wallet: string | null }) => e.wallet).map((e: { wallet: string }) => e.wallet.toLowerCase());
    expect(new Set(dnis).size).to.equal(dnis.length);
    expect(new Set(wallets).size).to.equal(wallets.length);
  });

  describe("consultas", () => {
    it("consultarDni acepta el DNI con o sin puntos", async () => {
      expect((await padron.consultarDni("30.111.222"))?.nombre).to.equal("Ana Pérez");
      expect(await padron.consultarDni("99999999")).to.equal(null);
    });

    it("buscarPorWallet no distingue mayúsculas", async () => {
      expect((await padron.buscarPorWallet(ANA.toLowerCase()))?.dni).to.equal("30111222");
    });
  });

  describe("verificarAlta", () => {
    it("OK para un empleado activo con wallet", async () => {
      const r = await padron.verificarAlta("30111222");
      expect(r.resultado).to.equal(RESULTADOS_ALTA.OK);
      expect(r.empleado?.wallet).to.equal(ANA);
    });

    it("rechaza DNI inexistente, empleados de baja y sin wallet declarada", async () => {
      expect((await padron.verificarAlta("99999999")).resultado).to.equal(RESULTADOS_ALTA.DNI_INEXISTENTE);
      expect((await padron.verificarAlta("27666777")).resultado).to.equal(RESULTADOS_ALTA.BAJA);
      expect((await padron.verificarAlta("36777888")).resultado).to.equal(RESULTADOS_ALTA.SIN_WALLET);
    });
  });

  describe("auditar", () => {
    const tipos = async (credenciales: ReturnType<typeof credencial>[]) =>
      (await padron.auditar(credenciales)).map((h) => h.tipo);

    it("no reporta nada para una credencial en regla", async () => {
      const hallazgos = await padron.auditar([anaEnRegla]);
      expect(hallazgos.filter((h) => h.credencial?.tokenId === 1)).to.deep.equal([]);
    });

    it("detecta empleados de baja con credencial sin revocar", async () => {
      const jorge = credencial({ tokenId: 2, wallet: JORGE, nombre: "Jorge Medina", organismoId: 2 });
      const [h] = await padron.auditar([jorge]);
      expect(h.tipo).to.equal(HALLAZGOS.BAJA_CON_CREDENCIAL);
      expect(h.accion).to.equal("REVOCAR");
    });

    it("ignora credenciales revocadas y de proveedores", async () => {
      const jorgeRevocado = credencial({ tokenId: 2, wallet: JORGE, nombre: "Jorge Medina", organismoId: 2, revocada: true });
      const proveedor = credencial({ tokenId: 3, wallet: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", nombre: "X S.A.", rol: "PROVEEDOR", organismoId: 0 });
      expect(await tipos([jorgeRevocado, proveedor])).to.not.include(HALLAZGOS.BAJA_CON_CREDENCIAL);
      expect(await tipos([jorgeRevocado, proveedor])).to.not.include(HALLAZGOS.WALLET_DESCONOCIDA);
    });

    it("detecta cuando la persona declaró otra wallet", async () => {
      const pablo = credencial({ tokenId: 4, wallet: PABLO_ANTERIOR, nombre: "Pablo Ríos" });
      const [h] = await padron.auditar([pablo]);
      expect(h.tipo).to.equal(HALLAZGOS.WALLET_CAMBIADA);
      expect(h.accion).to.equal("REVOCAR_Y_EMITIR");
      expect(h.empleado?.dni).to.equal("31555666");
    });

    it("una persona con la wallet cambiada no aparece además como 'sin credencial'", async () => {
      const pablo = credencial({ tokenId: 4, wallet: PABLO_ANTERIOR, nombre: "Pablo Ríos" });
      const dePablo = (await padron.auditar([pablo])).filter((h) => h.empleado?.dni === "31555666");
      expect(dePablo.map((h) => h.tipo)).to.deep.equal([HALLAZGOS.WALLET_CAMBIADA]);
    });

    it("detecta wallets que no figuran en el padrón", async () => {
      const desconocida = credencial({ tokenId: 5, wallet: "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec", nombre: "Nadie" });
      expect(await tipos([desconocida])).to.include(HALLAZGOS.WALLET_DESCONOCIDA);
    });

    it("detecta cambios de organismo y de función", async () => {
      const otroOrganismo = credencial({ tokenId: 1, wallet: ANA, nombre: "Ana Pérez", organismoId: 3 });
      const otraFuncion = credencial({ tokenId: 1, wallet: ANA, nombre: "Ana Pérez", rol: "INSPECTOR" });
      expect(await tipos([otroOrganismo])).to.include(HALLAZGOS.CAMBIO_ORGANISMO);
      expect(await tipos([otraFuncion])).to.include(HALLAZGOS.CAMBIO_FUNCION);
    });

    it("sugiere renovar si la persona sigue activa y la credencial venció", async () => {
      const vencida = credencial({ tokenId: 1, wallet: ANA, nombre: "Ana Pérez", vencida: true });
      const h = (await padron.auditar([vencida])).find((x) => x.credencial?.tokenId === 1);
      expect(h?.tipo).to.equal(HALLAZGOS.VENCIDA);
      expect(h?.accion).to.equal("RENOVAR");
    });

    it("lista a los activos con wallet que no tienen credencial (y no a los de baja ni sin wallet)", async () => {
      const sinCredencial = (await padron.auditar([anaEnRegla]))
        .filter((h) => h.tipo === HALLAZGOS.SIN_CREDENCIAL)
        .map((h) => h.empleado?.nombre);
      expect(sinCredencial).to.include("Sofía Torres");
      expect(sinCredencial).to.not.include("Ana Pérez");
      expect(sinCredencial).to.not.include("Marta Ruiz"); // de baja
      expect(sinCredencial).to.not.include("Diego Sosa"); // sin wallet
    });
  });
});
