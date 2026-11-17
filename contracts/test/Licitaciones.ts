import { expect } from "chai";
import { network } from "hardhat";
import { Group } from "@semaphore-protocol/core";
import {
  BERAZATEGUI,
  CUIT_NORTE,
  CUIT_SUR,
  QUILMES,
  Rol,
  autorizarInscripcion,
  desplegarCredenciales,
  identidad,
  probar,
  protocolo,
} from "./lib/fixtures.js";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const Estado = {
  RECIBIENDO_OFERTAS: 0n,
  APERTURA: 1n,
  EVALUACION: 2n,
  ADJUDICADA: 3n,
  EN_EJECUCION: 4n,
  FINALIZADA: 5n,
  DESIERTA: 6n,
} as const;

const HORA = 3600;
const PRESUPUESTO = 48_500_000n;
const ETAPAS = [3000, 4000, 3000]; // 30 %, 40 %, 30 %
const SIN_DATOS = ethers.ZeroHash;

/** Credenciales con un empleado de Quilmes, uno de Berazategui, un inspector y dos proveedores en el grupo. */
async function desplegar() {
  const base = await desplegarCredenciales(ethers);
  const { credenciales, verificador, empleado, empleadoOtro, inspector, proveedor, proveedor2, vence } = base;
  await credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", vence, SIN_DATOS);
  await credenciales.emitirFuncionario(empleadoOtro.address, Rol.EMPLEADO, BERAZATEGUI, "Carlos Díaz", vence, SIN_DATOS);
  await credenciales.emitirFuncionario(inspector.address, Rol.INSPECTOR, BERAZATEGUI, "Luis Gómez", vence, SIN_DATOS);

  const idSur = identidad("sur");
  const idNorte = identidad("norte");
  for (const [wallet, id, cuit, nombre] of [
    [proveedor, idSur, CUIT_SUR, "Construcciones del Sur S.A."],
    [proveedor2, idNorte, CUIT_NORTE, "Obras del Norte S.R.L."],
  ] as const) {
    const { datos, firma } = await autorizarInscripcion(ethers, credenciales, verificador, wallet.address, {
      identityCommitment: id.commitment,
      cuit,
      razonSocial: nombre,
    });
    await credenciales.connect(wallet).inscribirProveedor(datos, firma);
  }

  const licitaciones = await ethers.deployContract("Licitaciones", [await credenciales.getAddress()]);
  const nuevoGrupo = () => new Group([idSur.commitment, idNorte.commitment]);
  return { ...base, licitaciones, idSur, idNorte, nuevoGrupo };
}

async function conLicitacion() {
  const base = await desplegar();
  const ahora = await time.latest();
  const cierre = BigInt(ahora + 2 * HORA);
  await base.licitaciones
    .connect(base.empleado)
    .crearLicitacion("Ampliación del Centro de Salud San Martín", "bafkreimetadata", PRESUPUESTO, cierre, HORA, ETAPAS);
  return { ...base, licitacionId: 1n, cierre };
}

/** Arma una oferta completa: compromisos, cifrado simulado y prueba de Semaphore. */
async function armarOferta(
  base: Awaited<ReturnType<typeof desplegar>>,
  licitacionId: bigint,
  quien: "sur" | "norte",
  monto: bigint,
  opciones: { grupo?: Group } = {},
) {
  const id = quien === "sur" ? base.idSur : base.idNorte;
  const wallet = quien === "sur" ? base.proveedor : base.proveedor2;
  const plazoDias = 180;
  const desglose = [(monto * 3n) / 10n, (monto * 4n) / 10n];
  desglose.push(monto - desglose[0] - desglose[1]);
  const sal = protocolo.nuevaSal();
  const sal2 = protocolo.nuevaSal();
  const compromisoMonto = protocolo.compromisoMonto(licitacionId, monto, plazoDias, desglose, sal);
  const compromisoAutoria = protocolo.compromisoAutoria(licitacionId, wallet.address, sal2);
  // En la dApp esto es el cifrado tlock de {monto, plazoDias, desglose, sal}. El contrato no lo lee.
  const cifrado = ethers.toUtf8Bytes(JSON.stringify({ monto: String(monto), plazoDias, sal }));
  const propuestaCID = `bafkreipropuesta${quien}`;
  const mensaje = protocolo.mensajeOferta(licitacionId, ethers.keccak256(cifrado), compromisoMonto, compromisoAutoria, propuestaCID);
  const prueba = await probar(id, opciones.grupo ?? base.nuevoGrupo(), mensaje, licitacionId);
  return { wallet, monto, plazoDias, desglose, sal, sal2, compromisoMonto, compromisoAutoria, cifrado, propuestaCID, prueba };
}

type OfertaArmada = Awaited<ReturnType<typeof armarOferta>>;

const enviar = (lic: Awaited<ReturnType<typeof desplegar>>["licitaciones"], id: bigint, o: OfertaArmada) =>
  lic.ofertar(id, o.cifrado, o.compromisoMonto, o.compromisoAutoria, o.propuestaCID, o.prueba);

/** Licitación con dos ofertas (Sur 45 M, Norte 47 M) ya enviadas por el relayer. */
async function conOfertas() {
  const base = await conLicitacion();
  const relayer = base.otro;
  const sur = await armarOferta(base, base.licitacionId, "sur", 45_000_000n);
  const norte = await armarOferta(base, base.licitacionId, "norte", 47_000_000n);
  await enviar(base.licitaciones.connect(relayer), base.licitacionId, sur);
  await enviar(base.licitaciones.connect(relayer), base.licitacionId, norte);
  return { ...base, relayer, sur, norte };
}

async function conOfertasAbiertas() {
  const base = await conOfertas();
  await time.increaseTo(base.cierre + 1n);
  for (const [ofertaId, o] of [
    [1n, base.sur],
    [2n, base.norte],
  ] as const) {
    await base.licitaciones.abrirOferta(base.licitacionId, ofertaId, o.monto, o.plazoDias, o.desglose, o.sal);
  }
  await time.increase(HORA);
  return base;
}

async function adjudicada() {
  const base = await conOfertasAbiertas();
  await base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 1n, "bafkreidictamen");
  return base;
}

describe("Licitaciones", () => {
  describe("publicación", () => {
    it("un empleado publica la licitación y se mintea su NFT", async () => {
      const { licitaciones, empleado } = await loadFixture(desplegar);
      const cierre = BigInt((await time.latest()) + 2 * HORA);

      await expect(
        licitaciones.connect(empleado).crearLicitacion("Pavimentación", "bafkreimeta", PRESUPUESTO, cierre, HORA, ETAPAS),
      )
        .to.emit(licitaciones, "LicitacionPublicada")
        .withArgs(1n, QUILMES, empleado.address, "Pavimentación", "bafkreimeta", PRESUPUESTO, cierre, cierre + BigInt(HORA));

      expect(await licitaciones.ownerOf(1n)).to.equal(await licitaciones.getAddress());
      expect(await licitaciones.tokenURI(1n)).to.equal("ipfs://bafkreimeta");
      expect(await licitaciones.estado(1n)).to.equal(Estado.RECIBIENDO_OFERTAS);
      const l = await licitaciones.licitacion(1n);
      expect(l.organismoId).to.equal(BigInt(QUILMES));
      expect(l.porcentajesEtapas.map(Number)).to.deep.equal(ETAPAS);
    });

    it("solo publican empleados con credencial vigente", async () => {
      const { licitaciones, inspector, proveedor, otro } = await loadFixture(desplegar);
      const cierre = BigInt((await time.latest()) + 2 * HORA);
      for (const quien of [inspector, proveedor, otro]) {
        await expect(
          licitaciones.connect(quien).crearLicitacion("X", "cid", PRESUPUESTO, cierre, HORA, ETAPAS),
        ).to.be.revertedWithCustomError(licitaciones, "SinRol");
      }
    });

    it("valida etapas, fechas, presupuesto y textos", async () => {
      const { licitaciones, empleado } = await loadFixture(desplegar);
      const cierre = BigInt((await time.latest()) + 2 * HORA);
      const lic = licitaciones.connect(empleado);
      await expect(lic.crearLicitacion("X", "cid", PRESUPUESTO, cierre, HORA, [5000, 4000])).to.be.revertedWithCustomError(
        licitaciones,
        "EtapasInvalidas",
      );
      await expect(lic.crearLicitacion("X", "cid", PRESUPUESTO, cierre, HORA, [])).to.be.revertedWithCustomError(
        licitaciones,
        "EtapasInvalidas",
      );
      await expect(lic.crearLicitacion("X", "cid", PRESUPUESTO, cierre, HORA, [10000, 0])).to.be.revertedWithCustomError(
        licitaciones,
        "EtapasInvalidas",
      );
      await expect(
        lic.crearLicitacion("X", "cid", PRESUPUESTO, BigInt(await time.latest()), HORA, ETAPAS),
      ).to.be.revertedWithCustomError(licitaciones, "FechaInvalida");
      await expect(lic.crearLicitacion("X", "cid", PRESUPUESTO, cierre, 60, ETAPAS)).to.be.revertedWithCustomError(
        licitaciones,
        "FechaInvalida",
      );
      await expect(lic.crearLicitacion("X", "cid", 0, cierre, HORA, ETAPAS)).to.be.revertedWithCustomError(
        licitaciones,
        "PresupuestoInvalido",
      );
      await expect(lic.crearLicitacion("", "cid", PRESUPUESTO, cierre, HORA, ETAPAS)).to.be.revertedWithCustomError(
        licitaciones,
        "TextoInvalido",
      );
    });
  });

  describe("ofertas anónimas", () => {
    it("acepta una oferta con una prueba válida, la mande quien la mande", async () => {
      const base = await loadFixture(conLicitacion);
      const o = await armarOferta(base, base.licitacionId, "sur", 45_000_000n);

      await expect(enviar(base.licitaciones.connect(base.otro), base.licitacionId, o))
        .to.emit(base.licitaciones, "OfertaRecibida")
        .withArgs(
          base.licitacionId,
          1n,
          o.prueba.nullifier,
          ethers.hexlify(o.cifrado),
          o.compromisoMonto,
          o.compromisoAutoria,
          o.propuestaCID,
        );

      const guardada = await base.licitaciones.oferta(base.licitacionId, 1n);
      expect(guardada.abierta).to.equal(false);
      expect(guardada.monto).to.equal(0n);
      expect(guardada.autor).to.equal(ethers.ZeroAddress);
      expect(await base.licitaciones.nullifierUsado(base.licitacionId, o.prueba.nullifier)).to.equal(true);
    });

    it("rechaza una segunda oferta de la misma empresa", async () => {
      const base = await loadFixture(conOfertas);
      const otra = await armarOferta(base, base.licitacionId, "sur", 40_000_000n);
      await expect(enviar(base.licitaciones, base.licitacionId, otra)).to.be.revertedWithCustomError(
        base.licitaciones,
        "OfertaDuplicada",
      );
    });

    it("la misma empresa sí puede ofertar en otra licitación (otro scope, otro nullifier)", async () => {
      const base = await loadFixture(conOfertas);
      const cierre = BigInt((await time.latest()) + 2 * HORA);
      await base.licitaciones.connect(base.empleado).crearLicitacion("Otra", "cid", PRESUPUESTO, cierre, HORA, ETAPAS);
      const o = await armarOferta(base, 2n, "sur", 40_000_000n);
      await enviar(base.licitaciones, 2n, o);
      expect(o.prueba.nullifier).to.not.equal(base.sur.prueba.nullifier);
    });

    it("la prueba queda atada a la oferta: si se cambia el cifrado, se rechaza", async () => {
      const base = await loadFixture(conLicitacion);
      const o = await armarOferta(base, base.licitacionId, "sur", 45_000_000n);
      await expect(
        base.licitaciones.ofertar(base.licitacionId, ethers.toUtf8Bytes("otro"), o.compromisoMonto, o.compromisoAutoria, o.propuestaCID, o.prueba),
      ).to.be.revertedWithCustomError(base.licitaciones, "MensajeIncorrecto");
    });

    it("rechaza pruebas de otra licitación (scope)", async () => {
      const base = await loadFixture(conLicitacion);
      const o = await armarOferta(base, 99n, "sur", 45_000_000n);
      await expect(enviar(base.licitaciones, base.licitacionId, o)).to.be.revertedWithCustomError(
        base.licitaciones,
        "ScopeIncorrecto",
      );
    });

    it("rechaza pruebas de alguien que no está en el grupo", async () => {
      const base = await loadFixture(conLicitacion);
      const intruso = identidad("intruso");
      // Arma su propio grupo con él adentro: la raíz no es la del contrato
      const grupoFalso = new Group([base.idSur.commitment, base.idNorte.commitment, intruso.commitment]);
      const o = await armarOferta({ ...base, idSur: intruso }, base.licitacionId, "sur", 1n, { grupo: grupoFalso });
      await expect(enviar(base.licitaciones, base.licitacionId, o)).to.be.revertedWithCustomError(
        base.semaphore,
        "Semaphore__MerkleTreeRootIsNotPartOfTheGroup",
      );
    });

    it("un proveedor revocado deja de poder ofertar cuando vence la raíz vieja", async () => {
      const base = await loadFixture(conLicitacion);
      // La licitación cierra en 2 horas; Semaphore acepta raíces viejas durante 1 hora.
      const o = await armarOferta(base, base.licitacionId, "norte", 45_000_000n);
      const grupo = base.nuevoGrupo();
      const siblings = grupo.generateMerkleProof(1).siblings;
      await base.credenciales.revocarProveedor(5n, "Sanción", siblings);
      await time.increase(HORA + 1);
      await expect(enviar(base.licitaciones, base.licitacionId, o)).to.be.revertedWithCustomError(
        base.semaphore,
        "Semaphore__MerkleTreeRootIsExpired",
      );
    });

    it("no acepta ofertas después del cierre", async () => {
      const base = await loadFixture(conLicitacion);
      const o = await armarOferta(base, base.licitacionId, "sur", 45_000_000n);
      await time.increaseTo(base.cierre + 1n);
      await expect(enviar(base.licitaciones, base.licitacionId, o))
        .to.be.revertedWithCustomError(base.licitaciones, "FueraDePlazo")
        .withArgs(Estado.APERTURA);
    });
  });

  describe("apertura", () => {
    it("cualquiera publica el monto descifrado y el contrato verifica el compromiso", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      const { sur } = base;
      await expect(
        base.licitaciones.connect(base.otro).abrirOferta(base.licitacionId, 1n, sur.monto, sur.plazoDias, sur.desglose, sur.sal),
      )
        .to.emit(base.licitaciones, "OfertaAbierta")
        .withArgs(base.licitacionId, 1n, sur.monto, sur.plazoDias);
      const o = await base.licitaciones.oferta(base.licitacionId, 1n);
      expect(o.abierta).to.equal(true);
      expect(o.monto).to.equal(sur.monto);
      expect(await base.licitaciones.desgloseDe(base.licitacionId, 1n)).to.deep.equal(sur.desglose);
    });

    it("no se puede abrir antes del cierre", async () => {
      const base = await loadFixture(conOfertas);
      const { sur } = base;
      await expect(base.licitaciones.abrirOferta(base.licitacionId, 1n, sur.monto, sur.plazoDias, sur.desglose, sur.sal))
        .to.be.revertedWithCustomError(base.licitaciones, "FueraDePlazo")
        .withArgs(Estado.RECIBIENDO_OFERTAS);
    });

    it("rechaza valores que no coinciden con el compromiso", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      const { sur } = base;
      await expect(
        base.licitaciones.abrirOferta(base.licitacionId, 1n, sur.monto - 1n, sur.plazoDias, sur.desglose, sur.sal),
      ).to.be.revertedWithCustomError(base.licitaciones, "CompromisoIncorrecto");
    });

    it("no se abre dos veces y las ofertas sin abrir no se pueden adjudicar", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      const { sur } = base;
      await base.licitaciones.abrirOferta(base.licitacionId, 1n, sur.monto, sur.plazoDias, sur.desglose, sur.sal);
      await expect(
        base.licitaciones.abrirOferta(base.licitacionId, 1n, sur.monto, sur.plazoDias, sur.desglose, sur.sal),
      ).to.be.revertedWithCustomError(base.licitaciones, "OfertaYaAbierta");

      await time.increase(HORA);
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.EVALUACION);
      await expect(
        base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 2n, "dictamen"),
      ).to.be.revertedWithCustomError(base.licitaciones, "OfertaNoAbierta");
    });
  });

  describe("adjudicación", () => {
    it("un empleado del organismo adjudica una oferta abierta", async () => {
      const base = await loadFixture(conOfertasAbiertas);
      // Elige la segunda: la elección es discrecional, con dictamen
      await expect(base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 2n, "bafkreidictamen"))
        .to.emit(base.licitaciones, "LicitacionAdjudicada")
        .withArgs(base.licitacionId, 2n, base.empleado.address, "bafkreidictamen");
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.ADJUDICADA);
    });

    it("no adjudican empleados de otro organismo ni antes de terminar la apertura", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      await base.licitaciones.abrirOferta(base.licitacionId, 1n, base.sur.monto, base.sur.plazoDias, base.sur.desglose, base.sur.sal);
      await expect(base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 1n, "d"))
        .to.be.revertedWithCustomError(base.licitaciones, "FueraDePlazo")
        .withArgs(Estado.APERTURA);

      await time.increase(HORA);
      await expect(
        base.licitaciones.connect(base.empleadoOtro).adjudicar(base.licitacionId, 1n, "d"),
      ).to.be.revertedWithCustomError(base.licitaciones, "OtroOrganismo");
    });

    it("no adjudica ofertas que superan el presupuesto oficial", async () => {
      const base = await loadFixture(conLicitacion);
      const cara = await armarOferta(base, base.licitacionId, "sur", PRESUPUESTO + 1n);
      await enviar(base.licitaciones, base.licitacionId, cara);
      await time.increaseTo(base.cierre + 1n);
      await base.licitaciones.abrirOferta(base.licitacionId, 1n, cara.monto, cara.plazoDias, cara.desglose, cara.sal);
      await time.increase(HORA);
      await expect(
        base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 1n, "d"),
      ).to.be.revertedWithCustomError(base.licitaciones, "SuperaPresupuesto");
    });

    it("se puede declarar desierta", async () => {
      const base = await loadFixture(conOfertasAbiertas);
      await expect(base.licitaciones.connect(base.empleado).declararDesierta(base.licitacionId, "bafkreidesierta"))
        .to.emit(base.licitaciones, "LicitacionDesierta")
        .withArgs(base.licitacionId, base.empleado.address, "bafkreidesierta");
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.DESIERTA);
    });
  });

  describe("cierre: revelación de identidades", () => {
    it("ganador y perdedor revelan su autoría desde su wallet real", async () => {
      const base = await loadFixture(adjudicada);
      await expect(base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2))
        .to.emit(base.licitaciones, "AutoriaRevelada")
        .withArgs(base.licitacionId, 1n, base.proveedor.address, true);
      await expect(base.licitaciones.connect(base.proveedor2).revelarAutoria(base.licitacionId, 2n, base.norte.sal2))
        .to.emit(base.licitaciones, "AutoriaRevelada")
        .withArgs(base.licitacionId, 2n, base.proveedor2.address, false);

      expect((await base.licitaciones.licitacion(base.licitacionId)).contratista).to.equal(base.proveedor.address);
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.EN_EJECUCION);
    });

    it("no se puede revelar antes de la adjudicación", async () => {
      const base = await loadFixture(conOfertasAbiertas);
      await expect(
        base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2),
      ).to.be.revertedWithCustomError(base.licitaciones, "FueraDePlazo");
    });

    it("nadie más puede atribuirse una oferta", async () => {
      const base = await loadFixture(adjudicada);
      await expect(
        base.licitaciones.connect(base.proveedor2).revelarAutoria(base.licitacionId, 1n, base.sur.sal2),
      ).to.be.revertedWithCustomError(base.licitaciones, "AutoriaIncorrecta");
      await base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2);
      await expect(
        base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2),
      ).to.be.revertedWithCustomError(base.licitaciones, "AutoriaYaRevelada");
    });
  });

  describe("ejecución: inspectores y etapas", () => {
    async function enEjecucion() {
      const base = await adjudicada();
      await base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2);
      await base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.inspector.address);
      return base;
    }

    it("el inspector asignado aprueba las etapas en orden hasta finalizar la obra", async () => {
      const base = await loadFixture(enEjecucion);
      const lic = base.licitaciones.connect(base.inspector);
      expect(await base.licitaciones.inspectores(base.licitacionId)).to.deep.equal([base.inspector.address]);

      await expect(lic.registrarEvaluacion(base.licitacionId, 1n, true, "informe")).to.be.revertedWithCustomError(
        base.licitaciones,
        "EtapaIncorrecta",
      );
      // Una observación no aprueba la etapa
      await expect(lic.registrarEvaluacion(base.licitacionId, 0n, false, "observacion"))
        .to.emit(base.licitaciones, "EvaluacionRegistrada")
        .withArgs(base.licitacionId, 0n, base.inspector.address, false, "observacion");
      for (let etapa = 0n; etapa < 3n; etapa++) {
        await lic.registrarEvaluacion(base.licitacionId, etapa, true, `informe-${etapa}`);
      }
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.FINALIZADA);
      await expect(lic.registrarEvaluacion(base.licitacionId, 3n, true, "x")).to.be.revertedWithCustomError(
        base.licitaciones,
        "EtapaIncorrecta",
      );
    });

    it("solo evalúan inspectores asignados, y solo se asignan inspectores con credencial", async () => {
      const base = await loadFixture(enEjecucion);
      await expect(
        base.licitaciones.connect(base.empleado).registrarEvaluacion(base.licitacionId, 0n, true, "x"),
      ).to.be.revertedWithCustomError(base.licitaciones, "NoEsInspectorAsignado");
      await expect(
        base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.otro.address),
      ).to.be.revertedWithCustomError(base.licitaciones, "SinRol");
      await expect(
        base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.inspector.address),
      ).to.be.revertedWithCustomError(base.licitaciones, "InspectorYaAsignado");
      await expect(
        base.licitaciones.connect(base.empleadoOtro).asignarInspector(base.licitacionId, base.inspector.address),
      ).to.be.revertedWithCustomError(base.licitaciones, "OtroOrganismo");
    });

    it("no se evalúan etapas hasta que el ganador revela su identidad", async () => {
      const base = await loadFixture(adjudicada);
      await base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.inspector.address);
      await expect(
        base.licitaciones.connect(base.inspector).registrarEvaluacion(base.licitacionId, 0n, true, "x"),
      ).to.be.revertedWithCustomError(base.licitaciones, "SinContratista");
    });
  });
});
