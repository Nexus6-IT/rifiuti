import { InjectionToken } from '@angular/core'

/**
 * Una sezione del dialog del contratto che può aprire sub-dialog "Nuovo …". Ogni sezione si
 * registra con `providers: [{ provide: SEZIONE_CONTRATTO, useExisting: forwardRef(() => X) }]`:
 * il dialog le trova da solo e ignora Esc finché una ne ha uno aperto (Task 26 non deve
 * ricordarsene).
 */
export interface SezioneContratto {
  /** Esc nel sub-dialog fa chiudere anche il contratto: true = si ignora la chiusura. */
  bloccaChiusuraEsterna(visibile: boolean): boolean
}

export const SEZIONE_CONTRATTO = new InjectionToken<SezioneContratto>('SEZIONE_CONTRATTO')
