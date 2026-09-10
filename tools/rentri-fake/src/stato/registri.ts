import { randomUUID } from 'crypto'
import { generaIdentificativoMovimento } from '../dominio/identificativo-movimento'

/** `EsitoMessaggioModel` (dati-registri.yaml, stessa forma di quello di `archivio.ts`). */
export interface EsitoMessaggio {
  indice?: number
  campo?: string
  tipo: 'Errore' | 'Avvertimento'
  codice_messaggio?: string
  parametri?: unknown[]
}

/** `numero_registrazione`/`numero_registrazione_di_rettifica`/`numero_registrazione_rettifica`. */
export interface NumeroRegistrazione {
  anno?: number
  progressivo?: number
  identificativo?: string
}

/**
 * Una registrazione accettata su un Registro (`DatiMovimentoModel`/
 * `MovimentoDettaglioModel`, semplificati): `anno`/`progressivo` sono la
 * numerazione del CHIAMANTE (`AnnoProgressivoMovimentoModel`, obbligatoria sia
 * su `MovimentoModel.riferimenti.numero_registrazione` che su
 * `AnnullamentoMovimentoModel.numero_registrazione`); `identificativo` e'
 * invece assegnato dal RENTRI (v. `dominio/identificativo-movimento.ts`).
 */
export interface MovimentoRegistrato {
  identificativo: string
  anno: number
  progressivo: number
  dataOraRegistrazione: string
  dataCreazione: string
  dataTrasmissione: string
  annullato: boolean
  rettificato: boolean
  /** Valorizzato sulla registrazione ORIGINALE quando una successiva la rettifica/annulla. */
  numeroRegistrazioneDiRettifica?: NumeroRegistrazione
  /** Valorizzato sulla registrazione DI RETTIFICA/ANNULLAMENTO: chi ha rettificato. */
  numeroRegistrazioneRettifica?: NumeroRegistrazione
  /** Corpo originale (`MovimentoModel` o `AnnullamentoMovimentoModel`) cosi' come trasmesso. */
  corpo: Record<string, unknown>
}

export type StatoTransazioneRegistri = 'in_elaborazione' | 'completata'

export interface EsitoTransazioneRegistri {
  tipo?: string
  validazione: EsitoMessaggio[]
  errore: boolean
  tempo_elaborazione?: string
  esito?: unknown
}

type ContestoTransazioneRegistri =
  | { tipo: 'Movimenti'; identificativoRegistro: string; corpo: Record<string, unknown>[] }
  | { tipo: 'ValidaRegistro'; identificativoRegistro: string; richiesta: Record<string, unknown> }

export interface TransazioneRegistri {
  id: string
  stato: StatoTransazioneRegistri
  esito?: EsitoTransazioneRegistri
  contesto: ContestoTransazioneRegistri
}

/**
 * Filtro applicato da {@link Registri.elenca}/{@link Registri.conta}.
 *
 * **Divergenza dichiarata**: il contratto (dati-registri.yaml righe 254-371)
 * dichiara molti altri filtri (`causali_operazione`, `codice_eer`,
 * `data_registrazione_da/a`, `stato_fisico`, ...). Nessun test di questo
 * programma li esercita: applicarli senza un caso che li verifichi
 * rischierebbe di introdurre una regola mai controllata (stesso principio
 * dichiarato in `Archivio.elencaTrasmissioniDati`).
 */
export interface FiltroMovimenti {
  identificativiMovimento?: string[]
  anno?: number
  progressivo?: number
  annullato?: boolean
  rettificato?: boolean
}

/**
 * Stato in memoria dei servizi `dati-registri` (registro cronologico digitale
 * di carico e scarico, R6): deliberatamente in un file separato da
 * `Archivio` (`stato/archivio.ts`, di dominio `formulari`) — un altro task
 * lavora in parallelo su quel file, e i due domini (Registro vs FIR) non
 * condividono alcuno stato.
 */
export class Registri {
  private registriConosciuti = new Set<string>()
  private movimentiPerRegistro = new Map<string, MovimentoRegistrato[]>()
  private transazioni = new Map<string, TransazioneRegistri>()
  /** Ultima transazione di trasmissione movimenti per registro (`last-transazione-id`). */
  private ultimaTransazioneMovimenti = new Map<string, string>()

  azzera(): void {
    this.registriConosciuti.clear()
    this.movimentiPerRegistro.clear()
    this.transazioni.clear()
    this.ultimaTransazioneMovimenti.clear()
  }

  /**
   * Canale di controllo (`/__controllo/dati-registri/registro`): il registro
   * non si apre tramite alcuna API di questo contratto (v. commento di
   * `dominio/identificativo-registro.ts`), quindi senza questo canale nessun
   * test potrebbe mai raggiungere un `identificativo_registro` "esistente".
   */
  registraRegistro(identificativoRegistro: string): void {
    this.registriConosciuti.add(identificativoRegistro)
  }

  registroConosciuto(identificativoRegistro: string): boolean {
    return this.registriConosciuti.has(identificativoRegistro)
  }

  creaTransazioneMovimenti(
    identificativoRegistro: string,
    corpo: Record<string, unknown>[]
  ): string {
    const id = randomUUID()
    this.transazioni.set(id, {
      id,
      stato: 'in_elaborazione',
      contesto: { tipo: 'Movimenti', identificativoRegistro, corpo },
    })
    this.ultimaTransazioneMovimenti.set(identificativoRegistro, id)
    return id
  }

  creaTransazioneValidaRegistro(
    identificativoRegistro: string,
    richiesta: Record<string, unknown>
  ): string {
    const id = randomUUID()
    this.transazioni.set(id, {
      id,
      stato: 'in_elaborazione',
      contesto: { tipo: 'ValidaRegistro', identificativoRegistro, richiesta },
    })
    return id
  }

  leggiTransazione(id: string): TransazioneRegistri | undefined {
    return this.transazioni.get(id)
  }

  /** `GET /{identificativo_registro}/last-transazione-id`: `undefined` se nessuna trasmissione e' mai stata inviata. */
  ultimaTransazioneMovimentiDi(identificativoRegistro: string): string | undefined {
    return this.ultimaTransazioneMovimenti.get(identificativoRegistro)
  }

  /**
   * Completa la transazione. Per `Movimenti` con esito positivo, applica
   * DAVVERO le registrazioni (v. {@link applicaMovimenti}) e costruisce
   * `EsitoMovimentiDataModel.numero_registrazioni` se il chiamante del canale
   * di controllo non ne ha fornito uno proprio. Per `ValidaRegistro` (e per
   * `Movimenti` con `errore: true`) l'`esito` e' quello passato dal canale di
   * controllo, senza alcuna elaborazione: la fake non implementa la
   * validazione XSD/XML reale (fuori scope dichiarato, v. `routes/dati-registri.ts`).
   */
  completaTransazione(
    id: string,
    esito: {
      errore: boolean
      validazione?: EsitoMessaggio[]
      tipo?: string
      tempo_elaborazione?: string
      esito?: unknown
    }
  ): void {
    const transazione = this.transazioni.get(id)
    if (!transazione) return
    transazione.stato = 'completata'

    if (!esito.errore && transazione.contesto.tipo === 'Movimenti' && esito.esito === undefined) {
      const numeroRegistrazioni = this.applicaMovimenti(
        transazione.contesto.identificativoRegistro,
        transazione.contesto.corpo
      )
      transazione.esito = {
        errore: false,
        validazione: esito.validazione ?? [],
        tipo: esito.tipo,
        tempo_elaborazione: esito.tempo_elaborazione,
        esito: {
          identificativo_registro: transazione.contesto.identificativoRegistro,
          numero_registrazioni: numeroRegistrazioni,
        },
      }
      return
    }

    transazione.esito = {
      errore: esito.errore,
      validazione: esito.validazione ?? [],
      tipo: esito.tipo,
      tempo_elaborazione: esito.tempo_elaborazione,
      esito: esito.esito,
    }
  }

  /**
   * Applica DAVVERO le registrazioni trasmesse (chiamata solo da
   * {@link completaTransazione} su esito positivo): assegna un
   * `identificativo` a ciascuna, e se `riferimenti.numero_registrazione_rettifica`
   * (per un `MovimentoModel`, cioe' una RETTIFICA) o
   * `numero_registrazione_annullata` (per un `AnnullamentoMovimentoModel`,
   * cioe' un ANNULLAMENTO) referenzia una registrazione gia' nota, la marca
   * di conseguenza (`rettificato`/`annullato`) e le collega tramite
   * `numero_registrazione_di_rettifica`/`numero_registrazione_rettifica` — lo
   * stesso incrocio bidirezionale descritto dal contratto per `GET /movimenti`
   * e `GET /movimento/...`.
   *
   * Un riferimento che non trova corrispondenza viene ignorato silenziosamente
   * (la registrazione di rettifica/annullamento viene comunque registrata):
   * la fake non replica qui la validazione "numero_registrazione_rettifica
   * inesistente" del RENTRI reale, che il canale di controllo puo' comunque
   * simulare con `errore: true`.
   */
  private applicaMovimenti(
    identificativoRegistro: string,
    corpo: Record<string, unknown>[]
  ): { anno: number; progressivo: number; identificativo: string }[] {
    const elenco = this.movimentiPerRegistro.get(identificativoRegistro) ?? []
    const risultati: { anno: number; progressivo: number; identificativo: string }[] = []
    const ora = new Date().toISOString()

    for (const item of corpo) {
      const identificativo = generaIdentificativoMovimento()

      if ('numero_registrazione_annullata' in item) {
        const numeroRegistrazione = item.numero_registrazione as {
          anno: number
          progressivo: number
        }
        const bersaglio = this.trovaMovimento(
          elenco,
          item.numero_registrazione_annullata as Record<string, unknown>
        )
        if (bersaglio) {
          bersaglio.annullato = true
          bersaglio.numeroRegistrazioneDiRettifica = {
            anno: numeroRegistrazione.anno,
            progressivo: numeroRegistrazione.progressivo,
            identificativo,
          }
        }

        elenco.push({
          identificativo,
          anno: numeroRegistrazione.anno,
          progressivo: numeroRegistrazione.progressivo,
          dataOraRegistrazione: (item.data_ora_registrazione as string) ?? ora,
          dataCreazione: ora,
          dataTrasmissione: ora,
          annullato: false,
          rettificato: false,
          corpo: item,
        })
      } else {
        const riferimenti = (item.riferimenti ?? {}) as Record<string, unknown>
        const numeroRegistrazione = riferimenti.numero_registrazione as {
          anno: number
          progressivo: number
        }
        const numeroRegistrazioneRettifica = riferimenti.numero_registrazione_rettifica as
          | Record<string, unknown>
          | undefined

        if (numeroRegistrazioneRettifica) {
          const bersaglio = this.trovaMovimento(elenco, numeroRegistrazioneRettifica)
          if (bersaglio) {
            bersaglio.rettificato = true
            bersaglio.numeroRegistrazioneDiRettifica = {
              anno: numeroRegistrazione.anno,
              progressivo: numeroRegistrazione.progressivo,
              identificativo,
            }
          }
        }

        elenco.push({
          identificativo,
          anno: numeroRegistrazione.anno,
          progressivo: numeroRegistrazione.progressivo,
          dataOraRegistrazione: (riferimenti.data_ora_registrazione as string) ?? ora,
          dataCreazione: ora,
          dataTrasmissione: ora,
          annullato: false,
          rettificato: false,
          numeroRegistrazioneRettifica: numeroRegistrazioneRettifica
            ? {
                anno: numeroRegistrazioneRettifica.anno as number | undefined,
                progressivo: numeroRegistrazioneRettifica.progressivo as number | undefined,
                identificativo: numeroRegistrazioneRettifica.identificativo as string | undefined,
              }
            : undefined,
          corpo: item,
        })
      }

      const registrato = elenco[elenco.length - 1]
      risultati.push({
        anno: registrato.anno,
        progressivo: registrato.progressivo,
        identificativo,
      })
    }

    this.movimentiPerRegistro.set(identificativoRegistro, elenco)
    return risultati
  }

  private trovaMovimento(
    elenco: MovimentoRegistrato[],
    riferimento: Record<string, unknown>
  ): MovimentoRegistrato | undefined {
    if (typeof riferimento.identificativo === 'string') {
      return elenco.find(m => m.identificativo === riferimento.identificativo)
    }
    if (typeof riferimento.anno === 'number' && typeof riferimento.progressivo === 'number') {
      return elenco.find(
        m => m.anno === riferimento.anno && m.progressivo === riferimento.progressivo
      )
    }
    return undefined
  }

  private movimentiFiltrati(
    identificativoRegistro: string,
    filtro?: FiltroMovimenti
  ): MovimentoRegistrato[] {
    const elenco = this.movimentiPerRegistro.get(identificativoRegistro) ?? []
    if (!filtro) return elenco

    return elenco.filter(m => {
      if (
        filtro.identificativiMovimento &&
        !filtro.identificativiMovimento.includes(m.identificativo)
      ) {
        return false
      }
      if (filtro.anno !== undefined && m.anno !== filtro.anno) return false
      if (filtro.progressivo !== undefined && m.progressivo !== filtro.progressivo) return false
      if (filtro.annullato !== undefined && m.annullato !== filtro.annullato) return false
      if (filtro.rettificato !== undefined && m.rettificato !== filtro.rettificato) return false
      return true
    })
  }

  /** `GET /operatore/{identificativo_registro}/movimenti`. */
  elenca(identificativoRegistro: string, filtro?: FiltroMovimenti): MovimentoRegistrato[] {
    return this.movimentiFiltrati(identificativoRegistro, filtro)
  }

  /** `GET /operatore/{identificativo_registro}/movimenti/count`. */
  conta(identificativoRegistro: string, filtro?: FiltroMovimenti): number {
    return this.movimentiFiltrati(identificativoRegistro, filtro).length
  }

  /** `GET /operatore/{identificativo_registro}/movimento/{anno}/{progressivo}` (stato corrente). */
  dettaglioPerAnnoProgressivo(
    identificativoRegistro: string,
    anno: number,
    progressivo: number
  ): MovimentoRegistrato | undefined {
    return this.movimentiPerRegistro
      .get(identificativoRegistro)
      ?.find(m => m.anno === anno && m.progressivo === progressivo)
  }

  /** `GET /operatore/{identificativo_registro}/movimento/{identificativo_movimento}`. */
  dettaglioPerIdentificativo(
    identificativoRegistro: string,
    identificativo: string
  ): MovimentoRegistrato | undefined {
    return this.movimentiPerRegistro
      .get(identificativoRegistro)
      ?.find(m => m.identificativo === identificativo)
  }

  /**
   * `variazioni` (query `?variazioni=true`, default): le registrazioni che
   * hanno rettificato/annullato quella indicata — individuate qui, invece che
   * mantenute come array denormalizzato su ciascuna riga, cosi' la catena
   * resta sempre coerente con `numeroRegistrazioneDiRettifica`.
   */
  variazioniDi(
    identificativoRegistro: string,
    bersaglio: MovimentoRegistrato
  ): MovimentoRegistrato[] {
    const elenco = this.movimentiPerRegistro.get(identificativoRegistro) ?? []
    if (!bersaglio.numeroRegistrazioneDiRettifica) return []
    return elenco.filter(
      m =>
        m.identificativo === bersaglio.numeroRegistrazioneDiRettifica?.identificativo ||
        (m.anno === bersaglio.numeroRegistrazioneDiRettifica?.anno &&
          m.progressivo === bersaglio.numeroRegistrazioneDiRettifica?.progressivo)
    )
  }
}
