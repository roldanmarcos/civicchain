import {
  ESTADOS_SOLICITUD,
  clienteAfip,
  comoTask,
  conectarCredenciales,
  formatearCuit,
  formatearFecha,
} from "../scripts/lib/credenciales.js";

interface Args {
  todas: boolean;
}

/** Lista las solicitudes de inscripción de proveedores (por defecto, solo las pendientes). */
export default comoTask<Args>(async (args, hre) => {
  const { credenciales } = await conectarCredenciales(hre);
  const afip = await clienteAfip();

  const total = Number(await credenciales.totalSolicitudes());
  // Domicilio y rubros solo están en los eventos
  const eventos = await credenciales.queryFilter(credenciales.filters.SolicitudCreada());
  const detalle = new Map(eventos.map((e) => [e.args.solicitudId, e.args]));

  let mostradas = 0;
  for (let id = 1n; id <= BigInt(total); id++) {
    const s = await credenciales.solicitud(id);
    const estado = ESTADOS_SOLICITUD[Number(s.estado)];
    if (!args.todas && estado !== "PENDIENTE") continue;
    mostradas++;

    const extra = detalle.get(id);
    console.log(`Solicitud #${id} — ${estado}`);
    console.log(`  Razón social: ${s.razonSocial}`);
    console.log(`  CUIT:         ${formatearCuit(s.cuit)}`);
    if (extra) {
      console.log(`  Domicilio:    ${extra.domicilioLegal}`);
      console.log(`  Rubros:       ${extra.rubros}`);
    }
    console.log(`  Wallet:       ${s.wallet}`);
    console.log(`  Fecha:        ${formatearFecha(s.creadaEn)}`);
    if (estado === "PENDIENTE") {
      const v = await afip.verificarSolicitud({ cuit: s.cuit.toString(), razonSocial: s.razonSocial });
      console.log(`  AFIP:         ${v.ok ? "✓" : "✗"} ${v.mensaje}`);
    }
  }

  if (mostradas === 0) console.log(args.todas ? "No hay solicitudes." : "No hay solicitudes pendientes.");
});
