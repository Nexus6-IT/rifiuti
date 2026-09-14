/**
 * Risoluzione centralizzata delle variabili d'ambiente per la suite E2E.
 *
 * REGOLA DI SICUREZZA: il default di E2E_BASE_URL punta SEMPRE all'ambiente
 * locale (http://localhost:4200), MAI a produzione. Per puntare a produzione
 * bisogna impostare esplicitamente E2E_BASE_URL (vedi script `e2e:prod` in
 * package.json, che imposta la variabile e un flag di conferma).
 */

export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:4200'
export const DEFAULT_LOCAL_API_URL = 'http://localhost:3000/api/v1'
export const PRODUCTION_BASE_URL = 'https://rifiuti.ignicraft.com'

export function getBaseUrl(): string {
  return process.env.E2E_BASE_URL?.trim() || DEFAULT_LOCAL_BASE_URL
}

/**
 * Deriva l'URL base dell'API dalla baseURL del frontend quando non esplicitata.
 * In locale il backend gira su una porta diversa (3000) dal frontend (4200),
 * quindi non è un semplice `${baseUrl}/api/v1`.
 */
export function getApiUrl(): string {
  if (process.env.E2E_API_URL?.trim()) {
    return process.env.E2E_API_URL.trim()
  }
  const base = getBaseUrl()
  if (isProductionTarget(base)) {
    return `${base.replace(/\/$/, '')}/api/v1`
  }
  return DEFAULT_LOCAL_API_URL
}

/**
 * true se la baseURL corrente punta al dominio di produzione (o a qualunque
 * host diverso da localhost/127.0.0.1 — trattato come "non sicuro" per default,
 * per non abbassare la guardia su eventuali ambienti di staging non censiti).
 */
export function isProductionTarget(baseUrl: string = getBaseUrl()): boolean {
  try {
    const url = new URL(baseUrl)
    const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return !isLocalHost
  } catch {
    // baseURL non parsabile: fail-safe, trattalo come "non sicuro"
    return true
  }
}

export interface RoleCredentials {
  email: string
  password: string
}

export type Role = 'admin' | 'operator' | 'viewer' | 'superAdmin'

const ROLE_ENV_PREFIX: Record<Role, string> = {
  admin: 'E2E_ADMIN',
  operator: 'E2E_OPERATOR',
  viewer: 'E2E_VIEWER',
  superAdmin: 'E2E_SUPERADMIN',
}

/**
 * Legge le credenziali di un ruolo dalle variabili d'ambiente
 * `E2E_<ROLE>_USER` / `E2E_<ROLE>_PASS`. Ritorna null se mancano (il chiamante
 * deve fare skip condizionale, mai fallire rumorosamente).
 */
export function getRoleCredentials(role: Role): RoleCredentials | null {
  const prefix = ROLE_ENV_PREFIX[role]
  const email = process.env[`${prefix}_USER`]?.trim()
  const password = process.env[`${prefix}_PASS`]?.trim()
  if (!email || !password) return null
  return { email, password }
}

/**
 * Email del seed di sviluppo (apps/backend/prisma/seed-test-user.ts) per
 * ciascun ruolo, usate dal bypass POST /auth/dev/login. Copre solo
 * admin/operator/viewer: quel seed NON crea nessun utente SUPER_ADMIN, quindi
 * "superAdmin" resta volutamente fuori da questa mappa — vedi
 * getDevLoginSeedEmail e skipReason() in fixtures/auth.ts.
 */
const DEV_LOGIN_SEED_EMAILS: Partial<Record<Role, string>> = {
  admin: 'admin@test.com',
  operator: 'operator@test.com',
  viewer: 'viewer@test.com',
}

/**
 * Email del seed di sviluppo per il ruolo, o null se il ruolo non ha un
 * utente seed (oggi: solo "superAdmin").
 */
export function getDevLoginSeedEmail(role: Role): string | null {
  return DEV_LOGIN_SEED_EMAILS[role] ?? null
}

/**
 * true se il bypass POST /auth/dev/login è utilizzabile per questo ruolo sul
 * target corrente: mai su un target di produzione (isProductionTarget — la
 * rotta non esiste nemmeno, vedi auth.module.ts) e solo se esiste un utente
 * seed per il ruolo.
 */
export function canUseDevLogin(role: Role): boolean {
  return !isProductionTarget() && getDevLoginSeedEmail(role) !== null
}

/**
 * true se il ruolo è autenticabile in questa run, con QUALUNQUE dei due
 * percorsi: credenziali Keycloak reali (E2E_<RUOLO>_USER/PASS) oppure il
 * bypass di sviluppo dev-login (solo su target non di produzione, solo per
 * admin/operator/viewer — vedi canUseDevLogin). Usata da tutte le spec per
 * decidere lo skip: `test.skip(!hasRoleCredentials(role), skipReason(role))`.
 * Il nome è storico (era "solo credenziali reali"); il significato attuale è
 * "posso autenticare questo ruolo", non "ho una password per questo ruolo" —
 * per il motivo della scelta di precedenza fra i due percorsi, vedi
 * loginAndSaveState() in fixtures/auth.ts.
 */
export function hasRoleCredentials(role: Role): boolean {
  return getRoleCredentials(role) !== null || canUseDevLogin(role)
}

export function hasAnyCredentials(): boolean {
  return (['admin', 'operator', 'viewer', 'superAdmin'] as Role[]).some(hasRoleCredentials)
}

/**
 * URL della fake API RENTRI. Default locale: la fake non deve mai essere
 * cercata su un host di produzione.
 */
export function getRentriFakeUrl(): string {
  return process.env.E2E_RENTRI_FAKE_URL ?? 'http://localhost:4010'
}
