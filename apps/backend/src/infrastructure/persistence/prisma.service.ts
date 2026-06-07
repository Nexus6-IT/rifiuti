/**
 * Prisma Service - Database connection wrapper
 * Injectable service for NestJS DI
 *
 * ============================================================================
 * RLS (Row-Level Security) multi-tenant — difesa in profondità
 * ============================================================================
 * Questo service espone DUE viste sullo stesso pool di connessioni:
 *
 *   1. `this.prisma.<model>`  → client base (PrismaClient "nudo"), retro-
 *      compatibile con tutti i repository esistenti. NESSUN cambiamento di
 *      comportamento o di tipo per chi lo usa già.
 *
 *   2. `this.prisma.db.<model>` → client ESTESO con `rlsExtension`. Inietta
 *      automaticamente `tenantId` (risolto dal TenantContext) sui model
 *      tenant-scoped. È la difesa in profondità: anche se un repository
 *      dimentica di filtrare per tenant, l'estensione lo fa per lui.
 *      Quando il TenantContext è assente (seed/migrazioni/job di sistema)
 *      l'estensione è un NO-OP totale (vedi prisma-rls.extension.ts).
 *
 * PERCHÉ ADDITIVO E NON GLOBALE: `client.$extends(rlsExtension)` ritorna un
 * client con TIPO diverso da `PrismaClient`. Far sì che `class PrismaService
 * extends PrismaClient` "diventi" il client esteso romperebbe i tipi/DI di
 * tutti i repository. Esponiamo quindi il client esteso in modo additivo (`db`)
 * e migriamo i repository a usarlo gradualmente (i registry repository sono già
 * stati migrati). Migrazione di un repository = sostituire `this.prisma.<model>`
 * con `this.prisma.db.<model>`.
 * ============================================================================
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { rlsExtension } from './prisma-rls.extension'

/**
 * Costruisce il client esteso con RLS a partire da un client base. Definita come
 * funzione modulo-scope così che TypeScript possa INFERIRE il tipo del client
 * esteso (`RlsClient`) senza doverlo scrivere a mano (i tipi di `$extends` sono
 * generati e non hanno un nome esportabile stabile).
 */
function buildRlsClient(client: PrismaClient) {
  return client.$extends(rlsExtension)
}

/** Tipo del client Prisma esteso con RLS (inferito da `buildRlsClient`). */
export type RlsClient = ReturnType<typeof buildRlsClient>

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * Client esteso con RLS. Inizializzato in `onModuleInit` (dopo che il client
   * base è pronto) e condiviso con esso lo stesso pool di connessioni.
   */
  private rlsClient?: RlsClient

  async onModuleInit() {
    await this.$connect()
    // Il client esteso riusa la stessa istanza/connessione del client base:
    // `$extends` NON apre un nuovo pool, applica solo i wrapper alle query.
    this.rlsClient = buildRlsClient(this)
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }

  /**
   * Vista RLS-aware del client. Usare `this.prisma.db.<model>` nei repository
   * per ottenere l'iniezione automatica del `tenantId` (difesa in profondità).
   *
   * Disponibile dopo `onModuleInit`. In contesti che non passano dal ciclo di
   * vita Nest (alcuni test), ricade in modo lazy su una costruzione on-demand
   * così da non lanciare `undefined`.
   */
  get db(): RlsClient {
    if (!this.rlsClient) {
      this.rlsClient = buildRlsClient(this)
    }
    return this.rlsClient
  }

  async cleanDatabase() {
    // For testing: clean all tables
    if (process.env.NODE_ENV === 'test') {
      const tables = await this.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables WHERE schemaname='public'
      `

      for (const { tablename } of tables) {
        if (tablename !== '_prisma_migrations') {
          await this.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`)
        }
      }
    }
  }
}
