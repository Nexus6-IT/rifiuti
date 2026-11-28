import { RentriEmissionePossibile } from '../rentri/rentri-blocchi.service'

/** Avviso da mostrare all'apertura del form "Nuovo FIR" sulla scorta di numeri vidimati. */
export interface AvvisoScorta {
  /** `error`: l'emissione sarebbe rifiutata (scorta vuota). `warn`: sta per finire, si emette ancora. */
  gravita: 'error' | 'warn'
  testo: string
}

/**
 * Trasforma l'esito di `GET /rentri/emissione-possibile` in un avviso, o in nessun avviso.
 *
 * Il banner promette un blocco solo quando l'emissione lo applica davvero: se il backend dice che
 * l'emissione non consuma scorta (`scortaRichiesta` false: MANUALE, senza certificato, modulo
 * spento) non si avvisa, come non si avvisa per una scorta abbondante. «In esaurimento» esiste solo
 * con una soglia configurata dall'utente (nessuna soglia inventata, come nel job di rifornimento).
 */
export function avvisoScortaDa(esito: RentriEmissionePossibile | null): AvvisoScorta | null {
  if (!esito || !esito.scortaRichiesta) return null

  if (!esito.possibile) {
    return {
      gravita: 'error',
      testo:
        esito.motivo ??
        'Nessun numero FIR vidimato disponibile: vidima un lotto dalla sezione Blocchi RENTRI prima di emettere.',
    }
  }

  if (esito.inEsaurimento) {
    const rimasti =
      esito.numeriDisponibili === 1
        ? 'Resta 1 numero vidimato'
        : `Restano ${esito.numeriDisponibili} numeri vidimati`
    return {
      gravita: 'warn',
      testo: `${rimasti} su una soglia di ${esito.soglia}: la scorta sta per finire. Vidima un nuovo lotto dalla sezione Blocchi RENTRI, o attendi il rifornimento automatico.`,
    }
  }

  return null
}
