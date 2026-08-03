# Aziende madre e figlie — isolamento dei dati fra società dello stesso gruppo

**Data**: 2026-08-03
**Stato**: design approvato, da pianificare
**Origine**: richiesta PO — «voglio che le aziende di uno stesso tenant abbiano i dati isolati e che per ognuna di loro ci sia una configurazione per il RENTRI», precisata in «lo scopo è l'isolamento dei dati tra le aziende figlie di una azienda madre (che gestisce contratto e potrebbe essere il consulente)».

## 1. Il punto di partenza, verificato sul codice

Nel modello attuale **il tenant È l'azienda**: `Tenant` porta P.IVA, ragione sociale e i dati del dichiarante MUD (`schema.prisma`, modello `Tenant`). Non esiste una sotto-entità azienda, e chi gestisce più società ha più tenant.

Il flusso «il consulente crea le sue aziende» esiste già ed è in esercizio:

- un ADMIN con `User.companyLimit` crea aziende da `/admin/tenants`: piano TRIAL forzato, `ownerUserId` = se stesso, ruoli di sistema seminati, e creazione automatica della `ConsultantTenantAssociation` con ruolo ADMIN (`application/admin/tenant.service.ts`, `associateOwner`);
- le vede in «Le mie aziende» con il badge della quota, le seleziona dal selettore e ci lavora dentro (`GET /me/tenants`, `POST /me/switch-tenant`, `api/me/membership.service.ts`);
- **ogni azienda ha già la propria configurazione RENTRI**: `RentriCredential` è `@unique` sul tenant (certificato, `num_iscr` operatore, `credentials_id` di firma remota) con le proprie `RentriUnitaLocale` per le sedi.

Quindi il requisito «configurazione RENTRI per ogni azienda» è **già soddisfatto** dal modello esistente. Ciò che mancava non era il modello ma la tenuta dell'isolamento, corretta e rilasciata in produzione il 2026-08-03 (commit `deb8949`: fonte unica dell'azienda attiva, incarico consulente scaduto, job PDF senza tenant, `RENTRISyncLog` fuori dalla RLS, destinatari MUD non filtrati).

Ciò che manca davvero è il **livello di gruppo**: le aziende di un consulente sono N tenant indipendenti, senza nulla che le leghi, con un abbonamento ciascuna e senza una vista d'insieme (la dashboard aggregata esistente è per giunta rotta, vedi §4).

## 2. Decisioni prese

| Domanda | Decisione |
|---|---|
| Natura delle aziende nel gruppo | Misto: società distinte, sedi e rami. Le **sedi** restano modellate da `RentriUnitaLocale`; il livello nuovo è la persona giuridica |
| Rapporto col multi-tenant esistente | Convivono: multi-tenant fra clienti diversi, gerarchia madre-figlie dentro il gruppo |
| Configurazione RENTRI | Una per azienda, sempre 1:1 (nessuna condivisione, nessuna eredità) |
| Chi vede quale azienda | Abilitazione esplicita utente→azienda |
| La madre ha dati operativi? | Entrambi i casi devono funzionare (holding operativa o puro contenitore) |
| Dove vive il contratto | Solo sulla madre; le figlie ereditano |
| Visibilità | Le figlie sono isolate fra loro; la madre vede tutto |
| Poteri dalla madre | Pieni, secondo il ruolo dell'utente |
| Tetto FIR | Per azienda: il valore viene dal piano della madre, il conteggio è di ciascuna figlia |

## 3. Modello dati

Una sola colonna nuova:

```prisma
model Tenant {
  // ...
  /// Azienda madre del gruppo. null = azienda madre (radice, titolare del
  /// contratto); valorizzata = azienda figlia. Gerarchia a UN SOLO livello:
  /// una figlia non può avere figlie (vincolo applicativo + test).
  parentTenantId String?  @map("parent_tenant_id") @db.Uuid
  madre          Tenant?  @relation("GruppoAziende", fields: [parentTenantId], references: [id], onDelete: Restrict)
  figlie         Tenant[] @relation("GruppoAziende")

  @@index([parentTenantId])
}
```

`onDelete: Restrict`: una madre con figlie non è cancellabile: la cascata cancellerebbe i dati operativi di società che hanno obblighi di conservazione decennale (D.Lgs. 152/2006).

**Perché la figlia è un tenant e non una nuova entità `Azienda`.** Le alternative valutate erano: (A) tabella `Azienda` con `aziendaId` aggiunto alle ~23 tabelle oggi tenant-scoped; (B) `azienda` che sostituisce `tenant` nei dati operativi; (C) la figlia è un tenant. Si sceglie C perché le figlie ereditano immutato tutto l'isolamento già in esercizio e testato — `TenantContext`, estensione RLS Prisma, `requireRequestTenantId`, RBAC per tenant, `RentriCredential` 1:1 — e perché **non muove un solo dato operativo**: nessun backfill su 23 tabelle, nessuna finestra in cui i dati stanno a metà. A e B avrebbero costruito in parallelo un secondo meccanismo di isolamento equivalente a quello esistente, con dati veri già in produzione.

**Il prezzo, esplicito.** La parola «tenant» copre due cose: il contratto (radice) e l'azienda (figlia). Si mitiga con la regola del §5 — contratto solo sulla radice, verificata da test — e con il vincolo di un solo livello, che tiene la gerarchia leggibile senza query ricorsive.

**Madre operativa o contenitore**: nessuna differenza di modello. La madre è un tenant; se non ha FIR né registri, semplicemente non ne ha. Nessun flag di tipo da mantenere allineato.

## 4. Isolamento fra sorelle

Non richiede codice nuovo: due figlie sono due tenant, e due tenant sono già isolati. La consegna di questa parte è la **dimostrazione**, cioè la suite di test del §9.

Le uniche eccezioni note all'isolamento per tenant restano quelle documentate nell'audit del 2026-08-03 e valgono identiche fra sorelle: la verifica pubblica delle firme (`findByIdPublic`, volutamente non filtrata, risposta anonima) e la RLS nativa Postgres ancora assente — l'isolamento è oggi solo applicativo. Quest'ultima resta il rischio residuo principale e va affrontata separatamente.

## 5. Il contratto vive sulla madre

Piano, stato abbonamento, `firLimitPerMonth`, `userLimitTotal`, `featureFlags`, `stripeCustomerId` e `stripeSubscriptionId` si leggono **risalendo alla radice**. Un unico risolutore, usato da tutti i consumatori attuali: gli enforcement alla creazione di un FIR (`assertNotSuspended`, `assertFirLimitNotReached` in `api/fir/fir.controller.v2.ts`), `GET /api/v1/me/features`, il gating del menu di sinistra, l'enforcement delle utenze in `createUser`.

I campi restano fisicamente sulle figlie: la migrazione è additiva e forward-only, come da convenzione del progetto. Diventano però **non autorevoli**, e un test lo impone: nessun percorso deve leggerli direttamente dalla figlia. Senza quel test, fra sei mesi nessuno saprà più quale valore comanda.

**Tetto FIR — per azienda.** Il valore arriva dal piano della madre; il conteggio resta quello di ciascuna figlia. Un gruppo di 5 società con piano da 100 FIR/mese ha 100 FIR per ognuna, e una società attiva non consuma la quota delle sorelle.

**Quota aziende.** La creazione di una figlia da dentro una madre imposta `parentTenantId` e mantiene il flusso attuale (ruoli seminati, `ownerUserId`, associazione per lo switch). Il limite di quante figlie si possono creare passa dal `User.companyLimit` a un campo nuovo sulla radice, `Tenant.aziendeLimit` (intero, default derivato dal piano), coerente col piano commerciale già scritto («fino a 5 aziende», `marketing/01-content/blog-posts/article-5-wasteflow-vs-competitor.md`). La regola di precedenza è esplicita e non ammette letture alternative: **se il tenant su cui si crea ha `aziendeLimit` valorizzato, comanda quello; altrimenti vale `User.companyLimit` di chi crea**. I clienti attuali, che non hanno madre né `aziendeLimit`, non cambiano comportamento.

## 6. Accesso dall'alto

`MembershipService.checkAccess` acquisisce una quarta sorgente, dopo le tre attuali (tenant primario del JWT, `ownerUserId`, associazione consulente attiva e non scaduta): **essere abilitati alla madre del tenant richiesto**. È l'unico punto in cui la gerarchia concede qualcosa, ed è lo stesso punto già usato dal `TenantSwitchInterceptor`: la superficie di controllo non aumenta.

I poteri sono **pieni**, secondo il ruolo dell'utente: chi è abilitato alla madre seleziona una figlia e ci lavora come se fosse abilitato direttamente. È il consulente che opera per conto del cliente.

L'inverso non vale mai: essere abilitati a una figlia non dà accesso né alla madre né alle sorelle.

Il selettore azienda mostra la madre e le figlie accessibili come gerarchia (figlie indentate sotto la madre), non come elenco piatto.

## 7. Visione d'insieme

Una schermata aggregata, **non** un allargamento del contesto: si continua a lavorare dentro una sola azienda per volta, e la vista d'insieme è l'unico punto che legge più tenant, facendolo esplicitamente sulla lista dei figli autorizzati.

Si riscrive su questa base la dashboard aggregata esistente (`application/queries/handlers/get-aggregated-dashboard.handler.ts`), che **oggi è rotta**: le query raw leggono `t.name`, `m.type` e `m.deadline_date`, colonne che nello schema non esistono (`Tenant` ha `ragione_sociale`; `MUDReport` non ha né `type` né `deadline_date`), quindi falliscono a runtime benché l'endpoint sia cablato in `api/permissions/consultant.controller.ts`. Cambia la sorgente — i figli della madre invece delle sole associazioni consulente — e i contenuti diventano, per ciascuna figlia: FIR da trasmettere, scadenze MUD, errori di sincronia RENTRI, ultimo movimento di registro.

## 8. RENTRI

Nessuna modifica strutturale: `RentriCredential` è già 1:1 col tenant, quindi ogni figlia ha certificato, `num_iscr` operatore, credenziale di firma remota e unità locali proprie.

Una sola regola da imporre: la creazione di una figlia **non eredita nulla** dalla madre in materia RENTRI. Certificati e iscrizioni appartengono a quella persona giuridica; ereditarli significherebbe trasmettere all'ente per conto di un soggetto diverso da quello configurato.

## 9. Test — è qui che si dimostra il requisito

1. **Isolamento fra sorelle**, su ogni percorso e non solo sui repository: anagrafiche (produttori, trasportatori, destinatari), FIR e firme, registro carico/scarico, contratti, MUD, autorizzazioni impianto, configurazione e log RENTRI. Per ciascuno: lettura, scrittura, export MUD, PDF, job in coda, chiamate RENTRI.
2. **Nessuna risalita**: un utente abilitato solo a una figlia non vede né la madre né le sorelle, nemmeno conoscendone l'id.
3. **Discesa consentita**: un utente abilitato alla madre accede alle figlie con i poteri del proprio ruolo.
4. **Contratto**: piano, feature e limiti letti da una figlia risolvono sulla madre; nessun percorso legge quei campi dalla figlia.
5. **Tetto FIR per azienda**: due figlie dello stesso gruppo hanno ciascuna il proprio conteggio.
6. **Gerarchia a un livello**: creare una figlia sotto una figlia è rifiutato.
7. **Cancellazione**: una madre con figlie non è cancellabile.
8. **Quota aziende**: con `aziendeLimit` valorizzato sulla madre comanda quello; senza madre continua a valere `User.companyLimit`.

## 10. Migrazione

`parentTenantId` nullable: tutti i tenant esistenti restano radici e nessun dato si sposta. I gruppi si formano quando il PO lo decide, azienda per azienda. Rischio sui dati in produzione: nullo.

Per i clienti già esistenti creati in self-service (es. l'utente di test con tre aziende TRIAL) è possibile in seguito eleggere una madre e legarle, ma non è previsto alcun automatismo: legare due società è una decisione contrattuale, non un'inferenza.

## 11. Cosa NON facciamo

- **Nessuna entità `Azienda`** separata dal tenant: duplicherebbe un isolamento che esiste già.
- **Nessuna gerarchia a più livelli**: nessun gruppo di gruppi.
- **Nessuna eredità implicita** di anagrafiche, contatti o configurazioni RENTRI dalla madre alle figlie: il fallback implicito è esattamente ciò che ha prodotto i difetti di isolamento corretti il 2026-08-03.
- **Nessun consolidamento contabile o fiscale** fra le società del gruppo: la vista d'insieme è operativa, non un bilancio consolidato.
- **Nessuna modifica al RBAC**: ruoli e permessi restano per tenant, quindi per azienda, come oggi.

## 12. Rischi

| Rischio | Mitigazione |
|---|---|
| «Tenant» significa due cose (contratto e azienda) | Regola unica del §5 verificata da test; vincolo di un solo livello; nomenclatura `madre`/`figlie` nel codice e nella UI |
| L'isolamento è solo applicativo (nessuna RLS Postgres) | Vale già oggi fra tenant: non è un rischio introdotto da questo lavoro. Va chiuso a parte, con verifica su database reale |
| La discesa dalla madre amplia la superficie di accesso | È l'unica concessione gerarchica, in un solo punto già esistente (`checkAccess`), coperta dai test 2 e 3 |
| Il piano commerciale parla di «fino a 5 aziende» ma la quota oggi è sull'utente | §5: la quota si sposta sul contratto della madre, `companyLimit` resta per gli admin senza madre |
