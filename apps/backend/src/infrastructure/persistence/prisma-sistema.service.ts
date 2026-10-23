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
 * In questo pezzo non ha chiamanti: i job ci passano nel pezzo 2.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/** Sceglie l'URL e dice se si e' ripiegato sulla connessione applicativa. */
function risolviUrlSistema(): { url: string | undefined; fallback: boolean } {
  const dedicato = process.env.DATABASE_URL_SISTEMA
  if (dedicato) return { url: dedicato, fallback: false }
  return { url: process.env.DATABASE_URL, fallback: true }
}

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

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
