import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator'

/** Nome del campo come lo legge l'utente (con l'articolo), per il messaggio di errore. */
const ETICHETTE: Record<string, string> = {
  finoA: 'Il limite della fascia',
  prezzo: 'Il prezzo',
  sconto: 'Lo sconto',
  scontoAttuale: 'Lo sconto attuale',
  scontoNuovo: 'Lo sconto nuovo',
  provvigione: 'La provvigione',
  riferimento: 'Il riferimento',
  quantitaFissa: 'La quantità fissa',
  minimoFatturabile: 'Il minimo fatturabile',
  stimaAnnuaKg: 'La stima annua in kg',
}

/** Stringa oppure numero finito: il servizio o il dominio ne controllano il formato. */
export function IsTestoONumero(opzioni?: ValidationOptions) {
  return (oggetto: object, proprieta: string) =>
    registerDecorator({
      name: 'isTestoONumero',
      target: oggetto.constructor,
      propertyName: proprieta,
      options: {
        message: (a: ValidationArguments) =>
          `${ETICHETTE[a.property] ?? 'Il valore'} deve essere un testo o un numero.`,
        ...opzioni,
      },
      validator: {
        validate: (v: unknown) =>
          typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
      },
    })
}
