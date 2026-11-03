# ops/ — Procedure operative WasteFlow

## Backup off-site

### Script: `backup-offsite.sh`

Produce un dump gzip del database PostgreSQL, lo **verifica** e solo dopo lo
accetta; poi lo copia su una destinazione remota (rsync+SSH o rclone/S3). Da
eseguire sul VPS come root. Il `.env` è letto con `leggi_env` (libreria
`ops/lib/backup-verifica.sh`) e **mai eseguito**: niente `source` nel cron.

> `scripts/backup.sh` (percorsi `/opt/wasteflow`) **non** è lo script in uso:
> quello in uso è `ops/backup-offsite.sh`.

**Cosa viene verificato prima di accettare un backup:**

1. Il file deve essere un gzip integro e la sua coda deve contenere il marcatore
   finale di `pg_dump` (`-- PostgreSQL database dump complete`): un dump
   troncato può essere un gzip valido, ma senza marcatore viene scartato.
2. Di notte, un **ripristino di prova** in un database temporaneo
   (`wasteflow_verifica_<epoch>_<pid>`, sempre eliminato alla fine) con
   confronto di numero di tabelle, righe di `_prisma_migrations` e righe di
   `waste_movements` rispetto alla sorgente.
3. **Spazio libero** (Decisione 14): prima del dump servono 2 volte la
   dimensione del database nella cartella dei backup; prima del ripristino di
   prova 3 volte in `BACKUP_DATI_DIR` (default `/var/lib/docker`). Fattori
   regolabili con `BACKUP_FATTORE_SPAZIO_DUMP` e
   `BACKUP_FATTORE_SPAZIO_RIPRISTINO`.

**Stati dei file** in `/opt/rifiuti/backups`:

| Suffisso | Significato |
|----------|-------------|
| `.sql.gz.parziale` | dump in corso o interrotto |
| `.sql.gz.scartato` | dump incompleto o ripristino di prova fallito |
| `.sql.gz.non-verificato` | dump completo ma senza spazio per il ripristino di prova (può servire) |
| `.sql.gz` | backup verificato, nome finale |

Gli `.scartato` e `.non-verificato` più vecchi di 7 giorni vengono eliminati
dalla rotazione. Se un backup notturno fallisce parte una **mail a `root`**
(sul VPS inoltrata a Gmail da `/etc/aliases`, invio con `msmtp`); l'indirizzo si
cambia con `BACKUP_ALERT_EMAIL`.

**Modalità** (`BACKUP_MODALITA`):

- `notturno` (default): flusso completo, restore di prova, mail se fallisce,
  copia off-site, rotazione per `BACKUP_RETENTION_DAYS`.
- `predeploy`: dump + controllo di completezza, file `wasteflow_predeploy_*`
  (ne restano 10), nessun restore di prova, nessuna mail e nessuna copia
  off-site. Esce con codice diverso da zero se il dump fallisce: lo segnala il
  job di deploy.

**Configurazione** (variabili d'ambiente oppure righe nel `/opt/rifiuti/.env`):

```bash
# Modalità off-site: rsync | rclone | disabled
# Lasciare "disabled" finché la destinazione off-site non è decisa.
OFFSITE_MODE=disabled

# rsync: destinazione SSH
RSYNC_TARGET="backup@backup-server.example.com:/backups/wasteflow/"
RSYNC_SSH_KEY="/root/.ssh/id_ed25519_backup"

# Rotazione locale (default 30 giorni)
BACKUP_RETENTION_DAYS=30

# Cifratura opzionale con age (https://age-encryption.org/)
ENCRYPT_BACKUP=false
# AGE_RECIPIENT="age1..."   # chiave pubblica age del destinatario
```

Percorsi (sovrascrivibili): `WASTEFLOW_ENV_FILE` (`/opt/rifiuti/.env`),
`WASTEFLOW_COMPOSE_FILE` (`/opt/rifiuti/site/docker-compose.prod.yml`, quello
usato dal deploy), `BACKUP_STAGING_DIR` (`/opt/rifiuti/backups`). Ogni
`docker compose` passa `--env-file`: il compose di produzione ha variabili
obbligatorie interpolate anche da `exec`.

**Esecuzione manuale:**

```bash
bash /opt/rifiuti/site/ops/backup-offsite.sh
```

**Cron suggerito** (ogni notte alle 03:30, senza `source`):

```
# /etc/cron.d/wasteflow-backup
30 3 * * * root bash /opt/rifiuti/site/ops/backup-offsite.sh >> /var/log/wasteflow-backup.log 2>&1
```

### Allarme di freschezza: `controllo-freschezza-backup.sh`

`backup-offsite.sh` manda una mail quando il backup **fallisce**; se invece il
cron non parte (job rimosso, host spento) non scrive nessuno. Questo controllo
guarda l'età dell'ultimo dump verificato (`wasteflow_<DB_NAME>_*.sql.gz` e
`.sql.gz.age`; `predeploy`, `.scartato`, `.non-verificato` e `.parziale` non
contano) e manda una mail **solo ai cambi di stato**: oltre 26 ore
(`BACKUP_FRESCHEZZA_ORE`) arriva `ATTENZIONE backup WasteFlow fermo da <N> ore`
(o `... nessun dump verificato`), al ritorno alla normalità `Backup WasteFlow di
nuovo regolare`. Lo stato sta in `BACKUP_STATO_FILE`
(`/var/lib/wasteflow-backup/freschezza.stato`); esce 0 se OK, 1 se GUASTO.

```
# /etc/cron.d/wasteflow-backup-freschezza
*/30 * * * * root bash /opt/rifiuti/site/ops/controllo-freschezza-backup.sh >> /var/log/wasteflow-backup-freschezza.log 2>&1
```

Comportamenti da sapere: se la mail non parte (msmtp assente o in errore) lo
stato **non** cambia e il giro successivo riprova; se la cartella o il file di
stato non sono scrivibili il controllo scrive `ERRORE` sul log, esce con codice
3 e non manda mail (altrimenti ne partirebbe una ogni 30 minuti): il guasto si
vede nel log. Il log `/var/log/wasteflow-backup-freschezza.log` riceve una riga
ogni 30 minuti: aggiungerlo alla rotazione di logrotate.

L'installazione sul server è un passo del rilascio (con l'approvazione di
Graziano). Prova: `BACKUP_FRESCHEZZA_ORE=0 bash .../controllo-freschezza-backup.sh`
deve mandare una mail; poi si cancella `BACKUP_STATO_FILE` o si lascia girare
con la soglia normale per ricevere il messaggio di ripristino.

**Test degli script:** `bash ops/test/backup-verifica.test.sh` (la parte con
PostgreSQL gira solo se `PG_EXEC` è impostata, ad esempio
`PG_EXEC="docker exec -i <container>"`). Girano in CI (`ci.yml`, job `backend`
e `test-postgres`) e nel gate del deploy (`deploy.yml`, job `quality`).

---

## Codici MUD delle unità locali

Ogni unità locale RENTRI (`rentri_unita_locali`) ha un `progressivo_mud`: è il codice che il file MUD
scrive nella chiave di ogni record della sua dichiarazione. Lo assegnano la migration
`20261031130000_unita_locali_mud` (backfill: la principale di allora ha 1, le altre seguono per
data di creazione) e un trigger `BEFORE INSERT` (massimo dell'azienda + 1). **I codici non vanno
rinumerati a mano**: un MUD già presentato li contiene, e cambiarli farebbe sembrare un'altra sede.

Ripristino a mano della migration (in quest'ordine; il commento in testa al file ha lo stesso elenco):

```sql
DROP TRIGGER rentri_unita_locali_progressivo_mud ON rentri_unita_locali;
DROP FUNCTION rentri_unita_locali_assegna_progressivo_mud();
DROP INDEX rentri_unita_locali_tenant_progressivo_mud_key;
ALTER TABLE rentri_unita_locali
  DROP CONSTRAINT rentri_unita_locali_cap_check,
  DROP CONSTRAINT rentri_unita_locali_provincia_check,
  DROP CONSTRAINT rentri_unita_locali_numero_addetti_check,
  DROP CONSTRAINT rentri_unita_locali_progressivo_mud_check,
  DROP COLUMN indirizzo, DROP COLUMN civico, DROP COLUMN cap, DROP COLUMN comune,
  DROP COLUMN provincia, DROP COLUMN numero_addetti, DROP COLUMN progressivo_mud;
DELETE FROM _prisma_migrations WHERE migration_name = '20261031130000_unita_locali_mud';
```

---

## Migration della fase 4 (contratto cliente e listino): ordine di ripristino

**AVVERTENZA:** Esegui un backup con pg_dump prima di ogni ripristino. I comandi DROP TABLE cancellano i dati in modo definitivo.

```bash
docker exec rifiuti-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backup-pre-rollback.dump
```

Le migration della fase 4 dipendono l'una dall'altra tramite chiavi esterne, quindi a mano si
ripristinano **dall'ultima alla prima**, tutte nella stessa sessione `psql` come proprietario
(`wasteflow`), e prima di farlo si rimette in produzione il tag del backend precedente (il codice
nuovo non regge tabelle mancanti). L'elenco `DROP` esatto sta nel commento in testa a ciascun
`migration.sql`: questa tabella ne dà solo l'ordine e i rischi.

Ogni blocco di ripristino va eseguito dentro `BEGIN; ... COMMIT;`: se un comando fallisce, il
`ROLLBACK` annulla tutto il blocco e lo schema non resta a metà.

| # | Migration | Pezzo | Cosa toglie | Attenzione |
|---|-----------|-------|-------------|------------|
| 0 | `20261104100000_legami_avvisi_e_causali` | 4.3 | il valore `CONTRATTO_ALTRA_SEDE` nel CHECK `legami_movimento_avvisi_ammessi` e il ramo su `fatturabile` del trigger `causali_registro_azienda_controlli` | nessun dato perso; va ripristinata per prima, prima di `20261103200000`. Comandi, in quest'ordine: `UPDATE legami_movimento SET avvisi = array_remove(avvisi, 'CONTRATTO_ALTRA_SEDE') WHERE 'CONTRATTO_ALTRA_SEDE' = ANY(avvisi);`<br>`ALTER TABLE legami_movimento DROP CONSTRAINT legami_movimento_avvisi_ammessi;`<br>`ALTER TABLE legami_movimento ADD CONSTRAINT legami_movimento_avvisi_ammessi CHECK (... senza CONTRATTO_ALTRA_SEDE ...) NOT VALID;`<br>`ALTER TABLE legami_movimento VALIDATE CONSTRAINT legami_movimento_avvisi_ammessi;`<br>la definizione precedente completa di `causali_registro_azienda_controlli` (`CREATE OR REPLACE FUNCTION`), riportata nel commento di testa della migration;<br>`DELETE FROM _prisma_migrations WHERE migration_name = '20261104100000_legami_avvisi_e_causali';` |
| 1 | `20261103200000_legami_movimento` | 4.3 | 3 tabelle (`righe_legame_movimento`, `legami_movimento`, `impostazioni_fatturazione`), 4 enum, i 3 indici unici additivi (`righe_addebito_id_elenco_id_tenant_id_key`, `elenchi_addebiti_id_contratto_id_tenant_id_key`, `contratti_cliente_id_cliente_id_tenant_id_key`), il CHECK `causali_registro_azienda_fatturabile_propria` e la colonna `fatturabile` di `causali_registro_azienda` e di `causali_registro` | va ripristinata dopo la riga 0 e prima di tutte le altre. Contiene scelte dell'utente e prezzi congelati: esportare prima `legami_movimento` e `righe_legame_movimento`. Comandi, in quest'ordine: `DROP TABLE righe_legame_movimento, legami_movimento, impostazioni_fatturazione;`<br>`DROP TYPE origine_quantita_legame, origine_riga_legame, fonte_cliente_legame, stato_legame_movimento;`<br>`DROP INDEX righe_addebito_id_elenco_id_tenant_id_key;`<br>`DROP INDEX elenchi_addebiti_id_contratto_id_tenant_id_key;`<br>`DROP INDEX contratti_cliente_id_cliente_id_tenant_id_key;`<br>`ALTER TABLE causali_registro_azienda DROP CONSTRAINT causali_registro_azienda_fatturabile_propria;`<br>`ALTER TABLE causali_registro_azienda DROP COLUMN fatturabile;`<br>`ALTER TABLE causali_registro DROP COLUMN fatturabile;`<br>`DELETE FROM _prisma_migrations WHERE migration_name = '20261103200000_legami_movimento';` |
| 2 | `20261103100000_listino_indici_seguiti` | seguiti 4.2b | solo indici e un CHECK | nessun dato perso, nessuna dipendenza da altre migration. Comandi, in quest'ordine: `ALTER TABLE "elenchi_addebiti" DROP CONSTRAINT "elenchi_addebiti_codice_non_000";`<br>`DROP INDEX "addebiti_tenant_id_gruppo_id_idx";`<br>`DROP INDEX "addebiti_tenant_id_codice_iva_id_idx";`<br>`DROP INDEX "addebiti_tenant_id_categoria_id_idx";`<br>`DROP INDEX "addebiti_tenant_id_centro_ricavo_id_idx";`<br>`DROP INDEX "addebiti_tenant_id_categoria_statistica_1_id_idx";`<br>`DROP INDEX "addebiti_tenant_id_categoria_statistica_2_id_idx";`<br>`DROP INDEX "activity_logs_tenant_id_action_idx";`<br>`DELETE FROM _prisma_migrations WHERE migration_name = '20261103100000_listino_indici_seguiti';` |
| 3 | `20261102300100_listino_elenchi_righe` | 4.2b | 5 tabelle (`elenchi_addebiti`, `allegati_elenco_addebiti`, `righe_addebito`, `scaglioni_riga_addebito`, `scadenze_riga_addebito`) e 3 enum | contiene dati dei clienti: se servono, esportare prima i dati di queste tabelle |
| 4 | `20261102300000_listino_archivio_addebiti` | 4.2a | 4 tabelle (`prezzi_listino_addebito`, `addebiti`, `codifiche_addebito`, `codici_iva`), le 3 colonne di `clienti` (`listino`, `provvigione_predefinita`, `tipo_provvigione_predefinita`) e 2 enum | SOLO dopo il punto 3 (le sue FK citano queste tabelle); le colonne di `clienti` contengono dati: se servono, esportare prima i dati di queste tabelle e di `clienti` |
| 5 | `20261102200100_clienti_agenti_contratti_cliente` | 4.1b | 5 tabelle (`allegati_contratto_cliente`, `periodi_fatturazione_cliente`, `contratti_cliente`, `clienti`, `agenti`) e 2 enum | SOLO dopo il punto 4 (la 4.2a aggiunge colonne a `clienti`); tabelle con dati: se servono, esportare prima i dati di queste tabelle |
| 6 | `20261102200000_anagrafiche_fatturazione_cliente` | 4.1a | 6 tabelle di fatturazione (`codifiche_contratto`, `testi_fatturazione`, `registri_iva`, `spese_accessorie`, `conti_correnti`, `condizioni_pagamento`) e 2 enum | SOLO dopo il punto 5 (le FK composite della 4.1b le citano); tabelle con dati: se servono, esportare prima i dati di queste tabelle |

Per ogni migration ripristinata si cancella anche la sua riga da `_prisma_migrations`
(`DELETE FROM _prisma_migrations WHERE migration_name = '<nome>';`), altrimenti il prossimo
`migrate deploy` la considera già applicata.

Se invece una di queste migration **fallisce** in deploy (P3009), la procedura è la stessa
descritta in "Ripristino da migration fallita (P3009)": sono transazionali, quindi non resta
nulla di metà; si controlla con `SELECT to_regclass('public.<prima tabella>')` che sia `NULL`, si
corregge la causa e si lancia `npx prisma migrate resolve --rolled-back <nome>` prima di
rilanciare il deploy. La `20261102300000` prende un lock su `clienti` per la durata della
migration (`lock_timeout` di 5 secondi): se scade si rilancia il deploy.

### 4.3a legame movimento: rilascio e rollback

Migration `20261103200000_legami_movimento`, additiva: tre tabelle nuove e vuote
(`legami_movimento`, `righe_legame_movimento`, `impostazioni_fatturazione`) con RLS `ENABLE` +
`FORCE`, quattro enum, tre indici unici additivi sul listino e la colonna `fatturabile` su
`causali_registro` (default `false`, `true` solo per `INGRESSO_ESTERNO` in carico) e
`causali_registro_azienda`. Nessuna colonna su `waste_movements`: l'`entryHash` e RENTRI non
cambiano. In 4.3a nessun legame si crea ancora; si imposta solo la data «Fatturazione da»
(`GET`/`PUT /impostazioni-fatturazione`, schermata `clienti/fatturazione`) e il flag `fatturabile`
delle causali aziendali.

**Rilascio.** Prima del deploy un backup (vedi l'avvertenza sopra):

```bash
docker exec rifiuti-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backup-pre-4-3a.dump
```

Il deploy lancia `npx prisma migrate deploy` col ruolo proprietario (`wasteflow`); `lock_timeout`
di 5 secondi in testa: se scade (traffico sulle causali) si rilancia il deploy. Controlli dopo:

```sql
SELECT to_regclass('public.legami_movimento'), to_regclass('public.impostazioni_fatturazione');
SELECT codice, verso FROM causali_registro WHERE fatturabile;   -- solo INGRESSO_ESTERNO / CARICO
SELECT count(*) FROM legami_movimento;                           -- 0 in 4.3a
```

e `ops/db-ruoli.sh` (privilegi di `wasteflow_app` e `wasteflow_sistema` sulle tabelle nuove).

**Rollback del codice** (tag precedente del backend): la migration puo' restare, il codice vecchio
ignora le tabelle e la colonna; i movimenti registrati nel frattempo non cambiano.

**Rollback dello schema** (solo se serve davvero, dopo il backup sopra e con il tag precedente gia'
in produzione). Se qualcuno ha impostato «Fatturazione da» o creato causali fatturabili, esportare
prima `impostazioni_fatturazione`. Un solo blocco, dentro `BEGIN; ... COMMIT;`, come proprietario:

```sql
BEGIN;
DROP TABLE righe_legame_movimento, legami_movimento, impostazioni_fatturazione;
DROP TYPE origine_quantita_legame, origine_riga_legame, fonte_cliente_legame, stato_legame_movimento;
DROP INDEX righe_addebito_id_elenco_id_tenant_id_key;
DROP INDEX elenchi_addebiti_id_contratto_id_tenant_id_key;
DROP INDEX contratti_cliente_id_cliente_id_tenant_id_key;
ALTER TABLE causali_registro_azienda DROP CONSTRAINT causali_registro_azienda_fatturabile_propria;
ALTER TABLE causali_registro_azienda DROP COLUMN fatturabile;
ALTER TABLE causali_registro DROP COLUMN fatturabile;
DELETE FROM _prisma_migrations WHERE migration_name = '20261103200000_legami_movimento';
COMMIT;
```

Se la migration **fallisce** (P3009) e' transazionale: `SELECT to_regclass('public.legami_movimento')`
deve dare `NULL`; si corregge la causa e si lancia
`npx prisma migrate resolve --rolled-back 20261103200000_legami_movimento`, poi si rilancia il deploy.

---

## Ripristino (Disaster Recovery)

### Script: `restore.sh`

Il ripristino **non elimina mai** il database di produzione: verifica il dump, lo
ripristina in un database nuovo e scambia i nomi solo se tutto è andato bene.

```bash
# 1. Scaricare il backup desiderato (rsync / rclone / manuale)
rsync -az backup@backup-server.example.com:/backups/wasteflow/wasteflow_..._20260610.sql.gz \
  /opt/rifiuti/backups/

# 2. Se cifrato con age, decifrare prima:
# age -d -i ~/.age/key.txt dump.sql.gz.age > dump.sql.gz

# 3. Eseguire il ripristino (chiede conferma interattiva). RIPRISTINO_TAG è
#    obbligatoria: il tag dell'immagine del backend che girerà DOPO il ripristino.
#    Le sue migration devono essere un'estensione dello schema del dump: di norma
#    il tag in produzione quando il dump è stato fatto, o uno successivo.
RIPRISTINO_TAG=sha-1a2b3c4 bash /opt/rifiuti/site/ops/restore.sh \
  /opt/rifiuti/backups/wasteflow_wasteflow_prod_20260610_033000.sql.gz
```

`RIPRISTINO_CONFERMATO=YES` salta la conferma (solo per procedure
automatizzate). Nessuna `DB_PASSWORD` richiesta: `DB_NAME` e `DB_USER` si
leggono dal `.env` senza eseguirlo. Si accettano solo file `.sql.gz` verificati o
`.sql` già decifrati e decompressi: mai `.non-verificato`, `.scartato`,
`.parziale` o `.age`.

Il restore, nell'ordine:

1. Rifiuta i formati non ammessi e verifica il dump (marcatore finale di
   `pg_dump`): un dump troncato si ferma qui, con il backend acceso e il database
   intatto
2. Richiede `RIPRISTINO_TAG` e la esporta come `TAG`, la variabile che sceglie
   l'immagine del backend nel compose (`rifiuti-backend:${TAG}`)
3. Controlla lo spazio libero in `BACKUP_DATI_DIR` (default `/var/lib/docker`):
   dimensione del database × `RIPRISTINO_FATTORE_SPAZIO` (default 2). Se il
   database di produzione non esiste (disaster recovery, volume nuovo) la
   dimensione si stima dal dump decompresso
4. Chiede conferma esplicita (`YES`), poi ferma il backend
5. Ripristina il dump in un database nuovo `<DB>_ripristino_<epoch>_<pid>`, in
   una sola transaction (`psql -1 -v ON_ERROR_STOP=1`); se fallisce elimina il
   database temporaneo, **riavvia il backend** com'era ed esce, con il database di
   produzione intatto
6. Controlla il database ripristinato (almeno una tabella in `public`,
   `_prisma_migrations` leggibile); se fallisce, come al punto 5
7. Scambia i nomi: il database di produzione diventa
   `<DB>_prima_del_ripristino_<AAAAMMGG_HHMMSS>_<pid>` e quello ripristinato
   prende il nome `<DB>` (se il database di produzione non esisteva, il
   ripristinato prende solo il nome)
8. Esegue `prisma migrate deploy` con l'immagine `RIPRISTINO_TAG`. Se fallisce
   esce con errore e **il backend resta fermo**: il database ripristinato è in
   uso con lo schema non allineato, e farlo ripartire nasconderebbe il guasto. Il
   messaggio dice come rilanciare migrate e avvio, oppure come tornare al
   database precedente (rinominarlo in `<DB>` a backend fermo)
9. Ricrea il backend con l'immagine `RIPRISTINO_TAG`
   (`up -d --no-deps backend`, non `start`, che riavvierebbe il container con la
   sua immagine di prima), scrive nel log l'immagine effettiva ed esce con errore
   se non corrisponde al tag

In caso di errore l'ultima riga del log dice in che stato è il database di
produzione: `intatto` (backend riavviato), `quello ripristinato, con lo schema
NON allineato; il precedente è <nome>; il backend resta FERMO`, oppure uno stato
da verificare a mano se lo script è stato interrotto durante lo scambio dei nomi.

**Il database precedente non viene eliminato.** Dopo aver verificato
l'applicazione va eliminato a mano con `DROP DATABASE "<nome>"` (il nome è
nell'ultima riga del log); fino ad allora occupa quanto il database di
produzione.

**Prima e dopo il ripristino, tre cose che lo script non fa:**

- **Non sovrapporlo al backup notturno.** Lo scambio dei nomi termina le
  connessioni al database (`pg_terminate_backend`): un `pg_dump` del cron
  `wasteflow-backup` (03:30) in corso viene interrotto e manda una mail di
  fallimento. Evitare la finestra 03:15-04:30, oppure commentare la riga di
  `/etc/cron.d/wasteflow-backup` per la durata del ripristino e rimetterla dopo.
- **Le cache Redis restano quelle di prima.** Permessi (`perm-check:*`), sessioni
  (`session:*`, `session_epoch:*`) e refresh token (`refresh_token:*`) descrivono
  il database sostituito: un utente disattivato o un ruolo tolto dopo la data del
  dump torna valido nel database, ma una sessione aperta dopo quella data resta
  in Redis. Se il dump è vecchio, togliere quelle chiavi (forza un nuovo login per
  tutti), dal container `redis` (`docker compose ... exec redis sh`): `redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'perm-check:*' | xargs -r redis-cli -a "$REDIS_PASSWORD" DEL`,
  e lo stesso per gli altri prefissi. **Mai `FLUSHALL`**: Redis contiene anche
  le code dei job. Altrimenti accettarle sapendo che scadono da sole, ciascuna con
  la propria durata.
- **Il frontend resta sul tag del deploy.** `restore.sh` ricrea solo il backend
  con `RIPRISTINO_TAG`; il frontend continua con l'immagine dell'ultimo deploy
  fino al deploy successivo. Se i due tag differiscono, verificare che il
  frontend funzioni con quel backend, oppure ricrearlo con lo stesso tag
  (`TAG=<RIPRISTINO_TAG> docker compose ... up -d --no-deps frontend`).

Il ripristino di prova notturno già verifica ogni backup su un database
temporaneo; resta utile provare `restore.sh` su un ambiente di staging.

---

## F2-10 controparti (ditte e sedi)

Migration `20261031110000_ditte_sedi_controparti` (Fase 2 pezzo 10): ogni anagrafica di ruolo
(produttori, trasportatori, destinatari) viene collegata a una **ditta** per (azienda, partita IVA)
e a una **sede**; la stessa P.IVA in più ruoli della stessa azienda diventa UNA ditta. Gli id delle
righe di ruolo non cambiano, FIR e contratti non vengono toccati. La migration è transazionale e si
**ferma** (senza modificare nulla) se una P.IVA non è di 11 cifre.

### Censimento PRIMA del merge (lo lancia l'orchestratore sul VPS)

Sola lettura, soli conteggi:

```bash
docker exec -i <container postgres> psql -U <utente> -d <db>
```

```sql
WITH a AS (
  SELECT 'P' r, tenant_id, btrim(partita_iva) p, lower(btrim(ragione_sociale)) n FROM produttori
  UNION ALL SELECT 'T', tenant_id, btrim(partita_iva), lower(btrim(ragione_sociale)) FROM trasportatori
  UNION ALL SELECT 'D', tenant_id, btrim(partita_iva), lower(btrim(ragione_sociale)) FROM destinatari)
SELECT
  (SELECT count(*) FROM a) AS anagrafiche,
  (SELECT count(*) FROM a WHERE p !~ '^[0-9]{11}$') AS piva_non_conformi,
  (SELECT count(*) FROM (SELECT 1 FROM a GROUP BY tenant_id, p HAVING count(DISTINCT r) > 1) x) AS ditte_fuse,
  (SELECT count(*) FROM (SELECT 1 FROM a GROUP BY tenant_id, p
     HAVING count(DISTINCT r) > 1 AND count(DISTINCT n) > 1) x) AS ditte_fuse_nome_divergente;
```

- `piva_non_conformi > 0` **blocca il merge**: le righe vanno corrette a mano prima.
- `ditte_fuse_nome_divergente` va nel rapporto finale (la ditta prende la ragione sociale della riga
  aggiornata più di recente; le righe di ruolo conservano la propria).

### Ripristino da migration fallita (P3009)

La migration è transazionale (DDL e DML in un solo script: un `RAISE EXCEPTION` annulla tutto).
Se il deploy si ferma con P3009:

1. controllare che la migration non abbia lasciato nulla: `SELECT to_regclass('public.ditte');` deve
   dare NULL (altrimenti non è stata annullata: fermarsi e chiedere);
2. correggere il dato indicato dal messaggio (i soli conteggi per tabella; i valori si cercano con il
   censimento, restringendo la `WHERE` a `p !~ '^[0-9]{11}$'`);
3. sul VPS, in `/opt/rifiuti/site`, dentro il container backend e COME OWNER (lo stesso modo in cui il
   job di deploy esegue `migrate deploy`, `.gitea/workflows/deploy.yml`):
   ```bash
   cd /opt/rifiuti/site
   COMPOSE="docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml"
   $COMPOSE run --rm backend sh -c 'DATABASE_URL="$DATABASE_URL_MIGRAZIONI" npx prisma migrate resolve --rolled-back 20261031110000_ditte_sedi_controparti'
   ```
   (o il nome della migration fallita; le virgolette singole fanno espandere `DATABASE_URL_MIGRAZIONI`
   dentro il container, non sulla shell del VPS), poi rilanciare il deploy.

### Colonne vecchie congelate (`20261031110100_anagrafiche_su_ditte`, Task 3b-2)

La migration richiama l'ultima volta `f210_collega_anagrafiche()` (collega le righe create dal
backend vecchio fra le due migration, perché il deploy applica le migration mentre il vecchio è
ancora in servizio), la elimina, controlla che nessuna riga di ruolo sia senza ditta o sede (se no
`RAISE EXCEPTION` con i soli conteggi per tabella e tutto viene annullato), rende `ditta_id` e
`sede_id` NOT NULL, toglie il NOT NULL a ragione sociale, P.IVA e indirizzo della riga di ruolo,
elimina i tre indici unici `*_tenant_id_partita_iva_key` (l'unicità sta in `ditte`) e commenta le
colonne come "copia congelata". Nessun dato viene cancellato; il lock sulle tabelle vive è limitato
da `SET LOCAL lock_timeout = '5s'`. Se non ottiene il lock la migration fallisce senza modificare
nulla, ma resta segnata come fallita (P3009): prima di rilanciare il deploy serve
`npx prisma migrate resolve --rolled-back 20261031110100_anagrafiche_su_ditte` (stessa procedura
del ripristino da P3009 sopra).

**Finestra di deploy.** Se la 110000 e la 110100 arrivano nello stesso deploy, fra il commit della
110100 e l'avvio del nuovo backend il backend vecchio non può creare anagrafiche (INSERT senza
`ditta_id` → 23502 → 500). Fallisce in modo sicuro, senza toccare dati; le letture non cambiano.
Le **modifiche (PUT)** servite dal backend vecchio nella stessa finestra invece riescono, ma
scrivono solo le colonne congelate, che il codice nuovo non legge più: la modifica va persa senza
alcun errore. Se la finestra non è trascurabile, avvisare di non modificare anagrafiche fra
`migrate` e `up -d`, e rivedere dopo il deploy quelle toccate in quel lasso di tempo.

Da qui il codice nuovo **non scrive più** le colonne vecchie e non le legge, salvo la ragione sociale
(`ragioneSocialeStorica`, usata dal MUD per le integrazioni già salvate). Le righe create dopo il
deploy hanno quelle colonne NULL. Un privato (solo codice fiscale) esiste solo su `ditte`. La
rimozione fisica delle colonne è un seguito (F2-10b).

### Note di rilascio F2-10 (da riportare nel rapporto di deploy)

- **Ditte fuse con nome divergente** (4 nel censimento del 31/10): la ditta prende il nome della riga
  aggiornata più di recente. Da quel momento FIR nuovi, contratti, dashboard, mail di scadenza e
  RENTRI (anche per i FIR già esistenti) usano quel nome per tutti i ruoli; il MUD no (usa la
  ragione sociale storica della riga). Chiedere all'operatore di rivedere quelle ditte dopo il deploy.
- **Rollback del solo codice** (senza lo script di ripristino qui sotto): i FIR firmati con il
  codice fiscale delle parti (`*_codice_fiscale` su `firs`) non sono più verificabili dal codice vecchio.
- **Controlli dopo il deploy** (come owner, sola lettura): `SELECT count(*) FROM ditte;` atteso
  circa 7 (come da censimento); nessuna riga di ruolo senza ditta o sede:
  `SELECT (SELECT count(*) FROM produttori WHERE ditta_id IS NULL OR sede_id IS NULL) +
  (SELECT count(*) FROM trasportatori WHERE ditta_id IS NULL OR sede_id IS NULL) +
  (SELECT count(*) FROM destinatari WHERE ditta_id IS NULL OR sede_id IS NULL);` deve dare 0 (con i
  NOT NULL della 110100 è già garantito dallo schema: il controllo conferma che la migration è applicata).
- Su una sede già esistente i contatti nuovi non sovrascrivono mai quelli registrati: la risposta
  porta un avviso e i contatti si cambiano da "Sedi".

### Rollback

Fino alla `20261031110000_ditte_sedi_controparti` il rollback del codice è innocuo (le migration
sono additive e le colonne vecchie non cambiano). **Dopo** la `20261031110100_anagrafiche_su_ditte`
il codice vecchio non legge le anagrafiche create dopo il deploy (colonne vecchie NULL) e non
conosce i privati: il rollback richiede il **ripristino del backup notturno** oppure lo script
inverso qui sotto (come owner, prima del rollback del codice).

**Privati (`partita_iva` NULL, solo produttori per D2.5): vanno decisi a mano PRIMA**, cancellando
la riga di ruolo o assegnando una P.IVA. Controllo:
`SELECT count(*) FROM produttori r JOIN ditte d ON d.id = r.ditta_id WHERE d.partita_iva IS NULL;`
Se ce ne sono, il `SET NOT NULL` sulla P.IVA fallisce: lo script è in una transazione, quindi
**non modifica nulla** (lanciarlo con `psql -v ON_ERROR_STOP=1`).

Lo script ricostruisce le colonne vecchie dalla ditta e dalla sede predefinita, rimette i NOT NULL e
gli indici unici, **ricrea `f210_collega_anagrafiche()`** (il redeploy rilancerebbe la 110100, che la
chiama: senza, "function does not exist" → P3009) e **cancella la riga della 110100 da
`_prisma_migrations`** (`migrate resolve --rolled-back` su una migration applicata con successo è
rifiutato da Prisma, P3012). La funzione si prende dalla 110000 e lo script si trova in `ops/f210-rollback.sql`:

```bash
cd /opt/rifiuti/site
COMPOSE="docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml"
MIGR=apps/backend/prisma/migrations/20261031110000_ditte_sedi_controparti/migration.sql
{ echo 'BEGIN;'
  sed -n '/^CREATE FUNCTION f210_collega_anagrafiche/,/^\$f210\$;/p' "$MIGR"
  echo 'REVOKE EXECUTE ON FUNCTION f210_collega_anagrafiche() FROM PUBLIC;'
  cat ops/f210-rollback.sql
} | $COMPOSE exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Tutto passa su STDIN in un solo flusso, dentro il container `postgres` (il client `psql` gira lì: non
serve copiare file). `$POSTGRES_USER` è il proprietario del database (`DB_USER`), le virgolette
singole fanno espandere le variabili dentro il container. Lo script è
[`ops/f210-rollback.sql`](f210-rollback.sql): ricostruisce le colonne vecchie, rimette i NOT NULL e
gli indici unici e cancella la riga della 110100 da `_prisma_migrations`; la `BEGIN;` e la funzione
sono anteposte dal comando. Con `ON_ERROR_STOP` un errore interrompe il flusso e la transazione non
viene confermata (nessuna modifica).

Provato per intero (il 31/10, con il comando sopra via `docker exec -i … sh -c 'psql …'`) su un
database temporaneo (migrate deploy fino alla 110100, rollback, nuovo
`migrate deploy` che riapplica la 110100 senza errori). Le ditte e le sedi create dopo il deploy
restano in `ditte`/`sedi_ditte` (il codice vecchio le ignora).

### Sede e codice fiscale delle parti del FIR (`20261031110200_fir_parti_sede_cf`, Task 5a)

Additiva: cinque colonne NULL su `firs` (`producer_sede_id`, `receiver_sede_id`,
`producer_codice_fiscale`, `carrier_codice_fiscale`, `receiver_codice_fiscale`), nessun backfill,
nessuna FK (snapshot), nessuna policy (`firs` è già sotto RLS). `SET LOCAL lock_timeout = '5s'`:
se non ottiene il lock fallisce senza modificare nulla ma resta segnata come fallita (P3009), quindi
prima di rilanciare il deploy `npx prisma migrate resolve --rolled-back 20261031110200_fir_parti_sede_cf`.

Ripristino: `ALTER TABLE firs DROP COLUMN producer_sede_id, DROP COLUMN receiver_sede_id,
DROP COLUMN producer_codice_fiscale, DROP COLUMN carrier_codice_fiscale,
DROP COLUMN receiver_codice_fiscale;` e `DELETE FROM _prisma_migrations WHERE migration_name =
'20261031110200_fir_parti_sede_cf';`. Il codice vecchio ignora le colonne; i FIR con il codice fiscale
nel documento firmato (privati) non sarebbero più verificabili dopo un `DROP COLUMN`.

### Pese: modello dati (`20261101600000_pese_modello_dati`, Fase 4 pezzo 8a, Task 2a)

Additiva: 5 tipi enum e 7 tabelle nuove (`strumenti_pesa`, `automezzi`, `accessi_pesa`, `pesate`,
`rettifiche_peso`, `allegati_pesa`, `collegamenti_accesso`) con trigger di immutabilità e RLS
(`ENABLE` + `FORCE`, `isolamento_azienda` e `sola_lettura`). Nessun backfill, nessuna modifica alle
colonne esistenti; le FK verso `waste_movements`, `firs`, `registri_rifiuti`, `trasportatori` sono
create con `SET LOCAL lock_timeout = '5s'`: se il lock non arriva la migration fallisce senza
modificare nulla ma resta segnata come fallita (P3009), quindi prima di rilanciare il deploy
`npx prisma migrate resolve --rolled-back 20261101600000_pese_modello_dati`. La migration esegue i
REVOKE dei privilegi (D4) per `wasteflow_app` e `wasteflow_sistema` solo se i ruoli esistono.

Ripristino (le tabelle sono nuove, nessun dato esistente le usa): `DROP TABLE collegamenti_accesso,
rettifiche_peso, pesate CASCADE; DROP TABLE accessi_pesa, automezzi, allegati_pesa, strumenti_pesa
CASCADE;` poi `DROP FUNCTION pesate_immutabile(), pesate_controlli(), rettifiche_peso_immutabile(),
rettifiche_peso_controlli(), allegati_pesa_immutabile(), accessi_pesa_controlli(),
collegamenti_accesso_controlli();` poi `DROP TYPE tipo_collegamento_accesso, origine_tara,
stato_accesso_pesa, modo_pesatura, fonte_pesata;` e `DELETE FROM _prisma_migrations WHERE
migration_name = '20261101600000_pese_modello_dati';`. Con dati già inseriti le pesate (e gli
allegati) sono documentazione del registro e del FIR: esportarle prima di un `DROP`.

#### Pese 4.8a: privilegi, trigger, rilascio e rollback

La migration `20261101600100_pese_cancellazione_e_indici` completa la precedente (entrambe mai applicate
fuori dai database di test; sono state rinumerate da `20261101400000/400100` a `600000/600100` perche'
F2-9, gia' in produzione, ha `20261101500000`).

- **Privilegi (`ops/db-ruoli.sh`, `prisma/sql/ruoli-db.sql`):** `pesate`, `rettifiche_peso`,
  `allegati_pesa` ricevono a `wasteflow_app` e `wasteflow_sistema` solo SELECT e INSERT (REVOKE
  esplicita di UPDATE/DELETE/TRUNCATE). Dopo ogni `migrate deploy` rilanciare `ops/db-ruoli.sh`.
- **Trigger:** le tre tabelle sono immutabili (UPDATE rifiutato) e senza DELETE/TRUNCATE a qualunque
  ruolo, proprietario compreso; passa solo la cascata da `tenants`. `accessi_pesa` e
  `collegamenti_accesso` hanno trigger di coerenza (stato, registro, verso, FOR SHARE sull'accesso).
  Per correggere un peso si registra una rettifica (ADMIN), mai un UPDATE.
- **RLS:** 44 tabelle con `tenant_id` dopo questo pezzo (37 + le 7 delle pese);
  `rls-catalogo.postgres.spec.ts` lo verifica.
- **Dopo il deploy:** `SELECT count(*) FROM accessi_pesa` risponde (0 all'inizio); la feature `pese`
  e' applicata solo nell'interfaccia (menu), non nel backend.
- **nginx:** il frontend (`apps/frontend/nginx.conf`) ha gia' `client_max_body_size 6m` su `/api/`
  (allegati delle pesate, 5 MB); il vhost del VPS e' gia' a 25m: nulla da fare sul VPS.
- **Rollback del codice:** il codice vecchio ignora le tabelle. Le consegne FIR fatte col netto di un
  accesso restano valide (il peso e' scritto nel FIR). **Controllare prima** quanto e' stato
  registrato: `SELECT tenant_id, count(*) FROM accessi_pesa GROUP BY 1;` e avvisare che le pesate
  non saranno piu' visibili nel programma.
- **Rollback dei dati:** le pesate sono documentazione e per costruzione non si cancellano. La strada
  e' il restore del backup; il ripristino a mano sopra (DROP) vale solo su un database SENZA accessi.
  Se la migration fallisce con P3009: `npx prisma migrate resolve --rolled-back
  20261101600000_pese_modello_dati` (o `...600100_pese_cancellazione_e_indici`) e rilanciare.

---

## F2-9 trasmissione del registro a RENTRI

Migration `20261101500000_trasmissione_registro_rentri`: tabella `movimenti_trasmissione_rentri`
(una riga per movimento trasmesso o in via di trasmissione; nessuna riga = non trasmesso), colonna
`registri_rifiuti.invio_rentri_automatico_dal`, CHECK di formato e unico per azienda
dell'`identificativo_rentri` del registro. Additiva: nasce vuota, nessun invio retroattivo, nessun
GRANT (default privileges di `ops/db-ruoli.sh`).

- **Dopo il deploy non parte nessun invio.** La tabella nasce vuota e nessun registro ha un
  identificativo: per attivare la trasmissione un amministratore deve inserire l'identificativo
  RENTRI del registro (`R` + 10 caratteri, dal portale) e, se vuole l'invio automatico, scegliere la
  modalita' "da oggi". Fino ad allora il job non trova nulla da fare.
- **Chi arriva da WinWaste** deve prima usare "Dichiara gia' su RENTRI" per le annotazioni gia'
  inviate dall'altro programma (altrimenti vengono ritrasmesse come doppie registrazioni), poi
  confrontare con "Verifica allineamento".
- **Controllo post-deploy:** `SELECT stato, count(*) FROM movimenti_trasmissione_rentri GROUP BY 1`
  (atteso: nessuna riga) e, nei log del backend, il job di trasmissione che gira senza errori e
  senza invii.
- **Rollback del codice: innocuo.** Il codice vecchio ignora la tabella e le colonne. Prima del
  rollback eseguire `SELECT stato, count(*) FROM movimenti_trasmissione_rentri GROUP BY 1` e avvisare
  che, dopo il rollback, lo stato delle trasmissioni non sara' piu' visibile nel programma.
- **Interruttore di emergenza degli invii del registro** (seguito del 31/10/2026): variabile
  `RENTRI_REGISTRO_INVII_ATTIVI`, **attiva di default**; solo il testo esatto `false` sospende gli
  invii (`FALSE`, `0`, `no`, spazi: restano attivi, di proposito). Per spegnere: aggiungere
  `RENTRI_REGISTRO_INVII_ATTIVI=false` a `/opt/rifiuti/.env` e riavviare il backend
  (`docker compose --env-file /opt/rifiuti/.env -f docker-compose.prod.yml up -d backend`); per
  riaccendere: togliere la riga (o metterla a `true`) e riavviare. Da spenti: nessuna prenotazione e
  nessuna POST verso RENTRI (il job lo scrive una volta per giro: «Invii RENTRI sospesi»); le
  annotazioni continuano ad accodarsi e a essere adottate, "Trasmetti" risponde 202 con
  `avvio: 'SOSPESO'` e la pagina dice «Invii verso RENTRI sospesi dall'amministratore del sistema».
  La ripresa degli esiti (solo GET) continua, quindi le transazioni gia' aperte si chiudono. Alla
  riaccensione parte tutto quello che si e' accumulato in coda: controllare prima il numero di
  righe `DA_TRASMETTERE` (`SELECT count(*) FROM movimenti_trasmissione_rentri WHERE stato =
  'DA_TRASMETTERE' AND escluso_il IS NULL`).
- **Esclusione di una singola annotazione dall'invio automatico** (seguito del 31/10/2026, migration
  `20261102100000_rentri_esclusione_invio_automatico`: tre colonne nullable `escluso_il`,
  `escluso_da`, `motivo_esclusione` su `movimenti_trasmissione_rentri` e un CHECK che le ammette solo
  con `stato = 'DA_TRASMETTERE'`; RLS invariata, nessuna tabella nuova). Solo ADMIN, con motivo e
  audit (`RENTRI_REGISTRO_ESCLUSO_INVIO_AUTOMATICO` / `..._RIINCLUSO_INVIO_AUTOMATICO`, senza testo
  libero). Una riga esclusa resta `DA_TRASMETTERE` ma `prenota` non la sceglie e l'adozione non la
  ricrea; l'inclusione di nuovo la cancella (non e' mai partita) e il job la riadotta se spetta.
  Righe in volo, incerte o trasmesse non si possono escludere (409 e CHECK del database).
  Controllo: `SELECT count(*) FROM movimenti_trasmissione_rentri WHERE escluso_il IS NOT NULL`.
  Rollback del codice: innocuo (il codice vecchio ignora le colonne, ma una riga esclusa verrebbe
  allora inviata dal job: prima di tornare indietro reincludere o accettare l'invio).
- **Mai cancellare righe `TRASMESSA` per "ripartire"**: l'annotazione verrebbe ritrasmessa a RENTRI
  (doppia registrazione). I trigger rifiutano il DELETE diretto di una riga `TRASMESSA`,
  `GIA_SU_RENTRI`, `INCERTA`, `IN_INVIO` e `ATTESA_ESITO`; la cancellazione a cascata di un'azienda
  passa.
- **Ripristino a mano della migration: solo per un database SENZA trasmissioni** (i dati
  andrebbero persi):

  ```sql
  DROP TABLE movimenti_trasmissione_rentri;
  DROP FUNCTION movimenti_trasmissione_rentri_immutabile(), movimenti_trasmissione_rentri_no_delete();
  DROP TYPE stato_trasmissione_rentri, origine_trasmissione_rentri;
  ALTER TABLE registri_rifiuti
    DROP CONSTRAINT registri_rifiuti_tenant_identificativo_rentri_key,
    DROP CONSTRAINT registri_rifiuti_identificativo_rentri_check,
    DROP COLUMN invio_rentri_automatico_dal;
  DELETE FROM _prisma_migrations WHERE migration_name = '20261101500000_trasmissione_registro_rentri';
  ```

---

## Rollback

Se lo smoke test fallisce dopo `migrate` e `up -d`, i container nuovi restano
su. Il workflow di deploy **non** può rilasciare un tag precedente:
`workflow_dispatch` non ha input e lo script fa sempre
`git reset --hard origin/master` e rilascia l'immagine di `github.sha`
(`deploy.yml`: trigger `workflow_dispatch` e passo "Deploy via SSH").

Il rollback reale è quindi `git revert -m 1 <commit di merge>` su `master` e la
pipeline intera (build delle immagini di 30-40 minuti sul runner condiviso, più
il deploy). È possibile solo se le migration del rilascio sono additive (per la
Fase 0 lo sono: il piano C aggiunge una colonna nullable e un indice, ignorati
dal codice vecchio; vedere nel piano C il caso limite di Capodanno).
Vale per lo schema, non per un dato: se un'azienda ha impostato il **progressivo
iniziale** del registro (piano R) e il codice torna indietro **prima** del primo
movimento di quell'anno, il codice vecchio numera da 1 e ignora l'impostazione
senza dirlo. Prima del rollback controllare `registro_progressivi_iniziali`
per l'anno in corso e avvisare le aziende interessate.

Stesso discorso per le **giacenze iniziali** del registro (Fase 2 pezzo 2, tabella
`giacenze_iniziali`): il codice vecchio non le conosce, quindi dopo un rollback le
aperture sono ignorate e gli scarichi che contavano su di loro tornano bloccati
per giacenza insufficiente (o, se erano gia' registrati, il saldo risulta
negativo). Prima del rollback controllare `SELECT tenant_id, count(*) FROM
giacenze_iniziali GROUP BY 1` e avvisare le aziende interessate; la tabella resta
nel database (migration additiva) e riprende a contare al ripristino del codice.

Stesso discorso per **rettifiche e annullamenti** (Fase 2 pezzo 3, colonne
`tipo_annotazione`, `movimento_rettificato_id`, `movimento_originale_id`,
`motivo_annotazione`, `hash_versione` su `waste_movements`): il codice vecchio non
le conosce, quindi dopo un rollback le correzioni conterebbero come movimenti
ordinari (un annullamento sommerebbe la quantita' invece di toglierla, una
rettifica si sommerebbe all'annotazione che corregge) e giacenze, MUD e anomalie
risulterebbero sbagliati. **Prima del rollback** controllare `SELECT tenant_id,
tipo_annotazione, count(*) FROM waste_movements WHERE tipo_annotazione <>
'ORDINARIA' GROUP BY 1, 2`: se non e' vuoto, il rollback del codice non e'
innocuo e va concordato con le aziende interessate. Le colonne restano nel
database (migration additiva) e tornano a contare al ripristino del codice.

Stesso discorso per le **causali del registro** (Fase 2 pezzo 5, tabelle `causali_registro` e
`causali_registro_azienda`, colonna `waste_movements.causale_azienda_id`): il codice vecchio
conosce solo le 11 causali di sempre, quindi dopo un rollback le causali `AZ_...` tornano
`ESCLUSO` nel MUD e non sono piu' registrabili (i movimenti gia' registrati restano, con la causale
come testo). **Prima del rollback** controllare `SELECT tenant_id, count(*) FROM
causali_registro_azienda GROUP BY 1` e `SELECT tenant_id, count(*) FROM waste_movements WHERE
causale_azienda_id IS NOT NULL GROUP BY 1`: se non sono vuote, avvisare le aziende interessate. Le
tabelle e la colonna restano nel database (migration additiva) e tornano a contare al ripristino del
codice; il ripristino a mano dello schema e' nel commento iniziale della migration
`20261030100000_causali_registro`. Dopo ogni `prisma migrate deploy` va rieseguito
`ops/db-ruoli.sh`: la sola lettura di `causali_registro` per i ruoli applicativi sta anche li'.

**Attenzione dopo un rollback del codice con la colonna ancora presente:** la rettifica o
l'annullamento di un movimento che ha una causale `AZ_...` FALLISCONO. Il codice vecchio non scrive
`causale_azienda_id` nel movimento di storno, e il CHECK `waste_movements_causale_azienda_coerente`
respinge l'insert (causale `AZ_...` senza `causale_azienda_id`). Le altre causali non sono toccate.

Se si ripristina a mano anche lo schema (elenco nel commento iniziale della migration
`20261030100000_causali_registro`), vanno cancellate anche le 2 righe di `_prisma_migrations`,
altrimenti `prisma migrate deploy` non le riapplica al successivo rilascio:
`DELETE FROM _prisma_migrations WHERE migration_name IN ('20261030100000_causali_registro',
'20261030100100_causali_disattivazione_check');`. La migration `..._disattivazione_check` va
annullata per prima (il suo ripristino e' nel proprio commento iniziale). Le migration gia' applicate
in produzione non si modificano: il commento iniziale resta com'e'.

Stesso discorso per le **soglie del deposito temporaneo** (Fase 2 pezzo 6, tabella
`soglie_deposito_temporaneo`): il codice vecchio la ignora, quindi dopo un rollback la pagina
del deposito torna all'eta' "dal primo carico" e ai 90 giorni fissi, e le soglie
personalizzate dalle aziende tornano quelle fisse. **Prima del rollback** controllare
`SELECT tenant_id, count(*) FROM soglie_deposito_temporaneo GROUP BY 1` e avvisare le aziende
interessate. La tabella resta nel database (migration additiva) e riprende a contare al
ripristino del codice; il ripristino a mano dello schema e' nel commento iniziale della
migration `20261031100000_soglie_deposito_temporaneo`.

Stesso discorso per **modifica e cancellazione dei contratti** (Fase 4 pezzo 0, colonne
`versione`, `eliminato_il`, `eliminato_da` di `contracts`): il codice vecchio ignora le colonne,
quindi **dopo un rollback i contratti eliminati ricompaiono** nella lista (e un contratto
eliminato in `DRAFT` potrebbe essere attivato). Prima del rollback, **come owner** (con RLS
FORCE il ruolo applicativo vedrebbe 0 righe e il controllo darebbe un falso "vuoto"):
`SELECT tenant_id, count(*) FROM contracts WHERE eliminato_il IS NOT NULL GROUP BY 1`; se non
e' vuoto, avvisare le aziende o portare quei contratti a `TERMINATED` con una query concordata.
Caso inverso: un contratto eliminato e poi riattivato (o portato a `TERMINATED`) durante il
rollback **sparisce di nuovo** al roll-forward, perche' `eliminato_il` e' ancora valorizzato:
rifare il controllo di sopra prima di tornare al codice nuovo e, se serve, azzerare
`eliminato_il`/`eliminato_da` di quei contratti. La FK `contracts_tenant_id_fkey` resta e il
codice vecchio non ne risente. Il ripristino a mano
dello schema e' nel commento della migration `20261101200000_contratti_modifica_eliminazione`.

Stesso discorso per le **tabelle di fatturazione** (Fase 4 pezzo 1, prima migration
`20261102200000_anagrafiche_fatturazione_cliente`: `condizioni_pagamento`, `conti_correnti`,
`spese_accessorie`, `registri_iva`, `testi_fatturazione`, `codifiche_contratto`). Rollback del
codice: innocuo, il codice vecchio ignora le tabelle. Prima di un ripristino dello schema
controllare, **come owner** (con RLS FORCE il ruolo applicativo vedrebbe 0 righe):
`SELECT tenant_id, count(*) FROM condizioni_pagamento GROUP BY 1` e lo stesso per le altre cinque
tabelle; se non sono vuote i dati si perdono, quindi esportarli prima. Se e' applicata
`20261102200100_…` (4.1b), ripristinare prima quella, poi questa. Il ripristino a mano dello
schema e' nel commento della migration.

**Clienti, agenti e contratti cliente** (Fase 4 pezzo 1, seconda migration
`20261102200100_clienti_agenti_contratti_cliente`: `agenti`, `clienti`, `contratti_cliente`,
`periodi_fatturazione_cliente`, `allegati_contratto_cliente`). Rollback del codice: innocuo, il
codice vecchio ignora le tabelle; la sede predefinita di un cliente o di un agente torna
disattivabile finche' il codice nuovo non rientra (il codice vecchio non conosce quei due ruoli).
Prima di un ripristino dello schema controllare, **come owner** (con RLS FORCE il ruolo
applicativo vedrebbe 0 righe): `SELECT tenant_id, count(*) FROM clienti GROUP BY 1` e lo stesso
per `agenti`, `contratti_cliente` e `allegati_contratto_cliente`; se non sono vuote i dati si
perdono, quindi esportarli prima (gli allegati sono file PDF nel database: `COPY ... TO` con
`encode(contenuto, 'base64')`). Si ripristina questa PRIMA della `20261102200000_...`. Se e'
applicata la `20261102300000_listino_archivio_addebiti`, ripristinare prima quella: aggiunge colonne
a `clienti`, quindi il suo `DROP COLUMN` fallirebbe dopo il `DROP TABLE clienti`. Il
ripristino a mano dello schema e' nel commento della migration.

**Archivio addebiti e codici IVA** (Fase 4 pezzo 2a, prima migration
`20261102300000_listino_archivio_addebiti`: `codici_iva`, `codifiche_addebito`, `addebiti`,
`prezzi_listino_addebito`, piu' le colonne `listino`, `provvigione_predefinita` e
`tipo_provvigione_predefinita` su `clienti`). Rollback del codice: innocuo, il codice vecchio ignora
tabelle e colonne nuove. Prima di un ripristino dello schema controllare, **come owner** (con RLS
FORCE il ruolo applicativo vedrebbe 0 righe): `SELECT tenant_id, count(*) FROM addebiti GROUP BY 1` e
lo stesso per `codici_iva`, `codifiche_addebito` e `prezzi_listino_addebito`, piu'
`SELECT count(*) FROM clienti WHERE listino IS NOT NULL OR provvigione_predefinita IS NOT NULL`: se
non sono vuote i dati si perdono, quindi esportarli prima (`COPY ... TO`). Ordine: si ripristina
prima la seconda migration del pezzo (`20261102300100_listino_elenchi_righe`, che cita queste
tabelle), poi questa. Il ripristino a mano dello schema e' nel commento della migration. Attenzione
al deploy: la migration fa `ALTER TABLE clienti ADD COLUMN` dentro la sua transazione e il lock
(ACCESS EXCLUSIVE) dura fino al commit, quindi per quei pochi istanti letture e scritture sui
clienti aspettano; `NOT VALID` + `VALIDATE` dei due CHECK non cambia questo, perche' il lock
dell'`ALTER TABLE` resta. `lock_timeout` di 5 secondi fa fallire la migration invece di accodare
tutto dietro una transazione lunga su `clienti`: si rilancia il deploy. Se e' applicata anche la `20261102300100_listino_elenchi_righe` (elenchi e righe), ripristinare prima quella.

**Elenchi e righe di addebito** (Fase 4 pezzo 2b, seconda migration
`20261102300100_listino_elenchi_righe`: `elenchi_addebiti`, `allegati_elenco_addebiti`,
`righe_addebito`, `scaglioni_riga_addebito`, `scadenze_riga_addebito`). Solo tabelle e tipi nuovi:
nessun `ALTER` su tabelle esistenti, quindi nessun blocco in deploy. Rollback del codice: innocuo, il
codice vecchio ignora le tabelle nuove. Prima di un ripristino dello schema controllare, **come
owner** (con RLS FORCE il ruolo applicativo vedrebbe 0 righe): `SELECT tenant_id, count(*) FROM
elenchi_addebiti GROUP BY 1` e lo stesso per `righe_addebito` (con fasce, scadenze e allegati
dipendenti); se non sono vuote i dati si perdono, quindi esportarli prima (`COPY ... TO`). Ordine: se
si ripristinano **entrambe** le migration del pezzo, questa va ripristinata **prima** della
`20261102300000_listino_archivio_addebiti` (le sue FK citano addebiti, codici IVA e codifiche). Il
ripristino a mano e' nel commento di testa della migration:
`DROP TABLE scadenze_riga_addebito, scaglioni_riga_addebito, righe_addebito, allegati_elenco_addebiti,
elenchi_addebiti; DROP TYPE applica_prezzo_speciale, tipologia_rifiuto_addebito,
tipo_quantita_addebito;` e `DELETE FROM _prisma_migrations WHERE migration_name =
'20261102300100_listino_elenchi_righe'`. Un'unica clausola non rappresentabile da Prisma,
`NULLS NOT DISTINCT` sull'unico delle righe, e' solo nel SQL (come `giacenze_iniziali`): `migrate
diff` resta vuoto.

**Legami movimento-cliente-prezzo** (Fase 4 pezzo 3, migration `20261103200000_legami_movimento`:
`legami_movimento`, `righe_legame_movimento`, `impostazioni_fatturazione`, flag `fatturabile` delle
causali). Tabelle e tipi nuovi, piu' due `ADD COLUMN` su tabelle piccole e tre `CREATE UNIQUE INDEX`
additivi sul listino: in deploy il lock dura pochi istanti e `lock_timeout` di 5 secondi fa fallire
la migration invece di accodare tutto (si rilancia il deploy). Nessuna colonna su `waste_movements`.
Rollback del codice: innocuo, il codice vecchio ignora tabelle e colonne nuove. Anche l'inserimento
di una causale aziendale PROPRIA col codice vecchio funziona: `causali_registro_azienda.fatturabile` ha
`DEFAULT false`, quindi il CHECK `causali_registro_azienda_fatturabile_propria` e' soddisfatto e la
causale nasce non fatturabile. Se la migration fallisce per `lock_timeout` (55P03): `npx prisma migrate
resolve --rolled-back 20261103200000_legami_movimento` e si rilancia il deploy.
Prima di un ripristino dello schema controllare, **come owner**: `SELECT tenant_id, stato, count(*)
FROM legami_movimento GROUP BY 1, 2`; se non e' vuota i dati si perdono, quindi esportarli prima
(`COPY ... TO`). Il ripristino a mano e' nel commento di testa della migration e nella riga 0 della
tabella sopra. Le FK `NoAction` verso `righe_addebito`, `elenchi_addebiti`, `contratti_cliente`,
`clienti` e `codici_iva` rendono non eliminabili gli oggetti del listino usati da un legame: dopo il
ripristino tornano eliminabili.

Il ripristino dal backup `wasteflow_predeploy_*` con `restore.sh` si fa solo se
una migration ha alterato dati, e perde le scritture successive al backup. Si fa
**dopo** il `git revert` e la pipeline, con `RIPRISTINO_TAG` uguale al tag del
rilascio **precedente** (quello in produzione prima del deploy da annullare):
`restore.sh` esegue `prisma migrate deploy` con quell'immagine e ci ricrea il
backend, e con il tag del
rilascio da annullare riapplicherebbe proprio la migration che si voleva togliere.

Aggiungere a `deploy.yml` un input `tag` che salti la build è una decisione
aperta (Decisioni aperte, 9).

- I revert dei piani della Fase 0 vanno **solo in ordine inverso** (A, poi C,
  poi D), perché C importa da D e A da C.
- Per rilasciare di nuovo un piano revertito serve il **revert del revert**, non
  un nuovo merge del branch.
- Dopo un revert di A le chiavi scritte in `MUDReport.reportData`
  (`integrazioni`, `esportazioni`, `annullamenti`, ...) restano e il codice
  vecchio le ignora.

---

## 4.6 abbinamenti carico-scarico

Tabella `abbinamenti_carico_scarico` (migration `20261101300000_abbinamenti_carico_scarico`,
additiva): quale carico, o giacenza iniziale, ha coperto quale scarico del registro. Il codice
vecchio la ignora; dopo un rollback del codice la tabella resta e riprende a contare al
ripristino. **Prima del rollback** controllare
`SELECT tenant_id, count(*) FROM abbinamenti_carico_scarico GROUP BY 1` e avvisare le aziende
che hanno abbinamenti manuali (si perdono nella vista, non nel database).

Ripristino a mano dello schema (solo se serve): `DROP TABLE abbinamenti_carico_scarico;
DROP TYPE origine_abbinamento; DROP INDEX giacenze_iniziali_id_registro_tenant_key;` e
`DELETE FROM _prisma_migrations WHERE migration_name = '20261101300000_abbinamenti_carico_scarico';`.

Con il codice vecchio e la tabella ancora presente: cancellare una giacenza iniziale gia'
abbinata fallisce con un errore di chiave esterna non gestito (500); **modificare una giacenza
iniziale gia abbinata** (quantita, CER, data) e **rettificare un carico gia abbinato** (ridurlo
sotto la quantita abbinata, cambiarne CER, unita o data) non vengono controllati: le righe
restano e al ripristino del codice risultano `INCOERENTE`. Gli annullamenti di
movimenti lasciano righe che al ripristino del codice risultano `INCOERENTE` (e si correggono
dalla pagina). Prima di cancellare giacenze iniziali o movimenti col codice vecchio,
controllare `SELECT count(*) FROM abbinamenti_carico_scarico WHERE tenant_id = '<azienda>'`; se
le righe non servono piu', `DELETE FROM abbinamenti_carico_scarico WHERE tenant_id = '<azienda>'`.

Le migration gia' applicate in produzione non si modificano: il commento iniziale resta com'e'.

**Ricalcolo lungo e lock.** Il ricalcolo (`POST /abbinamenti/ricalcolo`) gira in una transazione
con timeout di 60 s (`maxWait` 10 s); l'override a mano di 15 s (`maxWait` 5 s). Finche il
ricalcolo e in corso tiene i lock sui CER dell'ambito: le registrazioni di scarichi
concorrenti sugli stessi CER non lo aspettano a lungo, ma falliscono dopo circa 5 s (timeout
predefinito di Prisma) con un errore e vanno ripetute. Se un ricalcolo supera il timeout viene
annullato per intero; rilanciarlo per CER (`cerCode`) o fuori orario.

**Dopo il deploy, cosa controllare:**
- `SELECT count(*) FROM abbinamenti_carico_scarico` risponde (0 finche nessuno registra scarichi
  di stoccaggio R13/D15; poi cresce con le registrazioni).
- RLS: la tabella ha `ENABLE` e `FORCE ROW LEVEL SECURITY` e la policy `isolamento_azienda`;
  in CI `rls-catalogo.postgres.spec.ts` conta 44 tabelle con RLS.
- Gli scarichi registrati prima del deploy non sono abbinati: l'amministratore li abbina dalla
  pagina Giacenze -> Abbinamenti con "Abbina con FIFO i non abbinati".

## Metriche Prometheus (`/metrics`)

Il backend espone l'endpoint standard Prometheus a:

```
GET http://backend:3000/metrics
```

(NON sotto il prefix `/api/v1` — escluso a livello di app)

### Aggiunta job Prometheus su infra condivisa

Aggiungere al file `/opt/observability/prometheus.yml` sul VPS:

```yaml
scrape_configs:
  # ... job esistenti ...

  - job_name: 'wasteflow-backend'
    static_configs:
      - targets: ['backend:3000'] # rete compose 'wasteflow'
    metrics_path: /metrics
    scrape_interval: 30s
    scrape_timeout: 10s
```

Poi ricaricare Prometheus a caldo (senza restart):

```bash
curl -s -X POST http://127.0.0.1:9091/-/reload
```

Verificare che il target sia UP:

```
http://grafana.ignicraft.com/explore → selezionare datasource prometheus-infra
→ query: up{job="wasteflow-backend"}
```

> **Nota**: affinché Prometheus (container nella rete `monitoring`) raggiunga
> il backend (rete `wasteflow`), il container backend deve essere collegato a
> entrambe le reti. Il `docker-compose.prod.yml` già include
> `networks: [wasteflow, monitoring]` per il servizio backend.

---

## Error tracking (Bugsink)

**Attivo dal 23/10/2026.** Progetto Bugsink `wasteflow` (id 5), UI su
`https://error.ignicraft.com`.

- **Backend**: `SENTRY_DSN` in `/opt/rifiuti/.env`, passata al container da
  `docker-compose.prod.yml` (con `SENTRY_ENVIRONMENT`, default `production`).
  Usa il DSN interno, perche' il backend e' sulla rete `monitoring`:

  ```
  SENTRY_DSN=http://<32hex-senza-trattini>@bugsink:8000/5
  ```

  Dopo una modifica al DSN il container va **ricreato** (`restart` non rilegge
  l'env):

  ```bash
  docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml up -d backend
  ```

- **Frontend**: il DSN pubblico (`https://<chiave>@error.ignicraft.com/5`) sta
  in `apps/frontend/src/environments/environment.prod.ts` ed entra nel bundle
  alla build; la CSP di `apps/frontend/nginx.conf` ammette
  `https://error.ignicraft.com` in `connect-src`.

La chiave del DSN si legge dal progetto Bugsink (`sentry_key` con i trattini
tolti).

Il progetto su Bugsink si crea con `docker exec bugsink bugsink-manage shell`
(`from projects.models import Project`); la chiave del DSN va scritta senza trattini.

### Cosa viene inviato

- I 5xx dell'API, tranne i 503 delle rotte `/health` (sono il segnale normale di un
  controllo che fallisce; Decisione 4). Tag `correlationId` e `statusCode`, utente (solo
  `id`), `tenantId` e percorso senza query string.
- Gli errori dei job schedulati (`@Cron`), con il tag `job` (il nome del metodo) e, per gli
  errori per tenant dei tre job RENTRI, il tag `tenantId`.
- Prova d'invio: come al passo 7.5 del piano (`docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md`), provocare un errore e leggere l'evento in Bugsink.

### Dati personali

Gli eventi non portano corpo, header, cookie né query string della richiesta (né query e fragment delle chiamate HTTP in uscita nei breadcrumb), e l'utente è
ridotto al solo `id` (Decisione 5; `apps/backend/src/core/monitoring/opzioni-sentry.ts`).
Ogni aggiornamento dell'SDK va seguito dalla lettura di un evento vero, come al passo 7.5 del piano `docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md`,
per verificare che le opzioni abbiano ancora l'effetto voluto.

### Limite del guardiano dei job

Il test `segnala-errore-job.spec.ts` verifica che ogni metodo `@Cron` chiami
`segnalaErroreJob`. È un controllo testuale: non vede gli errori inghiottiti da un `catch`
interno (i `catch` per utente di `checkMudDeadlines` restano solo nel log).

### Orari dei job

Sono in UTC, perché il backend non ha `TZ` (Decisione 10): `EVERY_DAY_AT_8AM` sono le 09:00
italiane d'inverno e le 10:00 d'estate.

---

## Invio email (SMTP)

Attivato l'11/09/2026. Casella dedicata al prodotto:
`wasteflowsoftware@gmail.com`.

### Le due trappole, verificate sul campo

**1. La password dell'account NON funziona.** Dal 2022 Google non accetta più
le credenziali normali per l'accesso SMTP dei programmi: risponde
`535 5.7.8 Username and Password not accepted`. Serve una **password per app**,
16 caratteri minuscoli in 4 gruppi, da `myaccount.google.com/apppasswords`.

La voce **non compare** finché la verifica in due passaggi non è attiva
sull'account — Google la nasconde del tutto, non la mostra disabilitata. Se il
pannello dice «L'impostazione che stai cercando non è disponibile», è quello il
motivo, non un problema del browser.

**2. Prima ancora, il compose non passava le variabili al container.** Le
credenziali potevano stare in `/opt/rifiuti/.env` e il backend non le vedeva:
l'invio falliva all'avvio con «Missing credentials for PLAIN» qualunque cosa ci
fosse nel file. Le variabili `SMTP_*`, `EMAIL_FROM` e
`ACCESS_REQUEST_NOTIFY_EMAIL` sono ora dichiarate in `docker-compose.prod.yml`.

### Configurazione

In `/opt/rifiuti/.env` (mode 600, mai versionato):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=wasteflowsoftware@gmail.com
SMTP_PASSWORD=<password per app, 16 caratteri SENZA spazi>
EMAIL_FROM=wasteflowsoftware@gmail.com
ACCESS_REQUEST_NOTIFY_EMAIL=wasteflowsoftware@gmail.com
```

**Porta 465 e non 587**: il provider del VPS blocca la 587 in uscita, e il
codice attiva TLS solo se `SMTP_PORT` vale **esattamente** `'465'`
(`email.service.ts`). **`SMTP_USER` deve coincidere con `EMAIL_FROM`**,
altrimenti Gmail riscrive il mittente e i messaggi finiscono nello spam.

Poi ricreare il backend (non basta `restart`: le variabili si leggono alla
creazione del container):

```bash
cd /opt/rifiuti/site
docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml up -d backend
```

### Verifica

All'avvio il log deve dire `SMTP server ready to send emails` e **non** deve
contenere `Missing credentials`:

```bash
docker logs rifiuti-backend-1 2>&1 | grep -iE "SMTP|Missing credentials"
```

Ma «pronto» non è «consegnato»: per una prova vera, inviare un messaggio e
controllare che arrivi davvero in casella.
