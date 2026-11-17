import { expect } from "chai";
import { network } from "hardhat";
import {
  BERAZATEGUI,
  CUIT_DV_INCORRECTO,
  CUIT_NORTE,
  CUIT_SUR,
  DIA,
  GrupoLocal,
  QUILMES,
  Rol,
  VIGENCIA,
  autorizarInscripcion,
  desplegarCredenciales,
  identidad,
  protocolo,
} from "./lib/fixtures.js";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const SIN_DATOS = ethers.ZeroHash;
const HASH_ANA = protocolo.datosHash({ dni: "30111222", resolucion: "Res. 12/2026" }, protocolo.nuevaSal());

async function desplegar() {
  return desplegarCredenciales(ethers);
}

async function conEmpleado() {
  const base = await desplegar();
  await base.credenciales.emitirFuncionario(base.empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", base.vence, HASH_ANA);
  return { ...base, tokenId: 1n };
}

async function conProveedor() {
  const base = await desplegar();
  const id = identidad("construcciones-del-sur");
  // Función y no objeto: loadFixture restaura la cadena pero no los objetos de JS entre tests.
  const grupo = () => {
    const g = new GrupoLocal();
    g.agregar(id.commitment);
    return g;
  };
  const { datos, firma } = await autorizarInscripcion(ethers, base.credenciales, base.verificador, base.proveedor.address, {
    identityCommitment: id.commitment,
  });
  await base.credenciales.connect(base.proveedor).inscribirProveedor(datos, firma);
  return { ...base, tokenId: 1n, id, grupo, datos };
}

describe("CredencialNFT", () => {
  describe("despliegue", () => {
    it("asigna los roles de administración a la wallet indicada", async () => {
      const { credenciales, admin } = await loadFixture(desplegar);
      expect(await credenciales.hasRole(await credenciales.ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await credenciales.hasRole(await credenciales.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    });

    it("no acepta la dirección cero como admin", async () => {
      const { semaphore } = await loadFixture(desplegar);
      const fabrica = await ethers.getContractFactory("CredencialNFT");
      await expect(fabrica.deploy(ethers.ZeroAddress, await semaphore.getAddress())).to.be.revertedWithCustomError(
        fabrica,
        "WalletInvalida",
      );
      await expect(fabrica.deploy((await ethers.getSigners())[0].address, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        fabrica,
        "WalletInvalida",
      );
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

      await expect(credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", vence, HASH_ANA))
        .to.emit(credenciales, "CredencialEmitida")
        .withArgs(1n, empleado.address, Rol.EMPLEADO, QUILMES, 0n, "Ana Pérez", vence, HASH_ANA)
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
      expect(c.datosHash).to.equal(HASH_ANA);

      expect(await credenciales.tieneRolActivo(empleado.address, Rol.EMPLEADO)).to.equal(true);
      expect(await credenciales.organismoDe(empleado.address, Rol.EMPLEADO)).to.equal(BigInt(QUILMES));
    });

    it("emite credenciales de inspector", async () => {
      const { credenciales, inspector, vence } = await loadFixture(desplegar);
      await credenciales.emitirFuncionario(inspector.address, Rol.INSPECTOR, BERAZATEGUI, "Luis Gómez", vence, SIN_DATOS);
      expect(await credenciales.tieneRolActivo(inspector.address, Rol.INSPECTOR)).to.equal(true);
    });

    it("no emite credenciales de proveedor (esas se inscriben con la firma del verificador)", async () => {
      const { credenciales, proveedor, vence } = await loadFixture(desplegar);
      await expect(
        credenciales.emitirFuncionario(proveedor.address, Rol.PROVEEDOR, QUILMES, "X", vence, SIN_DATOS),
      ).to.be.revertedWithCustomError(credenciales, "RolInvalido");
    });

    it("solo ADMIN_ROLE puede emitir", async () => {
      const { credenciales, empleado, otro, vence } = await loadFixture(desplegar);
      await expect(
        credenciales.connect(otro).emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", vence, SIN_DATOS),
      )
        .to.be.revertedWithCustomError(credenciales, "AccessControlUnauthorizedAccount")
        .withArgs(otro.address, await credenciales.ADMIN_ROLE());
    });

    it("valida wallet, organismo, nombre y fecha", async () => {
      const { credenciales, empleado, vence } = await loadFixture(desplegar);
      const ahora = BigInt(await time.latest());

      await expect(
        credenciales.emitirFuncionario(ethers.ZeroAddress, Rol.EMPLEADO, QUILMES, "Ana", vence, SIN_DATOS),
      ).to.be.revertedWithCustomError(credenciales, "WalletInvalida");
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, 0, "Ana", vence, SIN_DATOS),
      ).to.be.revertedWithCustomError(credenciales, "OrganismoInvalido");
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "", vence, SIN_DATOS),
      ).to.be.revertedWithCustomError(credenciales, "TextoInvalido");
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "x".repeat(121), vence, SIN_DATOS),
      ).to.be.revertedWithCustomError(credenciales, "TextoInvalido");
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana", ahora, SIN_DATOS),
      ).to.be.revertedWithCustomError(credenciales, "FechaInvalida");
    });

    it("no emite una segunda credencial a una wallet que ya tiene una, aunque sea de otro rol", async () => {
      const { credenciales, empleado, vence, tokenId } = await loadFixture(conEmpleado);
      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.INSPECTOR, QUILMES, "Ana Pérez", vence, SIN_DATOS),
      )
        .to.be.revertedWithCustomError(credenciales, "WalletConCredencial")
        .withArgs(tokenId);
    });

    it("no emite una segunda credencial a una wallet con la credencial vencida (hay que renovarla)", async () => {
      const { credenciales, empleado, tokenId } = await loadFixture(conEmpleado);
      await time.increase(VIGENCIA + DIA);
      const nuevaFecha = BigInt((await time.latest()) + VIGENCIA);

      await expect(
        credenciales.emitirFuncionario(empleado.address, Rol.EMPLEADO, QUILMES, "Ana Pérez", nuevaFecha, SIN_DATOS),
      )
        .to.be.revertedWithCustomError(credenciales, "WalletConCredencial")
        .withArgs(tokenId);
    });

    it("tras revocar, permite emitir una nueva credencial a la misma wallet", async () => {
      const { credenciales, empleado, vence, tokenId } = await loadFixture(conEmpleado);
      await credenciales.revocar(tokenId, "Cambio de rol");

      await credenciales.emitirFuncionario(empleado.address, Rol.INSPECTOR, QUILMES, "Ana Pérez", vence, SIN_DATOS);

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

  describe("inscripción de proveedores (firma del verificador)", () => {
    it("emite la credencial y agrega el compromiso al grupo de Semaphore", async () => {
      const { credenciales, semaphore, grupoId, verificador, proveedor } = await loadFixture(desplegar);
      const id = identidad("sur");
      const { datos, firma } = await autorizarInscripcion(ethers, credenciales, verificador, proveedor.address, {
        identityCommitment: id.commitment,
      });

      await expect(credenciales.connect(proveedor).inscribirProveedor(datos, firma))
        .to.emit(credenciales, "CredencialEmitida")
        .withArgs(1n, proveedor.address, Rol.PROVEEDOR, 0, CUIT_SUR, datos.razonSocial, datos.validaHasta, datos.datosHash)
        .and.to.emit(credenciales, "ProveedorAgregadoAlGrupo")
        .withArgs(1n, id.commitment);

      expect(await credenciales.tieneRolActivo(proveedor.address, Rol.PROVEEDOR)).to.equal(true);
      expect(await semaphore.hasMember(grupoId, id.commitment)).to.equal(true);
      const [commitment, enGrupo] = await credenciales.compromisoDe(1n);
      expect(commitment).to.equal(id.commitment);
      expect(enGrupo).to.equal(true);
      const c = await credenciales.credencial(1n);
      expect(c.cuit).to.equal(CUIT_SUR);
      expect(c.datosHash).to.equal(datos.datosHash);
    });

    it("rechaza firmas de cuentas sin VERIFICADOR_ROLE", async () => {
      const { credenciales, otro, proveedor } = await loadFixture(desplegar);
      const { datos, firma } = await autorizarInscripcion(ethers, credenciales, otro, proveedor.address, {
        identityCommitment: identidad("x").commitment,
      });
      await expect(credenciales.connect(proveedor).inscribirProveedor(datos, firma)).to.be.revertedWithCustomError(
        credenciales,
        "FirmaInvalida",
      );
    });

    it("la firma no sirve para otra wallet ni con otros datos", async () => {
      const { credenciales, verificador, proveedor, otro } = await loadFixture(desplegar);
      const { datos, firma } = await autorizarInscripcion(ethers, credenciales, verificador, proveedor.address, {
        identityCommitment: identidad("x").commitment,
      });
      await expect(credenciales.connect(otro).inscribirProveedor(datos, firma)).to.be.revertedWithCustomError(
        credenciales,
        "FirmaInvalida",
      );
      await expect(
        credenciales.connect(proveedor).inscribirProveedor({ ...datos, razonSocial: "Otra S.A." }, firma),
      ).to.be.revertedWithCustomError(credenciales, "FirmaInvalida");
      await expect(
        credenciales.connect(proveedor).inscribirProveedor({ ...datos, identityCommitment: 123n }, firma),
      ).to.be.revertedWithCustomError(credenciales, "FirmaInvalida");
    });

    it("rechaza autorizaciones vencidas y CUITs inválidos", async () => {
      const { credenciales, verificador, proveedor } = await loadFixture(desplegar);
      const vencida = await autorizarInscripcion(ethers, credenciales, verificador, proveedor.address, {
        identityCommitment: identidad("x").commitment,
      });
      await time.increase(2 * 3600);
      await expect(
        credenciales.connect(proveedor).inscribirProveedor(vencida.datos, vencida.firma),
      ).to.be.revertedWithCustomError(credenciales, "FirmaVencida");

      const malCuit = await autorizarInscripcion(ethers, credenciales, verificador, proveedor.address, {
        identityCommitment: identidad("x").commitment,
        cuit: CUIT_DV_INCORRECTO,
      });
      await expect(credenciales.connect(proveedor).inscribirProveedor(malCuit.datos, malCuit.firma))
        .to.be.revertedWithCustomError(credenciales, "CuitInvalido")
        .withArgs(CUIT_DV_INCORRECTO);
    });

    it("una autorización se usa una sola vez", async () => {
      const { credenciales, verificador, proveedor, tokenId, datos, id, grupo } = await loadFixture(conProveedor);
      await credenciales.revocarProveedor(tokenId, "Prueba", grupo().quitar(id.commitment));
      const misma = await autorizarInscripcion(ethers, credenciales, verificador, proveedor.address, datos);
      await expect(credenciales.connect(proveedor).inscribirProveedor(misma.datos, misma.firma)).to.be.revertedWithCustomError(
        credenciales,
        "FirmaYaUsada",
      );
    });

    it("no inscribe un CUIT que ya tiene credencial vigente, ni una wallet con credencial", async () => {
      const { credenciales, verificador, proveedor, otro } = await loadFixture(conProveedor);
      const mismoCuit = await autorizarInscripcion(ethers, credenciales, verificador, otro.address, {
        identityCommitment: identidad("otro").commitment,
      });
      await expect(credenciales.connect(otro).inscribirProveedor(mismoCuit.datos, mismoCuit.firma))
        .to.be.revertedWithCustomError(credenciales, "CuitConCredencial")
        .withArgs(1n);

      const mismaWallet = await autorizarInscripcion(ethers, credenciales, verificador, proveedor.address, {
        identityCommitment: identidad("otro").commitment,
        cuit: CUIT_NORTE,
      });
      await expect(credenciales.connect(proveedor).inscribirProveedor(mismaWallet.datos, mismaWallet.firma))
        .to.be.revertedWithCustomError(credenciales, "WalletConCredencial")
        .withArgs(1n);
    });

    it("no acepta un compromiso de identidad que ya está en el grupo", async () => {
      const { credenciales, verificador, otro, datos } = await loadFixture(conProveedor);
      const repetido = await autorizarInscripcion(ethers, credenciales, verificador, otro.address, {
        identityCommitment: datos.identityCommitment,
        cuit: CUIT_NORTE,
      });
      await expect(credenciales.connect(otro).inscribirProveedor(repetido.datos, repetido.firma)).to.revert(ethers);
    });

    it("revocarProveedor saca al proveedor del grupo y libera el CUIT", async () => {
      const { credenciales, semaphore, grupoId, verificador, otro, tokenId, id, grupo } = await loadFixture(conProveedor);

      await expect(credenciales.revocarProveedor(tokenId, "Wallet comprometida", grupo().quitar(id.commitment)))
        .to.emit(credenciales, "ProveedorQuitadoDelGrupo")
        .withArgs(tokenId, id.commitment);
      expect(await semaphore.hasMember(grupoId, id.commitment)).to.equal(false);
      expect((await credenciales.compromisoDe(tokenId))[1]).to.equal(false);

      // La misma empresa se vuelve a inscribir con otra wallet y otra identidad
      const nueva = await autorizarInscripcion(ethers, credenciales, verificador, otro.address, {
        identityCommitment: identidad("sur-nueva").commitment,
      });
      await credenciales.connect(otro).inscribirProveedor(nueva.datos, nueva.firma);
      const [actual] = await credenciales.credencialDeCuit(CUIT_SUR);
      expect(actual).to.equal(2n);
    });

    it("revocar (sin siblings) no se puede usar con proveedores que están en el grupo", async () => {
      const { credenciales, tokenId } = await loadFixture(conProveedor);
      await expect(credenciales.revocar(tokenId, "Baja"))
        .to.be.revertedWithCustomError(credenciales, "UsarRevocarProveedor")
        .withArgs(tokenId);
    });

    it("revocarProveedor solo acepta proveedores", async () => {
      const { credenciales, tokenId } = await loadFixture(conEmpleado);
      await expect(credenciales.revocarProveedor(tokenId, "Baja", []))
        .to.be.revertedWithCustomError(credenciales, "NoEsProveedor")
        .withArgs(tokenId);
    });

    it("cualquiera puede sacar del grupo a un proveedor vencido, y después no se puede renovar", async () => {
      const { credenciales, otro, tokenId, id, grupo, datos } = await loadFixture(conProveedor);
      const siblings = grupo().quitar(id.commitment);
      await expect(credenciales.connect(otro).quitarVencidoDelGrupo(tokenId, siblings))
        .to.be.revertedWithCustomError(credenciales, "CredencialNoVencida")
        .withArgs(tokenId);

      await time.increaseTo(datos.validaHasta + 1n);
      await credenciales.connect(otro).quitarVencidoDelGrupo(tokenId, siblings);
      expect((await credenciales.compromisoDe(tokenId))[1]).to.equal(false);

      const futura = BigInt((await time.latest()) + VIGENCIA);
      await expect(credenciales.renovar(tokenId, futura))
        .to.be.revertedWithCustomError(credenciales, "ProveedorFueraDelGrupo")
        .withArgs(tokenId);
      // Ya fuera del grupo, se revoca con `revocar`
      await credenciales.revocar(tokenId, "Vencida");
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
  });
});
