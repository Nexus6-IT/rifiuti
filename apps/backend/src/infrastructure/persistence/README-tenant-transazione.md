# Tenant per transazione (RLS pezzo 2a)

## Come funziona

Il `PrismaService` iniettato da Nest e' un client esteso con `estensioneTenantTransazione`
(`prisma-tenant-transazione.ts`, factory `creaPrismaServiceApplicativo`). Con un tenant nello
store del `TenantContext`, ogni operazione gira in una transazione che inizia con
`set_config('app.tenant_id', <tenant>, true)`. La policy del pezzo 3 leggera' quel valore.

Il terzo argomento e' `true` (locale alla transazione), non `false` (di sessione): a COMMIT o
ROLLBACK il valore sparisce e la connessione torna al pool pulita. Con `false` il tenant
resterebbe sulla connessione e la richiesta successiva, magari di un altro tenant, lo erediterebbe.
Il tenant e' sempre un parametro della query, mai concatenato nell'SQL.

Si legge solo lo store dell'AsyncLocalStorage, non il fallback `CURRENT_TENANT_ID`.

## Senza tenant

Nessuna transazione aggiunta: la query parte come prima e `app.tenant_id` non e' impostato.
Quando il pezzo 3 attivera' `FORCE` questo significa zero righe: per questo job, login, cron e
seed passano su `PrismaSistemaService` (pezzo 2b) o in `TenantContext.run` (pezzo 2c).

## Scrivere una nuova transazione

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.fIR.update(...) // SEMPRE tx, mai this.prisma
})
```

Dentro `fn` usare solo `tx`: il client esterno aprirebbe una transazione propria su un'altra
connessione, fuori dall'atomicita'. Il `set_config` e' gia' il primo statement. Per il client
filtrato usare `this.prisma.db.$transaction`. Il batch `$transaction([a, b])` e' supportato.

Avvertenze (dettagli nei commenti del codice):
- `await` dentro `TenantContext.run`: il tenant e' letto quando la PrismaPromise viene eseguita,
  non quando e' creata (attenzione alle promise memoizzate fra richieste);
- con un tenant ogni operazione sta in una transazione: VACUUM, `CREATE INDEX CONCURRENTLY` e
  simili falliscono, vanno lanciati senza contesto;
- `$on` e `$use` sono tipizzati ma assenti sul client esteso.

## Costo misurato

500 `findFirst` su `fir`, `wasteflow-pg-test` (127.0.0.1:55432, via relay WSL, quindi
pessimistico rispetto alla produzione dove backend e Postgres condividono la rete Docker).
Tre esecuzioni, millisecondi per operazione (media / p95):

| Scenario | Esec. 1 | Esec. 2 | Esec. 3 |
|---|---|---|---|
| A nudo, senza tenant | 1,29 / 1,67 | 1,34 / 1,64 | 1,33 / 1,62 |
| B esteso, senza tenant | 1,74 / 2,66 | 1,29 / 1,60 | 1,27 / 1,46 |
| C nudo, con tenant (nessuna transazione) | 1,18 / 1,42 | 1,22 / 1,49 | 1,28 / 1,50 |
| D esteso, con tenant | 1,27 / 1,67 | 1,34 / 1,69 | 1,26 / 1,49 |

Il sovraccosto di D su C va da -0,01 a +0,12 ms per operazione, cioe' nel rumore. Non e'
stato verificato perche' sia cosi' basso. La misura e' sequenziale (una operazione alla volta)
e non dice nulla sulla contesa del pool sotto concorrenza. Query reali piu' pesanti di un `findFirst` indicizzato ne sono
dominate. Rieseguire, DA `apps/backend` (lo script sta in `scripts/`, fuori da build e CI):

```
DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public" \
  npx ts-node -P tsconfig.json scripts/tenant-transazione.misura.ts [N]
```

## Pool

Una transazione per operazione tiene la connessione un po' piu' a lungo. Oggi `connection_limit`
e' il default di Prisma (num_cpus * 2 + 1) e non e' impostato. Alzarlo (parametro nell'URL di
`DATABASE_URL`) se compaiono timeout `Timed out fetching a new connection from the connection pool`
sotto carico. Le transazioni interattive mantengono il `maxWait` di default di Prisma (2 s):
la pressione sul pool si vede quindi per prima come errore P2028 o P2024. In questo pezzo non cambia nessun valore.

## Cosa resta

- **2b:** cron cross-tenant, lookup di login e refresh, verifica pubblica del FIR, cruscotti
  super admin, impersonificazione, membership dei consulenti e seed passano su `PrismaSistemaService`.
- **2c:** worker per singolo tenant (`rentri-sync`, `audit-logging`) dentro
  `TenantContext.run({ tenantId })`; `CURRENT_TENANT_ID` limitata a `NODE_ENV=test`;
  `TenantSwitchInterceptor` e `checkAccess` verificati sul contesto giusto.
- **3:** policy `ENABLE` e `FORCE` sulle 25 tabelle con
  `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`.
