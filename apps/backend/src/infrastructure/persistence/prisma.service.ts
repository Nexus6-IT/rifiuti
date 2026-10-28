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
import { estensioneTenantTransazione } from './prisma-tenant-transazione'

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

/**
 * Tabelle che `cleanDatabase` NON svuota. `_prisma_migrations` e' dell'ORM; `causali_registro` e' il
 * catalogo di sistema delle causali: lo scrive solo la migration e i test non possono ricrearlo
 * (l'applicazione non ha i privilegi di scrittura), quindi svuotarlo lo perderebbe per sempre.
 */
export const TABELLE_NON_SVUOTABILI: readonly string[] = ['_prisma_migrations', 'causali_registro']

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
        if (!TABELLE_NON_SVUOTABILI.includes(tablename)) {
          await this.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`)
        }
      }
    }
  }
}

/**
 * Factory del provider `PrismaService` (RLS pezzo 2a): l'istanza iniettata da
 * Nest NON e' la classe nuda ma il client esteso con `estensioneTenantTransazione`,
 * cosi' ogni operazione (e ogni `$transaction`) con un tenant nel TenantContext
 * esegue `set_config('app.tenant_id', ...)` nella propria transazione.
 *
 * Scelta tecnica: factory provider invece di un costruttore che restituisce
 * `this.$extends(...)`. La classe `PrismaService` resta quella di prima (gli spec
 * che la istanziano direttamente e spiano `$extends`/prototype restano validi) e
 * il client esteso la affianca con gli stessi membri applicativi, delegati
 * all'istanza base: `db`, `cleanDatabase`, `onModuleInit`, `onModuleDestroy`.
 * I lifecycle hook sono chiamati da Nest sul valore restituito dalla factory.
 *
 * `db` e' composto nell'ordine corretto: `base.$extends(rlsExtension)` e poi
 * l'estensione tenant sopra quel client (l'ordine inverso perde il filtro RLS
 * dentro le transazioni).
 *
 * UNICO cast: il tipo del client esteso non e' assegnabile a `PrismaService`
 * (classe con membri privati); la forma a runtime e' un soprainsieme dei membri
 * pubblici della classe. Il cast sta qui, nessun consumatore ne ha bisogno.
 */
export function creaPrismaServiceApplicativo(): PrismaService {
  const base = new PrismaService()
  const rlsBase = buildRlsClient(base)
  const db = rlsBase.$extends(estensioneTenantTransazione(rlsBase))
  return base.$extends(estensioneTenantTransazione(base)).$extends({
    name: 'membri-prisma-service',
    client: {
      db,
      cleanDatabase: () => base.cleanDatabase(),
      onModuleInit: () => base.onModuleInit(),
      onModuleDestroy: () => base.onModuleDestroy(),
    },
  }) as unknown as PrismaService
}
