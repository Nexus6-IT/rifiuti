# Scadenzario con avvisi — piano di implementazione

> **Per chi esegue:** usa `superpowers:subagent-driven-development` (consigliato)
> o `superpowers:executing-plans`. I passi hanno caselle `- [ ]` per il
> tracciamento.

**Obiettivo:** avvisare l'utente **prima** che una scadenza diventi un danno —
autorizzazioni degli impianti, certificato RENTRI, iscrizioni all'Albo — riusando
lo scadenzario che nel progetto esiste già e copre solo il MUD.

**Architettura:** non si costruisce nulla di nuovo. `DeadlineCheckerService`
esiste, è registrato, gira ogni giorno e sa già mandare avvisi per il MUD con
intervalli, email e notifiche in applicazione. Contiene **due metodi con il corpo
vuoto** che dicono «da implementare quando il modello esisterà»: quel modello nel
frattempo è stato creato e nessuno è tornato indietro. Questo piano riempie quei
due corpi e aggiunge il terzo caso (certificato RENTRI).

**Stack:** NestJS `@Cron`, Prisma, il `TemplateService` e il `NotificationService`
già presenti.

**Documenti di riferimento:**

- `docs/audits/concorrenti-sintesi-2026-09-11.md` §2 (perché è la priorità)
- `docs/superpowers/plans/2026-09-11-programma-prodotto.md` (ordine e criteri)

## Vincoli globali

- **TDD obbligatorio** (regola di progetto): prima il test, guardalo fallire.
- **Lingua**: commenti, messaggi ed errori in italiano. Identificatori in inglese
  dove il codice attorno lo è.
- **Isolamento**: ogni query filtra per tenant. Il tenant È l'azienda in questo
  progetto.
- **Stile**: prettier `semi: false`, virgolette singole, larghezza 100.
- **Memoria della macchina**: eseguire sempre `npx jest --runInBand <percorso>`,
  mai la suite intera.
- **Migrazioni**: additive, forward-only, nuove colonne nullable.

## Cosa esiste già (verificato l'11/09, non assumere: rileggere prima di toccare)

| Pezzo                        | Dove                                                                  | Stato                                |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| Servizio scadenzario         | `src/application/notifications/deadline-checker.service.ts`           | esiste, registrato, 4 `@Cron`        |
| Intervalli di avviso         | idem, `NOTIFICATION_INTERVALS = [30, 15, 7, 3, 1]`                    | esiste                               |
| Scadenza MUD                 | idem, `checkMudDeadlines`                                             | **implementato**, usare come modello |
| Scadenza vidimazioni         | idem, `checkVidimazioneDeadlines`                                     | **corpo vuoto**, TODO                |
| Scadenza autorizzazioni      | idem, `checkAuthorizationExpirations`                                 | **corpo vuoto**, TODO                |
| Modello email autorizzazioni | `src/infrastructure/email/template.service.ts:123`                    | esiste                               |
| Modello email vidimazioni    | idem `:100`                                                           | esiste                               |
| Dato di scadenza impianto    | `prisma/schema.prisma`, `AutorizzazioneImpianto.dataScadenza`         | **esiste**                           |
| Scadenza certificato RENTRI  | `src/infrastructure/rentri/rentri-certificato-scadenza.util.ts`       | esiste                               |
| Scadenza controparti         | `Trasportatore.numeroIscrizione`, `Destinatario.numeroAutorizzazione` | **il numero c'è, la DATA NO**        |

---

### Task 1: Avvisi di scadenza delle autorizzazioni dell'impianto

Riempie `checkAuthorizationExpirations`, oggi vuoto, usando `AutorizzazioneImpianto.dataScadenza`
che nel frattempo è stato aggiunto allo schema.

**File:**

- Modifica: `apps/backend/src/application/notifications/deadline-checker.service.ts:195-211`
- Test: `apps/backend/src/application/notifications/deadline-checker.service.spec.ts`

**Interfacce:**

- Consuma: `AutorizzazioneImpianto` (Prisma), `TemplateService.renderAuthorizationExpiration`,
  `NotificationService`, `EmailService`.
- Produce: niente per altri task.

- [ ] **Passo 1: scrivere il test che fallisce**

```ts
it('avvisa quando un autorizzazione scade fra 30 giorni', async () => {
  const fra30 = new Date()
  fra30.setDate(fra30.getDate() + 30)
  prisma.autorizzazioneImpianto.findMany.mockResolvedValue([
    { id: 'a1', tenantId: 't1', estremi: 'AUT/123', dataScadenza: fra30 },
  ])

  await service.checkAuthorizationExpirations()

  expect(notificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: 't1', severity: 'WARNING' })
  )
})
```

- [ ] **Passo 2: eseguirlo e vederlo fallire**

`npx jest --runInBand src/application/notifications/deadline-checker.service`
Atteso: FALLISCE, nessuna chiamata a `notificationService.create` (il metodo oggi
scrive solo una riga di log).

- [ ] **Passo 3: implementare il minimo**

Leggere le autorizzazioni con `dataScadenza` non nulla entro l'intervallo massimo,
calcolare i giorni mancanti, e avvisare **solo** se il numero di giorni è in
`NOTIFICATION_INTERVALS` — esattamente come fa `checkMudDeadlines`, che va letto
prima e imitato. Non reinventare il ciclo: copiarne la forma.

- [ ] **Passo 4: eseguire e vedere passare**

- [ ] **Passo 5: aggiungere il caso «già scaduta»**

Un'autorizzazione con `dataScadenza` nel passato non deve essere silenziosa: va
avvisata con severità maggiore e un testo diverso («è scaduta il…», non «scadrà
fra…»). Test prima.

- [ ] **Passo 6: commit**

```bash
git add apps/backend/src/application/notifications/deadline-checker.service.ts \
        apps/backend/src/application/notifications/deadline-checker.service.spec.ts
git commit -m "feat(scadenzario): avvisi per le autorizzazioni degli impianti"
```

---

### Task 2: Avviso di scadenza del certificato RENTRI

Senza certificato valido **ogni** trasmissione all'ente si ferma. È la scadenza
più costosa e oggi non avvisa nessuno.

**File:**

- Modifica: `apps/backend/src/application/notifications/deadline-checker.service.ts`
  (nuovo `@Cron`, accanto agli altri)
- Test: stesso spec del Task 1

**Interfacce:**

- Consuma: `calcolaGiorniAllaScadenzaCertificato`
  (`src/infrastructure/rentri/rentri-certificato-scadenza.util.ts`) — **riusare,
  non duplicare la logica di lettura del `notAfter`**.

- [ ] **Passo 1: test che fallisce** — certificato che scade fra 15 giorni →
      notifica creata. Poi eseguirlo e vederlo fallire.
- [ ] **Passo 2: implementare** leggendo le credenziali RENTRI per tenant e
      riusando l'utilità esistente.
- [ ] **Passo 3: test del caso già scaduto** → severità massima, testo che dice
      che le trasmissioni sono ferme.
- [ ] **Passo 4: commit** `feat(scadenzario): avviso di scadenza del certificato RENTRI`

---

### Task 3: La data di scadenza delle controparti (lacuna di dato)

**Questo task esiste perché il dato NON c'è.** Di trasportatori e destinatari
conserviamo il numero di iscrizione e di autorizzazione, ma **non la scadenza**:
senza, nessun avviso è possibile.

**File:**

- Modifica: `apps/backend/prisma/schema.prisma` (`Trasportatore`, `Destinatario`)
- Crea: `apps/backend/prisma/migrations/<timestamp>_scadenze_controparti/migration.sql`
- Modifica: i DTO e i form delle due anagrafiche
- Test: spec delle anagrafiche

- [ ] **Passo 1: migrazione additiva** — due colonne nullable
      (`scadenza_iscrizione` su trasportatori, `scadenza_autorizzazione` su
      destinatari). Nullable perché le anagrafiche esistenti non ce l'hanno e
      **non va inventata**.
- [ ] **Passo 2: esporre i campi** in DTO e form, come campi facoltativi.
- [ ] **Passo 3: estendere il controllo del Task 1** perché copra anche queste
      due, con test.
- [ ] **Passo 4: commit** `feat(anagrafiche): data di scadenza di iscrizioni e autorizzazioni`

---

### Task 4: Avvisare al momento della scelta, non solo per email

**È il punto in cui superiamo i concorrenti.** Un avviso via email 30 giorni
prima è utile; un avviso **quando l'operatore sceglie quel destinatario in un
formulario** evita l'errore sul momento.

**File:**

- Modifica: endpoint delle anagrafiche (aggiungere lo stato di scadenza alla
  risposta)
- Modifica: `apps/frontend/src/app/features/fir/fir-list.component.ts` (selettori
  di destinatario e trasportatore)

- [ ] **Passo 1: test backend** — l'elenco dei destinatari riporta
      `autorizzazioneScaduta: boolean` e `giorniAllaScadenza: number | null`.
- [ ] **Passo 2: implementare** il calcolo, riusando la stessa funzione del Task 1.
- [ ] **Passo 3: test frontend** — scegliendo un destinatario con autorizzazione
      scaduta compare un avviso inline; **non** bloccare l'emissione (potrebbe
      essere un dato nostro non aggiornato: avvisare, non impedire).
- [ ] **Passo 4: commit** `feat(fir): avviso di autorizzazione scaduta alla scelta della parte`

---

### Task 5: Normalizzare il numero Albo invece di rifiutarlo

Difetto noto, documentato in `concorrenti-sintesi-2026-09-11.md` §6.1: l'ente
pretende sei cifre con gli zeri davanti, e un trasportatore che scrive `MI/7490`
oggi viene **rifiutato** invece che corretto in `MI/007490`.

**File:**

- Modifica: `apps/backend/src/application/rentri/mappatura/mappa-parti.ts`
  (`PATTERN_NUMERO_ISCRIZIONE_ALBO`, riga ~20 e ~241)
- Test: `mappa-parti.spec.ts`

- [ ] **Passo 1: test che fallisce**

```ts
it('normalizza il numero Albo a sei cifre invece di rifiutarlo', () => {
  const out = mappaTrasportatore(
    { ragioneSociale: 'T', partitaIVA: '1', numeroIscrizione: 'MI/7490' },
    'Terrestre'
  )
  expect(out.numero_iscrizione_albo).toBe('MI/007490')
})
```

- [ ] **Passo 2: eseguirlo e vederlo fallire** — oggi solleva
      `DatoMancantePerRentriError`.
- [ ] **Passo 3: implementare** la normalizzazione: sigla in maiuscolo, cifre
      allineate a destra con zeri. **Rifiutare comunque** se le cifre sono più di
      sei o se la sigla non è di due lettere: lì è ambiguo e non si indovina.
- [ ] **Passo 4: test del caso ancora rifiutato** (`MI/1234567`, `M/123`).
- [ ] **Passo 5: commit** `fix(rentri): il numero Albo si normalizza, non si rifiuta`

---

## Automazione — cosa fa il sistema al posto dell'utente

Applicando il criterio del programma (§5):

- **Calcola** i giorni mancanti, la severità e quando avvisare: l'utente non deve
  ricordarsi nulla.
- **Normalizza** i formati che sa correggere (Albo), e lo dice.
- **Non decide** se un'autorizzazione scaduta blocca un formulario: avvisa e lascia
  decidere, perché il dato potrebbe essere solo non aggiornato da noi.

## Autoverifica del piano

- Copertura: le quattro aree del divario sullo scadenzario (impianti, certificato,
  controparti, avviso al momento della scelta) hanno ciascuna un task.
- Nessun segnaposto: ogni passo dice cosa scrivere e cosa eseguire.
- Coerenza dei nomi: `checkAuthorizationExpirations` e
  `checkVidimazioneDeadlines` sono i nomi reali dei metodi vuoti;
  `calcolaGiorniAllaScadenzaCertificato` e `PATTERN_NUMERO_ISCRIZIONE_ALBO` sono
  verificati nel sorgente.
- **Nota**: `checkVidimazioneDeadlines` resta vuoto di proposito. Riguarda la
  vidimazione dei **registri**, che dipende dal registro cronologico: va
  affrontato col piano del registro, non qui. Lasciarlo vuoto è una scelta
  dichiarata, non una dimenticanza.
