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
