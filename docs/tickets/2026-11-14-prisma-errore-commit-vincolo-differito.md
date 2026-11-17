# Ticket: l'errore del COMMIT di un vincolo differito non arriva all'applicazione (Prisma 5.22?)

Stato: aperto, NON risolto (review PR A Fase 3, punto I2). Non blocca il merge.

## Problema

Il report del Task 9 afferma che, con Prisma 5.22, un errore sollevato al COMMIT di una transazione
interattiva (`$transaction(async tx => ...)`) da un vincolo `DEFERRABLE INITIALLY DEFERRED` non
arriva all'applicazione: la transazione sembra riuscita. Non e' chiaro se la causa sia Prisma o il
nostro `PrismaService` con l'estensione RLS (`app.tenant_id` impostato per transazione).

Impatto oggi: nullo. L'unico vincolo differito del codice e' il constraint trigger della migration
`20261114140300_blocco_invio_importati` (riga `IMPORTAZIONE`/`DA_RICONCILIARE` obbligatoria per ogni
movimento importato) e la contromisura e' attiva: `SET CONSTRAINTS ... IMMEDIATE` come ultimo
statement del blocco (`caricamento/inserisci-a-blocchi.ts`). Il test
`trasmissione-importati.schema.postgres.spec.ts` (righe ~144-173) prova che i dati non restano
scritti. Il rischio e' futuro: un nuovo vincolo differito senza la stessa contromisura perderebbe le
scritture in silenzio.

## Passi per riprodurlo

1. Postgres di prova (container usa e getta, mai quello di un altro worktree) con una tabella e un
   vincolo differito che fallisce sempre al commit:
   ```sql
   CREATE TABLE t_diff (id int PRIMARY KEY);
   CREATE FUNCTION t_diff_ko() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'ko al commit' USING ERRCODE = 'integrity_constraint_violation'; END $$;
   CREATE CONSTRAINT TRIGGER t_diff_chk AFTER INSERT ON t_diff
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION t_diff_ko();
   ```
2. Caso A, `PrismaClient` nudo (nessuna estensione), Prisma 5.22:
   ```ts
   const p = new PrismaClient()
   try {
     await p.$transaction(async tx => { await tx.$executeRaw`INSERT INTO t_diff VALUES (1)` })
     console.log('NESSUN ERRORE')           // comportamento sospetto
   } catch (e) { console.log('errore', e) }  // comportamento atteso
   console.log(await p.$queryRaw`SELECT count(*) FROM t_diff`)  // 0 se il COMMIT e' fallito
   ```
   Ripetere con `$transaction([...])` (array) e con `isolationLevel: 'Serializable'`.
3. Caso B, il client esteso di `PrismaService` dentro `TenantContext.run({ tenantId }, ...)`, stessa
   transazione. Se A segnala l'errore e B no, la causa e' la nostra estensione; se entrambi lo
   perdono, e' Prisma.
4. Controllare nei log di Postgres (`log_statement = all`) che il COMMIT parta e fallisca: serve a
   distinguere "errore perso dal client" da "COMMIT non inviato".
5. Se e' un bug di Prisma: segnalarlo upstream con la riproduzione del caso A, indicando la versione
   (5.22) e verificando se persiste sull'ultima 5.x/6.x.

## Da fare a valle

- Annotare la trappola in `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md`
  (regola: ogni vincolo differito richiede `SET CONSTRAINTS ... IMMEDIATE` come ultimo statement
  finche' il ticket non e' chiuso).
- Se la causa e' l'estensione, correggerla e rimuovere la contromisura solo dopo un test dedicato.
