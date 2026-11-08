import { AzioniDiRiga, azioniDiRiga } from '../clienti/tabelle/azioni-lista'

/** Come costruire le azioni di una riga di Produttori, Trasportatori o Destinatari. */
export interface OpzioniAzioniAnagrafica {
  /** Ragione sociale: entra nei nomi accessibili («Modifica ACME S.r.l.»). */
  nome: string
  /** Ruolo che puo' modificare ed eliminare (vedi `puoGestireAnagrafiche`). */
  puoGestire: boolean
  /** Senza ditta non ci sono sedi da mostrare. */
  dittaId?: string | null
  /** Sedi attive della ditta; se manca vale 1 (la sede mostrata in lista). */
  numeroSedi?: number
  modifica: () => void
  sedi: () => void
  elimina: () => void
}

/**
 * Azioni di una riga di anagrafica: «Modifica <nome>» sulla riga, nel menu ⋯ «Sedi (n)» ed «Elimina»
 * (in fondo, rossa). Chi non puo' gestire le anagrafiche ma vede le sedi le ha come azione
 * principale, senza menu; senza ditta non ha nessuna azione.
 */
export function azioniAnagrafica(o: OpzioniAzioniAnagrafica): AzioniDiRiga {
  const sedi = o.dittaId
    ? { etichetta: `Sedi (${o.numeroSedi ?? 1})`, icona: 'pi pi-map-marker', esegui: o.sedi }
    : null
  if (!o.puoGestire) {
    return {
      principale: sedi ? { ...sedi, etichetta: `Sedi di ${o.nome}` } : null,
      altre: [],
    }
  }
  return azioniDiRiga({
    modifica: o.modifica,
    etichettaModifica: `Modifica ${o.nome}`,
    extra: sedi ? [sedi] : [],
    elimina: o.elimina,
  })
}
