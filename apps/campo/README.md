# WasteFlow campo

App Angular (PWA, in preparazione) per autisti e operatori sul campo. Piano: `~/.claude/state/orchestrazione/report/rifiuti/2026-11-18-fattibilita-app-mobile.md`.

## Perche' e' fuori dai workspace npm della radice

`apps/frontend` resta su Angular 17.3, `apps/campo` usa Angular 21. Con un solo lock alla radice
l'hoisting porterebbe due versioni di `@angular/core` nello stesso albero, e `apps/frontend/Dockerfile.prod`
(che copia solo i `package.json` di frontend e backend) non reggerebbe un workspace in piu'.
Per questo `apps/campo` ha **un lock proprio** e non e' nell'elenco `workspaces` della radice.

Angular 21 richiede Node >= 22.22.3 (o >= 24.15): la CI usa Node 22 per questo job.

## Comandi (da `apps/campo`)

    npm ci
    npm run build
    npm test -- --watch=false
