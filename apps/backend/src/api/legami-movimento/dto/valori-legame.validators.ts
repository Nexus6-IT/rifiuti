/**
 * Decoratori dei DTO dei legami (4.3b, Task 22). I numeri dell'API sono stringhe col punto, mai
 * numeri JSON: le regole (decimali, segno, zero, formula dello sconto) sono quelle del dominio
 * `valori-legame`, qui solo agganciate a class-validator con il messaggio del dominio, che
 * porta gia' il nome del campo. Il DTO controlla forma e valori; le regole di stato sono del servizio.
 */
import { plainToInstance } from 'class-transformer'
import {
  registerDecorator,
  validateSync,
  type ValidationError,
  type ValidationOptions,
} from 'class-validator'
import { MESSAGGIO_CASCATA } from '../../../domain/listino/importi-riga'
import {
  validaPrezzoManuale,
  validaQuantitaManuale,
  validaScontoManuale,
} from '../../../domain/legami-movimento/valori-legame'

type Esito = { ok: true } | { ok: false; errore: string }

function daDominio(
  nome: string,
  valida: (v: unknown) => Esito,
  opzioni?: ValidationOptions
): PropertyDecorator {
  return (oggetto: object, proprieta: string | symbol) =>
    registerDecorator({
      name: nome,
      target: oggetto.constructor,
      propertyName: proprieta as string,
      options: opzioni,
      validator: {
        validate: (v: unknown) => valida(v).ok,
        defaultMessage: args => {
          const e = valida(args?.value)
          return e.ok ? '' : e.errore
        },
      },
    })
}

/** Quantita' scritta a mano: stringa > 0 col punto, al massimo 3 decimali. */
export const QuantitaLegame = (o?: ValidationOptions) =>
  daDominio('quantitaLegame', validaQuantitaManuale, o)

/** Prezzo scritto a mano: stringa >= 0 col punto, al massimo 6 decimali. */
export const PrezzoLegame = (o?: ValidationOptions) =>
  daDominio('prezzoLegame', validaPrezzoManuale, o)

/** Sconto: stringa con una formula a cascata valida (la virgola e' ammessa, come nel listino). */
export const ScontoLegame = (o?: ValidationOptions) =>
  daDominio(
    'scontoLegame',
    v => {
      // `validaScontoManuale` accetta anche undefined/null (= nessuno sconto): qui solo testo.
      if (typeof v !== 'string') return { ok: false, errore: MESSAGGIO_CASCATA }
      return validaScontoManuale(v)
    },
    o
  )

function messaggiDi(errori: ValidationError[]): string[] {
  return errori.flatMap(e => [
    ...Object.values(e.constraints ?? {}),
    ...messaggiDi(e.children ?? []),
  ])
}

/** Primo messaggio di validazione di `valore` come istanza di `classe` (null se valido). */
function primoErrore(classe: new () => object, valore: unknown): string | null {
  if (typeof valore !== 'object' || valore === null || Array.isArray(valore)) return 'non valido.'
  const errori = validateSync(plainToInstance(classe, valore) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  return messaggiDi(errori)[0] ?? null
}

/**
 * Valida un oggetto (o ogni elemento di una lista con `each`) con le regole di `classe` SENZA
 * `@ValidateNested`: la pipe di Nest metterebbe davanti ai messaggi dei figli il percorso tecnico
 * (`righe.0.Prezzo: ...`), che all'utente non dice nulla. Qui il messaggio e` quello del campo,
 * preceduto da «Riga N: » per le liste. Va con `@Type(() => classe)` per la trasformazione.
 */
export function Nidificato(
  classe: new () => object,
  opzioni: { each?: boolean; elemento?: string } = {}
): PropertyDecorator {
  const nome = opzioni.elemento ?? 'Riga'
  const trova = (v: unknown): string | null => {
    if (!opzioni.each) return primoErrore(classe, v)
    if (!Array.isArray(v)) return 'deve essere una lista.'
    for (let i = 0; i < v.length; i++) {
      const e = primoErrore(classe, v[i])
      if (e) return `${nome} ${i + 1}: ${e}`
    }
    return null
  }
  return (oggetto: object, proprieta: string | symbol) =>
    registerDecorator({
      name: 'nidificato',
      target: oggetto.constructor,
      propertyName: proprieta as string,
      validator: {
        validate: (v: unknown) => trova(v) === null,
        defaultMessage: args => trova(args?.value) ?? '',
      },
    })
}
