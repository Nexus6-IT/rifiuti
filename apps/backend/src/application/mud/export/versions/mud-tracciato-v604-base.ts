import {
  MudDichiarazioneExport,
  MudExportData,
  MudRifiutoLine,
  MudTracciatoVersion,
  StatoFisico,
  MudAllegatoDR,
  MudAllegatoTE,
  MudAllegatoRT,
  MudAllegatoRE,
  MudAutorizzazione,
  MudModuloGestione,
  MudRiciclaggio,
  MudRiciclaggioQuantita,
  MudIntermediazione,
  MudTipoAutorizzazione,
  MudUnitaOrigineDestinazione,
  MudOperazioneSmaltimento,
  MudOperazioneRecupero,
} from '../mud-export.types'
import {
  mudRecord,
  mudNum,
  mudQty,
  mudQtyUm,
  mudAlfa,
  mudCodiceFiscale,
  mudDate,
  mudTime,
  mudIstat,
  mudFlag,
  mudOperazioni,
  mudDateOrZero,
} from '../mud-format.util'
import { normalizeCer } from '../../../esg/emission-factors'

/** Lunghezze totali dei record, da «Lunghezza totale record X» del tracciato. */
export const LUNGHEZZE_RECORD_V604: Readonly<Record<string, number>> = {
  XX: 488,
  AA: 338,
  AB: 257,
  AU: 327,
  AR: 201,
  BA: 217,
  BB: 310,
  BC: 83,
  BD: 245,
  BE: 268,
  DA: 93,
  DB: 221,
}

/** Stato fisico che il tracciato indica quando la riga non ne ha uno. */
export const STATO_FISICO_PREDEFINITO: StatoFisico = 'SOLIDO_NON_POLVERULENTO'

/** Ordine dei 7 flag di stato fisico nei record BA e DA. */
const STATO_FISICO_ORDER: StatoFisico[] = [
  'SOLIDO_POLVERULENTO',
  'SOLIDO_NON_POLVERULENTO',
  'FANGOSO_PALABILE',
  'LIQUIDO',
  'AERIFORME',
  'VISCHIOSO_SCIROPPOSO',
  'ALTRO',
]

/** Operazioni di smaltimento del record BD, nell'ordine del tracciato. */
const SMALTIMENTO_ORDER: MudOperazioneSmaltimento[] = [
  'D2',
  'D3',
  'D4',
  'D6',
  'D7',
  'D8',
  'D9',
  'D10',
  'D11',
  'D13',
  'D14',
  'D15',
]

/** Operazioni di recupero del record BE, nell'ordine del tracciato. */
const RECUPERO_ORDER: MudOperazioneRecupero[] = [
  'R1',
  'R2',
  'R3',
  'R4',
  'R5',
  'R6',
  'R7',
  'R8',
  'R9',
  'R10',
  'R11',
  'R12',
  'R13',
]

/** I 30 contatori di record della testata XX, nell'ordine esatto del tracciato. */
const COUNT_ORDER = [
  'AA',
  'AB',
  'BA',
  'BB',
  'BC',
  'BD',
  'BE',
  'DA',
  'DB',
  'RA',
  'RB',
  'RC',
  'RD',
  'RE',
  'RF',
  'VC',
  'VD',
  'VE',
  'VF',
  'VG',
  'VH',
  'IA',
  'IB',
  'IC',
  'ID',
  'IE',
  'IF',
  'MA',
  'AU',
  'AR',
]

/**
 * Dati con cui si scrive un pacchetto: la vista del pacchetto (rifiuti, schede AU/AR/INT che
 * contiene) più il riferimento alla dichiarazione, assente se il file ha un solo pacchetto.
 */
type DatiPacchetto = MudExportData & { pacchetto?: MudDichiarazioneExport }

/** Numero massimo di discariche dichiarabili in un record AU. */
const MAX_DISCARICHE_AU = 3

/**
 * Base comune dei tracciati MUD della famiglia **6.04** (Unioncamere/Ecocerved).
 *
 * Le annualità 6.04/24 (MUD 2025, dati 2024, DPCM 29/1/2025) e 6.04/25
 * (MUD 2026, dati 2025, DPCM 30/1/2026) hanno **struttura e lunghezze record
 * identiche**: cambiano solo la costante di release, la tabella ATECO di
 * riferimento, tre etichette di stato fisico (solo descrizioni) e i tipi di
 * autorizzazione ammessi nel record AU. Tutto ciò che è comune vive qui; ogni
 * annualità è una sottoclasse che dichiara `version`, `year` ed eventuali
 * vincoli propri.
 *
 * Formato: file di testo ASCII (ISO 646) sequenziale multirecord, record a
 * lunghezza fissa **con separatore `;` dopo ogni campo, incluso l'ultimo**,
 * terminatore di riga CRLF. La sequenza è: `XX` (testata, primo e unico) seguito
 * dai record della dichiarazione.
 *
 * Record implementati, con lunghezza da tracciato:
 *   XX 488 · AA 338 · AB 257 · AU 327 · AR 201 · BA 217 · BB 310 · BC 83 ·
 *   BD 245 · BE 268 · DA 93 · DB 221
 *
 * ⚠️ NON implementati: sezioni RAEE (RA–RF), Veicoli Fuori Uso (VC–VH),
 * Imballaggi gestori (IA–IF) e Materiali secondari (MA); i relativi contatori
 * della testata XX restano a zero. Comunicazione Rifiuti Semplificata, Rifiuti
 * Urbani e Produttori AEE hanno canali di trasmissione separati e non fanno
 * parte di questo tracciato.
 *
 * ⚠️ Prima dell'invio reale il file va validato con l'applicazione ufficiale su
 * mudtelematico.it: un file non conforme sui separatori viene scartato per intero.
 */
export abstract class MudTracciatoV604Base implements MudTracciatoVersion {
  /** Costante release del file (campo 2 del record XX), es. "6.04/24". */
  abstract readonly version: string
  /** Anno **dei dati** dichiarati (la dichiarazione si presenta l'anno dopo). */
  abstract readonly year: number
  abstract readonly scadenzaPresentazione: string

  /**
   * Tipi di autorizzazione ammessi nel record AU per questa annualità.
   * Il 6.04/25 aggiunge 7 (bonifiche art. 242 c.7), 8 (ordinanze art. 191) e
   * 9 (art. 110 c.3): dichiararli su un tracciato che non li prevede farebbe
   * fallire la validazione ufficiale, quindi vengono riportati a 0 = ND.
   */
  protected readonly tipiAutorizzazioneAmmessi: readonly MudTipoAutorizzazione[] = [
    0, 1, 2, 3, 4, 5, 6,
  ]

  generate(data: MudExportData): string {
    // Il corpo va costruito prima della testata: XX riporta i conteggi per tipo.
    const body: string[] = []
    // Un pacchetto per dichiarazione, nell'ordine dato; senza dichiarazioni, uno solo come sempre.
    if (data.dichiarazioni) {
      // Difese: un elenco vuoto darebbe un file senza pacchetti, e le schede AU, AR e INT in più
      // pacchetti sarebbero duplicate (D7: ciascuna sta in un solo pacchetto).
      if (data.dichiarazioni.length === 0) {
        throw new Error('Elenco di dichiarazioni vuoto: file MUD non conforme')
      }
      if (data.dichiarazioni.filter(d => d.conAutorizzazioni).length > 1) {
        throw new Error('Schede AU in più di un pacchetto: file MUD non conforme')
      }
      if (data.dichiarazioni.filter(d => d.conAllegatiAzienda).length > 1) {
        throw new Error('Schede AR e INT in più di un pacchetto: file MUD non conforme')
      }
      for (const dichiarazione of data.dichiarazioni) {
        body.push(...this.pacchetto(this.vistaPacchetto(data, dichiarazione)))
      }
    } else {
      body.push(...this.pacchetto(data))
    }

    const xx = this.recordXX(data, body)
    const righe = [xx, ...body]
    for (const riga of righe) {
      const tipo = riga.slice(0, 2)
      const attesa = LUNGHEZZE_RECORD_V604[tipo]
      // un tipo nuovo senza lunghezza in tabella non passa senza controllo
      if (attesa === undefined) {
        throw new Error(
          `Record di tipo ${tipo} senza lunghezza nel tracciato: file MUD non conforme`
        )
      }
      if (riga.length !== attesa) {
        throw new Error(
          `Record ${tipo} di ${riga.length} caratteri invece di ${attesa}: file MUD non conforme`
        )
      }
    }
    return righe.join('\r\n') + '\r\n'
  }

  /** Vista dei dati di un pacchetto: D7, AU solo dove indicato, AR e INT solo con gli allegati. */
  private vistaPacchetto(data: MudExportData, d: MudDichiarazioneExport): DatiPacchetto {
    return {
      ...data,
      rifiuti: d.rifiuti,
      autorizzazioni: d.conAutorizzazioni ? data.autorizzazioni : [],
      riciclaggio: d.conAllegatiAzienda ? data.riciclaggio : [],
      intermediazioni: d.conAllegatiAzienda ? data.intermediazioni : [],
      pacchetto: d,
    }
  }

  /** I record di una dichiarazione: AA, AB, AU, AR, le schede RIF con i loro allegati, INT. */
  private pacchetto(data: DatiPacchetto): string[] {
    const body: string[] = []
    body.push(this.recordAA(data))
    body.push(this.recordAB(data))

    // Le schede SA-AUT e SA-RIC seguono l'AA a cui si agganciano.
    ;(data.autorizzazioni ?? []).forEach((aut, i) => body.push(this.recordAU(data, aut, i + 1)))
    ;(data.riciclaggio ?? []).forEach((ric, i) => body.push(this.recordAR(data, ric, i + 1)))

    data.rifiuti.forEach((r, idx) => {
      const progr = idx + 1
      body.push(this.recordBA(data, r, progr))

      // Moduli allegati alla scheda RIF, ciascuno con progressivo proprio.
      let n = 0
      for (const rt of r.rt ?? []) body.push(this.recordBB_RT(data, r, progr, ++n, rt))
      n = 0
      for (const dr of r.dr ?? []) body.push(this.recordBB_DR(data, r, progr, ++n, dr))
      n = 0
      for (const te of r.te ?? []) body.push(this.recordBB_TE(data, r, progr, ++n, te))
      n = 0
      for (const re of r.re ?? []) body.push(this.recordBC(data, r, progr, ++n, re))
      // Il modulo MG è la coppia BD+BE con lo stesso progressivo di allegato.
      n = 0
      for (const mg of r.mg ?? []) {
        const allegato = ++n
        body.push(this.recordBD(data, r, progr, allegato, mg))
        body.push(this.recordBE(data, r, progr, allegato, mg))
      }
    })

    // Sezione intermediazione: scheda INT seguita dai moduli UO/UD.
    ;(data.intermediazioni ?? []).forEach((int, idx) => {
      const progr = idx + 1
      body.push(this.recordDA(data, int, progr))
      let n = 0
      for (const uo of int.uo ?? []) body.push(this.recordDB(data, int, progr, 'UO', ++n, uo))
      n = 0
      for (const ud of int.ud ?? []) body.push(this.recordDB(data, int, progr, 'UD', ++n, ud))
    })
    return body
  }

  // ===================== Helper comuni =====================

  /** Conta i record del corpo che iniziano con un dato tipo. */
  protected countType(body: string[], type: string): number {
    return body.filter(l => l.startsWith(`${type};`)).length
  }

  /** CF del dichiarante (o P.IVA in fallback), formattato a 16 caratteri. */
  protected cfDichiarante(data: MudExportData): string {
    return mudCodiceFiscale(data.azienda.codiceFiscale || data.azienda.partitaIva)
  }

  /**
   * Codice di identificazione univoco dell'unità locale (`alfa 15`): quello del pacchetto
   * che si sta scrivendo, 1 se il file ha un solo pacchetto.
   */
  protected unitaLocale(data: DatiPacchetto): string {
    return mudNum(data.pacchetto?.progressivoUnitaLocale ?? 1, 15)
  }

  /** ISTAT provincia/comune dell'azienda, derivati dal codice comune a 6 cifre. */
  protected istatAzienda(data: MudExportData): { prov: string; com: string } {
    return this.istatDaCodice(data.azienda.comuneCode)
  }

  /** ISTAT provincia/comune da un codice comune a 6 cifre. */
  protected istatDaCodice(code?: string): { prov: string; com: string } {
    return {
      prov: mudIstat(code?.slice(0, 3)),
      com: mudIstat(code?.slice(3, 6)),
    }
  }

  /** Chiave comune dei record agganciati a una scheda RIF. */
  protected chiaveSchedaRif(data: MudExportData, r: MudRifiutoLine, schedaProgr: number): string[] {
    return [
      mudNum(data.year, 4),
      this.cfDichiarante(data),
      this.unitaLocale(data),
      mudNum(schedaProgr, 4),
      mudAlfa(normalizeCer(r.cerCode), 6),
    ]
  }

  /** 7 flag (0/1) di stato fisico; default solido NON polverulento. */
  protected statoFisicoFlags(stato?: StatoFisico): string[] {
    const selected = stato ?? STATO_FISICO_PREDEFINITO
    return STATO_FISICO_ORDER.map(s => (s === selected ? '1' : '0'))
  }

  /** Coppia «quantità + unità di misura», ricorrente in quasi tutti i record. */
  protected qtyUm(value: number | undefined): Array<string | number> {
    return mudQtyUm(value ?? 0)
  }

  // ===================== Sezione anagrafica =====================

  /** XX — Testata del file di export e modulo riepilogativo (488). */
  protected recordXX(data: MudExportData, body: string[]): string {
    const a = data.azienda
    const now = data.generatedAt ?? new Date()
    const counters = COUNT_ORDER.map(t => mudNum(this.countType(body, t), 5))

    return mudRecord('XX', [
      mudAlfa(this.version, 7), // costante release file
      mudNum(10, 2), // tipo file (SW non CCIAA)
      mudDate(now), // data creazione AAAAMMGG
      mudTime(now), // ora creazione HHMMSS
      mudNum(body.length, 8), // nr totale record estratti escluso XX
      ...counters, // 30 contatori per tipo record
      this.cfDichiarante(data),
      mudAlfa(a.ragioneSociale, 60),
      mudAlfa(a.via, 30), // indirizzo
      mudAlfa(a.civico ?? '', 10), // civico
      mudAlfa(a.cap, 5),
      mudAlfa(a.comune, 30), // città
      mudAlfa(a.provincia, 2), // sigla provincia
      mudAlfa('', 5), // prefisso telefonico
      mudAlfa(a.telefono ?? '', 10), // numero telefonico
      mudAlfa(a.pec ?? '', 60), // indirizzo e-mail
      mudAlfa('WASTEFLOW', 30), // riservato: identificativo SW produttore file
    ])
  }

  /** AA — Scheda SA-1: anagrafica azienda + unità locale (338). */
  protected recordAA(data: DatiPacchetto): string {
    const sostituisce = (data.sostituisce?.progressivi ?? [1]).includes(
      data.pacchetto?.progressivoUnitaLocale ?? 1
    )
      ? data.sostituisce
      : undefined
    const a = data.azienda
    // Blocco «unità locale»: la sede del pacchetto, oppure l'azienda (sede legale = unità locale).
    const sede = data.pacchetto?.unitaLocale ?? null
    const ul = sede ?? a
    const addetti = sede ? sede.numeroAddetti : (a.numeroAddetti ?? 0)
    // Il telefono è dell'azienda: la sede non ne ha uno proprio, meglio vuoto che sbagliato.
    const telefonoUl = sede ? (sede.telefono ?? '') : (a.telefono ?? '')
    // ISTAT provincia/comune sono `num 3` da tracciato: vanno zero-paddati.
    // Emetterli spazio-paddati (come faceva la versione precedente) produce un
    // campo numerico riempito di spazi, che fa scartare il file.
    const { prov, com } = this.istatAzienda(data)
    const { prov: provUl, com: comUl } = sede ? this.istatDaCodice(sede.comuneCode) : { prov, com }
    return mudRecord('AA', [
      mudNum(data.year, 4),
      this.cfDichiarante(data),
      this.unitaLocale(data),
      mudAlfa(a.atecoCode ?? '', 6), // ISTAT attività (ATECO), alfa: zeri significativi
      mudNum(Number(a.reaNumber) || 0, 9), // N° iscrizione REA
      mudNum(addetti, 5), // totale addetti dell'unità locale
      mudAlfa(a.ragioneSociale, 60),
      provUl, // ISTAT provincia unità locale
      comUl, // ISTAT comune unità locale
      mudAlfa(ul.via, 30), // indirizzo unità locale
      mudAlfa(ul.civico ?? '', 6), // civico unità locale
      mudAlfa(ul.cap, 5), // CAP unità locale
      mudAlfa('', 5), // prefisso tel UL
      mudAlfa(telefonoUl, 10), // num tel UL
      prov, // ISTAT provincia sede legale (sempre l'azienda)
      com, // ISTAT comune sede legale
      mudAlfa(a.via, 30), // indirizzo sede legale
      mudAlfa(a.civico ?? '', 6), // civico sede legale
      mudAlfa(a.cap, 5), // CAP sede legale
      mudAlfa('', 5), // prefisso tel SL
      mudAlfa(a.telefono ?? '', 10), // num tel SL
      mudAlfa(a.legaleRappresentanteCognome ?? '', 25),
      mudAlfa(a.legaleRappresentanteNome ?? '', 25),
      mudDate(data.generatedAt ?? new Date()), // data compilazione AAAAMMGG
      mudNum(12, 2), // mesi di attività nell'anno (default 12)
      // annulla e sostituisce + data della comunicazione sostituita (giorno italiano AAAAMMGG)
      // solo i pacchetti il cui progressivo era già stato presentato (G2): gli altri sono nuovi
      mudNum(sostituisce ? 1 : 0, 1),
      sostituisce ? mudDate(sostituisce.dataComunicazione) : mudNum(0, 8),
    ])
  }

  /** AB — Scheda SA-2: anagrafica riassuntiva (257). */
  protected recordAB(data: DatiPacchetto): string {
    return mudRecord('AB', [
      mudNum(data.year, 4),
      this.cfDichiarante(data),
      this.unitaLocale(data),
      mudNum(data.rifiuti.length, 6), // numero di schede RIF del pacchetto
      mudNum((data.intermediazioni ?? []).length, 6), // numero schede INT
      mudNum(0, 1), // veicoli: scheda AUT
      mudNum(0, 1), // veicoli: scheda ROT
      mudNum(0, 1), // veicoli: scheda FRA
      mudNum(0, 2), // RAEE: schede TRA-RAEE
      mudNum(0, 2), // RAEE: schede CR-RAEE
      mudNum(0, 1), // imballaggi: scheda IMB
      mudNum((data.autorizzazioni ?? []).length, 2), // autorizzazioni: schede AUT
      mudNum((data.riciclaggio ?? []).length, 2), // riciclaggio: schede RIC
      mudAlfa('', 181), // FILLER-01 (retrocompatibilità)
    ])
  }

  /**
   * AU — Scheda SA-AUT: autorizzazioni e certificazioni dell'impianto (327).
   *
   * Da emettere una per ogni autorizzazione o certificazione posseduta. In
   * assenza di autorizzazioni — e per tutti i soggetti estranei alla gestione
   * rifiuti — il record non va trasmesso e `AB` riporta `00` schede AUT.
   */
  protected recordAU(data: MudExportData, aut: MudAutorizzazione, progressivo: number): string {
    const tipo = this.normalizzaTipoAutorizzazione(aut.tipoAutorizzazione)
    // Il flag EoW è definito solo per i tipi 1, 2, 4 e 5.
    const eowApplicabile = tipo === 1 || tipo === 2 || tipo === 4 || tipo === 5

    // Fino a 3 blocchi discarica: le posizioni non usate restano azzerate.
    const discariche = (aut.discariche ?? []).slice(0, MAX_DISCARICHE_AU)
    const blocchiDiscarica: Array<string | number> = []
    for (let i = 0; i < MAX_DISCARICHE_AU; i++) {
      const d = discariche[i]
      blocchiDiscarica.push(mudNum(d?.classificazione ?? 0, 1))
      blocchiDiscarica.push(mudNum(d?.capacitaResiduaMc ?? 0, 9))
    }

    return mudRecord('AU', [
      mudNum(data.year, 4),
      this.cfDichiarante(data),
      this.unitaLocale(data),
      mudNum(progressivo, 4), // nr progressivo scheda SA-AUT
      mudAlfa(aut.estremi, 20), // estremi autorizzazione / iscrizione
      mudDateOrZero(aut.dataRilascio), // data rilascio / presentazione / rinnovo
      mudDateOrZero(aut.dataScadenza),
      mudNum(aut.enteAutorizzante ?? 0, 1), // 0=ND 1=Provincia 2=Regione 3=Ministero
      mudNum(tipo, 1),
      mudFlag(aut.rinnovoAutocertificazione), // rinnovo per autocertificazione
      mudOperazioni(aut.operazioniRecupero, 50), // "R1,R5,R13"
      mudOperazioni(aut.operazioniSmaltimento, 50), // "D4,D5,D12"
      mudFlag(aut.gestisceVFU),
      mudFlag(aut.gestisceRAEE),
      mudFlag(eowApplicabile && aut.autorizzazioneEoW), // art. 184-ter c.3
      mudFlag(aut.impiantoIncenerimento),
      mudNum(aut.capacitaComplessivaTa ?? 0, 9), // capacità autorizzata t/a
      mudNum(aut.capacitaPericolosiTa ?? 0, 9),
      mudNum(aut.capacitaNonPericolosiTa ?? 0, 9),
      mudFlag(aut.impiantoCoincenerimento),
      mudNum(aut.capacitaCoincComplessivaTa ?? 0, 9),
      mudNum(aut.capacitaCoincPericolosiTa ?? 0, 9),
      mudNum(aut.capacitaCoincNonPericolosiTa ?? 0, 9),
      ...blocchiDiscarica, // 3 × (classificazione + capacità residua mc)
      mudDateOrZero(aut.emasPrimaRegistrazione), // 1a registrazione EMAS
      mudAlfa(aut.emasNumeroRegistrazione ?? '', 9), // numero registrazione EMAS
      mudDateOrZero(aut.iso14001Emissione), // emissione corrente ISO 14001
    ])
  }

  /**
   * Riporta a 0 (ND) i tipi di autorizzazione non previsti da questa annualità.
   * Evita di produrre un file che il validatore ufficiale rigetterebbe.
   */
  protected normalizzaTipoAutorizzazione(tipo?: MudTipoAutorizzazione): number {
    if (tipo == null) return 0
    return this.tipiAutorizzazioneAmmessi.includes(tipo) ? tipo : 0
  }

  /**
   * AR — Scheda SA-RIC: riciclaggio per frazione (201).
   *
   * Una scheda per ogni frazione trattata su rifiuti di origine urbana e su
   * imballaggi. Almeno una fra le due sezioni di provenienza va compilata.
   */
  protected recordAR(data: MudExportData, ric: MudRiciclaggio, progressivo: number): string {
    const op = ric.operazioni ?? {}
    return mudRecord('AR', [
      mudNum(data.year, 4),
      this.cfDichiarante(data),
      this.unitaLocale(data),
      mudNum(progressivo, 4), // nr progressivo scheda SA-RIC
      mudNum(ric.frazione, 2), // frazione 01..11
      // Operazioni di recupero eseguite (flag), nell'ordine del tracciato.
      mudFlag(op.r3),
      mudFlag(op.r4),
      mudFlag(op.r5),
      mudFlag(op.r9),
      mudFlag(op.r12),
      mudFlag(op.r13),
      ...this.bloccoRiciclaggio(ric.urbani), // provenienza da rifiuti urbani
      ...this.bloccoRiciclaggio(ric.imballaggi), // provenienza da imballaggi
    ])
  }

  /** Blocco di 5 quantità (+ UM) della scheda SA-RIC. */
  protected bloccoRiciclaggio(q?: MudRiciclaggioQuantita): Array<string | number> {
    return [
      ...this.qtyUm(q?.trattataKg),
      ...this.qtyUm(q?.scartiPreliminariKg),
      ...this.qtyUm(q?.finaleRiciclaggioKg),
      ...this.qtyUm(q?.scartiFinaliKg),
      ...this.qtyUm(q?.preparataRiutilizzoKg),
    ]
  }

  // ===================== Sezione rifiuti =====================

  /**
   * BA — Scheda RIF (Sezione Rifiuti Speciali), 35 campi, lunghezza 217.
   *
   * I conteggi dei moduli allegati (RT, RE, TE, DR) sono derivati dagli allegati
   * effettivamente emessi, così testata e scheda restano coerenti.
   */
  protected recordBA(data: MudExportData, r: MudRifiutoLine, progressivo: number): string {
    return mudRecord('BA', [
      ...this.chiaveSchedaRif(data, r, progressivo),
      ...this.statoFisicoFlags(r.statoFisico), // 7 flag stato fisico
      ...this.qtyUm(r.prodottoKg), // prodotto nell'unità locale
      ...this.qtyUm(this.sommaQuantita(r.rt)), // ricevuto da terzi
      mudNum(r.rt?.length ?? 0, 5), // nr moduli RT
      ...this.qtyUm(this.sommaQuantita(r.re)), // prodotto fuori unità locale
      mudNum(r.re?.length ?? 0, 5), // nr moduli RE
      ...this.qtyUm(r.trasportatoDalDichiaranteKg), // trasportato dal dichiarante
      mudNum(r.te?.length ?? 0, 5), // nr moduli TE
      ...this.qtyUm(this.sommaQuantita(r.dr)), // consegnato a terzi
      mudNum(r.dr?.length ?? 0, 5), // nr moduli DR
      ...this.qtyUm(r.giacenzaRecuperoKg), // giacenza 31/12 a recupero
      ...this.qtyUm(r.giacenzaSmaltimentoKg), // giacenza 31/12 a smaltimento
      ...this.qtyUm(r.recuperoKg), // complessiva avviata a recupero
      ...this.qtyUm(r.smaltimentoKg), // complessiva avviata a smaltimento
    ])
  }

  /** Somma delle quantità di una lista di allegati. */
  protected sommaQuantita(items?: Array<{ quantitaKg: number }>): number {
    return (items ?? []).reduce((sum, i) => sum + (i.quantitaKg || 0), 0)
  }

  /** BB — Modulo DR: rifiuto conferito a terzi (310). */
  protected recordBB_DR(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    dr: MudAllegatoDR
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
      nazione: dr.nazione,
    })
  }

  /** BB — Modulo TE: trasportatore. Per i TE si valorizzano solo CF e ragione sociale. */
  protected recordBB_TE(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    te: MudAllegatoTE
  ): string {
    return this.recordBB(data, r, schedaProgr, 'TE', allegatoProgr, {
      cf: te.codiceFiscale,
      ragioneSociale: te.ragioneSociale,
    })
  }

  /** BB — Modulo RT: rifiuto ricevuto da terzi (profilo gestore). */
  protected recordBB_RT(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    rt: MudAllegatoRT
  ): string {
    return this.recordBB(data, r, schedaProgr, 'RT', allegatoProgr, {
      cf: rt.codiceFiscale,
      ragioneSociale: rt.ragioneSociale,
      istatProvincia: rt.istatProvincia,
      istatComune: rt.istatComune,
      indirizzo: rt.indirizzo,
      civico: rt.civico,
      cap: rt.cap,
      quantitaKg: rt.quantitaKg,
      ricevutoDaPrivati: rt.ricevutoDaPrivati,
      origineUrbana: rt.origineUrbana,
      pileAccumulatori: rt.pileAccumulatori,
    })
  }

  /** Costruisce un record BB generico per tipo allegato (RT/DR/TE), lunghezza 310. */
  protected recordBB(
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
      ricevutoDaPrivati?: boolean
      origineUrbana?: boolean
      pileAccumulatori?: boolean
      /** solo DR estero (A-W-05) */
      nazione?: string
    }
  ): string {
    return mudRecord('BB', [
      ...this.chiaveSchedaRif(data, r, schedaProgr),
      mudAlfa(tipo, 2), // tipo allegato
      mudNum(allegatoProgr, 5), // nr progressivo allegato
      mudCodiceFiscale(f.cf), // CF soggetto
      mudAlfa(f.ragioneSociale, 60),
      mudIstat(f.istatProvincia), // ISTAT provincia (DR/RT) — campo num 3
      mudIstat(f.istatComune), // ISTAT comune (DR/RT) — campo num 3
      mudAlfa(f.indirizzo ?? '', 30),
      mudAlfa(f.civico ?? '', 6),
      mudAlfa(f.cap ?? '', 5),
      ...this.qtyUm(f.quantitaKg), // quantità dichiarata
      mudAlfa(f.nazione ?? '', 20), // nome nazione (estero)
      mudAlfa('', 6), // codice reg. CEE 1013/2006
      mudFlag(f.ricevutoDaPrivati), // ricevuto da privati (solo RT)
      ...this.qtyUm(0), // altre op. smaltimento (estero)
      ...this.qtyUm(0), // recupero di materia (estero)
      ...this.qtyUm(0), // recupero di energia (estero)
      ...this.qtyUm(0), // incenerimento (estero)
      ...this.qtyUm(0), // discarica (estero)
      mudFlag(f.origineUrbana), // origine urbana (solo RT)
      mudFlag(f.pileAccumulatori), // pile e accumulatori portatili (solo RT)
    ])
  }

  /**
   * BC — Modulo RE: rifiuto prodotto fuori dall'unità locale (83).
   * Richiede un record BA precedente con la stessa chiave.
   */
  protected recordBC(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    re: MudAllegatoRE
  ): string {
    return mudRecord('BC', [
      ...this.chiaveSchedaRif(data, r, schedaProgr),
      mudNum(allegatoProgr, 5), // nr progressivo allegato
      mudIstat(re.istatProvincia),
      mudIstat(re.istatComune),
      mudNum(re.attivitaOrigine ?? 0, 1), // attività che ha originato il rifiuto
      ...this.qtyUm(re.quantitaKg),
    ])
  }

  /**
   * BD — Modulo MG, parte «operazioni di smaltimento» (245).
   *
   * Il modulo di gestione completo è la coppia BD + BE con lo stesso numero
   * progressivo di allegato: BE porta il recupero e le giacenze al 31/12.
   */
  protected recordBD(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    mg: MudModuloGestione
  ): string {
    const s = mg.smaltimento ?? {}
    return mudRecord('BD', [
      ...this.chiaveSchedaRif(data, r, schedaProgr),
      mudNum(allegatoProgr, 4), // nr progressivo allegato (4 cifre nel BD/BE)
      mudNum(mg.tipologiaImpianto ?? 0, 2), // tipologia di impianto
      mudFlag(mg.smaltimentoSuOrdinanza), // ordinanza sindacale art. 191
      mudNum(mg.classificazioneDiscarica ?? 0, 1), // classificazione discarica
      mudQty(mg.quantitaDiscaricaTon ?? 0), // depositata in discarica (tonnellate)
      // 12 operazioni di smaltimento, ciascuna con la propria unità di misura.
      ...SMALTIMENTO_ORDER.flatMap(op => this.qtyUm(s[op])),
    ])
  }

  /** BE — Modulo MG, parte «operazioni di recupero» + giacenze al 31/12 (268). */
  protected recordBE(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    mg: MudModuloGestione
  ): string {
    const rec = mg.recupero ?? {}
    return mudRecord('BE', [
      ...this.chiaveSchedaRif(data, r, schedaProgr),
      // Nel BE il progressivo allegato è tipizzato `alfa 4` dal tracciato, ma il
      // valore resta la stessa stringa numerica del BD a cui il record si lega.
      mudNum(allegatoProgr, 4),
      // 13 operazioni di recupero, ciascuna con la propria unità di misura.
      ...RECUPERO_ORDER.flatMap(op => this.qtyUm(rec[op])),
      ...this.qtyUm(mg.giacenzaRecuperoKg), // giacenza 31/12 da avviare a recupero
      ...this.qtyUm(mg.giacenzaSmaltimentoKg), // giacenza 31/12 da avviare a smaltimento
    ])
  }

  // ===================== Sezione intermediazione =====================

  /** DA — Scheda INT: rifiuti commercializzati e intermediati senza detenzione (93). */
  protected recordDA(data: MudExportData, int: MudIntermediazione, progressivo: number): string {
    return mudRecord('DA', [
      mudNum(data.year, 4),
      this.cfDichiarante(data),
      this.unitaLocale(data),
      mudNum(progressivo, 4), // nr progressivo scheda INT
      mudAlfa(normalizeCer(int.cerCode), 6), // CER (solo catalogo europeo)
      ...this.statoFisicoFlags(int.statoFisico), // 7 flag stato fisico
      ...this.qtyUm(int.quantitaIntermediataKg), // quantità complessivamente intermediata
      mudNum(int.uo?.length ?? 0, 5), // numero di moduli UO
      mudNum(int.ud?.length ?? 0, 5), // numero di moduli UD
    ])
  }

  /**
   * DB — Moduli UO/UD: unità locali di origine o destinazione del rifiuto (221).
   *
   * Il progressivo enumera i singoli soggetti di 1 in 1: la suddivisione in
   * pagine da tre soggetti del modello cartaceo non si riflette nell'export.
   */
  protected recordDB(
    data: MudExportData,
    int: MudIntermediazione,
    schedaProgr: number,
    tipo: 'UO' | 'UD',
    allegatoProgr: number,
    u: MudUnitaOrigineDestinazione
  ): string {
    return mudRecord('DB', [
      mudNum(data.year, 4),
      this.cfDichiarante(data),
      this.unitaLocale(data),
      mudNum(schedaProgr, 4), // nr progressivo scheda INT
      mudAlfa(normalizeCer(int.cerCode), 6),
      mudAlfa(tipo, 2), // tipo allegato UO / UD
      mudNum(allegatoProgr, 5), // nr progressivo allegato
      mudCodiceFiscale(u.codiceFiscale),
      mudAlfa(u.ragioneSociale, 60),
      mudIstat(u.istatProvincia), // ISTAT provincia — campo num 3
      mudIstat(u.istatComune), // ISTAT comune — campo num 3
      mudAlfa(u.indirizzo ?? '', 30),
      mudAlfa(u.civico ?? '', 6),
      mudAlfa(u.paeseEstero ?? '', 20), // solo se di origine non nazionale
      ...this.qtyUm(u.quantitaKg), // quantità acquisita / ceduta nell'anno
    ])
  }
}
