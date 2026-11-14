/**
 * Fase 3 (3.1), D5: ciclo di vita di un lotto di import. Tutto passa dal client APPLICATIVO dentro
 * `TenantContext.run({ tenantId })` (RLS ENABLE+FORCE): il motore non usa mai `PrismaSistemaService`.
 *
 * Log: solo id tecnici e conteggi, mai valori delle righe (dati personali).
 */
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { LoggerService } from '../../../core/logger/logger.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { LottoGiaInCorsoError, LottoNonInCorsoError } from './errori'
import { AvviaLotto, CONTEGGI_VUOTI, ConteggiLotto, LottoCreato, Tx } from './tipi'

const LUNGHEZZA_ERRORE = 1000

@Injectable()
export class LottiImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('LottiImportService')
  }

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  /**
   * Apre un lotto `IN_CORSO`.
   * @throws LottoGiaInCorsoError se ce n'e' gia' uno per (azienda, archivio, ambito): due `avvia`
   *   concorrenti non possono avere entrambi successo (indice unico parziale `lotti_import_in_corso_key`).
   */
  async avvia(tenantId: string, dati: AvviaLotto): Promise<LottoCreato> {
    try {
      const lotto = await this.nelTenant(tenantId, tx =>
        tx.lottoImport.create({
          data: {
            tenantId,
            importSource: dati.importSource,
            archivio: dati.archivio,
            ambito: dati.ambito,
            formatoStaging: dati.formatoStaging,
            hashStaging: dati.hashStaging,
            avviatoDa: dati.avviatoDa ?? null,
            conteggi: { ...CONTEGGI_VUOTI },
          },
          select: { id: true, stato: true },
        })
      )
      this.logger.info('Lotto di import avviato', {
        tenantId,
        lottoId: lotto.id,
        ambito: dati.ambito,
      })
      return lotto
    } catch (errore) {
      if (errore instanceof Prisma.PrismaClientKnownRequestError && errore.code === 'P2002') {
        throw new LottoGiaInCorsoError(dati.archivio, dati.ambito)
      }
      throw errore
    }
  }

  /**
   * Somma i conteggi di un blocco, NELLA STESSA transazione del blocco: se il blocco torna indietro
   * tornano indietro anche i conteggi.
   */
  async registraBlocco(
    tx: Tx,
    tenantId: string,
    lottoId: string,
    blocco: { lette: number; inserite: number; saltate: number; scartate?: number }
  ): Promise<ConteggiLotto> {
    // FOR UPDATE: due caricatori sullo stesso lotto si accodano invece di perdere aggiornamenti.
    const righe = await tx.$queryRaw<Array<{ conteggi: unknown }>>`
      SELECT "conteggi" FROM "lotti_import"
      WHERE "id" = ${lottoId}::uuid AND "tenant_id" = ${tenantId}::uuid AND "stato" = 'IN_CORSO'
      FOR UPDATE`
    if (righe.length === 0) throw new LottoNonInCorsoError(lottoId)
    const c = { ...CONTEGGI_VUOTI, ...(righe[0].conteggi as Partial<ConteggiLotto>) }
    const nuovi: ConteggiLotto = {
      lette: c.lette + blocco.lette,
      inserite: c.inserite + blocco.inserite,
      saltate: c.saltate + blocco.saltate,
      scartate: c.scartate + (blocco.scartate ?? 0),
      blocchi: c.blocchi + 1,
    }
    await tx.lottoImport.updateMany({
      where: { id: lottoId, tenantId, stato: 'IN_CORSO' },
      data: { conteggi: nuovi as unknown as Prisma.InputJsonValue },
    })
    return nuovi
  }

  /** `IN_CORSO` -> `COMPLETATO`. */
  async completa(tenantId: string, lottoId: string): Promise<void> {
    await this.nelTenant(tenantId, async tx => {
      const r = await tx.lottoImport.updateMany({
        where: { id: lottoId, tenantId, stato: 'IN_CORSO' },
        data: { stato: 'COMPLETATO', conclusoIl: new Date() },
      })
      if (r.count !== 1) throw new LottoNonInCorsoError(lottoId)
    })
    this.logger.info('Lotto di import completato', { tenantId, lottoId })
  }

  /** `IN_CORSO` -> `FALLITO`, con l'errore (senza valori delle righe). */
  async fallisci(tenantId: string, lottoId: string, errore: string): Promise<void> {
    await this.nelTenant(tenantId, tx =>
      tx.lottoImport.updateMany({
        where: { id: lottoId, tenantId, stato: 'IN_CORSO' },
        data: {
          stato: 'FALLITO',
          errore: errore.slice(0, LUNGHEZZA_ERRORE),
          conclusoIl: new Date(),
        },
      })
    )
    this.logger.warn('Lotto di import fallito', { tenantId, lottoId })
  }

  /** Lettura nel contesto dell'azienda (per i chiamanti e per i test). */
  async leggi(tenantId: string, lottoId: string) {
    return await this.nelTenant(tenantId, tx =>
      tx.lottoImport.findFirst({ where: { id: lottoId, tenantId } })
    )
  }
}
