/**
 * Blacklist di endpoint distruttivi (da docs/audits/uat-2026-07-25/01-api-surface.md,
 * sezione "BLACKLIST distruttivi — non invocare mai su produzione").
 *
 * Ogni voce è {method, pattern} dove pattern è una regex applicata al PATH
 * (senza query string) della richiesta, già normalizzato senza il prefisso
 * host/porta. `:id`/`:code` nella doc diventano `[^/]+` nella regex.
 */
export interface BlacklistEntry {
  method: string // '*' = qualunque metodo
  pattern: RegExp
  label: string
}

export const DESTRUCTIVE_BLACKLIST: BlacklistEntry[] = [
  {
    method: 'POST',
    pattern: /\/api\/v1\/backup\/restore\/?$/,
    label: 'POST /backup/restore — sovrascrive il DB da backup',
  },
  {
    method: 'DELETE',
    pattern: /\/api\/v1\/backup\/cleanup\/?$/,
    label: 'DELETE /backup/cleanup — purge irreversibile backup',
  },
  {
    method: 'POST',
    pattern: /\/api\/v1\/backup\/create\/?$/,
    label: 'POST /backup/create — crea un backup (side-effect I/O pesante, escluso per prudenza)',
  },
  {
    method: 'DELETE',
    pattern: /\/api\/v1\/registry\/(produttori|trasportatori|destinatari)\/[^/]+\/?$/,
    label: 'DELETE /registry/* — elimina anagrafica master data',
  },
  {
    method: 'PATCH',
    pattern: /\/api\/v1\/admin\/tenants\/[^/]+\/status\/?$/,
    label: 'PATCH /admin/tenants/:id/status — sospende/riattiva un intero tenant',
  },
  {
    method: 'POST',
    pattern: /\/api\/v1\/reference-data\/reseed\/?$/,
    label: 'POST /reference-data/reseed — sovrascrive dataset di riferimento condivisi',
  },
  {
    method: 'POST',
    pattern: /\/api\/v1\/fir\/[^/]+\/annulla\/?$/,
    label: 'POST /fir/:id/annulla — annulla irreversibilmente un FIR',
  },
  {
    method: 'DELETE',
    pattern: /\/api\/v1\/rentri\/credential\/?$/,
    label: 'DELETE /rentri/credential — rimuove la credenziale RENTRI del tenant',
  },
]

/**
 * Verifica se una richiesta (metodo + url) matcha una voce della blacklist.
 * L'URL può essere assoluto o relativo: viene confrontato solo il pathname.
 *
 * Matcher puro: non conosce run, prefissi o esenzioni. Resta invariato (e
 * quindi il self-test esistente in tests/public/guardrail-self-test.spec.ts
 * continua a valere) — le esenzioni per-run sono un livello separato, vedi
 * `valutaRichiesta` sotto.
 */
export function matchBlacklist(method: string, url: string): BlacklistEntry | null {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }
  const upperMethod = method.toUpperCase()
  for (const entry of DESTRUCTIVE_BLACKLIST) {
    if (entry.method !== '*' && entry.method !== upperMethod) continue
    if (entry.pattern.test(pathname)) return entry
  }
  return null
}

/**
 * Esenzioni per-run al blocco DELETE /registry/(produttori|trasportatori|
 * destinatari)/:id: id di risorse create ED ESPLICITAMENTE REGISTRATE da
 * questa run (vedi fixtures/risorse.ts `registra`).
 *
 * ATTENZIONE a cosa NON garantisce: questa esenzione non è "sicura anche in
 * produzione" — è semplicemente IRRAGGIUNGIBILE in produzione con l'unico
 * meccanismo di autenticazione oggi esistente. `apiLogin` (utils/api-client.ts)
 * rifiuta sempre di autenticarsi contro un target non locale, e l'endpoint
 * di bypass POST /auth/dev/login non è nemmeno registrato lì (vedi
 * auth.module.ts) — quindi oggi non esiste un token valido con cui questa
 * esenzione potrebbe essere usata contro produzione. Il giorno in cui
 * qualcuno aggiunge un SECONDO modo di autenticarsi (un token reale, una
 * chiave di servizio, ecc.), questa esenzione tornerà raggiungibile e andrà
 * rivalutata da capo: non è stata pensata per quel caso, è solo che quel
 * caso oggi non può presentarsi.
 *
 * Stato in-memory, per processo: fixtures/risorse.ts lo ripopola sia alla
 * registrazione (stesso processo del test) sia in `ripulisci()` (processo
 * del teardown, che rilegge il registro persistito su disco e riesenta
 * ogni id prima di cancellarlo).
 */
const idEsentiDaBlacklist = new Set<string>()

const PATTERN_DELETE_REGISTRY =
  /\/api\/v1\/registry\/(produttori|trasportatori|destinatari)\/([^/]+)\/?$/

/** Segna un id come esente dal blocco DELETE /registry/* per questo processo. */
export function esentaDallaBlacklist(id: string): void {
  idEsentiDaBlacklist.add(id)
}

/** Solo per i test del matcher: azzera le esenzioni registrate. */
export function pulisciEsenzioni(): void {
  idEsentiDaBlacklist.clear()
}

/**
 * Come `matchBlacklist`, ma applica l'esenzione per-run sulle tre rotte di
 * cancellazione dell'anagrafica: se l'id nell'URL è stato registrato in
 * questa run (`esentaDallaBlacklist`), la richiesta NON viene bloccata.
 * Ogni altra voce della blacklist resta bloccata SEMPRE, senza eccezioni:
 * l'esenzione riguarda esclusivamente DELETE /registry/*.
 *
 * Questo è il punto che deve essere usato da chi esegue davvero le
 * richieste (vedi utils/api-client.ts `apiDelete`) — `matchBlacklist` resta
 * il matcher puro per il self-test della blacklist.
 */
export function valutaRichiesta(method: string, url: string): BlacklistEntry | null {
  const hit = matchBlacklist(method, url)
  if (!hit) return null

  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }

  const registryDeleteMatch = pathname.match(PATTERN_DELETE_REGISTRY)
  if (registryDeleteMatch && method.toUpperCase() === 'DELETE') {
    const id = registryDeleteMatch[2]
    if (idEsentiDaBlacklist.has(id)) return null
  }

  return hit
}
