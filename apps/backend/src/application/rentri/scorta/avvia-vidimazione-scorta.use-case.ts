import { Injectable, NotFoundException } from '@nestjs/common'
import { RentriVidimazioneClient } from '../../../infrastructure/rentri/rentri-vidimazione.client'
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

  async execute(
    tenantId: string,
    codiceBlocco: string,
    quantita: number
  ): Promise<EsitoAvvioVidimazioneScorta> {
    const cf = await risolviCfTenant(this.prisma, tenantId)
    const { risultati } = await this.vidimazioneClient.elencaBlocchi(
      cf,
      { codiceBlocco, ancheDisattivi: true },
      tenantId
    )
    const blocco = risultati.find(b => b.codice_blocco === codiceBlocco)

    if (!blocco) {
      throw new NotFoundException(
        `Nessun blocco virtuale RENTRI con codice ${codiceBlocco} trovato per questo operatore.`
      )
    }

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
