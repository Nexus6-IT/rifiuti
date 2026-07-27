# Contratti — form utilizzabile senza conoscere gli UUID

Data: 2026-07-27
Stato: approvato

## Problema

Il dialog "Nuovo contratto" (`apps/frontend/src/app/features/contracts/contracts-list.component.ts`)
è compilabile solo da chi conosce i dati interni del sistema:

- `ID produttore` e `ID controparte` sono due `<input pInputText>` in cui va
  incollato un UUID. Nessun operatore ha quegli identificativi.
- I codici CER sono un `p-chips` a testo libero: si può salvare `15010`,
  `banana`, qualunque cosa.
- `Termini di pagamento` e `Frequenza fatturazione` sono input liberi con
  placeholder `net_30` e `monthly` — codici tecnici in inglese.
- Nulla verifica che gli id inseriti esistano davvero: il backend salva
  qualunque stringa.

In elenco la colonna "Controparte" mostra il *tipo* ("Trasportatore"), non il
nome dell'azienda, perché il contratto salva solo l'UUID.

## Decisioni

1. **Un solo campo "tipo".** "Tipo controparte" sparisce dalla UI e viene
   dedotto da "Tipo contratto": `WASTE_TRANSPORT` → `TRANSPORTER`,
   `WASTE_DISPOSAL` → `DISPOSER`. Per `FULL_SERVICE` e `FRAMEWORK`, che non
   implicano un registro univoco, compare una micro-select
   Trasportatore/Destinatario prima della società. Il valore resta salvato a DB
   come oggi: **nessuna migrazione**.
2. **`BROKER` non è selezionabile.** Non esiste un registro Intermediari da cui
   scegliere la società: un tipo che non si può portare a termine non va
   offerto. L'enum resta a DB per i dati esistenti e per quando il registro ci
   sarà.
3. **Le parti si scelgono dai registri**, non si digitano.
4. **I CER si scelgono dal catalogo** (837 voci, ricerca server-side già
   esistente in `CerService`).
5. **Termini di pagamento e frequenza di fatturazione diventano select in
   italiano.** A DB restano i codici tecnici: la colonna è `VarChar(20)` con
   default `net_30` / `monthly` e non va toccata.
6. **L'elenco mostra la ragione sociale** della controparte e del produttore.
7. **Il numero contratto arriva precompilato** col prossimo progressivo, e
   resta modificabile.

## Vocabolari

| Codice a DB | Etichetta |
|---|---|
| `immediato` | Pagamento immediato |
| `net_30` | 30 giorni data fattura |
| `net_60` | 60 giorni data fattura |
| `net_90` | 90 giorni data fattura |
| `net_30_fm` | 30 giorni fine mese |
| `net_60_fm` | 60 giorni fine mese |

| Codice a DB | Etichetta |
|---|---|
| `per_trip` | A viaggio |
| `weekly` | Settimanale |
| `monthly` | Mensile |
| `bimonthly` | Bimestrale |
| `quarterly` | Trimestrale |
| `biannual` | Semestrale |
| `annual` | Annuale |
| `on_completion` | A fine servizio |

I codici già presenti a DB restano leggibili: l'elenco mostra il codice grezzo
quando non trova un'etichetta, invece di mostrare una casella vuota.

## Componenti

### Frontend

| File | Ruolo |
|---|---|
| `features/registry/anagrafica-select.component.ts` (nuovo) | `ControlValueAccessor` sul registro indicato da `@Input() registro: 'produttori' \| 'trasportatori' \| 'destinatari'`. Carica la lista del tenant e la filtra su ragione sociale e P.IVA. Emette l'`id`. Registro con una sola voce → preselezionata. Registro vuoto → messaggio esplicito, non una tendina vuota. |
| `features/cer/cer-multi-select.component.ts` (nuovo) | Multi-selezione sul catalogo CER, gemello di `CerSelectComponent` con `[multiple]="true"`. Emette `string[]`. |
| `features/contracts/contract-vocabulary.ts` (nuovo) | Le due tabelle qui sopra + le etichette già sparse nel componente lista. |
| `features/contracts/contract-create-dialog.component.ts` (nuovo) | Il dialog di creazione, estratto da `contracts-list.component.ts` (oggi 712 righe che fanno lista, creazione e cambio stato insieme). Contiene la derivazione registro←tipo contratto. |
| `features/contracts/contracts-list.component.ts` (modificato) | Resta lista + cambio stato. La colonna Controparte mostra la ragione sociale. |
| `features/contracts/contracts.service.ts` (modificato) | `Contract` guadagna `producer` e `counterparty` opzionali; nuovo `nextNumber()`. |

### Backend

| File | Modifica |
|---|---|
| `application/contracts/contract.service.ts` | `list()`/`getById()` arricchiscono con `producer` e `counterparty` (`{ id, ragioneSociale, partitaIVA }`) risolti in **3 query batch** sui registri, non una per riga. Id non risolvibile → `null`. `create()` verifica che gli id esistano nel registro corretto **e nello stesso tenant**. Nuovo `nextContractNumber()`. |
| `api/.../contract.controller.ts` | `GET /contracts/next-number`, registrato **prima** di `GET /contracts/:id` (altrimenti `:id` cattura la rotta). |
| `application/contracts/dto/create-contract.dto.ts` | `@IsUUID()` su `producerId`/`counterpartyId`; `@IsIn(...)` su `paymentTerms` e `billingFrequency`; `counterpartyType` accetta ancora `BROKER` (dati storici). |
| `application/contracts/contract-vocabulary.ts` (nuovo) | I codici ammessi, gemello del file frontend. Il repo non ha ancora `libs/` condivise: il disallineamento si previene con un test, non con una libreria. |

## Numerazione

`CTR-<anno>-<progressivo a 3 cifre>`, calcolato sul massimo esistente **del
tenant per l'anno corrente**. Il primo contratto dell'anno riparte da `001`.
Resta un *suggerimento*: l'unicità vera è garantita dal vincolo
`@@unique([tenantId, contractNumber])` già presente, e un numero duplicato
inserito a mano viene respinto dal DB come oggi.

## Errori

- Registro vuoto → il campo dice quale anagrafica va popolata prima.
- Id non presente nel registro → `400` con messaggio che nomina il registro
  atteso ("Trasportatore non trovato nel registro").
- Cambiando "Tipo contratto" la controparte già scelta si azzera: altrimenti
  resterebbe un id del registro sbagliato.

## Test

Backend (girano nel gate CI):
- numerazione: primo contratto dell'anno, progressivo con buchi, cambio anno;
- arricchimento con id orfano (deve dare `null`, non sollevare);
- `counterpartyId` che esiste ma nel registro sbagliato → `400`;
- `counterpartyId` di un altro tenant → `400`;
- `paymentTerms` fuori elenco → `400`;
- allineamento fra vocabolario backend e valori accettati dal DTO.

Frontend: derivazione registro←tipo contratto, azzeramento della controparte al
cambio tipo, preselezione con registro a una voce. **Nota:** il gate CI non
esegue i test frontend (il runner non ha un browser, scelta documentata in
`deploy.yml`), quindi vanno verificati in locale.

## Fuori scope

Modello Prisma, workflow degli stati, auto-compilazione FIR da contratto,
`pricingConfig` (pricing a scaglioni/zone), registro Intermediari.
