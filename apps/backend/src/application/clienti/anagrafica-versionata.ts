/**
 * Lock ottimistico e traduzione degli errori Prisma per le anagrafiche versionate del pezzo 4.1
 * (D13, D14): un solo helper usato da tutti i servizi, cosi' codici e messaggi 409 sono identici.
 *
 * - `scriviCondizionato`: la scrittura e' un `updateMany`/`deleteMany` con `versione` nel `where`;
 *   `count === 0` vuol dire che un'altra operazione ha cambiato (o cancellato) la riga.
 * - `confrontaVersione`: controllo anticipato, prima di validare e scrivere.
 * - `traduciErrorePrisma`: P2002 su un vincolo noto -> 409 col codice del vincolo (con la RLS
 *   Postgres non da' il nome del vincolo: vedi il commento nel corpo); P2003 -> 409
 *   `<PREFISSO>_IN_USO`; tutto il resto viene rilanciato.
 *
 * Gli errori sono `ConflictException` con `error` = codice: il filtro globale lo riporta nel body.
 */
import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

export interface DescrizioneEntita {
  /** Prefisso dei codici di errore, es. `CONTO_CORRENTE`. */
  prefisso: string
  /** Soggetto con l'articolo, es. `Il conto corrente`. */
  soggetto: string
  /** Per l'accordo del participio ("modificata", "usata") e del suffisso del codice. */
  femminile: boolean
}

export type VincoliNoti = Readonly<Record<string, { codice: string; messaggio: string }>>

function modificatoNelFrattempo(e: DescrizioneEntita): ConflictException {
  const [suffisso, participio] = e.femminile
    ? ['MODIFICATA', 'stata modificata']
    : ['MODIFICATO', 'stato modificato']
  return new ConflictException({
    error: `${e.prefisso}_${suffisso}_NEL_FRATTEMPO`,
    message: `${e.soggetto} è ${participio} nel frattempo da un'altra operazione: ricarica per vedere i dati aggiornati e ripeti l'operazione.`,
  })
}

/** Esegue una scrittura condizionata alla versione: nessuna riga toccata = 409. */
export async function scriviCondizionato(
  op: () => Promise<{ count: number }>,
  e: DescrizioneEntita
): Promise<void> {
  const { count } = await op()
  if (count === 0) throw modificatoNelFrattempo(e)
}

/** Versione ricevuta diversa da quella attuale = 409 (prima di validare e scrivere). */
export function confrontaVersione(attuale: number, ricevuta: number, e: DescrizioneEntita): void {
  if (attuale !== ricevuta) throw modificatoNelFrattempo(e)
}

/** Il `target` di un P2002 puo' essere il nome del vincolo o l'elenco delle colonne. */
function corrisponde(target: unknown, nomeVincolo: string): boolean {
  if (typeof target === 'string') return target === nomeVincolo
  if (Array.isArray(target) && target.length > 0) {
    return nomeVincolo.endsWith(`${target.join('_')}_key`)
  }
  return false
}

export function traduciErrorePrisma(
  err: unknown,
  e: DescrizioneEntita,
  vincoli: VincoliNoti
): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = err.meta?.target
      const nomi = Object.keys(vincoli)
      // Con la RLS attiva (ruolo applicativo) Postgres omette il dettaglio "Key (...)" e Prisma
      // riporta `target: null`: con un solo vincolo noto la risposta e' comunque univoca.
      const nome =
        target == null && nomi.length === 1 ? nomi[0] : nomi.find(v => corrisponde(target, v))
      if (nome) {
        throw new ConflictException({
          error: vincoli[nome].codice,
          message: vincoli[nome].messaggio,
        })
      }
    }
    if (err.code === 'P2003') {
      throw new ConflictException({
        error: `${e.prefisso}_IN_USO`,
        message: `${e.soggetto} è ${e.femminile ? 'usata' : 'usato'} da clienti o contratti: disattivalo invece di eliminarlo.`,
      })
    }
  }
  throw err
}
