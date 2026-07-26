# R2 — Aggiornamento: più sedi operative per azienda

> Integrazione al piano `2026-07-26-r2-aggancio-formulari.md`, decisa dal committente il 2026-07-26 dopo il Task 1.

## La decisione

L'applicativo deve reggere **aziende con più unità locali RENTRI**.

Il Task 1 (commit `7877cc8`) aveva modellato `numIscrSito` come campo singolo su `RentriCredential` — una sede per tenant — dichiarando il multi-sede fuori ambito. **Quella semplificazione decade**: un'azienda con più sedi non potrebbe agganciare i formulari delle sedi secondarie, e l'aggancio è la ragione d'essere di R2.

## Il modello

Tabella **`RentriUnitaLocale`**, figlia del tenant:
- `numIscrSito` con il pattern del contratto (`^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$`, da `formulari.yaml` riga 684);
- denominazione leggibile, per farla scegliere all'operatore senza costringerlo a riconoscere un codice;
- flag **`principale`**: chi ha una sola sede non deve scegliere nulla e il comportamento resta quello odierno; chi ne ha più d'una sceglie esplicitamente;
- stato di attività, perché una sede può cessare senza che spariscano i formulari che vi fanno riferimento.

**Migrazione del dato esistente**: il valore oggi su `RentriCredential.numIscrSito` diventa la prima unità locale, marcata principale. Nessuna perdita. Il campo sulla credenziale va **deprecato, non rimosso**, finché la migrazione non è verificata in produzione — è la stessa cautela adottata con `rentriProtocolNumber`.

## Conseguenze sugli altri task di R2

- **Ricerca**: `GET /` accetta `num_iscr_sito` **oppure** `identificativo_soggetto`. Con più sedi la ricerca dev'essere possibile su una sede scelta o sull'intera azienda.
- **Acquisizione e rilascio**: `POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}` porta la sede **dentro l'operazione**. L'interfaccia la fa scegliere quando le sedi sono più d'una, e non chiede nulla quando è una sola.
- **Il formulario agganciato** va associato all'unità locale con cui è stato acquisito: senza quel legame non si saprebbe con quale sede rilasciarne la visibilità.

## Vincolo di sicurezza

Un'unità locale appartiene a un tenant: **ogni operazione che la referenzia deve verificarne l'appartenenza**, altrimenti si aprirebbe una via per operare sulla sede di un'altra azienda. Vale la convenzione del progetto: **404, non 403** — nessuna fuga di esistenza.

## Vincolo di popolamento

Il servizio `anagrafiche` dell'ente espone le unità locali di un operatore (`GET /operatore/{num_iscr}/siti`), ed è coperto dalla fase R4 che procede in parallelo. Il modello va progettato perché R4 possa **popolarlo senza cambiarlo**: inserimento manuale ora, allineamento automatico poi.
