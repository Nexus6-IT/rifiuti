import { randomUUID } from 'crypto'

/**
 * Stato in memoria del servizio `vidimazione-formulari`
 * (`docs/contracts/rentri/vidimazione-formulari.yaml`, versione
 * 1.0.20260831-1024): deliberatamente in un file separato da `Archivio`
 * (`stato/archivio.ts`, dominio `formulari`) e da `Registri`
 * (`stato/registri.ts`, dominio `dati-registri`) — altri task lavorano in
 * parallelo su quei file, e questo dominio (blocchi virtuali + FIR vidimati)
 * non condivide stato con nessuno dei due.
 *
 * Vedi `docs/audits/rentri-vidimazione-e-qr-2026-09-10.md`: il servizio
 * esiste davvero (un audit precedente l'aveva erroneamente dichiarato
 * inesistente) e produce `qr_code_bytes` gia' firmato dall'ente — questa
 * fake non firma nulla, genera solo byte PLAUSIBILI (v. commento su
 * `generaQrCodeBytes`).
 */

/** `BloccoModel` semplificato: solo i campi che questa fake sa popolare. */
export interface BloccoRegistrato {
  codiceBlocco: string
  identificativoSoggetto: string
  numIscrSito?: string
  descrizione?: string
  disattivo: boolean
  dataCreazione: string
  dataUltimoUtilizzo?: string
}

/** `EfirModel`/`EfirPublicModel` semplificati: il FIR cosi' come vidimato. */
export interface FirVidimato {
  codiceBlocco: string
  progressivo: number
  numeroFir: string
  checkSum: string
  /** Base64, v. `generaQrCodeBytes`. */
  qrCodeBytes: string
  dataRichiesta: string
  utenteRichiesta?: string
  denominazioneUtenteRichiesta?: string
  denominazioneSoggetto?: string
  codiceFiscaleSoggetto?: string
  numIscrSito?: string
  isAnnullato: boolean
  dataAnnullamento?: string
  utenteAnnullamento?: string
}

export type StatoTransazioneVidimazione = 'in_elaborazione' | 'completata'

export interface EsitoTransazioneVidimazione {
  errore: boolean
  tipo?: string
  tempo_elaborazione?: string
  validazione?: unknown[]
  esito?: FirVidimato | null
}

export interface TransazioneVidimazione {
  id: string
  codiceBlocco: string
  stato: StatoTransazioneVidimazione
  esito?: EsitoTransazioneVidimazione
}

interface FiltroElencoBlocchi {
  identificativo: string
  numIscrSito?: string
  codiceBlocco?: string
  ancheDisattivi?: boolean
}

interface FiltroElencoFir {
  progressivoIniziale?: number
  progressivoFinale?: number
}

/**
 * Genera byte PLAUSIBILI per `qr_code_bytes` (`EfirModel.qr_code_bytes`,
 * `format: byte`, restituito Base64). Il contratto dichiara che il contenuto
 * reale e' un CBOR firmato COSE (RFC 8152): questa fake NON lo costruisce (la
 * firma e' dell'ente, non ne abbiamo la chiave, v. l'audit citato in testata)
 * — produce solo una sequenza di byte casuali di lunghezza plausibile,
 * sufficiente perche' il client la decodifichi da Base64 e la ricodifichi in
 * Base45 (catena verificata da `apps/backend/.../qr/`). Semplificazione
 * dichiarata, non un vero payload COSE/CBOR.
 */
function generaQrCodeBytes(): string {
  const bytes = Buffer.from(randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''), 'hex')
  return bytes.toString('base64')
}

/**
 * Checksum PLAUSIBILE per `numero_fir` ("concatenazione del codice di
 * blocco, il progressivo ed il checksum", descrizione di `EfirModel`): 4
 * caratteri alfanumerici derivati da un uuid. Il contratto non documenta
 * l'algoritmo reale (proprieta' dell'ente) — divergenza dichiarata.
 */
function generaCheckSum(): string {
  return randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()
}

export class Vidimazione {
  private blocchi = new Map<string, BloccoRegistrato>()
  private firPerBlocco = new Map<string, FirVidimato[]>()
  private transazioni = new Map<string, TransazioneVidimazione>()

  azzera(): void {
    this.blocchi.clear()
    this.firPerBlocco.clear()
    this.transazioni.clear()
  }

  // --- Canale di controllo -------------------------------------------------

  /**
   * I blocchi virtuali NON si creano tramite alcuna API di questo contratto
   * ("La creazione dei blocchi e' possibile solo nell'area web Operatori",
   * descrizione di `GET /`): senza questo canale nessun test potrebbe mai
   * raggiungere un `codice_blocco` "esistente" — stesso principio di
   * `Registri.registraRegistro`.
   */
  registraBlocco(
    codiceBlocco: string,
    identificativoSoggetto: string,
    opzioni?: { numIscrSito?: string; descrizione?: string; disattivo?: boolean }
  ): void {
    this.blocchi.set(codiceBlocco, {
      codiceBlocco,
      identificativoSoggetto,
      numIscrSito: opzioni?.numIscrSito,
      descrizione: opzioni?.descrizione,
      disattivo: opzioni?.disattivo ?? false,
      dataCreazione: new Date().toISOString(),
    })
  }

  bloccoConosciuto(codiceBlocco: string): boolean {
    return this.blocchi.has(codiceBlocco)
  }

  // --- Lettura blocchi -------------------------------------------------------

  elencaBlocchi(filtro: FiltroElencoBlocchi): BloccoRegistrato[] {
    return [...this.blocchi.values()].filter(b => {
      if (b.identificativoSoggetto !== filtro.identificativo) return false
      if (filtro.numIscrSito && b.numIscrSito !== filtro.numIscrSito) return false
      if (filtro.codiceBlocco && b.codiceBlocco !== filtro.codiceBlocco) return false
      if (!filtro.ancheDisattivi && b.disattivo) return false
      return true
    })
  }

  // --- Vidimazione (async, NONBLOCK_PULL) -----------------------------------

  creaTransazioneVidimazione(codiceBlocco: string): string {
    const id = randomUUID()
    this.transazioni.set(id, { id, codiceBlocco, stato: 'in_elaborazione' })
    return id
  }

  leggiTransazione(id: string): TransazioneVidimazione | undefined {
    return this.transazioni.get(id)
  }

  /**
   * Completa la transazione. Su esito positivo (`errore: false` e nessun
   * `esito` fornito dal canale di controllo) vidima DAVVERO un nuovo FIR sul
   * blocco: assegna il prossimo `progressivo`, genera `numero_fir`,
   * `check_sum` e `qr_code_bytes` (v. `generaQrCodeBytes`) e aggiorna
   * `numero_fir_vidimati`/`data_ultimo_utilizzo` del blocco — stesso
   * principio di `Registri.completaTransazione` per `Movimenti`.
   */
  completaTransazione(
    id: string,
    esito: {
      errore: boolean
      tipo?: string
      tempo_elaborazione?: string
      validazione?: unknown[]
      esito?: Partial<FirVidimato>
      soggetto?: string
    }
  ): void {
    const transazione = this.transazioni.get(id)
    if (!transazione) return
    transazione.stato = 'completata'

    if (esito.errore) {
      transazione.esito = {
        errore: true,
        tipo: esito.tipo,
        tempo_elaborazione: esito.tempo_elaborazione,
        validazione: esito.validazione ?? [],
        esito: null,
      }
      return
    }

    const blocco = this.blocchi.get(transazione.codiceBlocco)
    const elenco = this.firPerBlocco.get(transazione.codiceBlocco) ?? []
    const progressivo = elenco.length + 1
    const checkSum = esito.esito?.checkSum ?? generaCheckSum()
    const numeroFir =
      esito.esito?.numeroFir ??
      `${transazione.codiceBlocco}${String(progressivo).padStart(6, '0')}${checkSum}`

    const fir: FirVidimato = {
      codiceBlocco: transazione.codiceBlocco,
      progressivo,
      numeroFir,
      checkSum,
      qrCodeBytes: esito.esito?.qrCodeBytes ?? generaQrCodeBytes(),
      dataRichiesta: new Date().toISOString(),
      utenteRichiesta: esito.soggetto,
      denominazioneUtenteRichiesta: esito.esito?.denominazioneUtenteRichiesta,
      denominazioneSoggetto: esito.esito?.denominazioneSoggetto,
      codiceFiscaleSoggetto: esito.esito?.codiceFiscaleSoggetto ?? blocco?.identificativoSoggetto,
      numIscrSito: esito.esito?.numIscrSito ?? blocco?.numIscrSito,
      isAnnullato: false,
    }

    elenco.push(fir)
    this.firPerBlocco.set(transazione.codiceBlocco, elenco)

    if (blocco) {
      blocco.dataUltimoUtilizzo = fir.dataRichiesta
    }

    transazione.esito = {
      errore: false,
      tipo: esito.tipo,
      tempo_elaborazione: esito.tempo_elaborazione,
      validazione: esito.validazione ?? [],
      esito: fir,
    }
  }

  // --- Lettura FIR vidimati --------------------------------------------------

  elencaFir(codiceBlocco: string, filtro: FiltroElencoFir): FirVidimato[] {
    return (this.firPerBlocco.get(codiceBlocco) ?? []).filter(f => {
      if (filtro.progressivoIniziale !== undefined && f.progressivo < filtro.progressivoIniziale) {
        return false
      }
      if (filtro.progressivoFinale !== undefined && f.progressivo > filtro.progressivoFinale) {
        return false
      }
      return true
    })
  }

  firPerProgressivo(codiceBlocco: string, progressivo: number): FirVidimato | undefined {
    return (this.firPerBlocco.get(codiceBlocco) ?? []).find(f => f.progressivo === progressivo)
  }

  /** `GET /verifica/{numero_fir}`: cerca su TUTTI i blocchi, non solo uno. */
  firPerNumero(numeroFir: string): FirVidimato | undefined {
    for (const elenco of this.firPerBlocco.values()) {
      const trovato = elenco.find(f => f.numeroFir === numeroFir)
      if (trovato) return trovato
    }
    return undefined
  }

  annullaFir(
    codiceBlocco: string,
    progressivo: number
  ): 'annullato' | 'non-trovato' | 'gia-annullato' {
    const fir = this.firPerProgressivo(codiceBlocco, progressivo)
    if (!fir) return 'non-trovato'
    if (fir.isAnnullato) return 'gia-annullato'
    fir.isAnnullato = true
    fir.dataAnnullamento = new Date().toISOString()
    return 'annullato'
  }
}
