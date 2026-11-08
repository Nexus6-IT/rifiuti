// Funzioni condivise dalle schede delle tabelle di fatturazione: messaggi di
// errore del backend, permessi di scrittura, conferma di eliminazione.
import { Signal, WritableSignal, computed, inject } from '@angular/core'
import { Observable } from 'rxjs'
import { ConfirmationService } from 'primeng/api'
import { AuthService } from '../../../core/services/auth.service'
import { puoGestireAnagrafiche } from '../../registry/registry-permissions'

/** Messaggio da `error.error.message` (stringa o array), altrimenti il ripiego. Mai id. */
export function messaggioErrore(err: unknown, ripiego: string): string {
  const m = (err as { error?: { message?: string | string[] } } | null)?.error?.message
  if (Array.isArray(m)) {
    const testo = m.filter(x => typeof x === 'string' && x.trim()).join(' ')
    return testo || ripiego
  }
  return typeof m === 'string' && m.trim() ? m : ripiego
}

/** Chi può scrivere: stessi ruoli delle anagrafiche; il VIEWER non vede i pulsanti. */
export function permessoScrittura(): Signal<boolean> {
  const auth = inject(AuthService)
  return computed(() => puoGestireAnagrafiche(auth.currentUser()?.role))
}

/**
 * Conferma condivisa. L'azione e' distruttiva di default (Elimina, Disattiva, Rimuovi): bottone
 * rosso per accettare, «Annulla» in testo e focus iniziale su «Annulla», cosi' Invio non cancella.
 * `pericolosa: false` per le conferme che non distruggono niente (rinnovo, cambio pagina).
 */
export function chiediConferma(
  conferma: ConfirmationService,
  messaggio: string,
  accetta: () => void,
  testi: { header?: string; acceptLabel?: string; pericolosa?: boolean } = {}
): void {
  conferma.confirm({
    header: testi.header ?? 'Conferma eliminazione',
    message: messaggio,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: testi.acceptLabel ?? 'Elimina',
    rejectLabel: 'Annulla',
    acceptButtonStyleClass: testi.pericolosa === false ? undefined : 'p-button-danger',
    rejectButtonStyleClass: 'p-button-text',
    defaultFocus: 'reject',
    accept: accetta,
  })
}

/**
 * «Disattiva» chiede conferma (la riga resta sui documenti che la citano, ma non si sceglie piu'
 * per quelli nuovi); «Riattiva» no. Una regola sola per tutte le liste.
 */
export function cambiaStatoConConferma(
  conferma: ConfirmationService,
  attivo: boolean,
  descrizione: string,
  esegui: () => void
): void {
  if (!attivo) {
    esegui()
    return
  }
  chiediConferma(
    conferma,
    `Disattivare ${descrizione}? Resta dove e' gia' usata, ma non si sceglie per i nuovi inserimenti.`,
    esegui,
    { header: 'Conferma disattivazione', acceptLabel: 'Disattiva' }
  )
}

/**
 * Elenco di una scheda: `righe` con la risposta, `errore` col messaggio del backend (o il
 * ripiego) e vuoto a caricamento riuscito. Le liste paginate (agenti, clienti, contratti) non la
 * usano: hanno `ElencoPaginato`, che tiene anche `totale` e annulla le risposte vecchie.
 */
export function caricaElenco<T>(
  fonte: Observable<T[]>,
  righe: WritableSignal<T[]>,
  errore: WritableSignal<string | null>,
  ripiego: string
): void {
  fonte.subscribe({
    next: r => {
      righe.set(r)
      errore.set(null)
    },
    error: err => errore.set(messaggioErrore(err, ripiego)),
  })
}

/**
 * Modifica di stato o eliminazione: a riuscita si ricarica; a errore (409 compreso) si mostra il
 * messaggio del backend e si ricarica comunque, perché dopo un conflitto di versione la riga è
 * vecchia.
 */
export function eseguiERicarica(
  operazione: Observable<unknown>,
  toast: { error(messaggio: string): void },
  ripiego: string,
  ricarica: () => void
): void {
  operazione.subscribe({
    next: () => ricarica(),
    error: err => {
      toast.error(messaggioErrore(err, ripiego))
      ricarica()
    },
  })
}
