// Validación de CUIT: mismo algoritmo que `cuitValido` del contrato y que la AFIP simulada del backend.

/** 11 dígitos y dígito verificador correcto. */
export function cuitValido(cuit) {
  const digitos = String(cuit).replace(/\D/g, "");
  if (!/^\d{11}$/.test(digitos)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((total, peso, i) => total + peso * Number(digitos[i]), 0);
  let esperado = 11 - (suma % 11);
  if (esperado === 11) esperado = 0;
  return esperado !== 10 && esperado === Number(digitos[10]);
}
