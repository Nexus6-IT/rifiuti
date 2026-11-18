/**
 * PrismaSistemaService — client Prisma per i job di sistema.
 *
 * Si collega con `DATABASE_URL_SISTEMA`, cioe' al ruolo DB `wasteflow_sistema`
 * (BYPASSRLS, creato da prisma/sql/ruoli-db.sql). Serve ai job che devono
 * leggere/scrivere oltre i confini di un tenant: l'applicazione normale usa
 * invece `PrismaService` (ruolo `wasteflow_app`, soggetto a RLS).
 *
 * Se `DATABASE_URL_SISTEMA` manca (ambienti senza ruoli DB) ripiega su
 * `DATABASE_URL` e lo dice con un warn, una volta sola. L'URL contiene la
 * password: non va MAI nei log.
 *
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import type * as runtime from '@prisma/client/runtime/library'
import { conVincoliChiusi } from './prisma-tenant-transazione'
import { risolviUrlSistema } from './url-sistema'

@Injectable()
export class PrismaSistemaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaSistemaService.name)

  constructor() {
    const { url, fallback } = risolviUrlSistema()
    // Senza URL (test, ambienti non configurati) lascia decidere a Prisma:
    // fallira' alla prima query, non alla costruzione.
    super(url ? { datasources: { db: { url } } } : undefined)
    if (fallback) {
      this.logger.warn(
        "DATABASE_URL_SISTEMA assente: il client di sistema usa la connessione dell'applicazione"
      )
    }
  }

  /**
   * Come il client applicativo: la forma interattiva chiude i vincoli differiti come ultimo
   * statement (con Prisma 5.22 l'errore del COMMIT altrimenti si perde, scritture comprese).
   * La forma batch passa invariata. Non imposta nessun tenant: il ruolo e' BYPASSRLS.
   */
  override $transaction<P extends Prisma.PrismaPromise<unknown>[]>(
    arg: [...P],
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
  ): Promise<runtime.Types.Utils.UnwrapTuple<P>>
  override $transaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    options?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  ): Promise<R>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- implementazione delle due firme sopra
  override $transaction(arg: any, options?: any): any {
    if (typeof arg === 'function') {
      return super.$transaction(conVincoliChiusi(arg), options)
    }
    return super.$transaction(arg, options)
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
