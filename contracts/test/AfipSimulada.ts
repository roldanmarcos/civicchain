import { expect } from "chai";
import { readFile } from "node:fs/promises";
import {
  RESULTADOS,
  crearClienteAfip,
  cuitValido,
  normalizarNombre,
} from "../../frontend/src/services/afip/afip.js";

const padron = JSON.parse(
  await readFile(new URL("../../frontend/src/services/afip/padron.json", import.meta.url), "utf8"),
);
const afip = crearClienteAfip(padron);

describe("AFIP simulada", () => {
  it("todos los CUITs del padrón tienen dígito verificador válido", () => {
    for (const persona of padron) {
      expect(cuitValido(persona.idPersona), String(persona.idPersona)).to.equal(true);
    }
  });

  describe("consultarCuit", () => {
    it("devuelve la persona, con o sin guiones", async () => {
      expect((await afip.consultarCuit("30712345671"))?.razonSocial).to.equal("CONSTRUCCIONES DEL SUR S.A.");
      expect((await afip.consultarCuit("30-71234567-1"))?.razonSocial).to.equal("CONSTRUCCIONES DEL SUR S.A.");
    });

    it("devuelve null si el CUIT no está en el padrón", async () => {
      expect(await afip.consultarCuit("30712223339")).to.equal(null);
    });
  });

  describe("normalizarNombre", () => {
    it("ignora mayúsculas, tildes, puntos y espacios de más", () => {
      expect(normalizarNombre("Construcciones  del Sur S.A.")).to.equal(normalizarNombre("CONSTRUCCIONES DEL SUR SA"));
      expect(normalizarNombre("Fernández Laura")).to.equal("FERNANDEZ LAURA");
    });
  });

  describe("verificarSolicitud", () => {
    it("OK cuando el CUIT está activo y la razón social coincide", async () => {
      const r = await afip.verificarSolicitud({ cuit: "30712345671", razonSocial: "Construcciones del Sur S.A." });
      expect(r.resultado).to.equal(RESULTADOS.OK);
      expect(r.ok).to.equal(true);
      expect(r.persona?.idPersona).to.equal(30712345671);
    });

    it("OK para personas físicas con apellido y nombre", async () => {
      const r = await afip.verificarSolicitud({ cuit: "27-25666777-6", razonSocial: "Fernández Laura" });
      expect(r.resultado).to.equal(RESULTADOS.OK);
    });

    it("CUIT_INVALIDO si el dígito verificador está mal", async () => {
      const r = await afip.verificarSolicitud({ cuit: "30712345678", razonSocial: "X" });
      expect(r.resultado).to.equal(RESULTADOS.CUIT_INVALIDO);
      expect(r.ok).to.equal(false);
    });

    it("CUIT_INEXISTENTE si no figura en el padrón", async () => {
      const r = await afip.verificarSolicitud({ cuit: "30712223339", razonSocial: "Empresa Fantasma S.A." });
      expect(r.resultado).to.equal(RESULTADOS.CUIT_INEXISTENTE);
    });

    it("CUIT_INACTIVO si la empresa está dada de baja", async () => {
      const r = await afip.verificarSolicitud({ cuit: "30705554443", razonSocial: "Viales Bonaerenses S.A." });
      expect(r.resultado).to.equal(RESULTADOS.CUIT_INACTIVO);
    });

    it("RAZON_SOCIAL_NO_COINCIDE e informa el nombre registrado", async () => {
      const r = await afip.verificarSolicitud({ cuit: "30719998883", razonSocial: "Electro Sur S.R.L." });
      expect(r.resultado).to.equal(RESULTADOS.RAZON_SOCIAL_NO_COINCIDE);
      expect(r.mensaje).to.contain("ELECTRO CONURBANO S.R.L.");
    });
  });
});
