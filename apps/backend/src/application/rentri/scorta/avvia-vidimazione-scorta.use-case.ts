import { Injectable, NotFoundException } from '@nestjs/common'
import {
  RentriVidimazioneClient,
  BloccoModel,
} from '../../../infrastructure/rentri/rentri-vidimazione.client'
import { RentriScortaRepository } from '../../../infrastructure/persistence/rentri-scorta.repository'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { risolviCfTenant } from './risolvi-cf-tenant'

export interface EsitoAvvioVidimazioneScorta {
  richiesti: number
  riusciti: number
  falliti: number
}

/**
 * Avvia (e attende, uno alla volta) la vidimazione di un lotto di numeri sul
 * blocco indicato, rifornendo la scorta (R6). Usato sia da
 * `POST /rentri/scorta/vidima` (in "fire and forget": il controller non
 * attende questa promise, restituisce subito 202 — la vidimazione NON è
 * immediata, v. `docs/audits/rentri-blocchi-come-fanno-gli-altri-2026-09-11.md`)
 * sia da `RentriRifornimentoScortaJob` (che invece attende, essendo già in
 * background).
 *
 * Un numero alla volta, non in parallelo: il contratto `vidimazione-formulari`
 * vidima UN FIR per chiamata (`POST /{codice_blocco}`, nessun parametro
 * quantità) — "quantità" è nostro, un ciclo su questa singola operazione.
 *
 * **Isolamento per numero**: un fallimento (rete, esito con `errore: true`)
 * NON interrompe gli altri del lotto — stesso principio già in uso in
 * `RentriRiconciliazioneJob` (isolamento per tenant): un ente lento o
 * intermittente non deve azzerare un intero rifornimento programmato.
 *
 * **Fail-closed sul `codiceBlocco`, PRIMA di scrivere**: `POST
 * /rentri/scorta/vidima` prende `codiceBlocco` dal corpo della richiesta,
 * scelto dal chiamante — non da un elenco già validato come in
 * `ImpostaBloccoPredefinitoUseCase` (che lo risolve sempre da `GET
 * /rentri/blocchi`). Senza una verifica preventiva qui, un `codiceBlocco`
 * inventato o di un'altra sede finirebbe comunque a `vidimaFir`, che lo gira
 * all'ente: l'ente resta il vero backstop, ma questo use case scriverebbe
 * (o proverebbe a scrivere) prima di sapere se il blocco esiste per questo
 * operatore. Stessa regola di `ImpostaBloccoPredefinitoUseCase`: si
 * interroga `elencaBlocchi` per quel `codiceBlocco` e si rifiuta con 404 se
 * non risulta, PRIMA di qualunque chiamata a `vidimaFir`.
 *
 * Questa verifica è esposta anche come metodo pubblico separato,
 * {@link AvviaVidimazioneScortaUseCase.verificaBlocco}: il controller la
 * `await`a PRIMA di rispondere 202, cosa che `execute` da solo non permette
 * di fare in "fire and forget" (un `NotFoundException` lanciato dentro una
 * promise non attesa muore in un `.catch(log)`, invisibile al chiamante —
 * il difetto corretto qui). Il ciclo di vidimazione vero e proprio resta
 * "avvia e dimentica": solo l'esito della verifica risale al chiamante come
 * errore reale.
 *
 * **Blocco inesistente vs. ente irraggiungibile — NON sono lo stesso esito.**
 * Un `codiceBlocco` confermato assente nella risposta dell'ente è un
 * rifiuto DEFINITIVO (404, fail-closed, non si scrive). Un errore nel
 * *contattare* l'ente (rete, timeout, 5xx) durante questa verifica è
 * TRANSITORIO: non possiamo affermare né negare che il blocco esista. In
 * questo caso NON si rifiuta la richiesta — si prosegue con il ciclo di
 * vidimazione, che isola per-numero (v. sopra) esattamente come faceva
 * prima che questa verifica preventiva esistesse: se l'ente è davvero
 * irraggiungibile, ogni chiamata a `vidimaFir` fallirà a sua volta e verrà
 * contata in `falliti`. Trattare un guasto transitorio come un rifiuto
 * definitivo (o peggio, come nella regressione corretta qui, farlo morire
 * in un log dentro un fire-and-forget) sarebbe più fail-closed di quanto
 * serva e, nel caso fire-and-forget, silenzioso — il progetto vuole
 * fail-closed sulle scritture, non il silenzio sui guasti di rete.
 */
@Injectable()
export class AvviaVidimazioneScortaUseCase {
  constructor(
    private readonly vidimazioneClient: RentriVidimazioneClient,
    private readonly scortaRepo: RentriScortaRepository,
    private readonly logger: LoggerService,
    private readonly prisma: PrismaService
  ) {
    this.logger.setContext('AvviaVidimazioneScortaUseCase')
  }

  /**
   * Verifica preventiva del `codiceBlocco`, PRIMA di scrivere.
   *
   * Rifiuta con `NotFoundException` (rifiuto definitivo, fail-closed) solo
   * se l'ente RISPONDE e il blocco non risulta nell'elenco. Se l'ente non
   * risponde (errore di comunicazione, condizione transitoria), NON
   * rifiuta: si limita a loggare e a restituire, lasciando che sia il
   * ciclo di vidimazione a scoprire — e contare come `falliti` — un ente
   * davvero irraggiungibile, come faceva prima di questa verifica.
   *
   * Chiamato sia dal controller (atteso, PRIMA del 202) sia da `execute`
   * stesso (per chi lo invoca direttamente, come `RentriRifornimentoScortaJob`).
   */
  async verificaBlocco(tenantId: string, codiceBlocco: string): Promise<void> {
    const cf = await risolviCfTenant(this.prisma, tenantId)

    let risultati: BloccoModel[]
    try {
      ;({ risultati } = await this.vidimazioneClient.elencaBlocchi(
        cf,
        { codiceBlocco, ancheDisattivi: true },
        tenantId
      ))
    } catch (error: unknown) {
      this.logger.warn(
        'Verifica preventiva del blocco RENTRI non riuscita per un errore di comunicazione con l’ente ' +
          '(condizione transitoria): si procede comunque con la vidimazione, sarà il ciclo per-numero a ' +
          'rilevare ed a contare un ente davvero irraggiungibile',
        {
          tenantId,
          codiceBlocco,
          errore: error instanceof Error ? error.message : String(error),
        }
      )
      return
    }

    const blocco = risultati.find(b => b.codice_blocco === codiceBlocco)
    if (!blocco) {
      throw new NotFoundException(
        `Nessun blocco virtuale RENTRI con codice ${codiceBlocco} trovato per questo operatore.`
      )
    }
  }

  async execute(
    tenantId: string,
    codiceBlocco: string,
    quantita: number
  ): Promise<EsitoAvvioVidimazioneScorta> {
    await this.verificaBlocco(tenantId, codiceBlocco)

    let riusciti = 0
    let falliti = 0

    for (let i = 0; i < quantita; i++) {
      try {
        const { transazioneId } = await this.vidimazioneClient.vidimaFir(
          codiceBlocco,
          undefined,
          tenantId
        )
        const esito = await this.vidimazioneClient.attendiEsitoVidimazione(
          transazioneId,
          undefined,
          tenantId
        )

        if (esito.errore || !esito.esito) {
          falliti++
          this.logger.warn('Vidimazione RENTRI rifiutata dall’ente', {
            tenantId,
            codiceBlocco,
            transazioneId,
          })
          continue
        }

        const { esito: efir } = esito
        if (!efir.numero_fir || !efir.qr_code_bytes || !efir.num_iscr_sito) {
          falliti++
          this.logger.error(
            'Esito di vidimazione RENTRI privo di campi obbligatori (numero_fir/qr_code_bytes/num_iscr_sito)',
            new Error('Esito vidimazione incompleto'),
            { tenantId, codiceBlocco, transazioneId }
          )
          continue
        }

        await this.scortaRepo.inserisciDisponibile(tenantId, {
          numIscrSito: efir.num_iscr_sito,
          codiceBlocco,
          progressivo: efir.progressivo,
          numeroFir: efir.numero_fir,
          qrCodeBytes: efir.qr_code_bytes,
          dataVidimazione: new Date(efir.data_richiesta),
        })
        riusciti++
      } catch (error: unknown) {
        falliti++
        this.logger.error(
          'Vidimazione RENTRI non riuscita per un numero del lotto, si prosegue con gli altri',
          error instanceof Error ? error : new Error(String(error)),
          { tenantId, codiceBlocco }
        )
      }
    }

    this.logger.info('Rifornimento scorta RENTRI completato', {
      tenantId,
      codiceBlocco,
      richiesti: quantita,
      riusciti,
      falliti,
    })

    return { richiesti: quantita, riusciti, falliti }
  }
}
