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

/** Marca il codice che gira gia' dentro una transazione aperta da questo modulo. */
const transazioneAperta = new AsyncLocalStorage<{ inTransazione: true }>()

const NOME_SETTING = 'app.tenant_id'

/** Tenant dello store del contesto, `null` se assente o vuoto. */
function tenantDelContesto(): string | null {
  const id = TenantContext.getStoreTenantId()
  return id && id.length > 0 ? id : null
}

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
 *    poi `fn(tx)` marcata come "in transazione") e forma batch (set_config in testa).
 */
export function estensioneTenantTransazione(base: PrismaClient) {
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
            .then(r => r.slice(1))
        }
        const fn = arg as (tx: Prisma.TransactionClient) => Promise<unknown>
        if (!tenantId) {
          return base.$transaction(fn, options)
        }
        return base.$transaction(async tx => {
          await impostaTenant(tx, tenantId)
          return transazioneAperta.run({ inTransazione: true }, () => fn(tx))
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
