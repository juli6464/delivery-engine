// Dinero en pesos colombianos (COP) enteros: el COP no usa centavos en la práctica. Ningún monto es float.

/** Porcentaje de un monto en pesos, redondeo half-up con aritmética entera (sin errores de float). */
export function percentOf(pesos: number, percent: number): number {
  assertPesos(pesos);
  if (!Number.isInteger(percent) || percent < 0) throw new RangeError(`porcentaje inválido: ${percent}`);
  return Math.floor((pesos * percent + 50) / 100);
}

/** Convierte un valor fraccionario (p. ej. km × valor por km) a pesos, half-up. */
export function roundPesos(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`monto inválido: ${value}`);
  return Math.round(value);
}

export function assertPesos(pesos: number): void {
  if (!Number.isSafeInteger(pesos) || pesos < 0) throw new RangeError(`pesos inválidos: ${pesos}`);
}
