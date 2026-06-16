import { Prisma } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'

/**
 * Prisma Client Extension per la Row-Level Security (RLS) multi-tenant.
 *
 * DIFESA IN PROFONDITÀ. I repository risolvono già il tenant dal `TenantContext`
 * e lo includono esplicitamente nelle query (fix di Fase 1 al cross-tenant leak).
 * Questa estensione è il secondo livello: anche se un repository (o un nuovo
 * pezzo di codice) dimentica di filtrare per `tenantId`, l'estensione lo inietta
 * automaticamente a livello di client Prisma, per i soli model "tenant-scoped".
 *
 * COMPORTAMENTO (volutamente conservativo):
 *   - Si attiva SOLO quando `TenantContext.getTenantId()` ritorna un valore.
 *     In quel caso, per i model tenant-scoped:
 *       · letture/mutazioni filtrate (findMany, findFirst, findFirstOrThrow,
 *         count, aggregate, groupBy, updateMany, deleteMany) → inietta
 *         `where.tenantId` se non già presente.
 *       · create / createMany → inietta `data.tenantId` se non già presente.
 *       · upsert → inietta `where.tenantId` e `create.tenantId` se assenti.
 *   - Quando il contesto è ASSENTE (seed, migrazioni, job di sistema, test di
 *     setup che non impostano un tenant) l'estensione è un NO-OP totale: non
 *     altera alcuna query. Questo evita di rompere setup/test esistenti.
 *   - I model NON tenant-scoped (es. Tenant, Permission, CERCode, AbacPolicy…)
 *     non vengono mai toccati.
 *
 * NOTA SUI "TYPE CONFLICTS" (perché prima era disabilitata):
 *   Il problema originale era che, usando `$allModels`/`$allOperations`, gli
 *   `args` arrivano con tipi unione molto larghi e lo spread di `args.where` /
 *   `args.data` generava errori TS. Qui risolviamo trattando l'argomento come
 *   `Record<string, unknown>` SOLO nel punto di iniezione (helper `injectWhere`
 *   / `injectData`), mantenendo comunque la chiamata a `query(args)` con il tipo
 *   originale. È un typing pragmatico e localizzato, non un `as any` diffuso.
 *
 * FOLLOW-UP (P4 — NON implementato qui): RLS nativa PostgreSQL (CREATE POLICY +
 * `SET app.current_tenant` per connessione + migration). Darebbe enforcement a
 * livello DB anche per query raw/SQL fuori da Prisma, ma richiede gestione del
 * pooling delle connessioni e del `SET` per transazione. Vedi nota finale.
 */

/**
 * Insieme dei model che hanno un campo `tenantId` nello schema Prisma e che
 * quindi devono essere isolati per tenant. Tenuto come whitelist esplicita: è
 * più sicuro di un'euristica e rende l'aggiunta di un nuovo model una scelta
 * cosciente.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set<string>([
  'User',
  'FIR',
  'MUDReport',
  'CompanyTemplate',
  'Notification',
  'ActivityLog',
  'Produttore',
  'Trasportatore',
  'Destinatario',
  'Role',
  'UserRoleAssignment',
  'PermissionAuditLog',
  'RoleChangeHistory',
  'ResourceOwnership',
  'TemporaryPermissionGrant',
  'ConsultantTenantAssociation',
  'PermissionRequest',
  'RentriCredential',
  'WasteMovement',
  'Contract',
])

/** Operazioni il cui filtro avviene tramite `where`. */
const WHERE_OPERATIONS: ReadonlySet<string> = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
])

/** Operazioni il cui dato nasce tramite `data` (serve `tenantId` nel record). */
const DATA_OPERATIONS: ReadonlySet<string> = new Set<string>(['create', 'createMany'])

/**
 * Inietta `tenantId` nel `where` di `args` se non già presente.
 * Tipizzazione locale pragmatica per evitare i conflitti delle unioni Prisma.
 */
function injectWhere(args: unknown, tenantId: string): unknown {
  const a = (args ?? {}) as Record<string, unknown>
  const where = (a.where ?? {}) as Record<string, unknown>
  if (where.tenantId === undefined) {
    return { ...a, where: { ...where, tenantId } }
  }
  return a
}

/**
 * Inietta `tenantId` nel `data` di `args` se non già presente. Gestisce sia il
 * caso `data: {}` (create) sia `data: [{}, {}]` (createMany).
 */
function injectData(args: unknown, tenantId: string): unknown {
  const a = (args ?? {}) as Record<string, unknown>
  const data = a.data

  if (Array.isArray(data)) {
    return {
      ...a,
      data: data.map((row) => {
        const r = (row ?? {}) as Record<string, unknown>
        return r.tenantId === undefined ? { ...r, tenantId } : r
      }),
    }
  }

  const d = (data ?? {}) as Record<string, unknown>
  if (d.tenantId === undefined) {
    return { ...a, data: { ...d, tenantId } }
  }
  return a
}

/** upsert: filtra per tenant (`where`) e marca il record creato (`create`). */
function injectUpsert(args: unknown, tenantId: string): unknown {
  const a = (args ?? {}) as Record<string, unknown>
  const where = (a.where ?? {}) as Record<string, unknown>
  const create = (a.create ?? {}) as Record<string, unknown>

  return {
    ...a,
    where: where.tenantId === undefined ? { ...where, tenantId } : where,
    create: create.tenantId === undefined ? { ...create, tenantId } : create,
  }
}

/**
 * Argomenti passati da Prisma al callback `$allOperations`. Tipizzazione minima
 * e pragmatica (Prisma li tipa con unioni molto larghe che generavano i
 * "type conflicts" all'origine della disabilitazione).
 */
interface AllOperationsArgs {
  model?: string
  operation: string
  args: unknown
  query: (args: unknown) => unknown
}

/**
 * Cuore della RLS: data un'operazione su un model, decide se/come iniettare il
 * `tenantId` corrente, poi delega a `query`. Esportata per essere testabile in
 * isolamento (senza un vero PrismaClient).
 *
 * No-op (chiama `query(args)` invariato) quando: nessun tenant nel contesto,
 * model non tenant-scoped, oppure operazione che usa una chiave univoca diretta
 * (findUnique/update/delete by id).
 */
export function applyTenantScope({ model, operation, args, query }: AllOperationsArgs): unknown {
  const tenantId = TenantContext.getTenantId()

  // SUPER_ADMIN cross-tenant: se è un super admin e NON ha indicato un tenant
  // target (`X-Tenant-ID` assente → nessun tenantId nel contesto), bypassa la
  // RLS row-level e lascia la query invariata (accesso a tutti i tenant).
  // Se invece il super admin ha indicato un tenant target, `tenantId` è quel
  // valore e si applica la normale iniezione qui sotto (opera "dentro" quel
  // tenant). Questo bypass si attiva SOLO per super admin verificati dal token,
  // mai per utenti normali (che hanno sempre un tenantId nel contesto).
  if (TenantContext.isSuperAdmin() && !tenantId) {
    return query(args)
  }

  if (!tenantId) {
    return query(args)
  }

  if (!model || !TENANT_SCOPED_MODELS.has(model)) {
    return query(args)
  }

  if (operation === 'upsert') {
    return query(injectUpsert(args, tenantId))
  }
  if (WHERE_OPERATIONS.has(operation)) {
    return query(injectWhere(args, tenantId))
  }
  if (DATA_OPERATIONS.has(operation)) {
    return query(injectData(args, tenantId))
  }

  // findUnique/findUniqueOrThrow/update/delete su `where: { id }`: la PK è già
  // globale e i repository la usano con id già risolto nel tenant corretto.
  // Iniettare `tenantId` nel `where` di una findUnique romperebbe il vincolo
  // "unique field" di Prisma. Lasciamo invariato.
  return query(args)
}

/**
 * Estensione RLS. Restituita da `Prisma.defineExtension` così da essere
 * applicabile con `prisma.$extends(rlsExtension)`.
 */
export const rlsExtension = Prisma.defineExtension({
  name: 'multi-tenant-rls',
  query: {
    $allModels: {
      // `$allOperations` di Prisma tipa `params` con unioni molto larghe e si
      // aspetta un ritorno `Promise<unknown>`. Lasciamo inferire i tipi a
      // Prisma e deleghiamo alla funzione `applyTenantScope` (typing `unknown`),
      // castando params/ritorno nel punto di confine (è qui che nascevano i
      // "type conflicts" che avevano disabilitato l'estensione).
      $allOperations(params) {
        return applyTenantScope(params as unknown as AllOperationsArgs) as Promise<unknown>
      },
    },
  },
})

/**
 * Helper retro-compatibile: applica l'estensione RLS a un client Prisma.
 *
 * @example
 *   const prisma = new PrismaClient().$extends(withRLS())
 *   // Oppure, lato NestJS, in PrismaService dopo super().
 *
 * Il vecchio parametro `tenantId` non serve più: il tenant è risolto a runtime
 * dal `TenantContext` per ogni query (un singolo client serve tutti i tenant).
 */
export function withRLS() {
  return rlsExtension
}

/** Tipo dell'estensione RLS (per chi vuole tiparla esplicitamente). */
export type RlsExtension = typeof rlsExtension
