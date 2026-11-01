// Funzioni condivise dalle schede delle tabelle di fatturazione: messaggi di
// errore del backend, permessi di scrittura, conferma di eliminazione.
import { Signal, computed, inject } from '@angular/core'
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

export function chiediConferma(
  conferma: ConfirmationService,
  messaggio: string,
  accetta: () => void
): void {
  conferma.confirm({
    header: 'Conferma eliminazione',
    message: messaggio,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Elimina',
    rejectLabel: 'Annulla',
    accept: accetta,
  })
}
