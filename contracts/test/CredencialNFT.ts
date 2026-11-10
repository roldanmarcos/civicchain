import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

// Deben coincidir con el orden de los enums en el contrato
const Rol = { PROVEEDOR: 0, EMPLEADO: 1, INSPECTOR: 2 } as const;
const Estado = { PENDIENTE: 0, APROBADA: 1, RECHAZADA: 2, CANCELADA: 3 } as const;

const DIA = 24 * 60 * 60;
const VIGENCIA = 90 * DIA;
const QUILMES = 1;
const BERAZATEGUI = 2;

// CUITs con dígito verificador correcto
const CUIT_SUR = 30712345671n;
const CUIT_NORTE = 30709876542n;
const CUIT_DV_INCORRECTO = 30712345678n;

async function desplegar() {
  const [admin, empleado, inspector, proveedor, otro] = await ethers.getSigners();
  const credenciales = await ethers.deployContract("CredencialNFT", [admin.address]);
  const vence = BigInt((await time.latest()) + VIGENCIA);
  return { credenciales, admin, empleado, inspector, proveedor, otro, vence };
}

async function conEmpleado() {
  const base = await desplegar();
  await base.credenciales.emitirFuncionario(base.empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", base.vence);
  return { ...base, tokenId: 1n };
}

async function conSolicitud() {
  const base = await desplegar();
  await base.credenciales
    .connect(base.proveedor)
    .solicitarInscripcion(CUIT_SUR, "Construcciones del Sur S.A.", "Av. Calchaquí 123, Quilmes", "Construcción");
  return { ...base, solicitudId: 1n };
}

async function conProveedor() {
  const base = await conSolicitud();
  await base.credenciales.aprobarSolicitud(base.solicitudId, base.vence);
  return { ...base, tokenId: 1n };
}

describe("CredencialNFT", () => {
  describe("despliegue", () => {
    it("asigna los roles de administración a la wallet indicada", async () => {
      const { credenciales, admin } = await loadFixture(desplegar);
      expect(await credenciales.hasRole(await credenciales.ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await credenciales.hasRole(await credenciales.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    });

    it("no acepta la dirección cero como admin", async () => {
      const fabrica = await ethers.getContractFactory("CredencialNFT");
      await expect(fabrica.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(fabrica, "WalletInvalida");
    });

    it("declara soporte para ERC-721 y ERC-5192", async () => {
      const { credenciales } = await loadFixture(desplegar);
      expect(await credenciales.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
      expect(await credenciales.supportsInterface("0xb45a3c0e")).to.equal(true); // ERC-5192
    });
  });

  describe("emitirFuncionario (empleados e inspectores)", () => {
    it("emite la credencial y guarda sus datos", async () => {
      const { credenciales, empleado, vence } = await loadFixture(desplegar);

      await expect(credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", vence))
        .to.emit(credenciales, "CredencialEmitida")
        .withArgs(1n, empleado.address, Rol.EMPLEADO, QUILMES, 0n, "Ana Pérez", vence)
        .and.to.emit(credenciales, "Locked")
        .withArgs(1n);

      expect(await credenciales.ownerOf(1n)).to.equal(empleado.address);
      expect(await credenciales.totalEmitidas()).to.equal(1n);
      expect(await credenciales.locked(1n)).to.equal(true);

      const c = await credenciales.credencial(1n);
      expect(c.rol).to.equal(BigInt(Rol.EMPLEADO));
      expect(c.organismoId).to.equal(BigInt(QUILMES));
      expect(c.nombre).to.equal("Ana Pérez");
      expect(c.cuit).to.equal(0n);
      expect(c.validaHasta).to.equal(vence);
      expect(c.revocada).to.equal(false);

      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(true);
      expect(await credenciales.organismoDe(empleado.address, Rol.EMPLEADO)).to.equal(BigInt(QUILMES));
    });

    it("emite credenciales de inspector", async () => {
      const { credenciales, inspector, vence } = await loadFixture(desplegar);
      await credenciales.emitirFuncionario(inspector.address, Rol.INSPECTOR, BERAZATEGUI, "Luis Gómez", vence);
      expect(await credenciales.tieneRolActivo(inspector.address, Rol.INSPECTOR)).to.equal(true);
    });

    it("no emite credenciales de proveedor (esas van por solicitud)", async () => {
      const { credenciales, proveedor, vence } = await loadFixture(desplegar);
      await expect(
        credenciales.emitirFuncionario(proveedor.address, Rol.PROVEEDOR, QUILMES, "X", vence),
      ).to.be.revertedWithCustomError(credenciales, "RolInvalido");
    });

    it("solo ADMIN_ROLE puede emitir", async () => {
      const { credenciales, empleado, otro, vence } = await loadFixture(desplegar);
      await expect(
        credenciales.connect(otro).emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", vence),
      )
        .to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount")
        .withArgs(otro.address, await credenciales.ADMIN_ROLE());
    });

    it("valida wallet, organismo, nombre y fecha", async () => {
      const { credenciales, empleado, vence } = await loadFixture(desplegar);
      const ahora = BigInt(await time.latest());

      await expect(
        credenciales.emitirFuncionario(ethers.ZeroAddress, Rol.EMPLEADO, QUILMES, "Ana", vence),
      ).to.be.revertedWithCustomError(credenciales, "WalletInvalida");
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, 0, "Ana", vence),
      ).to.be.revertedWithCustomError(credenciales, "OrganismoInvalido");
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "", vence),
      ).to.be.revertedWithCustomError(credenciales, "TextoInvalido");
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "x".repeat(121), vence),
      ).to.be.revertedWithCustomError(credenciales, "TextoInvalido");
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana", ahora),
      ).to.be.revertedWithCustomError(credenciales, "FechaInvalida");
    });

    it("no emite una segunda credencial a una wallet que ya tiene una, aunque sea de otro rol", async () => {
      const { credenciales, empleado, vence, tokenId } = await loadFixture(conEmpleado);
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.INSPECTOR, QUILMES, "Ana Pérez", vence),
      )
        .to.be.revertedWithCustomError(credenciales, "WalletConCredencial")
        .withArgs(tokenId);
    });

    it("no emite una segunda credencial a una wallet con la credencial vencida (hay que renovarla)", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleado);
      await time.increase(VIGENCIA + DIA);
      const nuevaFecha = BigInt((await time.latest()) + VIGENCIA);

      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", nuevaFecha),
      )
        .to.be.revertedWithCustomError(credenciales, "WalletConCredencial")
        .withArgs(tokenId);
    });

    it("tras revocar, permite emitir una nueva credencial a la misma wallet", async () => {
      const { credenciales, empleado, vence, tokenId } = await loadFixture(conEmpleado);
      await credenciales.revocar(tokenId, "Cambio de rol");

      await credenciales.emitirFuncionario(empleado.address, Rol.INSPECTOR, QUILMES, "Ana Pérez", vence);

      const [actual, datos] = await credenciales.credencialDe(empleado.address);
      expect(actual).to.equal(2n);
      expect(datos.rol).to.equal(BigInt(Rol.INSPECTOR));
      expect(await credenciales.balanceOf(empleado.address)).to.equal(2n);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.INSPECTOR)).to.equal(true);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(false);
      // La revocada sigue existiendo como historial
      expect((await credenciales.credencial(tokenId)).revocada).to.equal(true);
    });
  });

  describe("cuitValido", () => {
    it("acepta CUITs con dígito verificador correcto", async () => {
      const { credenciales } = await loadFixture(desplegar);
      for (const cuit of [CUIT_SUR, CUIT_NORTE, 20301112220n, 30711112223n]) {
        expect(await credenciales.cuitValido(cuit), String(cuit)).to.equal(true);
      }
    });

    it("rechaza dígito verificador incorrecto y largos inválidos", async () => {
      const { credenciales } = await loadFixture(desplegar);
      for (const cuit of [CUIT_DV_INCORRECTO, 0n, 3071234567n, 307123456710n]) {
        expect(await credenciales.cuitValido(cuit), String(cuit)).to.equal(false);
      }
    });
  });

  describe("solicitudes de proveedores", () => {
    it("cualquier wallet puede solicitar y queda pendiente", async () => {
      const { credenciales, proveedor } = await loadFixture(desplegar);

      await expect(
        credenciales
          .connect(proveedor)
          .solicitarInscripcion(CUIT_SUR, "Construcciones del Sur S.A.", "Av. Calchaquí 123, Quilmes", "Construcción"),
      )
        .to.emit(credenciales, "SolicitudCreada")
        .withArgs(1n, proveedor.address, CUIT_SUR, "Construcciones del Sur S.A.", "Av. Calchaquí 123, Quilmes", "Construcción");

      const s = await credenciales.solicitud(1n);
      expect(s.wallet).to.equal(proveedor.address);
      expect(s.cuit).to.equal(CUIT_SUR);
      expect(s.razonSocial).to.equal("Construcciones del Sur S.A.");
      expect(s.estado).to.equal(BigInt(Estado.PENDIENTE));
      expect(await credenciales.solicitudPendienteDe(proveedor.address)).to.equal(1n);
      expect(await credenciales.totalSolicitudes()).to.equal(1n);
      // Solicitar no da credencial
      expect(await credenciales.tieneRolActivo(proveedor.address, Rol.PROVEEDOR)).to.equal(false);
    });

    it("valida CUIT y textos", async () => {
      const { credenciales, proveedor } = await loadFixture(desplegar);
      const p = credenciales.connect(proveedor);

      await expect(p.solicitarInscripcion(CUIT_DV_INCORRECTO, "Empresa", "Domicilio", "Rubro"))
        .to.be.revertedWithCustomError(credenciales, "CuitInvalido")
        .withArgs(CUIT_DV_INCORRECTO);
      await expect(p.solicitarInscripcion(CUIT_SUR, "", "Domicilio", "Rubro")).to.be.revertedWithCustomError(
        credenciales,
        "TextoInvalido",
      );
      await expect(p.solicitarInscripcion(CUIT_SUR, "Empresa", "", "Rubro")).to.be.revertedWithCustomError(
        credenciales,
        "TextoInvalido",
      );
      await expect(
        p.solicitarInscripcion(CUIT_SUR, "Empresa", "Domicilio", "x".repeat(241)),
      ).to.be.revertedWithCustomError(credenciales, "TextoInvalido");
    });

    it("una wallet no puede tener dos solicitudes pendientes", async () => {
      const { credenciales, proveedor } = await loadFixture(conSolicitud);
      await expect(
        credenciales.connect(proveedor).solicitarInscripcion(CUIT_NORTE, "Otra S.A.", "Domicilio", "Rubro"),
      )
        .to.be.revertedWithCustomError(credenciales, "SolicitudPendienteExistente")
        .withArgs(1n);
    });

    it("dos wallets pueden pedir el mismo CUIT (el admin decide cuál es legítima)", async () => {
      const { credenciales, otro } = await loadFixture(conSolicitud);
      await credenciales.connect(otro).solicitarInscripcion(CUIT_SUR, "Construcciones del Sur S.A.", "Dom", "Rubro");
      expect(await credenciales.solicitudPendienteDe(otro.address)).to.equal(2n);
    });

    it("no puede solicitar una wallet que ya tiene credencial", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleado);
      await expect(
        credenciales.connect(empleado).solicitarInscripcion(CUIT_SUR, "Empresa", "Domicilio", "Rubro"),
      )
        .to.be.revertedWithCustomError(credenciales, "WalletConCredencial")
        .withArgs(tokenId);
    });

    it("no se puede solicitar un CUIT que ya tiene credencial vigente", async () => {
      const { credenciales, otro, tokenId } = await loadFixture(conProveedor);
      await expect(
        credenciales.connect(otro).solicitarInscripcion(CUIT_SUR, "Construcciones del Sur S.A.", "Dom", "Rubro"),
      )
        .to.be.revertedWithCustomError(credenciales, "CuitConCredencial")
        .withArgs(tokenId);
    });

    describe("aprobar", () => {
      it("emite la credencial de proveedor con el CUIT y la razón social", async () => {
        const { credenciales, proveedor, vence, solicitudId } = await loadFixture(conSolicitud);

        await expect(credenciales.aprobarSolicitud(solicitudId, vence))
          .to.emit(credenciales, "SolicitudAprobada")
          .withArgs(solicitudId, 1n)
          .and.to.emit(credenciales, "CredencialEmitida")
          .withArgs(1n, proveedor.address, Rol.PROVEEDOR, 0n, CUIT_SUR, "Construcciones del Sur S.A.", vence);

        expect(await credenciales.tieneRolActivo(proveedor.address, Rol.PROVEEDOR)).to.equal(true);
        expect((await credenciales.solicitud(solicitudId)).estado).to.equal(BigInt(Estado.APROBADA));
        expect(await credenciales.solicitudPendienteDe(proveedor.address)).to.equal(0n);

        const [tokenId, datos] = await credenciales.credencialDeCuit(CUIT_SUR);
        expect(tokenId).to.equal(1n);
        expect(datos.nombre).to.equal("Construcciones del Sur S.A.");
        expect(datos.organismoId).to.equal(0n);
      });

      it("solo ADMIN_ROLE puede aprobar", async () => {
        const { credenciales, proveedor, vence, solicitudId } = await loadFixture(conSolicitud);
        await expect(
          credenciales.connect(proveedor).aprobarSolicitud(solicitudId, vence),
        ).to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount");
      });

      it("no aprueba solicitudes inexistentes ni ya resueltas", async () => {
        const { credenciales, vence, solicitudId } = await loadFixture(conProveedor);
        await expect(credenciales.aprobarSolicitud(99n, vence))
          .to.be.revertedWithCustomError(credenciales, "SolicitudInexistente")
          .withArgs(99n);
        await expect(credenciales.aprobarSolicitud(solicitudId, vence))
          .to.be.revertedWithCustomError(credenciales, "SolicitudNoPendiente")
          .withArgs(solicitudId);
      });

      it("si dos wallets pidieron el mismo CUIT, solo se puede aprobar una", async () => {
        const { credenciales, otro, vence, solicitudId } = await loadFixture(conSolicitud);
        await credenciales.connect(otro).solicitarInscripcion(CUIT_SUR, "Construcciones del Sur S.A.", "Dom", "Rubro");
        await credenciales.aprobarSolicitud(solicitudId, vence);

        await expect(credenciales.aprobarSolicitud(2n, vence))
          .to.be.revertedWithCustomError(credenciales, "CuitConCredencial")
          .withArgs(1n);
      });
    });

    describe("rechazar y cancelar", () => {
      it("el admin rechaza con motivo y el proveedor puede volver a solicitar", async () => {
        const { credenciales, proveedor, solicitudId } = await loadFixture(conSolicitud);

        await expect(credenciales.rechazarSolicitud(solicitudId, "La razón social no coincide con AFIP"))
          .to.emit(credenciales, "SolicitudRechazada")
          .withArgs(solicitudId, "La razón social no coincide con AFIP");

        expect((await credenciales.solicitud(solicitudId)).estado).to.equal(BigInt(Estado.RECHAZADA));
        expect(await credenciales.solicitudPendienteDe(proveedor.address)).to.equal(0n);

        await credenciales.connect(proveedor).solicitarInscripcion(CUIT_SUR, "Construcciones del Sur S.A.", "Dom", "Rubro");
        expect(await credenciales.solicitudPendienteDe(proveedor.address)).to.equal(2n);
      });

      it("rechazar exige motivo y ADMIN_ROLE", async () => {
        const { credenciales, proveedor, solicitudId } = await loadFixture(conSolicitud);
        await expect(credenciales.rechazarSolicitud(solicitudId, "")).to.be.revertedWithCustomError(
          credenciales,
          "MotivoVacio",
        );
        await expect(
          credenciales.connect(proveedor).rechazarSolicitud(solicitudId, "Motivo"),
        ).to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount");
      });

      it("el proveedor cancela su propia solicitud, pero no la de otro", async () => {
        const { credenciales, proveedor, otro, solicitudId } = await loadFixture(conSolicitud);

        await expect(credenciales.connect(otro).cancelarSolicitud(solicitudId))
          .to.be.revertedWithCustomError(credenciales, "NoEsTuSolicitud")
          .withArgs(solicitudId);

        await expect(credenciales.connect(proveedor).cancelarSolicitud(solicitudId))
          .to.emit(credenciales, "SolicitudCancelada")
          .withArgs(solicitudId);
        expect((await credenciales.solicitud(solicitudId)).estado).to.equal(BigInt(Estado.CANCELADA));
        expect(await credenciales.solicitudPendienteDe(proveedor.address)).to.equal(0n);
      });

      it("no se puede aprobar una solicitud cancelada", async () => {
        const { credenciales, proveedor, vence, solicitudId } = await loadFixture(conSolicitud);
        await credenciales.connect(proveedor).cancelarSolicitud(solicitudId);
        await expect(credenciales.aprobarSolicitud(solicitudId, vence))
          .to.be.revertedWithCustomError(credenciales, "SolicitudNoPendiente")
          .withArgs(solicitudId);
      });
    });

    it("al revocar un proveedor, su CUIT queda libre para inscribirse de nuevo", async () => {
      const { credenciales, otro, vence, tokenId } = await loadFixture(conProveedor);
      await credenciales.revocar(tokenId, "Wallet comprometida");

      await credenciales.connect(otro).solicitarInscripcion(CUIT_SUR, "Construcciones del Sur S.A.", "Dom", "Rubro");
      await credenciales.aprobarSolicitud(2n, vence);

      expect(await credenciales.tieneRolActivo(otro.address, Rol.PROVEEDOR)).to.equal(true);
      const [actual] = await credenciales.credencialDeCuit(CUIT_SUR);
      expect(actual).to.equal(2n);
    });
  });

  describe("intransferibilidad", () => {
    it("bloquea transferFrom y safeTransferFrom", async () => {
      const { credenciales, empleado, otro, tokenId } = await loadFixture(conEmpleado);

      await expect(
        credenciales.connect(empleado).transferFrom(empleado.address, otro.address, tokenId),
      ).to.be.revertedWithCustomError(credenciales, "CredencialIntransferible");
      await expect(
        credenciales
          .connect(empleado)
          ["safeTransferFrom(address,address,uint256)"](empleado.address, otro.address, tokenId),
      ).to.be.revertedWithCustomError(credenciales, "CredencialIntransferible");
    });

    it("bloquea approve y setApprovalForAll", async () => {
      const { credenciales, empleado, otro, tokenId } = await loadFixture(conEmpleado);

      await expect(
        credenciales.connect(empleado).approve(otro.address, tokenId),
      ).to.be.revertedWithCustomError(credenciales, "CredencialIntransferible");
      await expect(
        credenciales.connect(empleado).setApprovalForAll(otro.address, true),
      ).to.be.revertedWithCustomError(credenciales, "CredencialIntransferible");
    });

    it("el admin tampoco puede mover credenciales ajenas", async () => {
      const { credenciales, admin, empleado, tokenId } = await loadFixture(conEmpleado);
      await expect(
        credenciales.connect(admin).transferFrom(empleado.address, admin.address, tokenId),
      ).to.be.revertedWithCustomError(credenciales, "CredencialIntransferible");
    });
  });

  describe("revocar", () => {
    it("revoca la credencial y emite el evento con el motivo", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleado);

      await expect(credenciales.revocar(tokenId, "Baja en el padrón de empleados"))
        .to.emit(credenciales, "CredencialRevocada")
        .withArgs(tokenId, empleado.address, "Baja en el padrón de empleados");

      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(false);
      await expect(credenciales.organismoDe(empleado.address, Rol.EMPLEADO))
        .to.be.revertedWithCustomError(credenciales, "SinCredencialActiva")
        .withArgs(empleado.address, Rol.EMPLEADO);
    });

    it("solo ADMIN_ROLE puede revocar", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleado);
      await expect(
        credenciales.connect(empleado).revocar(tokenId, "Me revoco"),
      ).to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount");
    });

    it("exige motivo y no revoca dos veces", async () => {
      const { credenciales, tokenId } = await loadFixture(conEmpleado);
      await expect(credenciales.revocar(tokenId, "")).to.be.revertedWithCustomError(credenciales, "MotivoVacio");

      await credenciales.revocar(tokenId, "Baja");
      await expect(credenciales.revocar(tokenId, "Baja"))
        .to.be.revertedWithCustomError(credenciales, "CredencialYaRevocada")
        .withArgs(tokenId);
    });

    it("falla con un tokenId inexistente", async () => {
      const { credenciales } = await loadFixture(desplegar);
      await expect(credenciales.revocar(99n, "Baja"))
        .to.be.revertedWithCustomError(credenciales, "CredencialInexistente")
        .withArgs(99n);
    });
  });

  describe("vencimiento y renovación", () => {
    it("la credencial vale hasta validaHasta inclusive y después vence sola", async () => {
      const { credenciales, empleado, vence } = await loadFixture(conEmpleado);

      await time.increaseTo(vence);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(true);

      await time.increase(1);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(false);
    });

    it("renovar una credencial vencida la vuelve a habilitar", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleado);
      await time.increase(VIGENCIA + DIA);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(false);

      const nuevaFecha = BigInt((await time.latest()) + VIGENCIA);
      await expect(credenciales.renovar(tokenId, nuevaFecha))
        .to.emit(credenciales, "CredencialRenovada")
        .withArgs(tokenId, empleado.address, nuevaFecha);

      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(true);
      expect((await credenciales.credencial(tokenId)).validaHasta).to.equal(nuevaFecha);
    });

    it("no renueva credenciales revocadas ni con fechas pasadas", async () => {
      const { credenciales, tokenId } = await loadFixture(conEmpleado);
      const pasada = BigInt(await time.latest());
      await expect(credenciales.renovar(tokenId, pasada)).to.be.revertedWithCustomError(credenciales, "FechaInvalida");

      await credenciales.revocar(tokenId, "Baja");
      const futura = BigInt((await time.latest()) + VIGENCIA);
      await expect(credenciales.renovar(tokenId, futura))
        .to.be.revertedWithCustomError(credenciales, "CredencialYaRevocada")
        .withArgs(tokenId);
    });

    it("solo ADMIN_ROLE puede renovar", async () => {
      const { credenciales, empleado, tokenId, vence } = await loadFixture(conEmpleado);
      await expect(
        credenciales.connect(empleado).renovar(tokenId, vence + BigInt(VIGENCIA)),
      ).to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount");
    });
  });

  describe("consultas", () => {
    it("tieneRolActivo es false para wallets sin credencial o con otro rol", async () => {
      const { credenciales, empleado, otro } = await loadFixture(conEmpleado);
      expect(await credenciales.tieneRolActivo(otro.address, Rol.EMPLEADO)).to.equal(false);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.INSPECTOR)).to.equal(false);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.PROVEEDOR)).to.equal(false);
    });

    it("credencialDe devuelve tokenId 0 si la wallet nunca tuvo credencial", async () => {
      const { credenciales, otro } = await loadFixture(desplegar);
      const [tokenId] = await credenciales.credencialDe(otro.address);
      expect(tokenId).to.equal(0n);
    });

    it("credencialDe devuelve la credencial aunque esté revocada (para mostrar el estado)", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleado);
      await credenciales.revocar(tokenId, "Baja");
      const [id, datos] = await credenciales.credencialDe(empleado.address);
      expect(id).to.equal(tokenId);
      expect(datos.revocada).to.equal(true);
    });

    it("solicitud falla con un id inexistente", async () => {
      const { credenciales } = await loadFixture(desplegar);
      await expect(credenciales.solicitud(0n)).to.be.revertedWithCustomError(credenciales, "SolicitudInexistente");
      await expect(credenciales.solicitud(1n)).to.be.revertedWithCustomError(credenciales, "SolicitudInexistente");
    });
  });
});
