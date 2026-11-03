import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator'

const PAROLE: Record<number, string> = { 1: 'un decimale', 2: '2 decimali', 3: '3 decimali' }

/**
 * Conta i decimali significativi di un numero finito, anche quando `toString()` lo scrive in
 * notazione esponenziale (`1e-7` ha 7 decimali, `1.5e-7` ne ha 8, `1e21` zero).
 */
export function contaDecimali(valore: number): number {
  const testo = String(valore)
  const [mantissa, esponente] = testo.split('e')
  const decimaliMantissa = (mantissa.split('.')[1] ?? '').length
  return Math.max(0, decimaliMantissa - (esponente === undefined ? 0 : Number(esponente)))
}

/**
 * Numero finito con al massimo `massimo` decimali (colonna `Decimal` o tracciato). Sostituisce
 * `@IsNumber({ maxDecimalPlaces })`: quello di class-validator lancia un `TypeError` (500) sui
 * valori in notazione esponenziale; qui NaN, Infinity, stringhe ed esponenziali danno 400.
 * Il messaggio predefinito è "<etichetta> deve essere un numero con al massimo N decimali."
 */
export function MaxDecimali(massimo: number, etichetta: string, opzioni?: ValidationOptions) {
  return (oggetto: object, proprieta: string) =>
    registerDecorator({
      name: 'maxDecimali',
      target: oggetto.constructor,
      propertyName: proprieta,
      constraints: [massimo],
      options: {
        message: (_a: ValidationArguments) =>
          `${etichetta} deve essere un numero con al massimo ${PAROLE[massimo] ?? `${massimo} decimali`}.`,
        ...opzioni,
      },
      validator: {
        validate: (v: unknown) =>
          typeof v === 'number' && Number.isFinite(v) && contaDecimali(v) <= massimo,
      },
    })
}
