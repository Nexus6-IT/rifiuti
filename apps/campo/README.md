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

## Giro offline (P3)

Il giro del giorno si scarica in rete e se ne tiene una copia (snapshot) sul telefono tramite
`ArchivioGiro` (`src/app/core/archivio-giro.ts`): oggi IndexedDB nativo, sostituibile con un
provider nativo (Capacitor). Senza rete (o con il server irraggiungibile, 502/503/504) l'app mostra
la copia, con «Aggiornato il gg/mm hh:mm» sempre visibile e il banner «Offline».

- Un solo snapshot, legato all'utente (`sub` del token) e al giorno. Mai mostrato a un altro
  utente o in un altro giorno: in quel caso viene cancellato.
- Cancellato a fine giornata (all'avvio e al ripristino), al logout, a sessione finita e a ogni
  nuovo accesso (cambio utente).
- Il service worker resta «solo shell» (nessun `dataGroup`): i dati stanno solo in IndexedDB.
- IndexedDB non e' cifrato: si tengono solo i dati del giro, niente listini ne' fatturazione.
