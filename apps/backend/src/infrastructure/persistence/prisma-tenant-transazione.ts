import { AsyncLocalStorage } from 'async_hooks'
import { Prisma, PrismaClient } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'

/**
 * Meccanismo "tenant per transazione" (RLS pezzo 2a).
 *
 * Con un tenant nello store del TenantContext, ogni operazione del client esteso
 * esegue `set_config('app.tenant_id', <tenant>, true)` nella STESSA transazione
 * dell'operazione. Il terzo argomento `true` rende il valore locale alla
 * transazione: a COMMIT/ROLLBACK sparisce e la connessione torna al pool pulita.
 * Il tenant e' sempre un parametro della query, mai concatenato nel testo SQL.
 *
 * Legge SOLO lo store dell'AsyncLocalStorage, non il fallback `CURRENT_TENANT_ID`
 * di `getTenantId()`: i job e gli script senza contesto restano senza transazione
 * aggiunta (li sistemano i pezzi 2b e 2c).
 */

/**
 * Marca l'esecuzione di un batch `$transaction([...])` aperto da questo modulo.
 * Serve SOLO al batch: le sue operazioni nascono dal client esteso e senza il
 * flag il loro `$allOperations` le riavvolgerebbe in transazioni proprie.
 *
 * NON si usa nella forma interattiva: li' `fn` riceve il `tx` del client base,
 * le cui operazioni non passano mai da `$allOperations`. Il flag servirebbe solo
 * a far saltare il `set_config` alle chiamate fatte DENTRO `fn` sul client
 * esterno (per esempio un service che tiene `this.prisma`): quelle girano su
 * un'altra connessione del pool e devono avere il proprio tenant.
 */
const transazioneAperta = new AsyncLocalStorage<{ inTransazione: true }>()

const NOME_SETTING = 'app.tenant_id'

/** Tenant dello store del contesto, `null` se assente o vuoto. */
function tenantDelContesto(): string | null {
  return TenantContext.getStoreTenantId()
}

/**
 * Client su cui l'estensione apre le transazioni: il PrismaClient nudo oppure un
 * client gia' esteso (per esempio con `rlsExtension`). In quel caso il `tx` delle
 * transazioni interattive e le operazioni dei batch conservano le estensioni.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- i tipi generici dei client estesi non sono assegnabili a PrismaClient */
export interface ClienteBase {
  $transaction: (...args: any[]) => any
  $queryRaw: (...args: any[]) => any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Istruzione lazy (PrismaPromise) che imposta il tenant: serve sia da
 * `await` sia come primo elemento di un batch `$transaction([...])`.
 */
function istruzioneTenant(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  tenantId: string
): Prisma.PrismaPromise<unknown> {
  return client.$queryRaw`SELECT set_config(${NOME_SETTING}, ${tenantId}, true)`
}

/**
 * Imposta `app.tenant_id` (locale alla transazione) sul client transazionale
 * ricevuto. Va chiamata come PRIMO statement della transazione.
 */
export async function impostaTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await istruzioneTenant(tx, tenantId)
}

/**
 * Argomenti per `base.$extends(...)`. Il client esteso:
 *  - avvolge ogni operazione top-level (modelli e raw) in
 *    `$transaction([set_config, operazione])` quando c'e' un tenant e non si e'
 *    gia' in una transazione;
 *  - estende `$transaction`: forma interattiva (set_config come primo statement,
 *    poi `fn(tx)`) e forma batch (set_config in testa).
 *
 * Avvertenze note:
 *  - il tenant e' letto al momento dell'ESECUZIONE (primo `.then`/`await`), non
 *    della creazione: un PrismaPromise lazy creato in un contesto ed atteso in un
 *    altro usa il tenant di chi lo attende. Per lo stesso motivo una promise
 *    memoizzata e riusata fra richieste usa il tenant della richiesta che la
 *    attende, non di quella che l'ha creata;
 *  - con un tenant nel contesto ogni operazione gira in una transazione, quindi
 *    gli statement che non possono stare in un blocco transazionale (VACUUM,
 *    CREATE INDEX CONCURRENTLY, ...) falliscono: vanno eseguiti senza contesto;
 *  - costo: fuori da una transazione esplicita ogni operazione diventa una
 *    transazione (BEGIN, set_config, operazione, COMMIT) invece di una query sola.
 *    Misurato in sequenza sul Postgres di prova: sovraccosto nel rumore (vedi
 *    README-tenant-transazione.md). La misura non dice nulla sulla contesa del
 *    pool sotto concorrenza.
 */
export function estensioneTenantTransazione(base: ClienteBase) {
  return {
    name: 'tenant-per-transazione',
    query: {
      async $allOperations({
        args,
        query,
      }: {
        args: unknown
        query: (args: unknown) => Prisma.PrismaPromise<unknown>
      }) {
        const tenantId = tenantDelContesto()
        if (!tenantId || transazioneAperta.getStore()) {
          return query(args)
        }
        const [, risultato] = await base.$transaction([
          istruzioneTenant(base, tenantId),
          query(args),
        ])
        return risultato
      },
    },
    client: {
      $transaction: ((
        arg: unknown,
        options?: {
          maxWait?: number
          timeout?: number
          isolationLevel?: Prisma.TransactionIsolationLevel
        }
      ): unknown => {
        const tenantId = tenantDelContesto()
        if (Array.isArray(arg)) {
          if (!tenantId) {
            return base.$transaction(arg as Prisma.PrismaPromise<unknown>[], options)
          }
          // Le operazioni del batch arrivano dal client esteso: il flag impedisce che
          // il loro $allOperations le riavvolga in transazioni proprie, rompendo
          // l'atomicita' del batch.
          return transazioneAperta
            .run({ inTransazione: true }, () =>
              base.$transaction(
                [istruzioneTenant(base, tenantId), ...(arg as Prisma.PrismaPromise<unknown>[])],
                options
              )
            )
            .then((r: unknown[]) => r.slice(1))
        }
        const fn = arg as (tx: Prisma.TransactionClient) => Promise<unknown>
        if (!tenantId) {
          return base.$transaction(fn, options)
        }
        return base.$transaction(async (tx: Prisma.TransactionClient) => {
          await impostaTenant(tx, tenantId)
          return fn(tx)
        }, options)
      }) as unknown as PrismaClient['$transaction'],
    },
  }
}

/** Tipo del client esteso, inferito (i tipi di `$extends` non hanno un nome stabile). */
function costruisci(base: PrismaClient) {
  return base.$extends(estensioneTenantTransazione(base))
}
export type ClienteTenantTransazione = ReturnType<typeof costruisci>
