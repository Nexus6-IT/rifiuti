# COSTS.md — Registro costi sessioni (rifiuti)

<!-- costs-total-usd:225.67 -->
**Totale cumulato: $225.67**

Costo registrato automaticamente a fine sessione (hook SessionEnd) e leggibile via `~/.claude/bin/session-cost.sh`.

| Data | Sessione | Lavoro svolto | Costo |
|------|----------|---------------|-------|
| 2026-07-25 | `d2aea025-c` | P1 rilasciata in produzione (3 difetti critici chiusi, sessione singola, logout funzionante, Swagger chiuso) + P2 riscrittura integrazione RENTRI contro il contratto ufficiale, validata dall oracolo (auth ID_AUTH_REST_02, ciclo 202/200/303, resilienza ai guasti). Suite 95/837. | $22.48 |
| 2026-07-25 | `d2aea025-b` | Design + piano + esecuzione Fase 0 del programma production-ready: workflow di agenti iperspecializzati, fake API RENTRI containerizzata come oracolo di conformita (62 test), contratti ufficiali versionati, due audit di fedelta indipendenti (NON IDONEA -> IDONEA CON RISERVE dopo giro correttivo). | $128.93 |
| 2026-07-25 | `fb63b866` | Audit di conformità RENTRI + MUD con swarm di 4 agenti (Opus coordinatore/revisore): ricognizione normativa su fonti ufficiali (DM 59/2023, OpenAPI RENTRI, DPCM MUD), inventario del codice, audit approfondito della firma digitale. Esito: 2/35 funzionalità RENTRI conformi; l'auth implementata (OAuth2 `/token`) non esiste in RENTRI; nessuna firma con valore legale. Chiusi 4 difetti P0 di sicurezza (verify pubblico con CF cross-tenant, PDF senza filtro tenant, firma senza autorizzazione di ruolo, firme scartate in silenzio). MUD: base `V604Base` estratta, fix bug ISTAT, aggiunto tracciato 6.04/25 e 7 nuovi tipi di record (AU/AR/BC/BD/BE/DA/DB + RT), modello `AutorizzazioneImpianto`. 812 test verdi. | $43.11 |
| 2026-07-25 | `d2aea025` | Analisi completa + UAT e2e su produzione: swarm multi-agente (Opus coordinatore/revisore + implementatori Sonnet). 6 report di audit, 86 scenari UAT in italiano, suite Playwright da zero (71 test verdi + guardrail anti-distruttivi), 6 difetti corretti e verificati. Rilevata non conformità nuova: sessione singola non implementata. | $28.25 |
| 2026-07-25 | `a254dceb` | (auto — descrizione da completare) | $2.90 |
