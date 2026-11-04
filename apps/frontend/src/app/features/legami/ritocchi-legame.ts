import { leggiErroriAzione } from '../listino/errori-azione'
import { MotivoLegame, ModificaRigaLegame, RigaLegame } from './legami.model'
import { CampoRiga, ModificaCampoRiga } from './righe-legame-tabella.component'
import { etichettaMotivo } from './vocabolario-legami'

/** Ritocchi non ancora salvati, per riga (`rigaAddebitoId`) e per campo. */
export type Ritocchi = Readonly<Record<string, Partial<Record<CampoRiga, string | null>>>>

/** Un valore scritto coincide con quello già nel legame (numeri a confronto numerico, sconti per testo). */
function uguale(campo: CampoRiga, nuovo: string | null, originale: string | null): boolean {
  if (nuovo === null || originale === null) return nuovo === originale
  return campo === 'sconto' ? nuovo === originale : Number(nuovo) === Number(originale)
}

/** Registra un valore valido emesso dalla tabella; se torna a quello del legame non è più un ritocco. */
export function aggiornaRitocchi(
  attuali: Ritocchi,
  originale: RigaLegame | undefined,
  m: ModificaCampoRiga
): Ritocchi {
  const riga = { ...(attuali[m.rigaAddebitoId] ?? {}) }
  if (originale && uguale(m.campo, m.valore, originale[m.campo])) delete riga[m.campo]
  else riga[m.campo] = m.valore
  const nuovi = { ...attuali }
  if (Object.keys(riga).length > 0) nuovi[m.rigaAddebitoId] = riga
  else delete nuovi[m.rigaAddebitoId]
  return nuovi
}

/** Righe con i ritocchi non ancora salvati: l'importo di una riga ritoccata lo calcola il server. */
export function righeConRitocchi(righe: readonly RigaLegame[], r: Ritocchi): RigaLegame[] {
  return righe.map(riga => {
    const x = r[riga.rigaAddebitoId]
    if (!x) return riga
    return {
      ...riga,
      quantita: 'quantita' in x ? (x.quantita ?? riga.quantita) : riga.quantita,
      quantitaOrigine: 'quantita' in x ? 'MANUALE' : riga.quantitaOrigine,
      prezzo: 'prezzo' in x ? (x.prezzo ?? null) : riga.prezzo,
      sconto: 'sconto' in x ? (x.sconto ?? null) : riga.sconto,
      prezzoManuale: riga.prezzoManuale || 'prezzo' in x || 'sconto' in x,
      importo: null,
    }
  })
}

/** Solo le righe toccate: per un legame esistente `righe` è un ritocco, non la selezione intera. */
export function righeDaRitocchi(ritocchi: Ritocchi): ModificaRigaLegame[] {
  return Object.entries(ritocchi).map(([rigaAddebitoId, x]) => ({
    rigaAddebitoId,
    ...('quantita' in x && x.quantita ? { quantita: x.quantita } : {}),
    ...('prezzo' in x && x.prezzo ? { prezzo: x.prezzo } : {}),
    ...('sconto' in x ? { sconto: x.sconto ?? null } : {}),
  }))
}

/** Il backend rifiuta salvataggio e conferma di un legame rimasto indietro rispetto al movimento. */
export const LEGAME_DA_RIALLINEARE = 'LEGAME_DA_RIALLINEARE'

/**
 * Messaggi di un errore delle rotte del legame. Il 409 `LEGAME_INCOMPLETO` della conferma porta in
 * `details.motivi` i codici di ciò che manca: si traducono con `etichettaMotivo`, mai mostrati grezzi.
 */
export function messaggiErroreLegame(err: unknown): {
  messaggi: string[]
  rilettura: boolean
  codice: string | null
} {
  const e = leggiErroriAzione(err, 'Operazione non riuscita. Riprova.')
  const dettagli = (
    err as { error?: { details?: { motivi?: unknown; dettaglioCliente?: unknown } } } | null
  )?.error?.details
  if (e.codice === 'LEGAME_INCOMPLETO' && dettagli && Array.isArray(dettagli.motivi)) {
    const testi = (dettagli.motivi as MotivoLegame[]).map(etichettaMotivo)
    if (typeof dettagli.dettaglioCliente === 'string') testi.push(dettagli.dettaglioCliente)
    return {
      messaggi: ['Il legame è incompleto:', ...testi.map(t => `${t}.`)],
      rilettura: false,
      codice: e.codice,
    }
  }
  return { messaggi: e.messaggi, rilettura: e.rilettura, codice: e.codice }
}
