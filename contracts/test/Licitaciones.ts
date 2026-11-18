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
const ETAPAS = [14_550_000n, 19_400_000n, 14_550_000n]; // monto oficial de cada etapa, en pesos
const PRESUPUESTO = 48_500_000n; // la suma de las etapas
const INSPECTORES = 1; // inspectores que requiere la obra
const SIN_DATOS = ethers.ZeroHash;
const GWEI = 10n ** 9n;

/** Empleados de Quilmes y Berazategui, inspectores de ambos y dos proveedores en el grupo. */
async function desplegar() {
  const base = await desplegarCredenciales(ethers);
  const { credenciales, verificador, empleado, empleadoOtro, inspector, proveedor, proveedor2, vence } = base;
  const inspectorOtro = (await ethers.getSigners())[8];
  await credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", vence, SIN_DATOS);
  await credenciales.emitirFuncionario(empleadoOtro.address, Rol.EMPLEADO, BERAZATEGUI, "Carlos Díaz", vence, SIN_DATOS);
  await credenciales.emitirFuncionario(inspector.address, Rol.INSPECTOR, QUILMES, "Sofía Torres", vence, SIN_DATOS);
  await credenciales.emitirFuncionario(inspectorOtro.address, Rol.INSPECTOR, BERAZATEGUI, "Luis Gómez", vence, SIN_DATOS);

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
  return { ...base, inspectorOtro, licitaciones, idSur, idNorte, nuevoGrupo };
}

type Base = Awaited<ReturnType<typeof desplegar>>;

/** Un segundo inspector de Quilmes, para probar obras que requieren más de uno. */
async function inspectorExtraDeQuilmes(base: Base) {
  const extra = (await ethers.getSigners())[9];
  await base.credenciales.emitirFuncionario(extra.address, Rol.INSPECTOR, QUILMES, "Laura Benítez", base.vence, SIN_DATOS);
  return extra;
}

async function conLicitacion() {
  const base = await desplegar();
  const cierre = BigInt((await time.latest()) + 2 * HORA);
  const limite = cierre + BigInt(2 * HORA);
  await base.licitaciones
    .connect(base.empleado)
    .crearLicitacion("Ampliación del Centro de Salud San Martín", "bafkreimetadata", cierre, limite, ETAPAS, INSPECTORES);
  return { ...base, licitacionId: 1n, cierre, limite };
}

/** Arma una oferta completa: compromisos, cifrados simulados y prueba de Semaphore. */
async function armarOferta(base: Base, licitacionId: bigint, quien: "sur" | "norte", monto: bigint, opciones: { grupo?: Group } = {}) {
  const id = quien === "sur" ? base.idSur : base.idNorte;
  const wallet = quien === "sur" ? base.proveedor : base.proveedor2;
  const plazoDias = 180;
  const desglose = [(monto * 3n) / 10n, (monto * 4n) / 10n];
  desglose.push(monto - desglose[0] - desglose[1]);
  const sal = protocolo.nuevaSal();
  const sal2 = protocolo.nuevaSal();
  const compromisoMonto = protocolo.compromisoMonto(licitacionId, monto, plazoDias, desglose, sal);
  const compromisoAutoria = protocolo.compromisoAutoria(licitacionId, wallet.address, sal2);
  // En la dApp son los cifrados tlock del contenido y de la identidad. El contrato no los lee.
  const cifrado = ethers.toUtf8Bytes(`oferta ${quien} ${sal}`);
  const cifradoIdentidad = ethers.toUtf8Bytes(`identidad ${quien} ${sal2}`);
  const propuestaCID = `bafkreipropuesta${quien}`;
  const mensaje = protocolo.mensajeOferta(
    licitacionId,
    ethers.keccak256(cifrado),
    ethers.keccak256(cifradoIdentidad),
    compromisoMonto,
    compromisoAutoria,
    propuestaCID,
  );
  const prueba = await probar(id, opciones.grupo ?? base.nuevoGrupo(), mensaje, licitacionId);
  const sobre = { valido: true, monto, plazoDias, desglose, sal };
  return { wallet, monto, plazoDias, desglose, sal, sal2, compromisoMonto, compromisoAutoria, cifrado, cifradoIdentidad, propuestaCID, prueba, sobre };
}

type OfertaArmada = Awaited<ReturnType<typeof armarOferta>>;

const enviar = (lic: Base["licitaciones"], id: bigint, o: OfertaArmada) =>
  lic.ofertar(
    id,
    { cifrado: o.cifrado, cifradoIdentidad: o.cifradoIdentidad, compromisoMonto: o.compromisoMonto, compromisoAutoria: o.compromisoAutoria, propuestaCID: o.propuestaCID },
    o.prueba,
  );

const DESCARTADO = { valido: false, monto: 0n, plazoDias: 0, desglose: [], sal: ethers.ZeroHash };

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

async function conSobresAbiertos() {
  const base = await conOfertas();
  await time.increaseTo(base.cierre + 1n);
  await base.licitaciones.connect(base.empleado).abrirSobres(base.licitacionId, [base.sur.sobre, base.norte.sobre]);
  return base;
}

async function adjudicada() {
  const base = await conSobresAbiertos();
  await base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 1n, "bafkreidictamen");
  return base;
}

async function enEjecucion() {
  const base = await adjudicada();
  await base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2);
  await base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.inspector.address);
  await base.licitaciones.connect(base.empleado).depositarFondos(base.licitacionId, { value: base.sur.monto * GWEI });
  return base;
}

describe("Licitaciones", () => {
  describe("publicación", () => {
    it("un empleado publica la licitación y se mintea su NFT", async () => {
      const { licitaciones, empleado } = await loadFixture(desplegar);
      const cierre = BigInt((await time.latest()) + 2 * HORA);
      const limite = cierre + BigInt(HORA);

      await expect(licitaciones.connect(empleado).crearLicitacion("Pavimentación", "bafkreimeta", cierre, limite, ETAPAS, INSPECTORES))
        .to.emit(licitaciones, "LicitacionPublicada")
        .withArgs(1n, QUILMES, empleado.address, "Pavimentación", "bafkreimeta", PRESUPUESTO, cierre, limite);

      expect(await licitaciones.ownerOf(1n)).to.equal(await licitaciones.getAddress());
      expect(await licitaciones.tokenURI(1n)).to.equal("ipfs://bafkreimeta");
      expect(await licitaciones.estado(1n)).to.equal(Estado.RECIBIENDO_OFERTAS);
      const l = await licitaciones.licitacion(1n);
      expect(l.organismoId).to.equal(BigInt(QUILMES));
      expect(l.montosEtapas).to.deep.equal(ETAPAS);
      expect(l.presupuestoOficial).to.equal(PRESUPUESTO);
    });

    it("solo publican empleados con credencial vigente", async () => {
      const { licitaciones, inspector, proveedor, otro } = await loadFixture(desplegar);
      const cierre = BigInt((await time.latest()) + 2 * HORA);
      for (const quien of [inspector, proveedor, otro]) {
        await expect(
          licitaciones.connect(quien).crearLicitacion("X", "cid", cierre, cierre + 3600n, ETAPAS, INSPECTORES),
        ).to.be.revertedWithCustomError(licitaciones, "SinRol");
      }
    });

    it("valida etapas, fechas, presupuesto y textos", async () => {
      const { licitaciones, empleado } = await loadFixture(desplegar);
      const cierre = BigInt((await time.latest()) + 2 * HORA);
      const limite = cierre + 3600n;
      const lic = licitaciones.connect(empleado);
      const err = (p: Promise<unknown>, nombre: string) => expect(p).to.be.revertedWithCustomError(licitaciones, nombre);
      await err(lic.crearLicitacion("X", "cid", cierre, limite, [1n, 0n, 5n], INSPECTORES), "EtapasInvalidas");
      await err(lic.crearLicitacion("X", "cid", cierre, limite, [], INSPECTORES), "EtapasInvalidas");
      await err(lic.crearLicitacion("X", "cid", cierre, limite, [...Array(21)].map(() => 1n), INSPECTORES), "EtapasInvalidas");
      await err(lic.crearLicitacion("X", "cid", BigInt(await time.latest()), limite, ETAPAS, INSPECTORES), "FechaInvalida");
      // La fecha límite tiene que dejar al menos 5 minutos para abrir y evaluar
      await err(lic.crearLicitacion("X", "cid", cierre, cierre + 60n, ETAPAS, INSPECTORES), "FechaInvalida");
      await err(lic.crearLicitacion("", "cid", cierre, limite, ETAPAS, INSPECTORES), "TextoInvalido");
      await err(lic.crearLicitacion("X", "cid", cierre, limite, ETAPAS, 0), "InspectoresInvalidos");
      await err(lic.crearLicitacion("X", "cid", cierre, limite, ETAPAS, 11), "InspectoresInvalidos");
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
          ethers.hexlify(o.cifradoIdentidad),
          o.compromisoMonto,
          o.compromisoAutoria,
          o.propuestaCID,
        );

      const guardada = await base.licitaciones.oferta(base.licitacionId, 1n);
      expect(guardada.abierta).to.equal(false);
      expect(guardada.autor).to.equal(ethers.ZeroAddress);
      expect(await base.licitaciones.nullifierUsado(base.licitacionId, o.prueba.nullifier)).to.equal(true);
    });

    it("rechaza una segunda oferta de la misma empresa", async () => {
      const base = await loadFixture(conOfertas);
      const otra = await armarOferta(base, base.licitacionId, "sur", 40_000_000n);
      await expect(enviar(base.licitaciones, base.licitacionId, otra)).to.be.revertedWithCustomError(base.licitaciones, "OfertaDuplicada");
    });

    it("la misma empresa sí puede ofertar en otra licitación (otro scope, otro nullifier)", async () => {
      const base = await loadFixture(conOfertas);
      const cierre = BigInt((await time.latest()) + 2 * HORA);
      await base.licitaciones.connect(base.empleado).crearLicitacion("Otra", "cid", cierre, cierre + 3600n, ETAPAS, INSPECTORES);
      const o = await armarOferta(base, 2n, "sur", 40_000_000n);
      await enviar(base.licitaciones, 2n, o);
      expect(o.prueba.nullifier).to.not.equal(base.sur.prueba.nullifier);
    });

    it("la prueba queda atada a la oferta: si se cambia un cifrado, se rechaza", async () => {
      const base = await loadFixture(conLicitacion);
      const o = await armarOferta(base, base.licitacionId, "sur", 45_000_000n);
      await expect(enviar(base.licitaciones, base.licitacionId, { ...o, cifradoIdentidad: ethers.toUtf8Bytes("otra") })).to.be.revertedWithCustomError(
        base.licitaciones,
        "MensajeIncorrecto",
      );
      await expect(enviar(base.licitaciones, base.licitacionId, { ...o, cifrado: ethers.toUtf8Bytes("otro") })).to.be.revertedWithCustomError(
        base.licitaciones,
        "MensajeIncorrecto",
      );
    });

    it("rechaza pruebas de otra licitación (scope)", async () => {
      const base = await loadFixture(conLicitacion);
      const o = await armarOferta(base, 99n, "sur", 45_000_000n);
      await expect(enviar(base.licitaciones, base.licitacionId, o)).to.be.revertedWithCustomError(base.licitaciones, "ScopeIncorrecto");
    });

    it("rechaza pruebas de alguien que no está en el grupo", async () => {
      const base = await loadFixture(conLicitacion);
      const intruso = identidad("intruso");
      const grupoFalso = new Group([base.idSur.commitment, base.idNorte.commitment, intruso.commitment]);
      const o = await armarOferta({ ...base, idSur: intruso }, base.licitacionId, "sur", 1n, { grupo: grupoFalso });
      await expect(enviar(base.licitaciones, base.licitacionId, o)).to.be.revertedWithCustomError(
        base.semaphore,
        "Semaphore__MerkleTreeRootIsNotPartOfTheGroup",
      );
    });

    it("un proveedor revocado deja de poder ofertar a los 5 minutos", async () => {
      const base = await loadFixture(conLicitacion);
      const o = await armarOferta(base, base.licitacionId, "norte", 45_000_000n);
      const siblings = base.nuevoGrupo().generateMerkleProof(1).siblings;
      await base.credenciales.revocarProveedor(6n, "Sanción", siblings);
      await time.increase(5 * 60 + 1);
      await expect(enviar(base.licitaciones, base.licitacionId, o)).to.be.revertedWithCustomError(
        base.semaphore,
        "Semaphore__MerkleTreeRootIsExpired",
      );
    });

    it("con duración 0 una prueba con la raíz vieja se rechaza en el acto", async () => {
      const base = await loadFixture(conLicitacion);
      await base.credenciales.configurarDuracionRaiz(0);
      const o = await armarOferta(base, base.licitacionId, "norte", 45_000_000n);
      await base.credenciales.revocarProveedor(6n, "Sanción", base.nuevoGrupo().generateMerkleProof(1).siblings);
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

  describe("apertura de sobres", () => {
    it("después del cierre queda esperando la apertura, sin montos a la vista", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.APERTURA);
      expect((await base.licitaciones.oferta(base.licitacionId, 1n)).monto).to.equal(0n);
    });

    it("un empleado del organismo abre todos los sobres en una sola transacción", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      await expect(base.licitaciones.connect(base.empleado).abrirSobres(base.licitacionId, [base.sur.sobre, base.norte.sobre]))
        .to.emit(base.licitaciones, "SobresAbiertos")
        .withArgs(base.licitacionId, base.empleado.address, 2n, 0n)
        .and.to.emit(base.licitaciones, "OfertaAbierta")
        .withArgs(base.licitacionId, 1n, base.sur.monto, base.sur.plazoDias);
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.EVALUACION);
      expect(await base.licitaciones.desgloseDe(base.licitacionId, 2n)).to.deep.equal(base.norte.desglose);
    });

    it("el ofertante no puede abrir (ni nadie que no sea empleado del organismo)", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      const sobres = [base.sur.sobre, base.norte.sobre];
      await expect(base.licitaciones.connect(base.proveedor).abrirSobres(base.licitacionId, sobres)).to.be.revertedWithCustomError(
        base.licitaciones,
        "SinRol",
      );
      await expect(base.licitaciones.connect(base.empleadoOtro).abrirSobres(base.licitacionId, sobres)).to.be.revertedWithCustomError(
        base.licitaciones,
        "OtroOrganismo",
      );
    });

    it("hay que abrir todos los sobres juntos, y una sola vez", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      const lic = base.licitaciones.connect(base.empleado);
      await expect(lic.abrirSobres(base.licitacionId, [base.sur.sobre])).to.be.revertedWithCustomError(base.licitaciones, "SobresIncompletos");
      await lic.abrirSobres(base.licitacionId, [base.sur.sobre, base.norte.sobre]);
      await expect(lic.abrirSobres(base.licitacionId, [base.sur.sobre, base.norte.sobre]))
        .to.be.revertedWithCustomError(base.licitaciones, "FueraDePlazo")
        .withArgs(Estado.EVALUACION);
    });

    it("los sobres que no se pueden descifrar quedan descartados", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      await expect(base.licitaciones.connect(base.empleado).abrirSobres(base.licitacionId, [base.sur.sobre, DESCARTADO]))
        .to.emit(base.licitaciones, "OfertaDescartada")
        .withArgs(base.licitacionId, 2n);
      const o = await base.licitaciones.oferta(base.licitacionId, 2n);
      expect(o.descartada).to.equal(true);
      expect(o.abierta).to.equal(false);
      await expect(base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 2n, "d")).to.be.revertedWithCustomError(
        base.licitaciones,
        "OfertaNoAbierta",
      );
    });

    it("rechaza valores que no coinciden con el compromiso", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      const trucho = { ...base.norte.sobre, monto: base.norte.monto - 1n };
      await expect(base.licitaciones.connect(base.empleado).abrirSobres(base.licitacionId, [base.sur.sobre, trucho]))
        .to.be.revertedWithCustomError(base.licitaciones, "CompromisoIncorrecto")
        .withArgs(2n);
    });

    it("no se puede abrir antes del cierre ni después de la fecha límite", async () => {
      const base = await loadFixture(conOfertas);
      const lic = base.licitaciones.connect(base.empleado);
      await expect(lic.abrirSobres(base.licitacionId, [base.sur.sobre, base.norte.sobre]))
        .to.be.revertedWithCustomError(base.licitaciones, "FueraDePlazo")
        .withArgs(Estado.RECIBIENDO_OFERTAS);
      await time.increaseTo(base.limite + 1n);
      await expect(lic.abrirSobres(base.licitacionId, [base.sur.sobre, base.norte.sobre])).to.be.revertedWithCustomError(
        base.licitaciones,
        "PlazoDeAdjudicacionVencido",
      );
    });
  });

  describe("adjudicación", () => {
    it("un empleado del organismo adjudica una oferta abierta", async () => {
      const base = await loadFixture(conSobresAbiertos);
      await expect(base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 2n, "bafkreidictamen"))
        .to.emit(base.licitaciones, "LicitacionAdjudicada")
        .withArgs(base.licitacionId, 2n, base.empleado.address, "bafkreidictamen");
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.ADJUDICADA);
    });

    it("no adjudican empleados de otro organismo, ni antes de abrir, ni después de la fecha límite", async () => {
      const base = await loadFixture(conOfertas);
      await time.increaseTo(base.cierre + 1n);
      await expect(base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 1n, "d"))
        .to.be.revertedWithCustomError(base.licitaciones, "FueraDePlazo")
        .withArgs(Estado.APERTURA);
      await base.licitaciones.connect(base.empleado).abrirSobres(base.licitacionId, [base.sur.sobre, base.norte.sobre]);
      await expect(base.licitaciones.connect(base.empleadoOtro).adjudicar(base.licitacionId, 1n, "d")).to.be.revertedWithCustomError(
        base.licitaciones,
        "OtroOrganismo",
      );
      await time.increaseTo(base.limite + 1n);
      await expect(base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 1n, "d")).to.be.revertedWithCustomError(
        base.licitaciones,
        "PlazoDeAdjudicacionVencido",
      );
      // Vencido el plazo, solo queda declararla desierta
      await base.licitaciones.connect(base.empleado).declararDesierta(base.licitacionId, "Venció el plazo");
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.DESIERTA);
    });

    it("no adjudica ofertas que superan el presupuesto oficial", async () => {
      const base = await loadFixture(conLicitacion);
      const cara = await armarOferta(base, base.licitacionId, "sur", PRESUPUESTO + 1n);
      await enviar(base.licitaciones, base.licitacionId, cara);
      await time.increaseTo(base.cierre + 1n);
      await base.licitaciones.connect(base.empleado).abrirSobres(base.licitacionId, [cara.sobre]);
      await expect(base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 1n, "d")).to.be.revertedWithCustomError(
        base.licitaciones,
        "SuperaPresupuesto",
      );
    });
  });

  describe("identidades", () => {
    it("se revelan solas después de la fecha límite: cualquiera publica las de todas las ofertas", async () => {
      const base = await loadFixture(adjudicada);
      const ids = [
        { ofertaId: 1n, wallet: base.proveedor.address, sal: base.sur.sal2 },
        { ofertaId: 2n, wallet: base.proveedor2.address, sal: base.norte.sal2 },
      ];
      await expect(base.licitaciones.connect(base.otro).revelarIdentidades(base.licitacionId, ids)).to.be.revertedWithCustomError(
        base.licitaciones,
        "IdentidadesTodaviaOcultas",
      );
      await time.increaseTo(base.limite + 1n);
      await expect(base.licitaciones.connect(base.otro).revelarIdentidades(base.licitacionId, ids))
        .to.emit(base.licitaciones, "AutoriaRevelada")
        .withArgs(base.licitacionId, 1n, base.proveedor.address, true)
        .and.to.emit(base.licitaciones, "AutoriaRevelada")
        .withArgs(base.licitacionId, 2n, base.proveedor2.address, false);
      expect((await base.licitaciones.licitacion(base.licitacionId)).contratista).to.equal(base.proveedor.address);
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.EN_EJECUCION);
      // Se puede volver a llamar: las ya reveladas se saltean
      await base.licitaciones.connect(base.otro).revelarIdentidades(base.licitacionId, ids);
    });

    it("no se puede atribuir una oferta a otra wallet", async () => {
      const base = await loadFixture(adjudicada);
      await time.increaseTo(base.limite + 1n);
      await expect(
        base.licitaciones.revelarIdentidades(base.licitacionId, [{ ofertaId: 1n, wallet: base.proveedor2.address, sal: base.sur.sal2 }]),
      )
        .to.be.revertedWithCustomError(base.licitaciones, "AutoriaIncorrecta")
        .withArgs(1n);
    });

    it("el ganador puede revelarse antes por su cuenta, pero no antes de la adjudicación", async () => {
      const base = await loadFixture(conSobresAbiertos);
      await expect(base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2)).to.be.revertedWithCustomError(
        base.licitaciones,
        "FueraDePlazo",
      );
      await base.licitaciones.connect(base.empleado).adjudicar(base.licitacionId, 1n, "d");
      await expect(base.licitaciones.connect(base.proveedor2).revelarAutoria(base.licitacionId, 1n, base.sur.sal2))
        .to.be.revertedWithCustomError(base.licitaciones, "AutoriaIncorrecta")
        .withArgs(1n);
      await expect(base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2))
        .to.emit(base.licitaciones, "AutoriaRevelada")
        .withArgs(base.licitacionId, 1n, base.proveedor.address, true);
      await expect(base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2)).to.be.revertedWithCustomError(
        base.licitaciones,
        "AutoriaYaRevelada",
      );
    });
  });

  describe("ejecución: fondos, inspectores, etapas y pagos", () => {
    it("el organismo deposita exactamente el monto adjudicado (1 peso = 1 gwei)", async () => {
      const base = await loadFixture(adjudicada);
      const lic = base.licitaciones.connect(base.empleado);
      expect(await base.licitaciones.montoAdjudicadoEnWei(base.licitacionId)).to.equal(base.sur.monto * GWEI);
      await expect(lic.depositarFondos(base.licitacionId, { value: 1n }))
        .to.be.revertedWithCustomError(base.licitaciones, "MontoIncorrecto")
        .withArgs(base.sur.monto * GWEI);
      await expect(base.licitaciones.connect(base.empleadoOtro).depositarFondos(base.licitacionId, { value: base.sur.monto * GWEI })).to.be.revertedWithCustomError(
        base.licitaciones,
        "OtroOrganismo",
      );
      await expect(lic.depositarFondos(base.licitacionId, { value: base.sur.monto * GWEI }))
        .to.emit(base.licitaciones, "FondosDepositados")
        .withArgs(base.licitacionId, base.empleado.address, base.sur.monto * GWEI);
      await expect(lic.depositarFondos(base.licitacionId, { value: base.sur.monto * GWEI })).to.be.revertedWithCustomError(
        base.licitaciones,
        "YaFinanciada",
      );
    });

    it("cada etapa aprobada le paga al contratista lo que cotizó; las observaciones no pagan", async () => {
      const base = await loadFixture(enEjecucion);
      const lic = base.licitaciones.connect(base.inspector);

      await expect(lic.registrarEvaluacion(base.licitacionId, 1n, true, "informe")).to.be.revertedWithCustomError(
        base.licitaciones,
        "EtapaIncorrecta",
      );
      await expect(lic.registrarEvaluacion(base.licitacionId, 0n, false, "observacion")).to.changeEtherBalance(ethers, base.proveedor, 0n);

      for (let etapa = 0; etapa < 3; etapa++) {
        const pago = base.sur.desglose[etapa] * GWEI;
        await expect(lic.registrarEvaluacion(base.licitacionId, BigInt(etapa), true, `informe-${etapa}`))
          .to.emit(base.licitaciones, "PagoRealizado")
          .withArgs(base.licitacionId, BigInt(etapa), base.proveedor.address, pago);
      }
      expect(await base.licitaciones.estado(base.licitacionId)).to.equal(Estado.FINALIZADA);
      expect((await base.licitaciones.licitacion(base.licitacionId)).fondos).to.equal(0n);
      expect(await ethers.provider.getBalance(await base.licitaciones.getAddress())).to.equal(0n);
    });

    it("el pago llega a la wallet del contratista", async () => {
      const base = await loadFixture(enEjecucion);
      await expect(
        base.licitaciones.connect(base.inspector).registrarEvaluacion(base.licitacionId, 0n, true, "ok"),
      ).to.changeEtherBalance(ethers, base.proveedor, base.sur.desglose[0] * GWEI);
    });

    it("sin fondos depositados no se pueden aprobar etapas", async () => {
      const base = await loadFixture(adjudicada);
      await base.licitaciones.connect(base.proveedor).revelarAutoria(base.licitacionId, 1n, base.sur.sal2);
      await base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.inspector.address);
      await expect(
        base.licitaciones.connect(base.inspector).registrarEvaluacion(base.licitacionId, 0n, true, "x"),
      ).to.be.revertedWithCustomError(base.licitaciones, "SinFondos");
    });

    it("solo se asignan inspectores del mismo organismo, y solo evalúan los asignados", async () => {
      const base = await loadFixture(enEjecucion);
      expect(await base.licitaciones.inspectores(base.licitacionId)).to.deep.equal([base.inspector.address]);
      await expect(
        base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.inspectorOtro.address),
      ).to.be.revertedWithCustomError(base.licitaciones, "OtroOrganismo");
      await expect(
        base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.otro.address),
      ).to.be.revertedWithCustomError(base.licitaciones, "SinRol");
      await expect(
        base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.inspector.address),
      ).to.be.revertedWithCustomError(base.licitaciones, "InspectorYaAsignado");
      await expect(
        base.licitaciones.connect(base.inspectorOtro).registrarEvaluacion(base.licitacionId, 0n, true, "x"),
      ).to.be.revertedWithCustomError(base.licitaciones, "NoEsInspectorAsignado");
    });

    it("no se evalúan etapas hasta que se conoce al ganador", async () => {
      const base = await loadFixture(adjudicada);
      await base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, base.inspector.address);
      await expect(
        base.licitaciones.connect(base.inspector).registrarEvaluacion(base.licitacionId, 0n, true, "x"),
      ).to.be.revertedWithCustomError(base.licitaciones, "SinContratista");
    });

    it("no se asignan más inspectores que los que requiere la obra", async () => {
      const base = await loadFixture(enEjecucion);
      const otroDeQuilmes = await inspectorExtraDeQuilmes(base);
      expect((await base.licitaciones.licitacion(base.licitacionId)).inspectoresRequeridos).to.equal(1n);
      await expect(
        base.licitaciones.connect(base.empleado).asignarInspector(base.licitacionId, otroDeQuilmes.address),
      ).to.be.revertedWithCustomError(base.licitaciones, "CupoDeInspectoresCompleto");
    });

    it("con dos inspectores: hay que asignar a los dos y la etapa se paga cuando aprueban los dos", async () => {
      const base = await loadFixture(desplegar);
      const otroDeQuilmes = await inspectorExtraDeQuilmes(base);
      const cierre = BigInt((await time.latest()) + 2 * HORA);
      const limite = cierre + BigInt(2 * HORA);
      await base.licitaciones.connect(base.empleado).crearLicitacion("Puente", "cid", cierre, limite, ETAPAS, 2);
      const sur = await armarOferta(base, 1n, "sur", 40_000_000n);
      await enviar(base.licitaciones, 1n, sur);
      await time.increaseTo(cierre + 1n);
      await base.licitaciones.connect(base.empleado).abrirSobres(1n, [sur.sobre]);
      await base.licitaciones.connect(base.empleado).adjudicar(1n, 1n, "bafkreidictamen");
      await base.licitaciones.connect(base.proveedor).revelarAutoria(1n, 1n, sur.sal2);
      await base.licitaciones.connect(base.empleado).depositarFondos(1n, { value: sur.monto * GWEI });

      await base.licitaciones.connect(base.empleado).asignarInspector(1n, base.inspector.address);
      await expect(base.licitaciones.connect(base.inspector).registrarEvaluacion(1n, 0n, true, "ok"))
        .to.be.revertedWithCustomError(base.licitaciones, "FaltanInspectores")
        .withArgs(1n, 2n);

      await base.licitaciones.connect(base.empleado).asignarInspector(1n, otroDeQuilmes.address);

      // Aprueba el primero: queda registrada, pero la etapa no se da por aprobada ni se paga.
      await expect(base.licitaciones.connect(base.inspector).registrarEvaluacion(1n, 0n, true, "ok")).to.not.emit(
        base.licitaciones,
        "PagoRealizado",
      );
      expect((await base.licitaciones.licitacion(1n)).etapasAprobadas).to.equal(0n);
      expect(await base.licitaciones.aprobacionesDeEtapa(1n, 0n, base.inspector.address)).to.deep.equal([1n, true]);
      await expect(base.licitaciones.connect(base.inspector).registrarEvaluacion(1n, 0n, true, "otra vez"))
        .to.be.revertedWithCustomError(base.licitaciones, "YaAprobasteEstaEtapa");
      await expect(base.licitaciones.connect(base.inspector).registrarEvaluacion(1n, 0n, false, "me arrepiento"))
        .to.be.revertedWithCustomError(base.licitaciones, "YaAprobasteEstaEtapa");

      // El segundo observa: no cambia nada. Cuando aprueba, la etapa queda aprobada y se paga.
      await base.licitaciones.connect(otroDeQuilmes).registrarEvaluacion(1n, 0n, false, "falta el acta");
      expect((await base.licitaciones.licitacion(1n)).etapasAprobadas).to.equal(0n);
      await expect(base.licitaciones.connect(otroDeQuilmes).registrarEvaluacion(1n, 0n, true, "ok"))
        .to.changeEtherBalance(ethers, base.proveedor, sur.desglose[0] * GWEI);
      expect((await base.licitaciones.licitacion(1n)).etapasAprobadas).to.equal(1n);

      // La etapa siguiente arranca de cero.
      expect(await base.licitaciones.aprobacionesDeEtapa(1n, 1n, base.inspector.address)).to.deep.equal([0n, false]);
    });
  });
});
