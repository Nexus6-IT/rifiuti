/**
 * Forma comune delle voci di ogni tabella del servizio `codifiche`
 * (`docs/contracts/rentri/codifiche.yaml`): `ByteLookupModel`,
 * `Int16LookupModel`, `Int32LookupModel`, `StringLookupModel` condividono
 * tutti la stessa forma esterna `{ id, code, name, properties }` — cambia
 * solo il tipo di `id` atteso dal contratto (numerico per Byte/Int16/Int32,
 * stringa per StringLookupModel), non distinto qui a runtime. Stessa forma
 * usata dalla fixture dell'oracolo
 * (`tools/rentri-fake/src/stato/fixture-codifiche.ts`, `LookupItem`).
 *
 * Le tabelle territoriali (`province`, `comuni`) valorizzano in più
 * `properties['attivo']`, `properties['fine-validita']`,
 * `properties['nuovo-id']` (comune soppresso/accorpato) e `properties.cciaa`
 * — nessuna delle altre tabelle porta questi campi.
 */
export interface CodificaItem {
  id: number | string
  code: string | null
  name: string | null
  properties?: Record<string, unknown> | null
}

/**
 * Le 21 tabelle "semplici" del servizio `codifiche`: nessun parametro di
 * filtro dichiarato dal contratto, un solo `GET /lookup/<nome>` senza query
 * string. Il nome è esattamente il segmento di path del contratto ufficiale
 * — usato sia per comporre l'URL sia come chiave nella mappa restituita da
 * {@link RentriCodificheClient.scaricaTutte} (v. `rentri-codifiche.client.ts`).
 *
 * `codici-eer`, `comuni` e `comuni/{provincia_id}` NON sono in questo elenco:
 * hanno parametri di filtro propri (v. {@link FiltriCodiciEer},
 * {@link FiltriComuniProvincia}) e metodi dedicati sul client.
 */
export const NOME_TABELLE_CODIFICHE_SEMPLICI = [
  'attivita',
  'attivita-rs',
  'stati-fisici',
  'caratteristiche-pericolo',
  'adr-classi',
  'categorie-raee',
  'materiali',
  'provenienza',
  'unita-misura',
  'stati-formulario',
  'tipi-accettazione',
  'tipi-autorizzazione',
  'tipi-respingimento',
  'causali-operazione',
  'causali-respingimento',
  'tipi-tratte',
  'tipi-trasporto-transfrontaliero',
  'codici-errore',
  'regioni',
  'nazioni',
  'province',
] as const

export type NomeTabellaCodificaSemplice = (typeof NOME_TABELLE_CODIFICHE_SEMPLICI)[number]

/** Filtri opzionali di `GET /lookup/codici-eer` (codifiche.yaml, unica tabella "Rifiuto" con parametri). */
export interface FiltriCodiciEer {
  /** Se indicato, restituisce solo i codici pericolosi (`true`) o non pericolosi (`false`). */
  pericoloso?: boolean
  /** Se `true`, esclude le voci di "capitolo" (codici che terminano in `0000`). */
  escludi00?: boolean
}

/** Filtri opzionali di `GET /lookup/comuni/{provincia_id}` (default contrattuale: `attivi=true`). */
export interface FiltriComuniProvincia {
  /** Filtra per singolo comune all'interno della provincia. */
  comuneId?: string
  /** Default `true` (dichiarato dal contratto): un comune soppresso/accorpato non compare a meno di `attivi=false`. */
  attivi?: boolean
}

/** Corpo di `GET /status` (nessuna autenticazione richiesta, v. `codifiche.yaml`). */
export interface StatoServizioCodifiche {
  status: 'Ok' | 'Warning' | 'Planned' | string
  warnings: unknown[]
  planned_notices: unknown[]
}
