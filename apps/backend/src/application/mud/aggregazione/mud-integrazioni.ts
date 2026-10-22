import { chiaveConfrontoCer } from '../../../domain/waste-movement/cer-registro'
import { normalizzaUnitaRegistro } from '../../../domain/waste-movement/unita-misura-registro'

// Integrazioni annuali del MUD (dati che il registro non ha): chiavi e lettura difensiva
// di `MUDReport.reportData.integrazioni`. Funzioni pure.

export interface IntegrazioniMud {
  /** chiave = chiaveDestinatario */
  destinatari: Record<string, { ragioneSociale: string; codiceFiscale: string }>
  /** chiave = chiavePesoSpecifico */
  pesiSpecifici: Record<
    string,
    { cerCode: string; unita: string; kgPerUnita: number; confermatoFuoriIntervallo?: boolean }
  >
  aggiornateIl: string | null
  aggiornateDa: string | null
}

export const INTEGRAZIONI_VUOTE: IntegrazioniMud = {
  destinatari: {},
  pesiSpecifici: {},
  aggiornateIl: null,
  aggiornateDa: null,
}

/** Ragione sociale senza spazi doppi o esterni, maiuscola. */
export function chiaveDestinatario(ragioneSociale: string): string {
  return (ragioneSociale ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

export function chiavePesoSpecifico(cerCode6: string, unit: string): string {
  return `${chiaveConfrontoCer(cerCode6)}|${normalizzaUnitaRegistro(unit).unita}`
}

/**
 * Plausibilità del peso specifico (Decisione 18, rilievo G3-D-05): unico punto in cui
 * stanno gli intervalli. Un valore fuori intervallo (per esempio t/m³ al posto di kg/m³)
 * richiede una conferma esplicita.
 */
export const INTERVALLI_PESO_SPECIFICO: ReadonlyArray<{
  alias: readonly string[]
  min: number
  max: number
  descrizione: string
}> = [
  { alias: ['L', 'LT', 'LITRO', 'LITRI'], min: 0.1, max: 3, descrizione: 'kg per litro' },
  { alias: ['M3', 'MC', 'METRI CUBI'], min: 10, max: 3000, descrizione: 'kg per m³' },
]

/** Intervallo consueto per l'unità (normalizzata); null se non è noto. */
export function intervalloPesoSpecifico(unit: string): { min: number; max: number } | null {
  const u = normalizzaUnitaRegistro(unit).unita
  const trovato = INTERVALLI_PESO_SPECIFICO.find(i => i.alias.includes(u))
  return trovato ? { min: trovato.min, max: trovato.max } : null
}

/** Dentro l'intervallo consueto; false se l'intervallo non è noto. */
export function pesoSpecificoPlausibile(unit: string, kgPerUnita: number): boolean {
  const i = intervalloPesoSpecifico(unit)
  return i !== null && kgPerUnita >= i.min && kgPerUnita <= i.max
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Lettura difensiva: un JSON di forma inattesa vale come assente. */
export function leggiIntegrazioni(reportData: unknown): IntegrazioniMud {
  if (!isRecord(reportData) || !isRecord(reportData.integrazioni)) return INTEGRAZIONI_VUOTE
  const grezze = reportData.integrazioni
  const destinatari: IntegrazioniMud['destinatari'] = {}
  if (isRecord(grezze.destinatari)) {
    for (const [chiave, voce] of Object.entries(grezze.destinatari)) {
      if (!isRecord(voce)) continue
      const cf = voce.codiceFiscale
      if (typeof cf !== 'string' || cf.trim() === '') continue
      destinatari[chiave] = {
        ragioneSociale: typeof voce.ragioneSociale === 'string' ? voce.ragioneSociale : chiave,
        codiceFiscale: cf.trim(),
      }
    }
  }
  const pesiSpecifici: IntegrazioniMud['pesiSpecifici'] = {}
  if (isRecord(grezze.pesiSpecifici)) {
    for (const [chiave, voce] of Object.entries(grezze.pesiSpecifici)) {
      if (!isRecord(voce)) continue
      const kg = voce.kgPerUnita
      if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) continue
      if (typeof voce.cerCode !== 'string' || typeof voce.unita !== 'string') continue
      pesiSpecifici[chiave] = {
        cerCode: voce.cerCode,
        unita: voce.unita,
        kgPerUnita: kg,
        ...(voce.confermatoFuoriIntervallo === true ? { confermatoFuoriIntervallo: true } : {}),
      }
    }
  }
  return {
    destinatari,
    pesiSpecifici,
    aggiornateIl: typeof grezze.aggiornateIl === 'string' ? grezze.aggiornateIl : null,
    aggiornateDa: typeof grezze.aggiornateDa === 'string' ? grezze.aggiornateDa : null,
  }
}
