/**
 * Validatore di classe per la creazione di una controparte (F2-10, D2): serve almeno uno fra
 * `partitaIVA` e `codiceFiscale`. Un privato ha il solo codice fiscale.
 * Il messaggio non riporta mai il valore (dato personale).
 */
import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator'

export const MESSAGGIO_ALMENO_UN_IDENTIFICATIVO =
  'Indica la partita IVA oppure il codice fiscale della ditta'

function presente(valore: unknown): boolean {
  return typeof valore === 'string' && valore.trim() !== ''
}

/**
 * Da mettere su `partitaIVA`: controlla anche `codiceFiscale` dello stesso oggetto. Niente
 * `@IsOptional` sulla proprieta' (spegnerebbe questo controllo quando manca), quindi il tipo
 * stringa lo verifica il validatore stesso.
 */
export function AlmenoUnIdentificativoFiscale(opzioni?: ValidationOptions) {
  return function (oggetto: object, nomeProprieta: string) {
    registerDecorator({
      name: 'almenoUnIdentificativoFiscale',
      target: oggetto.constructor,
      propertyName: nomeProprieta,
      options: { message: MESSAGGIO_ALMENO_UN_IDENTIFICATIVO, ...opzioni },
      validator: {
        validate(_valore: unknown, args: ValidationArguments) {
          const dto = args.object as { partitaIVA?: unknown; codiceFiscale?: unknown }
          const piva = dto.partitaIVA
          if (piva !== undefined && piva !== null && typeof piva !== 'string') return false
          return presente(piva) || presente(dto.codiceFiscale)
        },
      },
    })
  }
}
