# Cruscotto — piano di implementazione

> **Per chi esegue:** usa `superpowers:subagent-driven-development` (consigliato)
> o `superpowers:executing-plans`. I passi hanno caselle `- [ ]`.

**Obiettivo:** trasformare il cruscotto da specchio di ciò che è successo a
**strumento che dice cosa fare oggi**, e che mette in evidenza i problemi prima
che diventino danni.

**Architettura:** non si costruisce da zero. `DashboardComponent` esiste, ha
quattro indicatori, i formulari recenti e la distribuzione per stato, e legge da
`FirService`. Questo piano aggiunge una fascia di **cose che richiedono
attenzione** in cima, alimentata dai dati che lo scadenzario produce, e sposta lì
la scorta di numeri vidimati.

**Stack:** Angular 17 standalone + PrimeNG, NestJS.

**Dipendenza:** il piano `2026-09-11-scadenzario.md` va eseguito **prima**: questo
cruscotto mostra ciò che quello calcola. Senza, la fascia sarebbe vuota.

## Vincoli globali

Identici al piano scadenzario: TDD, italiano, isolamento per tenant, prettier
`semi: false`, `--runInBand`, migrazioni additive.

## Correzione al confronto coi concorrenti

`concorrenti-sintesi-2026-09-11.md` §2 elenca «cruscotto» fra le aree **assenti**.
**È sbagliato**: il cruscotto esiste
(`apps/frontend/src/app/features/dashboard/dashboard.component.ts`, 300 righe,
con indicatori, elenco recenti e distribuzione per stato, accessibilità curata).
Il divario reale non è l'assenza, è che **mostra solo conteggi di formulari** e
non dice nulla su ciò che richiede un'azione. Questo piano parte da lì.

Stessa correzione vale per lo scadenzario: non era assente, era **a metà**.

---

### Task 1: Un endpoint che raccoglie ciò che richiede attenzione

Una sola chiamata, perché il cruscotto non deve fare cinque richieste per
disegnare una fascia.

**File:**

- Crea: `apps/backend/src/api/dashboard/attenzione.controller.ts`
- Crea: `apps/backend/src/application/dashboard/raccogli-attenzione.use-case.ts`
- Test: `raccogli-attenzione.use-case.spec.ts`

**Interfacce:**

- Consuma: lo stesso calcolo di scadenza del piano scadenzario (Task 1 e 2) —
  **riusarlo, non riscriverlo**; `RentriScortaRepository` per i numeri vidimati.
- Produce: `GET /api/v1/dashboard/attenzione`

```ts
interface VoceAttenzione {
  chiave: string // 'certificato-rentri', 'autorizzazione', 'scorta-vidimata', ...
  gravita: 'critico' | 'avviso' | 'informativo'
  titolo: string // testo italiano gia' pronto
  dettaglio: string // «scade fra 12 giorni», «nessun blocco attivo»
  azione?: { etichetta: string; rotta: string }
}
interface AttenzioneResult {
  voci: VoceAttenzione[]
}
```

- [ ] **Passo 1: test che fallisce** — con un certificato in scadenza fra 12
      giorni, `raccogli()` restituisce una voce `certificato-rentri` di gravità
      `avviso` con la rotta verso la pagina del certificato.
- [ ] **Passo 2: eseguirlo e vederlo fallire** (il file non esiste).
- [ ] **Passo 3: implementare il minimo** per quella sola voce.
- [ ] **Passo 4: verificare che passi.**
- [ ] **Passo 5: aggiungere una voce alla volta**, ciascuna col proprio test
      prima: autorizzazioni in scadenza o scadute, scorta di numeri vidimati
      esaurita o sotto soglia, nessun blocco attivo.
- [ ] **Passo 6: test dell'ordinamento** — le voci escono ordinate per gravità,
      i critici per primi. Un elenco non ordinato costringe l'utente a cercare.
- [ ] **Passo 7: commit** `feat(cruscotto): endpoint delle cose che richiedono attenzione`

---

### Task 2: La fascia in cima al cruscotto

**File:**

- Modifica: `apps/frontend/src/app/features/dashboard/dashboard.component.ts`
- Crea: `apps/frontend/src/app/features/dashboard/attenzione.service.ts`
- Test: `dashboard.component.spec.ts`

- [ ] **Passo 1: test che fallisce** — con due voci restituite dal servizio, il
      cruscotto le mostra sopra gli indicatori, la critica per prima.
- [ ] **Passo 2: eseguirlo e vederlo fallire.**
- [ ] **Passo 3: implementare** la fascia. Ogni voce porta il suo pulsante di
      azione che naviga dove si risolve il problema: **una segnalazione senza via
      d'uscita è solo ansia**.
- [ ] **Passo 4: test dello stato «tutto a posto»** — nessuna voce: la fascia non
      compare affatto, non un riquadro verde vuoto che occupa spazio ogni giorno.
- [ ] **Passo 5: verificare l'accessibilità** com'è già fatta nel resto del file
      (intestazioni, `aria-*`): imitare, non inventare.
- [ ] **Passo 6: commit** `feat(cruscotto): fascia delle cose che richiedono attenzione`

---

### Task 3: Indicatori che dicono qualcosa

Oggi gli indicatori sono quattro conteggi di formulari. Aggiungerne che rispondano
a domande che l'utente si pone davvero.

**File:**

- Modifica: `raccogli-attenzione.use-case.ts` o un nuovo use case per gli
  indicatori (decidere in base a quanto cresce: se supera le 150 righe, separare)
- Modifica: `dashboard.component.ts`

- [ ] **Passo 1: test** — «formulari da trasmettere al RENTRI», cioè emessi e non
      ancora sincronizzati. È la domanda che porta una sanzione se resta senza
      risposta.
- [ ] **Passo 2: implementare**, poi verificare.
- [ ] **Passo 3: test** — «numeri vidimati pronti», con la soglia configurata.
- [ ] **Passo 4: implementare**, poi verificare.
- [ ] **Passo 5: commit** `feat(cruscotto): indicatori orientati all'azione`

---

### Task 4: Andamento, non solo istantanea

Un conteggio dice dove sei; una serie dice dove stai andando.

- [ ] **Passo 1: test** — l'endpoint restituisce i formulari emessi per mese
      negli ultimi dodici mesi, filtrati per tenant.
- [ ] **Passo 2: implementare** con una query aggregata, non caricando tutti i
      formulari in memoria.
- [ ] **Passo 3: disegnare** il grafico con la libreria già usata nel progetto —
      **verificare quale sia prima di sceglierne una**; nessuna dipendenza nuova
      senza dichiararla.
- [ ] **Passo 4: commit** `feat(cruscotto): andamento dei formulari negli ultimi dodici mesi`

---

## Automazione — cosa fa il sistema al posto dell'utente

- **Decide cosa merita attenzione** e in che ordine: l'utente non deve girare fra
  cinque schermate per scoprire che qualcosa scade.
- **Porta dove si risolve**: ogni voce ha la sua azione.
- **Tace quando non c'è nulla da dire**: la fascia sparisce. Un avviso che compare
  sempre smette di essere letto.

## Autoverifica del piano

- Copertura: la fascia (Task 1-2), gli indicatori utili (Task 3) e l'andamento
  (Task 4) coprono il divario reale, che non era l'assenza del cruscotto ma la
  sua inutilità operativa.
- Nessun segnaposto: i tipi sono definiti, i nomi dei file esistenti sono
  verificati sul sorgente.
- Dipendenza dichiarata: senza il piano scadenzario la fascia non ha cosa
  mostrare.
- Punto lasciato aperto di proposito: la libreria dei grafici non è scelta qui
  perché va verificata nel progetto, e sceglierla a memoria sarebbe un
  segnaposto travestito.
