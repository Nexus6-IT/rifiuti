# Piano B RENTRI, pezzo 7: emissione in AUTOMATICA/IBRIDA senza certificato (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** quando un'azienda in modalità AUTOMATICA o IBRIDA emette un FIR senza avere un certificato RENTRI, il FIR non resta più "da trasmettere" in silenzio. Prende subito lo stesso esito definitivo della trasmissione, `RENTRI_CERTIFICATO_MANCANTE`, con il pulsante "Vai al certificato". Al caricamento del certificato si riapre e riparte da solo con il meccanismo del pezzo 6.

**Architettura:** in `TrasmettiFIRSecondoModalitaUseCase`, nel ramo `!certificatoConfigurato`, oggi c'è solo un warn. Al suo posto si carica il FIR, si applica `markRENTRISyncFailed(MESSAGGIO_CERTIFICATO_MANCANTE, 'RENTRI_CERTIFICATO_MANCANTE')` e lo si salva, sempre fail-closed: nessuna coda e nessuna chiamata a RENTRI. Un errore in questo salvataggio non fa fallire l'emissione: l'orchestrazione è già isolata in `emetti-fir.use-case.ts`.

**Tech Stack:** NestJS backend (Jest).

**Spec:** decisione di Graziano del 2026-10-23, "Esito subito all'emissione". Codice:
- `apps/backend/src/application/rentri/trasmetti-fir-secondo-modalita.use-case.ts` (righe ~60-110);
- `apps/backend/src/infrastructure/rentri/rentri-credential.resolver.ts` (`MESSAGGIO_CERTIFICATO_MANCANTE`);
- `apps/backend/src/domain/fir/aggregates/fir.aggregate.ts` (`markRENTRISyncFailed`);
- la riapertura al caricamento, in `rentri-credential.service.ts` e `rentri-credential.controller.ts` (pezzo 6).

## Global Constraints

- **Branch e worktree:** `fix/rentri-b7-emissione-senza-certificato` nel worktree `C:\Progetti\rifiuti-wt-rentri-b1`, partito da `fix/rentri-b6-certificato-mancante` @ `54b04d9`.
- **TDD obbligatorio:** prima il test, **eseguito e visto fallire**, poi il codice.
- **Comandi:** `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>` e `npx tsc --noEmit -p apps/backend`.
- **Messaggio:** sempre la costante `MESSAGGIO_CERTIFICATO_MANCANTE`, mai ricopiata.
- **Commit:** senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Il FIR marcato all'emissione** ha lo stesso stato e codice di quello fermato dalla trasmissione, quindi la riapertura al caricamento del pezzo 6 lo prende: `PERMANENTLY_FAILED` con `RENTRI_CERTIFICATO_MANCANTE`.
2. **In modalità MANUALE** nulla cambia: niente esito, l'utente trasmette quando vuole.
3. **Se il salvataggio dell'esito fallisce** (FIR annullato nel frattempo, database), l'emissione resta valida e l'errore si logga.

---

### Task 1: esito definitivo all'emissione senza certificato

**Files:**
- Modify: `apps/backend/src/application/rentri/trasmetti-fir-secondo-modalita.use-case.ts`. Si inietta il repository dei FIR, con lo stesso token o factory usati da `SyncFIRToRENTRIUseCase` in `rentri-sync.module.ts`.
- Modify: il provider in `rentri-sync.module.ts`, se serve per l'iniezione.
- Test: lo spec dello use case (si trova con `ls apps/backend/src/application/rentri/ | grep trasmetti`).

**Interfaces:** `eseguiSeAutomatica(...)` ha la firma invariata. `EsitoOrchestrazioneRENTRI` con `motivo: 'CERTIFICATO_MANCANTE'` resta come oggi e aggiunge `esitoRegistrato: boolean`.

- [ ] **Step 1: test che falliscono.**
  - `'AUTOMATICA senza certificato: FIR PERMANENTLY_FAILED RENTRI_CERTIFICATO_MANCANTE, nessun job'`;
  - `'IBRIDA senza certificato: stesso esito'`;
  - `'MANUALE senza certificato: FIR invariato'`;
  - `'salvataggio dell'esito che fallisce: nessuna eccezione, esitoRegistrato false, errore nel log'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui i test, lo spec di `emetti-fir.use-case`, `rentri-sync.module.spec.ts` e `tsc`. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): FIR emesso senza certificato in AUTOMATICA/IBRIDA con esito definitivo`.
