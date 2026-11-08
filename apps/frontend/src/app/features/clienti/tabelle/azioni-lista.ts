import { AzioneRiga } from '../../../shared/components/azioni-riga.component'

/** Le azioni di una riga: la principale come bottone, le altre nel menu ⋯. */
export interface AzioniDiRiga {
  principale: AzioneRiga | null
  altre: AzioneRiga[]
}

/** Come costruire le azioni di una riga di anagrafica o di tabella (Modifica, Disattiva, Elimina). */
export interface OpzioniAzioni {
  /** Assente = utente senza permesso di scrittura sulla riga: nessuna azione principale. */
  modifica?: () => void
  /** Testo accessibile del bottone principale (default «Modifica»). */
  etichettaModifica?: string
  /** Voci in testa al menu, prima di Disattiva (es. «Varia i prezzi…»). */
  extra?: AzioneRiga[]
  /** Stato attuale della riga e azione per cambiarlo: assente = nessuna voce Disattiva/Riattiva. */
  attivo?: boolean
  cambiaStato?: () => void
  /** Assente quando la riga non e' eliminabile: la voce non compare. */
  elimina?: () => void
}

/**
 * Azioni standard di una riga: «Modifica» come azione principale (icona matita, nome accessibile
 * dato da `etichettaModifica`), nel menu ⋯ le voci extra, «Disattiva»/«Riattiva» ed «Elimina»
 * (pericolosa, in fondo).
 */
export function azioniDiRiga(o: OpzioniAzioni): AzioniDiRiga {
  const altre: AzioneRiga[] = [...(o.extra ?? [])]
  if (o.cambiaStato) {
    altre.push({
      etichetta: o.attivo ? 'Disattiva' : 'Riattiva',
      icona: o.attivo ? 'pi pi-ban' : 'pi pi-replay',
      esegui: o.cambiaStato,
    })
  }
  if (o.elimina) {
    altre.push({ etichetta: 'Elimina', icona: 'pi pi-trash', pericolosa: true, esegui: o.elimina })
  }
  const modifica = o.modifica
  return {
    principale: modifica
      ? {
          etichetta: o.etichettaModifica ?? 'Modifica',
          icona: 'pi pi-pencil',
          esegui: modifica,
        }
      : null,
    altre,
  }
}

/**
 * Le azioni di una riga si costruiscono una volta sola per riga: il template le chiede a ogni ciclo
 * di rilevamento e `app-azioni-riga` ricostruirebbe il menu a ogni nuovo array. Le righe si
 * sostituiscono a ogni ricarica, quindi la memoria per oggetto non resta mai vecchia.
 */
export class MemoriaAzioni<T extends object> {
  private readonly memoria = new WeakMap<T, AzioniDiRiga>()

  constructor(private readonly crea: (riga: T) => AzioniDiRiga) {}

  di(riga: T): AzioniDiRiga {
    let azioni = this.memoria.get(riga)
    if (!azioni) {
      azioni = this.crea(riga)
      this.memoria.set(riga, azioni)
    }
    return azioni
  }
}
