/**
 * Decoratori dei DTO dei legami (4.3b, Task 22). I numeri dell'API sono stringhe col punto, mai
 * numeri JSON: le regole (decimali, segno, zero, formula dello sconto) sono quelle del dominio
 * `valori-legame`, qui solo agganciate a class-validator con il messaggio del dominio, che
 * porta gia' il nome del campo. Il DTO controlla forma e valori; le regole di stato sono del servizio.
 */
import { registerDecorator, type ValidationOptions } from 'class-validator'
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
