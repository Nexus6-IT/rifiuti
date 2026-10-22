import { chiaveConfrontoCer } from '../../../domain/waste-movement/cer-registro'
import { normalizzaUnitaRegistro } from '../../../domain/waste-movement/unita-misura-registro'

// Integrazioni annuali del MUD (dati che il registro non ha): chiavi e lettura difensiva
// di `MUDReport.reportData.integrazioni`. Funzioni pure.

export interface SoggettoIntegrato {
  ragioneSociale: string
  codiceFiscale: string
}

export interface IntegrazioniMud {
  /** chiave = chiaveDestinatario */
  destinatari: Record<string, SoggettoIntegrato>
  /** destinatario di uno scarico senza FIR né destinatario nel registro; chiave = chiaveMovimento */
  destinatariMovimento: Record<string, SoggettoIntegrato>
  /** CF del trasportatore (modulo TE); chiave = chiaveDestinatario della ragione sociale */
  trasportatori: Record<string, SoggettoIntegrato>
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
  destinatariMovimento: {},
  trasportatori: {},
  pesiSpecifici: {},
  aggiornateIl: null,
  aggiornateDa: null,
}

/** Ragione sociale senza spazi doppi o esterni, maiuscola. */
export function chiaveDestinatario(ragioneSociale: string): string {
  return (ragioneSociale ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Movimento del registro: anno e numero progressivo (`2025/5`). */
export function chiaveMovimento(anno: number, numero: number): string {
  return `${anno}/${numero}`
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

/** Voci con un CF non vuoto; il nome lo decide il chiamante (null = voce scartata). */
function leggiSoggetti(
  grezze: unknown,
  nome: (voce: Record<string, unknown>, chiave: string) => string | null
): Record<string, SoggettoIntegrato> {
  const soggetti: Record<string, SoggettoIntegrato> = {}
  if (!isRecord(grezze)) return soggetti
  for (const [chiave, voce] of Object.entries(grezze)) {
    if (!isRecord(voce)) continue
    const cf = voce.codiceFiscale
    if (typeof cf !== 'string' || cf.trim() === '') continue
    const ragioneSociale = nome(voce, chiave)
    if (ragioneSociale === null) continue
    soggetti[chiave] = { ragioneSociale, codiceFiscale: cf.trim() }
  }
  return soggetti
}

/** Lettura difensiva: un JSON di forma inattesa vale come assente. */
export function leggiIntegrazioni(reportData: unknown): IntegrazioniMud {
  if (!isRecord(reportData) || !isRecord(reportData.integrazioni)) return INTEGRAZIONI_VUOTE
  const grezze = reportData.integrazioni
  const destinatari = leggiSoggetti(grezze.destinatari, (voce, chiave) =>
    typeof voce.ragioneSociale === 'string' ? voce.ragioneSociale : chiave
  )
  const trasportatori = leggiSoggetti(grezze.trasportatori, (voce, chiave) =>
    typeof voce.ragioneSociale === 'string' ? voce.ragioneSociale : chiave
  )
  // La chiave di un movimento non è un nome: senza ragione sociale il DR non si compila.
  const destinatariMovimento = leggiSoggetti(grezze.destinatariMovimento, voce =>
    typeof voce.ragioneSociale === 'string' && voce.ragioneSociale.trim()
      ? voce.ragioneSociale.trim()
      : null
  )
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
    destinatariMovimento,
    trasportatori,
    pesiSpecifici,
    aggiornateIl: typeof grezze.aggiornateIl === 'string' ? grezze.aggiornateIl : null,
    aggiornateDa: typeof grezze.aggiornateDa === 'string' ? grezze.aggiornateDa : null,
  }
}
