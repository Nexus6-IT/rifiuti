import {
  MudExportData,
  MudRifiutoLine,
  MudTracciatoVersion,
  StatoFisico,
  MudAllegatoDR,
  MudAllegatoTE,
} from '../mud-export.types'
import {
  mudRecord,
  mudNum,
  mudQty,
  mudAlfa,
  mudCodiceFiscale,
  mudDate,
  mudTime,
  MUD_UM_KG,
} from '../mud-format.util'
import { normalizeCer } from '../../../esg/emission-factors'

/** Ordine dei 7 flag di stato fisico nel record BA. */
const STATO_FISICO_ORDER: StatoFisico[] = [
  'SOLIDO_POLVERULENTO',
  'SOLIDO_NON_POLVERULENTO',
  'FANGOSO_PALABILE',
  'LIQUIDO',
  'AERIFORME',
  'VISCHIOSO_SCIROPPOSO',
  'ALTRO',
]

/**
 * Tracciato MUD **versione 6.04/24 — dichiarazione MUD 2024**
 * (docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf).
 *
 * Produce il file telematico sequenziale multirecord. Sequenza:
 *   XX (testata, primo e unico) → { AA, AB, BA, BB } per ogni dichiarazione.
 * Campi separati da `;` (incluso l'ultimo); testo ASCII MAIUSCOLO; campi a
 * lunghezza fissa zero/spazio-paddati.
 *
 * Record implementati a lunghezza fissa conforme al tracciato: XX (488), AA
 * (338), AB (257), BA (217), BB (310).
 *
 * ⚠️ NOTA: i campi non presenti nel nostro dominio (REA, addetti, legale
 * rappresentante, prefissi/telefoni, sezioni veicoli/RAEE/imballaggi, moduli
 * RT/RE per i gestori, flussi estero) sono azzerati/vuoti — corretto per un
 * produttore base di rifiuti speciali. Prima dell'invio reale validare il file
 * con l'applicazione ufficiale su mudtelematico.it e popolare i dati di
 * riferimento ISTAT/ATECO. Nuove annualità = nuova classe versione.
 */
export class MudTracciatoV604_2024 implements MudTracciatoVersion {
  readonly version = '6.04/24'
  readonly year = 2024

  generate(data: MudExportData): string {
    // Costruisce prima il corpo (AA, AB, BA, BB...), poi la testata XX che ne
    // riporta i conteggi.
    const body: string[] = []
    body.push(this.recordAA(data))
    body.push(this.recordAB(data))

    data.rifiuti.forEach((r, idx) => {
      const progr = idx + 1
      body.push(this.recordBA(data, r, progr))
      let drNum = 0
      for (const dr of r.dr ?? []) body.push(this.recordBB_DR(data, r, progr, ++drNum, dr))
      let teNum = 0
      for (const te of r.te ?? []) body.push(this.recordBB_TE(data, r, progr, ++teNum, te))
    })

    const xx = this.recordXX(data, body)
    return [xx, ...body].join('\r\n') + '\r\n'
  }

  /** Conta i record del corpo che iniziano con un dato tipo. */
  private countType(body: string[], type: string): number {
    return body.filter((l) => l.startsWith(`${type};`)).length
  }

  /** XX — Testata del file di export e modulo riepilogativo (488 caratteri). */
  private recordXX(data: MudExportData, body: string[]): string {
    const a = data.azienda
    const now = data.generatedAt ?? new Date()
    // 30 contatori di record (AA..AR nell'ordine del tracciato); solo AA/AB/BA/BB
    // sono valorizzati, gli altri tipi non applicabili a 0.
    const countOrder = [
      'AA', 'AB', 'BA', 'BB', 'BC', 'BD', 'BE', 'DA', 'DB', 'RA', 'RB', 'RC',
      'RD', 'RE', 'RF', 'VC', 'VD', 'VE', 'VF', 'VG', 'VH', 'IA', 'IB', 'IC',
      'ID', 'IE', 'IF', 'MA', 'AU', 'AR',
    ]
    const counters = countOrder.map((t) => mudNum(this.countType(body, t), 5))

    return mudRecord('XX', [
      mudAlfa(this.version, 7), // costante release file
      mudNum(10, 2), // tipo file (SW non CCIAA)
      mudDate(now), // data creazione AAAAMMGG
      mudTime(now), // ora creazione HHMMSS
      mudNum(body.length, 8), // nr totale record estratti escluso XX
      ...counters, // 30 contatori per tipo record
      mudCodiceFiscale(a.codiceFiscale || a.partitaIva), // CF dichiarante
      mudAlfa(a.ragioneSociale, 60),
      mudAlfa(a.via, 30), // indirizzo
      mudAlfa('', 10), // civico (non disponibile separatamente)
      mudAlfa(a.cap, 5),
      mudAlfa(a.comune, 30), // città
      mudAlfa(a.provincia, 2), // sigla provincia
      mudAlfa('', 5), // prefisso telefonico
      mudAlfa('', 10), // numero telefonico
      mudAlfa(a.pec ?? '', 60), // indirizzo e-mail
      mudAlfa('WASTEFLOW', 30), // riservato: identificativo SW produttore file
    ])
  }

  /** AA — Scheda SA-1: anagrafica azienda + unità locale (338 caratteri). */
  private recordAA(data: MudExportData): string {
    const a = data.azienda
    const istatProv = a.comuneCode?.slice(0, 3) ?? ''
    const istatCom = a.comuneCode?.slice(3, 6) ?? ''
    // Unità locale e sede legale coincidono (anagrafica singola): stessi valori.
    return mudRecord('AA', [
      mudNum(data.year, 4),
      mudCodiceFiscale(a.codiceFiscale || a.partitaIva),
      mudNum(1, 15), // codice identificazione univoca unità locale
      mudAlfa(a.atecoCode ?? '', 6), // codice ISTAT attività (ATECO)
      mudNum(0, 9), // N° iscrizione REA (non disponibile)
      mudNum(0, 5), // totale addetti (non disponibile)
      mudAlfa(a.ragioneSociale, 60),
      mudAlfa(istatProv, 3), // ISTAT provincia unità locale
      mudAlfa(istatCom, 3), // ISTAT comune unità locale
      mudAlfa(a.via, 30), // indirizzo unità locale
      mudAlfa('', 6), // civico unità locale
      mudAlfa(a.cap, 5), // CAP unità locale
      mudAlfa('', 5), // prefisso tel UL
      mudAlfa('', 10), // num tel UL
      mudAlfa(istatProv, 3), // ISTAT provincia sede legale (= UL)
      mudAlfa(istatCom, 3), // ISTAT comune sede legale
      mudAlfa(a.via, 30), // indirizzo sede legale
      mudAlfa('', 6), // civico sede legale
      mudAlfa(a.cap, 5), // CAP sede legale
      mudAlfa('', 5), // prefisso tel SL
      mudAlfa('', 10), // num tel SL
      mudAlfa('', 25), // cognome legale rappresentante
      mudAlfa('', 25), // nome legale rappresentante
      mudDate(data.generatedAt ?? new Date()), // data compilazione AAAAMMGG
      mudNum(12, 2), // mesi di attività nell'anno (default 12)
      mudNum(0, 1), // annulla e sostituisce
      mudNum(0, 8), // data comunicazione sostituita
    ])
  }

  /** AB — Scheda SA-2: anagrafica riassuntiva (257 caratteri). */
  private recordAB(data: MudExportData): string {
    const a = data.azienda
    return mudRecord('AB', [
      mudNum(data.year, 4),
      mudCodiceFiscale(a.codiceFiscale || a.partitaIva),
      mudNum(1, 15), // codice identificazione univoca unità locale
      mudNum(data.rifiuti.length, 6), // numero di schede RIF
      mudNum(0, 6), // numero schede INT (intermediazione)
      mudNum(0, 1), // veicoli: scheda AUT
      mudNum(0, 1), // veicoli: scheda ROT
      mudNum(0, 1), // veicoli: scheda FRA
      mudNum(0, 2), // RAEE: schede TRA-RAEE
      mudNum(0, 2), // RAEE: schede CR-RAEE
      mudNum(0, 1), // imballaggi: scheda IMB
      mudNum(0, 2), // autorizzazioni: schede AUT
      mudNum(0, 2), // riciclaggio: schede RIC
      mudAlfa('', 181), // FILLER-01 (retrocompatibilità)
    ])
  }

  /**
   * BA — Scheda RIF (Sezione Rifiuti Speciali): 35 campi a lunghezza fissa,
   * lunghezza totale record 217 (tracciato V6.04/24). Mappa i nostri dati:
   * rifiuto prodotto nell'unità locale, quantità avviate a recupero/smaltimento;
   * i campi non disponibili (ricevuto da terzi, prodotto fuori UL, trasportato,
   * consegnato a terzi, giacenze, moduli RT/RE/TE/DR) sono a 0 finché non
   * implementati i moduli BB. Unità di misura: kg.
   */
  private recordBA(data: MudExportData, r: MudRifiutoLine, progressivo: number): string {
    const cf = mudCodiceFiscale(data.azienda.codiceFiscale || data.azienda.partitaIva)
    const unitaLocale = mudNum(1, 15) // unità locale unica (codice progressivo 1)
    const stati = this.statoFisicoFlags(r.statoFisico)

    return mudRecord('BA', [
      mudNum(data.year, 4), // anno
      cf, // codice fiscale (16)
      unitaLocale, // codice identificazione univoca unità locale (15)
      mudNum(progressivo, 4), // nr ordine progressivo scheda RIF
      mudAlfa(normalizeCer(r.cerCode), 6), // CER (solo catalogo europeo)
      ...stati, // 7 flag stato fisico
      mudQty(r.prodottoKg), // rifiuto prodotto nell'unità locale
      MUD_UM_KG, // UM
      mudQty(0), // ricevuto da terzi
      MUD_UM_KG, // UM
      mudNum(0, 5), // nr moduli RT
      mudQty(0), // prodotto fuori unità locale
      MUD_UM_KG, // UM
      mudNum(0, 5), // nr moduli RE
      mudQty(0), // trasportato dal dichiarante
      MUD_UM_KG, // UM
      mudNum(r.te?.length ?? 0, 5), // nr moduli TE
      mudQty(this.sommaDR(r)), // consegnato a terzi per recupero/smaltimento
      MUD_UM_KG, // UM
      mudNum(r.dr?.length ?? 0, 5), // nr moduli DR
      mudQty(0), // giacenza al 31/12 da avviare a recupero
      MUD_UM_KG, // UM
      mudQty(0), // giacenza al 31/12 da avviare a smaltimento
      MUD_UM_KG, // UM
      mudQty(r.recuperoKg), // quantità complessiva avviata a recupero
      MUD_UM_KG, // UM
      mudQty(r.smaltimentoKg), // quantità complessiva avviata a smaltimento
      MUD_UM_KG, // UM
    ])
  }

  /** 7 flag (0/1) di stato fisico nell'ordine del tracciato; default solido NON polverulento. */
  private statoFisicoFlags(stato?: StatoFisico): string[] {
    const selected = stato ?? 'SOLIDO_NON_POLVERULENTO'
    return STATO_FISICO_ORDER.map((s) => (s === selected ? '1' : '0'))
  }

  /** Totale conferito a terzi (somma quantità dei moduli DR). */
  private sommaDR(r: MudRifiutoLine): number {
    return (r.dr ?? []).reduce((sum, d) => sum + (d.quantitaKg || 0), 0)
  }

  /**
   * BB — Modulo DR (rifiuto conferito a terzi): 32 campi a lunghezza fissa
   * (lunghezza record 310). Valorizza anagrafica destinatario + quantità.
   */
  private recordBB_DR(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    dr: MudAllegatoDR,
  ): string {
    return this.recordBB(data, r, schedaProgr, 'DR', allegatoProgr, {
      cf: dr.codiceFiscale,
      ragioneSociale: dr.ragioneSociale,
      istatProvincia: dr.istatProvincia,
      istatComune: dr.istatComune,
      indirizzo: dr.indirizzo,
      civico: dr.civico,
      cap: dr.cap,
      quantitaKg: dr.quantitaKg,
    })
  }

  /**
   * BB — Modulo TE (trasportatore): valorizza solo CF + ragione sociale
   * (gli altri campi restano azzerati, come da specifica).
   */
  private recordBB_TE(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    te: MudAllegatoTE,
  ): string {
    return this.recordBB(data, r, schedaProgr, 'TE', allegatoProgr, {
      cf: te.codiceFiscale,
      ragioneSociale: te.ragioneSociale,
    })
  }

  /** Costruisce un record BB generico per tipo allegato (DR/TE/RT). */
  private recordBB(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    tipo: 'RT' | 'DR' | 'TE',
    allegatoProgr: number,
    f: {
      cf: string
      ragioneSociale: string
      istatProvincia?: string
      istatComune?: string
      indirizzo?: string
      civico?: string
      cap?: string
      quantitaKg?: number
    },
  ): string {
    return mudRecord('BB', [
      mudNum(data.year, 4),
      mudCodiceFiscale(data.azienda.codiceFiscale || data.azienda.partitaIva),
      mudNum(1, 15), // unità locale
      mudNum(schedaProgr, 4), // nr scheda RIF
      mudAlfa(normalizeCer(r.cerCode), 6),
      mudAlfa(tipo, 2), // tipo allegato
      mudNum(allegatoProgr, 5), // nr progressivo allegato
      mudCodiceFiscale(f.cf), // CF soggetto
      mudAlfa(f.ragioneSociale, 60),
      mudAlfa(f.istatProvincia ?? '', 3), // ISTAT provincia (DR/RT)
      mudAlfa(f.istatComune ?? '', 3), // ISTAT comune (DR/RT)
      mudAlfa(f.indirizzo ?? '', 30),
      mudAlfa(f.civico ?? '', 6),
      mudAlfa(f.cap ?? '', 5),
      mudQty(f.quantitaKg ?? 0), // quantità dichiarata
      MUD_UM_KG, // UM
      mudAlfa('', 20), // nome nazione (estero)
      mudAlfa('', 6), // codice reg. CEE 1013/2006
      mudNum(0, 1), // ricevuto da privati (solo RT)
      mudQty(0), // altre op. smaltimento (estero)
      MUD_UM_KG,
      mudQty(0), // recupero di materia (estero)
      MUD_UM_KG,
      mudQty(0), // recupero di energia (estero)
      MUD_UM_KG,
      mudQty(0), // incenerimento (estero)
      MUD_UM_KG,
      mudQty(0), // discarica (estero)
      MUD_UM_KG,
      mudNum(0, 1), // origine urbana (solo RT)
      mudNum(0, 1), // pile e accumulatori portatili (solo RT)
    ])
  }
}
