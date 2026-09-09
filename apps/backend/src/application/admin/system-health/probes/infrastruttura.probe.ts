import { Injectable } from '@nestjs/common'

import { HealthItem } from '../health-item'

/**
 * Probe delle dipendenze infrastrutturali (Postgres, Redis, storage oggetti,
 * SMTP, Keycloak).
 *
 * VINCOLO CHE DECIDE QUESTA PROBE: la verifica deve essere un contatto REALE
 * con la dipendenza, non la lettura di una variabile d'ambiente. Sapere che
 * `AWS_S3_BUCKET` e' valorizzato non dice nulla su quel bucket; una
 * `HeadBucket` che risponde si'. La configurazione la guardiamo solo per
 * distinguere «spento di proposito» (`off`) da «rotto» (`error`): una
 * dipendenza non configurata in questo ambiente non e' un guasto.
 *
 * Ogni controllo ha un tetto di tempo proprio: la pagina di stato non deve
 * restare appesa perche' una dipendenza non risponde — un timeout E' la
 * risposta, e viene mostrato come tale.
 */

/** Tetto di attesa per singolo controllo. Oltre, il controllo e' fallito. */
export const TIMEOUT_CONTROLLO_MS = 5_000

export interface ControlloInfrastruttura {
  key: string
  label: string
  /**
   * `false` quando la dipendenza non e' configurata in questo ambiente: la
   * voce diventa `off` (scelta), non `error` (guasto).
   */
  configurato: boolean
  /** Motivo mostrato quando `configurato` e' falso. */
  motivoNonConfigurato?: string
  /**
   * Contatta la dipendenza e restituisce la prova testuale del contatto
   * (es. "bucket wasteflow-documents raggiungibile"). Solleva se fallisce.
   */
  verifica: () => Promise<string>
}

@Injectable()
export class InfrastrutturaProbe {
  async raccogli(controlli: ControlloInfrastruttura[]): Promise<HealthItem[]> {
    return Promise.all(controlli.map(controllo => this.esegui(controllo)))
  }

  private async esegui(controllo: ControlloInfrastruttura): Promise<HealthItem> {
    const base = { key: `infra.${controllo.key}`, label: controllo.label }

    if (!controllo.configurato) {
      return {
        ...base,
        state: 'off',
        since: null,
        detail:
          controllo.motivoNonConfigurato ??
          'Non configurata in questo ambiente: spenta di proposito, non guasta.',
      }
    }

    const inizio = Date.now()
    try {
      const prova = await this.conTimeout(controllo.verifica())
      return {
        ...base,
        state: 'ok',
        since: new Date().toISOString(),
        detail: `${prova} (${Date.now() - inizio} ms).`,
      }
    } catch (errore) {
      return {
        ...base,
        state: 'error',
        since: null,
        detail: `Contatto fallito dopo ${Date.now() - inizio} ms: ${(errore as Error).message}`,
      }
    }
  }

  private conTimeout<T>(promessa: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout
    const scadenza = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`nessuna risposta entro ${TIMEOUT_CONTROLLO_MS} ms`)),
        TIMEOUT_CONTROLLO_MS
      )
    })
    return Promise.race([promessa, scadenza]).finally(() => clearTimeout(timer)) as Promise<T>
  }
}
