/** Contratto API della 4.9a (`/comunicazioni`, O.R.SO. annuale). Quantità: stringhe decimali col punto. */

export interface UnitaLocaleAnteprima {
  id: string
  nome: string
  provincia: string | null
}

export interface RigaRicevuto {
  cer: string
  descrizione: string
  operazioni: string[]
  totT: string
  extraT: string
  conFir: boolean
  /** Solo in modalità dettagliata (4.9e): una quota per conferitore. */
  soggetti?: SoggettoAnteprima[]
}

/** Conferitore o destinatario di una riga in modalità dettagliata. */
export interface SoggettoAnteprima {
  /** `C` comune, `I` impianto dell'elenco ARPA, `Inew` nuovo impianto. */
  ts: 'C' | 'I' | 'Inew'
  s: string
  etichetta: string
  qT: string
  conFir?: boolean
}

export interface RigaProdotto {
  cer: string
  descrizione: string
  operazioni: string[]
  totT: string
  giacenzaFineMeseT: string
  /** Solo in modalità dettagliata: una quota per destinatario. */
  soggetti?: SoggettoAnteprima[]
}

export interface MeseAnteprima {
  mese: number
  ricevuti: RigaRicevuto[]
  prodotti: RigaProdotto[]
}

/** Movimento coinvolto in un avviso: quanto serve per ritrovarlo nel registro. */
export interface MovimentoAvviso {
  id: string
  /** Giorno `AAAA-MM-GG`. */
  data: string
  /** Numero progressivo nel registro, «n/anno». */
  numero: string
  cer: string
}

export interface AvvisoComunicazione {
  codice: string
  messaggio: string
  movimentoIds: string[]
  movimenti?: MovimentoAvviso[]
}

export type StatoComunicazione = 'GENERATA' | 'INVIATA'

export interface ComunicazioneVista {
  id: string
  consorzio: string
  unitaLocaleId: string
  periodoDa: string
  periodoA: string
  tracciato: string
  versione: string
  stato: StatoComunicazione
  hashDati: string
  nomeFile: string
  generataIl: string
  generataDa: string
  inviataIl?: string | null
  inviataDa?: string | null
  modificataDopoInvio: boolean
  /** Affidabilita' del tracciato (4.9c-f): `RICAVATO_WINWASTE` = da confermare con un file reale. */
  affidabilita?: 'UFFICIALE' | 'RICAVATO_WINWASTE'
  notaAffidabilita?: string
}

export type ModalitaOrso = 'NORMALE' | 'DETTAGLIATA'

export interface AnteprimaOrso {
  /** Modalità della sede (configurazione); assente = normale. */
  modalita?: ModalitaOrso
  /** Nuovi impianti descritti nel file (solo dettagliata). */
  nuoviImpianti?: number
  affidabilita?: 'UFFICIALE' | 'RICAVATO_WINWASTE'
  notaAffidabilita?: string
  unitaLocale: UnitaLocaleAnteprima
  anno: number
  mesi: MeseAnteprima[]
  avvisi: AvvisoComunicazione[]
  bloccanti: boolean
  hashDati: string
  ultima?: ComunicazioneVista | null
  /** Ruolo effettivo nell'azienda selezionata: può generare e segnare «inviata». */
  puoGenerare?: boolean
}

export interface FileScaricato {
  blob: Blob
  nomeFile: string | null
}

/** Una riga della tabella mese × CER. */
export interface RigaTabella {
  mese: number
  meseNome: string
  direzione: 'Ricevuto' | 'Prodotto'
  cer: string
  descrizione: string
  operazioni: string
  quantita: string
  dettaglio: string
  /** Solo in modalità dettagliata: conferitore o destinatario della quota. */
  soggetto?: string
}

const MESI = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
]

export function nomeMese(mese: number): string {
  return MESI[mese - 1] ?? String(mese)
}

/** «1234.5» → «1.234,500 t» (it-IT, 3 decimali); valore non numerico: restituito com'è. */
export function formattaTonnellate(valore: string): string {
  const n = Number(valore)
  if (!Number.isFinite(n)) return valore
  return `${n.toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} t`
}

const NOME_TIPO_SOGGETTO: Record<SoggettoAnteprima['ts'], string> = {
  C: 'Comune',
  I: 'Impianto ARPA',
  Inew: 'Nuovo impianto',
}

/** «Nuovo impianto n. 2 · Ditta Rossi»: tipo, identificativo e nome del soggetto. */
export function testoSoggetto(s: SoggettoAnteprima): string {
  return `${NOME_TIPO_SOGGETTO[s.ts]} ${s.ts === 'Inew' ? 'n. ' : ''}${s.s} · ${s.etichetta}`
}

/** Appiattisce i mesi in righe mese × CER (ricevuti, poi prodotti); i mesi vuoti non hanno righe. */
export function righeDaAnteprima(mesi: MeseAnteprima[]): RigaTabella[] {
  const out: RigaTabella[] = []
  for (const m of [...mesi].sort((a, b) => a.mese - b.mese)) {
    for (const r of m.ricevuti) {
      if (r.soggetti && r.soggetti.length > 0) {
        // Modalità dettagliata: una riga per conferitore.
        for (const s of r.soggetti) {
          out.push({
            mese: m.mese,
            meseNome: nomeMese(m.mese),
            direzione: 'Ricevuto',
            cer: r.cer,
            descrizione: r.descrizione,
            operazioni: r.operazioni.join(', '),
            quantita: formattaTonnellate(s.qT),
            dettaglio: s.conFir ? 'con FIR' : 'senza FIR',
            soggetto: testoSoggetto(s),
          })
        }
        continue
      }
      out.push({
        mese: m.mese,
        meseNome: nomeMese(m.mese),
        direzione: 'Ricevuto',
        cer: r.cer,
        descrizione: r.descrizione,
        operazioni: r.operazioni.join(', '),
        quantita: formattaTonnellate(r.totT),
        dettaglio: `di cui extra ${formattaTonnellate(r.extraT)}${r.conFir ? ' · con FIR' : ''}`,
      })
    }
    for (const p of m.prodotti) {
      if (p.soggetti && p.soggetti.length > 0) {
        for (const s of p.soggetti) {
          out.push({
            mese: m.mese,
            meseNome: nomeMese(m.mese),
            direzione: 'Prodotto',
            cer: p.cer,
            descrizione: p.descrizione,
            operazioni: p.operazioni.join(', '),
            quantita: formattaTonnellate(s.qT),
            dettaglio: `giacenza a fine mese ${formattaTonnellate(p.giacenzaFineMeseT)}`,
            soggetto: testoSoggetto(s),
          })
        }
        continue
      }
      out.push({
        mese: m.mese,
        meseNome: nomeMese(m.mese),
        direzione: 'Prodotto',
        cer: p.cer,
        descrizione: p.descrizione,
        operazioni: p.operazioni.join(', '),
        quantita: formattaTonnellate(p.totT),
        dettaglio: `giacenza a fine mese ${formattaTonnellate(p.giacenzaFineMeseT)}`,
      })
    }
  }
  return out
}

/** Generare e segnare «inviata»: solo ADMIN e OPERATOR (SUPER_ADMIN incluso come amministratore). */
export function puoGenerareComunicazioni(ruolo: string | null | undefined): boolean {
  return ruolo === 'ADMIN' || ruolo === 'OPERATOR' || ruolo === 'SUPER_ADMIN'
}
