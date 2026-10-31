/**
 * Traduzione PURA di un'annotazione del registro nel modello RENTRI (`MovimentoModel` o
 * `AnnullamentoMovimentoModel` di `dati-registri.yaml`). Nessun accesso a database o HTTP.
 *
 * FAIL-CLOSED: ogni dato mancante o non traducibile con certezza produce un motivo esplicito e
 * l'annotazione non si trasmette; mai un valore inventato o un default. Tutti i motivi si
 * raccolgono insieme. I motivi sono in italiano, senza id interni, codici fiscali o partite IVA.
 */
import {
  ValoreNonTraducibilePerRentriError,
  codiceEerRichiedeDescrizione,
  traduciStatoFisico,
} from '../mappatura/mappa-rifiuto'
import type { IndirizzoRentri } from '../mappatura/mappa-parti'
import { cerSoloCifre } from '../../../domain/waste-movement/cer-registro'

export interface ParteFirRentri {
  denominazione: string
  codiceFiscale: string | null
}

export interface DatiFirPerRegistro {
  numeroFir: string | null
  dataInizioTrasporto: string | null
  dataFineTrasporto: string | null
  pesoVerificatoDestinoKg: number | null
  provenienza: 'U' | 'S' | null
  produttore: (ParteFirRentri & { indirizzo: IndirizzoRentri | null }) | null
  trasportatore: (ParteFirRentri & { numeroIscrizioneAlbo: string | null }) | null
  destinatario: (ParteFirRentri & { numeroAutorizzazione: string | null }) | null
}

export interface NumeroRegistrazione {
  anno: number
  progressivo: number
}

export interface AnnotazionePerRentri {
  movimentoId: string
  tipoAnnotazione: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
  numero: NumeroRegistrazione
  dataRegistrazione: string
  verso: 'CARICO' | 'SCARICO'
  codiceRentri: string | null
  cerCode: string
  descrizione: string | null
  quantita: number
  unit: string
  statoFisico: string | null
  classiPericolo: string | null
  operazione: string | null
  predecessore: NumeroRegistrazione | null
  motivo: string | null
  fir: DatiFirPerRegistro | null
  riferimentiCarico: NumeroRegistrazione[]
}

export type EsitoTraduzione =
  | { ok: true; corpo: Record<string, unknown> }
  | { ok: false; motivi: string[] }

type ParteCompilata =
  | 'produttore'
  | 'trasportatore'
  | 'destinatario'
  | 'integrazioneFir'
  | 'esito'
  | 'destinatoAttivita'

interface RegolaCausale {
  supportata: boolean
  /** Verso fissato dal catalogo (CHECK `causali_registro_codice_rentri_verso`) e dal contratto. */
  verso?: 'CARICO' | 'SCARICO'
  /** Parti che richiedono un FIR e i loro dati (altrimenti motivo). */
  richiede: ReadonlyArray<'produttore' | 'destinatario' | 'trasportatore'>
  /** Parti compilate nel corpo (le altre proprietà si omettono: `additionalProperties: false`). */
  compila: readonly ParteCompilata[]
}

const MAX_QUANTITA = 9_999_999_999.9999
const arrotonda4 = (x: number) => Math.round(x * 1e4) / 1e4

const NESSUNA: RegolaCausale = { supportata: true, verso: 'CARICO', richiede: [], compila: [] }
const NON_SUPPORTATA: RegolaCausale = { supportata: false, richiede: [], compila: [] }

/** Parti per causale RENTRI (D4): una tabella, non `switch` sparsi. */
const REGOLE_CAUSALE: Readonly<Record<string, RegolaCausale>> = {
  DT: NESSUNA,
  NP: NESSUNA,
  RE: NESSUNA,
  I: { supportata: true, verso: 'SCARICO', richiede: [], compila: ['destinatoAttivita'] },
  'T*': {
    supportata: true,
    verso: 'CARICO',
    richiede: ['produttore'],
    compila: ['produttore', 'trasportatore', 'integrazioneFir'],
  },
  aT: {
    supportata: true,
    verso: 'SCARICO',
    richiede: ['destinatario', 'trasportatore'],
    compila: ['destinatario', 'trasportatore', 'integrazioneFir', 'esito', 'destinatoAttivita'],
  },
  M: NON_SUPPORTATA,
  TR: NON_SUPPORTATA,
  'T*aT': NON_SUPPORTATA,
}

const DESTINAZIONI = new Set([
  ...Array.from({ length: 13 }, (_, i) => `R${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `D${i + 1}`),
])

const ALBO = /^([A-Za-z]{2})\/([0-9]{6})$/

/** `HP4,HP14` → `['HP04','HP14']`; null/vuoto → `[]`; token sconosciuto → errore. */
export function traduciClassiPericolo(valore: string | null): string[] {
  if (!valore || valore.trim() === '') return []
  const compatto = valore.replace(/HP\s+(\d)/gi, 'HP$1')
  const risultato: string[] = []
  for (const token of compatto.split(/[\s,;]+/).filter(t => t !== '')) {
    const m = /^HP(\d{1,2})$/i.exec(token)
    const n = m ? Number(m[1]) : NaN
    if (!m || n < 1 || n > 15) {
      throw new ValoreNonTraducibilePerRentriError(
        'caratteristiche_pericolo',
        token,
        Array.from({ length: 15 }, (_, i) => `HP${String(i + 1).padStart(2, '0')}`)
      )
    }
    const codice = `HP${String(n).padStart(2, '0')}`
    if (!risultato.includes(codice)) risultato.push(codice)
  }
  return risultato
}

/** KG/vuota → kg; T → kg ×1000; L → l; M3 → l ×1000 (volume puro); altro → errore. 4 decimali. */
export function traduciQuantita(
  q: number,
  unit: string
): { valore: number; unita_misura: 'kg' | 'l' } {
  const u = (unit ?? '').trim().toUpperCase()
  const tondo = (x: number) => {
    const r = arrotonda4(x)
    if (r > MAX_QUANTITA) {
      throw new ValoreNonTraducibilePerRentriError('quantita', String(q), [
        'al massimo 9999999999.9999',
      ])
    }
    return r
  }
  if (!Number.isFinite(q) || q < 0) {
    throw new ValoreNonTraducibilePerRentriError('quantita', String(q), ['numero >= 0'])
  }
  if (u === '' || u === 'KG') return { valore: tondo(q), unita_misura: 'kg' }
  if (u === 'T') return { valore: tondo(q * 1000), unita_misura: 'kg' }
  if (u === 'L') return { valore: tondo(q), unita_misura: 'l' }
  if (u === 'M3') return { valore: tondo(q * 1000), unita_misura: 'l' }
  throw new ValoreNonTraducibilePerRentriError('unita_misura', unit, ['KG', 'T', 'L', 'M3'])
}

function rifiuto(a: AnnotazionePerRentri, regola: RegolaCausale | undefined, motivi: string[]) {
  const out: Record<string, unknown> = {}

  const cifre = cerSoloCifre(a.cerCode)
  if (cifre.length !== 6) {
    motivi.push('Codice del rifiuto (CER) non valido: servono sei cifre.')
  } else {
    out.codice_eer = cifre
    if (codiceEerRichiedeDescrizione(cifre)) {
      const d = a.descrizione?.trim()
      if (!d) motivi.push('Il codice del rifiuto termina con 99: la descrizione è obbligatoria.')
      else if (d.length > 250) motivi.push('La descrizione del rifiuto supera i 250 caratteri.')
      else out.descrizione_eer = d
    }
  }

  try {
    out.stato_fisico = traduciStatoFisico(a.statoFisico)
  } catch {
    motivi.push(
      a.statoFisico?.trim()
        ? `Lo stato fisico "${a.statoFisico.trim()}" non ha un codice RENTRI.`
        : 'Stato fisico del rifiuto mancante.'
    )
  }

  try {
    out.quantita = traduciQuantita(a.quantita, a.unit)
  } catch (e) {
    const err = e as ValoreNonTraducibilePerRentriError
    motivi.push(
      err.campo === 'unita_misura'
        ? `Unità di misura "${a.unit}" non trasmettibile a RENTRI (ammesse: kg, t, l, m3).`
        : 'Quantità non valida o oltre il massimo ammesso da RENTRI.'
    )
  }

  let hp: string[] = []
  let hpNonTraducibile = false
  try {
    hp = traduciClassiPericolo(a.classiPericolo)
  } catch (e) {
    hpNonTraducibile = true
    motivi.push(
      `Caratteristica di pericolo non traducibile: "${(e as ValoreNonTraducibilePerRentriError).valoreRicevuto}".`
    )
  }
  if (hp.length > 0) out.caratteristiche_pericolo = hp
  else if (a.cerCode.includes('*') && !hpNonTraducibile) {
    motivi.push('Rifiuto pericoloso senza caratteristiche di pericolo.')
  }

  if (a.fir?.provenienza) out.provenienza = a.fir.provenienza

  if (regola?.compila.includes('destinatoAttivita') && a.operazione?.trim()) {
    const op = a.operazione.replace(/\s+/g, '').toUpperCase()
    if (DESTINAZIONI.has(op)) out.destinato_attivita = op
    else
      motivi.push(`Operazione di recupero o smaltimento "${a.operazione.trim()}" non riconosciuta.`)
  }
  return out
}

function parteBase(
  nome: string,
  p: ParteFirRentri | null,
  motivi: string[],
  obbligatoria: boolean
): { denominazione: string; codice_fiscale: string } | null {
  if (!p) {
    if (obbligatoria) motivi.push(`Il FIR non riporta ${nome}.`)
    return null
  }
  const den = p.denominazione?.trim()
  const cf = p.codiceFiscale?.trim()
  if (!den || den.length > 255) motivi.push(`Denominazione ${nome} mancante o troppo lunga.`)
  if (!cf || cf.length < 5 || cf.length > 20) {
    motivi.push(`Codice fiscale ${nome} mancante o non valido.`)
  }
  if (!den || den.length > 255 || !cf || cf.length < 5 || cf.length > 20) return null
  return { denominazione: den, codice_fiscale: cf }
}

function traduciMovimento(
  a: AnnotazionePerRentri,
  motivi: string[]
): Record<string, unknown> | null {
  const riferimenti: Record<string, unknown> = {
    numero_registrazione: { ...a.numero },
    data_ora_registrazione: a.dataRegistrazione,
  }
  const corpo: Record<string, unknown> = { riferimenti }

  let regola: RegolaCausale | undefined
  if (a.codiceRentri === null) {
    motivi.push('Causale senza codice RENTRI: crea una causale aziendale con il codice giusto.')
  } else {
    regola = REGOLE_CAUSALE[a.codiceRentri]
    if (!regola || !regola.supportata) {
      motivi.push(`Causale RENTRI "${a.codiceRentri}" non supportata da questo programma.`)
      regola = undefined
    } else {
      riferimenti.causale_operazione = a.codiceRentri
      if (regola.verso && regola.verso !== a.verso) {
        motivi.push(
          `La causale RENTRI "${a.codiceRentri}" è incoerente con il verso dell'annotazione: ` +
            `richiede un ${regola.verso === 'SCARICO' ? 'scarico' : 'carico'}.`
        )
      }
    }
  }

  if (a.tipoAnnotazione === 'RETTIFICA') {
    if (!a.predecessore) motivi.push('Rettifica senza annotazione rettificata.')
    else riferimenti.numero_registrazione_rettifica = { ...a.predecessore }
    const m = a.motivo?.trim()
    if (m) {
      if (m.length > 500) motivi.push('Il motivo della rettifica supera i 500 caratteri.')
      else corpo.annotazioni = m
    }
  }

  if (a.verso === 'SCARICO' && a.riferimentiCarico.length > 0) {
    riferimenti.riferimento_operazione = a.riferimentiCarico.map(r => ({ ...r }))
  }

  corpo.rifiuto = rifiuto(a, regola, motivi)

  if (regola) {
    const fir = a.fir
    if (regola.richiede.length > 0 && !fir) {
      motivi.push(
        `La causale RENTRI "${a.codiceRentri}" richiede il FIR collegato all'annotazione.`
      )
    }
    if (fir) {
      if (regola.compila.includes('produttore')) {
        const base = parteBase('del produttore', fir.produttore, motivi, true)
        const ind = fir.produttore?.indirizzo
        if (fir.produttore && !ind) {
          motivi.push('Il produttore del FIR non ha un indirizzo con comune riconosciuto.')
        }
        if (base && ind) corpo.produttore = { ...base, indirizzo: ind }
      }
      if (regola.compila.includes('trasportatore')) {
        const obbligatorio = regola.richiede.includes('trasportatore')
        const base = parteBase('del trasportatore', fir.trasportatore, motivi, obbligatorio)
        if (base) {
          const albo = fir.trasportatore?.numeroIscrizioneAlbo?.trim()
          corpo.trasportatore = {
            ...base,
            ...(albo && ALBO.test(albo) ? { num_iscrizione_albo: albo } : {}),
          }
        }
      }
      if (regola.compila.includes('destinatario')) {
        const base = parteBase('del destinatario', fir.destinatario, motivi, true)
        const aut = fir.destinatario?.numeroAutorizzazione?.trim()
        if (fir.destinatario && (!aut || aut.length > 50)) {
          motivi.push('Numero di autorizzazione del destinatario mancante o troppo lungo.')
        }
        if (base && aut && aut.length <= 50)
          corpo.destinatario = { ...base, num_autorizzazione: aut }
      }
      if (regola.compila.includes('integrazioneFir')) {
        const numero = fir.numeroFir?.trim()
        if (!numero) motivi.push('Il FIR collegato non ha il numero del FIR.')
        else if (numero.length > 20) motivi.push('Il numero del FIR supera i 20 caratteri.')
        else {
          corpo.integrazione_fir = {
            numero_fir: numero,
            ...(fir.dataInizioTrasporto ? { data_inizio_trasporto: fir.dataInizioTrasporto } : {}),
          }
        }
      }
      if (regola.compila.includes('esito')) {
        const peso = fir.pesoVerificatoDestinoKg
        const pesoValido =
          peso !== null && Number.isFinite(peso) && peso >= 0 && arrotonda4(peso) <= MAX_QUANTITA
        if (peso !== null && !pesoValido) {
          motivi.push('Il peso verificato a destino non è valido.')
        }
        const esito = {
          ...(fir.dataFineTrasporto ? { data_fine_trasporto: fir.dataFineTrasporto } : {}),
          ...(pesoValido ? { peso_verificato_destino: arrotonda4(peso) } : {}),
        }
        if (Object.keys(esito).length > 0) corpo.esito = esito
      }
    }
  }
  return corpo
}

export function traduciAnnotazione(a: AnnotazionePerRentri): EsitoTraduzione {
  const motivi: string[] = []

  if (a.tipoAnnotazione === 'ANNULLAMENTO') {
    if (!a.predecessore) motivi.push('Annullamento senza annotazione annullata.')
    const m = a.motivo?.trim()
    if (!m) motivi.push('Annullamento senza motivo.')
    else if (m.length > 500) motivi.push("Il motivo dell'annullamento supera i 500 caratteri.")
    if (motivi.length > 0 || !a.predecessore || !m) return { ok: false, motivi }
    return {
      ok: true,
      corpo: {
        numero_registrazione: { ...a.numero },
        data_ora_registrazione: a.dataRegistrazione,
        numero_registrazione_annullata: { ...a.predecessore },
        annotazioni: m,
      },
    }
  }

  const corpo = traduciMovimento(a, motivi)
  if (motivi.length > 0 || !corpo) return { ok: false, motivi }
  return { ok: true, corpo }
}
