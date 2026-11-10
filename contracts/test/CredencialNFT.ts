import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

// Debe coincidir con el orden del enum en ICredencialNFT.sol
const Rol = { PROVEEDOR: 0, EMPLEADO: 1, INSPECTOR: 2 } as const;

const DIA = 24 * 60 * 60;
const VIGENCIA = 90 * DIA;
const ORGANISMO_QUILMES = 1;
const ORGANISMO_BERAZATEGUI = 2;

const idHash = (dato: string) => ethers.keccak256(ethers.toUtf8Bytes(`${dato}:sal-de-prueba`));

async function desplegar() {
  const [admin, empleado, inspector, proveedor, otro] = await ethers.getSigners();
  const credenciales = await ethers.deployContract("CredencialNFT", [admin.address]);
  const ahora = await time.latest();
  const vence = BigInt(ahora + VIGENCIA);
  return { credenciales, admin, empleado, inspector, proveedor, otro, vence };
}

async function conEmpleadoEmitido() {
  const base = await desplegar();
  await base.credenciales.emitir(
    base.empleado.address,
    Rol.EMPLEADO,
    ORGANISMO_QUILMES,
    idHash("30111222"),
    base.vence,
  );
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

  describe("emitir", () => {
    it("emite la credencial y guarda sus datos", async () => {
      const { credenciales, empleado, vence } = await loadFixture(desplegar);

      await expect(
        credenciales.emitir(empleado.address, Rol.EMPLEADO, ORGANISMO_QUILMES, idHash("30111222"), vence),
      )
        .to.emit(credenciales, "CredencialEmitida")
        .withArgs(1n, empleado.address, Rol.EMPLEADO, ORGANISMO_QUILMES, vence)
        .and.to.emit(credenciales, "Locked")
        .withArgs(1n);

      expect(await credenciales.ownerOf(1n)).to.equal(empleado.address);
      expect(await credenciales.totalEmitidas()).to.equal(1n);
      expect(await credenciales.locked(1n)).to.equal(true);

      const c = await credenciales.credencial(1n);
      expect(c.rol).to.equal(BigInt(Rol.EMPLEADO));
      expect(c.organismoId).to.equal(BigInt(ORGANISMO_QUILMES));
      expect(c.validaHasta).to.equal(vence);
      expect(c.revocada).to.equal(false);
      expect(c.idHash).to.equal(idHash("30111222"));

      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(true);
      expect(await credenciales.organismoDe(empleado.address, Rol.EMPLEADO)).to.equal(BigInt(ORGANISMO_QUILMES));
    });

    it("emite credenciales de inspector y de proveedor", async () => {
      const { credenciales, inspector, proveedor, vence } = await loadFixture(desplegar);
      await credenciales.emitir(inspector.address, Rol.INSPECTOR, ORGANISMO_BERAZATEGUI, idHash("28999000"), vence);
      await credenciales.emitir(proveedor.address, Rol.PROVEEDOR, 0, idHash("30-71234567-8"), vence);

      expect(await credenciales.tieneRolActivo(inspector.address, Rol.INSPECTOR)).to.equal(true);
      expect(await credenciales.tieneRolActivo(proveedor.address, Rol.PROVEEDOR)).to.equal(true);
    });

    it("solo ADMIN_ROLE puede emitir", async () => {
      const { credenciales, empleado, otro, vence } = await loadFixture(desplegar);
      await expect(
        credenciales
          .connect(otro)
          .emitir(empleado.address, Rol.EMPLEADO, ORGANISMO_QUILMES, idHash("30111222"), vence),
      )
        .to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount")
        .withArgs(otro.address, await credenciales.ADMIN_ROLE());
    });

    it("valida wallet, idHash y fecha", async () => {
      const { credenciales, empleado, vence } = await loadFixture(desplegar);
      const ahora = BigInt(await time.latest());

      await expect(
        credenciales.emitir(ethers.ZeroAddress, Rol.EMPLEADO, ORGANISMO_QUILMES, idHash("1"), vence),
      ).to.be.revertedWithCustomError(credenciales, "WalletInvalida");
      await expect(
        credenciales.emitir(empleado.address, Rol.EMPLEADO, ORGANISMO_QUILMES, ethers.ZeroHash, vence),
      ).to.be.revertedWithCustomError(credenciales, "IdHashInvalido");
      await expect(
        credenciales.emitir(empleado.address, Rol.EMPLEADO, ORGANISMO_QUILMES, idHash("1"), ahora),
      ).to.be.revertedWithCustomError(credenciales, "FechaInvalida");
    });

    it("exige organismo para empleados e inspectores, y ninguno para proveedores", async () => {
      const { credenciales, empleado, inspector, proveedor, vence } = await loadFixture(desplegar);

      await expect(
        credenciales.emitir(empleado.address, Rol.EMPLEADO, 0, idHash("1"), vence),
      ).to.be.revertedWithCustomError(credenciales, "OrganismoInvalido");
      await expect(
        credenciales.emitir(inspector.address, Rol.INSPECTOR, 0, idHash("2"), vence),
      ).to.be.revertedWithCustomError(credenciales, "OrganismoInvalido");
      await expect(
        credenciales.emitir(proveedor.address, Rol.PROVEEDOR, ORGANISMO_QUILMES, idHash("3"), vence),
      ).to.be.revertedWithCustomError(credenciales, "OrganismoInvalido");
    });

    it("no emite una segunda credencial a una wallet que ya tiene una, aunque sea de otro rol", async () => {
      const { credenciales, empleado, vence, tokenId } = await loadFixture(conEmpleadoEmitido);
      await expect(
        credenciales.emitir(empleado.address, Rol.INSPECTOR, ORGANISMO_QUILMES, idHash("otro-dni"), vence),
      )
        .to.be.revertedWithCustomError(credenciales, "WalletConCredencial")
        .withArgs(tokenId);
    });

    it("no emite una segunda credencial a una wallet con la credencial vencida (hay que renovarla)", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleadoEmitido);
      await time.increase(VIGENCIA + DIA);
      const nuevaFecha = BigInt((await time.latest()) + VIGENCIA);

      await expect(
        credenciales.emitir(empleado.address, Rol.EMPLEADO, ORGANISMO_QUILMES, idHash("otro-dni"), nuevaFecha),
      )
        .to.be.revertedWithCustomError(credenciales, "WalletConCredencial")
        .withArgs(tokenId);
    });

    it("no emite dos credenciales para la misma persona (mismo idHash) en wallets distintas", async () => {
      const { credenciales, otro, vence, tokenId } = await loadFixture(conEmpleadoEmitido);
      await expect(
        credenciales.emitir(otro.address, Rol.EMPLEADO, ORGANISMO_QUILMES, idHash("30111222"), vence),
      )
        .to.be.revertedWithCustomError(credenciales, "IdHashConCredencial")
        .withArgs(tokenId);
    });

    it("tras revocar, permite emitir de nuevo a la misma persona (por ejemplo, con otra wallet)", async () => {
      const { credenciales, empleado, otro, vence, tokenId } = await loadFixture(conEmpleadoEmitido);
      await credenciales.revocar(tokenId, "Wallet comprometida");

      await credenciales.emitir(otro.address, Rol.EMPLEADO, ORGANISMO_QUILMES, idHash("30111222"), vence);

      expect(await credenciales.tieneRolActivo(otro.address, Rol.EMPLEADO)).to.equal(true);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(false);
      // La credencial revocada sigue existiendo como historial
      expect(await credenciales.ownerOf(tokenId)).to.equal(empleado.address);
      expect((await credenciales.credencial(tokenId)).revocada).to.equal(true);
    });

    it("tras revocar, permite emitir una nueva credencial a la misma wallet", async () => {
      const { credenciales, empleado, vence, tokenId } = await loadFixture(conEmpleadoEmitido);
      await credenciales.revocar(tokenId, "Cambio de rol");

      await credenciales.emitir(empleado.address, Rol.INSPECTOR, ORGANISMO_QUILMES, idHash("30111222"), vence);

      const [actual, datos] = await credenciales.credencialDe(empleado.address);
      expect(actual).to.equal(2n);
      expect(datos.rol).to.equal(BigInt(Rol.INSPECTOR));
      expect(await credenciales.balanceOf(empleado.address)).to.equal(2n);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.INSPECTOR)).to.equal(true);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(false);
    });
  });

  describe("intransferibilidad", () => {
    it("bloquea transferFrom y safeTransferFrom", async () => {
      const { credenciales, empleado, otro, tokenId } = await loadFixture(conEmpleadoEmitido);

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
      const { credenciales, empleado, otro, tokenId } = await loadFixture(conEmpleadoEmitido);

      await expect(
        credenciales.connect(empleado).approve(otro.address, tokenId),
      ).to.be.revertedWithCustomError(credenciales, "CredencialIntransferible");
      await expect(
        credenciales.connect(empleado).setApprovalForAll(otro.address, true),
      ).to.be.revertedWithCustomError(credenciales, "CredencialIntransferible");
    });

    it("el admin tampoco puede mover credenciales ajenas", async () => {
      const { credenciales, admin, empleado, tokenId } = await loadFixture(conEmpleadoEmitido);
      await expect(
        credenciales.connect(admin).transferFrom(empleado.address, admin.address, tokenId),
      ).to.be.revertedWithCustomError(credenciales, "CredencialIntransferible");
    });
  });

  describe("revocar", () => {
    it("revoca la credencial y emite el evento con el motivo", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleadoEmitido);

      await expect(credenciales.revocar(tokenId, "Baja en el padrón de empleados"))
        .to.emit(credenciales, "CredencialRevocada")
        .withArgs(tokenId, empleado.address, "Baja en el padrón de empleados");

      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(false);
      await expect(credenciales.organismoDe(empleado.address, Rol.EMPLEADO))
        .to.be.revertedWithCustomError(credenciales, "SinCredencialActiva")
        .withArgs(empleado.address, Rol.EMPLEADO);
    });

    it("solo ADMIN_ROLE puede revocar", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleadoEmitido);
      await expect(
        credenciales.connect(empleado).revocar(tokenId, "Me revoco"),
      ).to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount");
    });

    it("exige motivo y no revoca dos veces", async () => {
      const { credenciales, tokenId } = await loadFixture(conEmpleadoEmitido);
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
      const { credenciales, empleado, vence } = await loadFixture(conEmpleadoEmitido);

      await time.increaseTo(vence);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(true);

      await time.increase(1);
      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(false);
    });

    it("renovar una credencial vencida la vuelve a habilitar", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleadoEmitido);
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
      const { credenciales, tokenId } = await loadFixture(conEmpleadoEmitido);
      const pasada = BigInt(await time.latest());
      await expect(credenciales.renovar(tokenId, pasada)).to.be.revertedWithCustomError(credenciales, "FechaInvalida");

      await credenciales.revocar(tokenId, "Baja");
      const futura = BigInt((await time.latest()) + VIGENCIA);
      await expect(credenciales.renovar(tokenId, futura))
        .to.be.revertedWithCustomError(credenciales, "CredencialYaRevocada")
        .withArgs(tokenId);
    });

    it("solo ADMIN_ROLE puede renovar", async () => {
      const { credenciales, empleado, tokenId, vence } = await loadFixture(conEmpleadoEmitido);
      await expect(
        credenciales.connect(empleado).renovar(tokenId, vence + BigInt(VIGENCIA)),
      ).to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount");
    });
  });

  describe("consultas", () => {
    it("tieneRolActivo es false para wallets sin credencial o con otro rol", async () => {
      const { credenciales, empleado, otro } = await loadFixture(conEmpleadoEmitido);
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
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleadoEmitido);
      await credenciales.revocar(tokenId, "Baja");
      const [id, datos] = await credenciales.credencialDe(empleado.address);
      expect(id).to.equal(tokenId);
      expect(datos.revocada).to.equal(true);
    });
  });
});
