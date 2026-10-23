/**
 * Client HTTP minimale per il setup/teardown via API della suite E2E
 * (vedi vincoli globali del piano: "Setup via API, non via interfaccia,
 * tranne il passo sotto test"). Usa fetch nativo (Node 20+, vedi
 * package.json "engines").
 */

import { getApiUrl, getRoleCredentials, isProductionTarget, type Role } from './env'
import { valutaRichiesta } from './blacklist'

const DEV_LOGIN_PATH = '/auth/dev/login'

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

async function leggiCorpo(risposta: Response): Promise<unknown> {
  const testo = await risposta.text()
  if (!testo) return null
  try {
    return JSON.parse(testo)
  } catch {
    return testo
  }
}

/**
 * Bypass di sviluppo diretto per email — POST /auth/dev/login (vedi
 * apps/backend/src/auth/controllers/dev-auth.controller.ts). Quell'endpoint
 * NON esiste in produzione — auth.module.ts lo registra solo quando
 * NODE_ENV !== 'production', quindi in produzione la richiesta risulterebbe
 * in un 404 poco chiaro. Qui rifiutiamo esplicitamente di provarci contro
 * un target non locale, invece di degradare in silenzio.
 *
 * A differenza di apiLogin() sotto, l'email non viene letta dalle credenziali
 * di ruolo (E2E_<RUOLO>_USER) ma passata direttamente dal chiamante: è così
 * che fixtures/auth.ts autentica con le email del seed di sviluppo
 * (admin@test.com / operator@test.com / viewer@test.com — vedi
 * apps/backend/prisma/seed-test-user.ts e getDevLoginSeedEmail() in
 * utils/env.ts), che non hanno nulla a che fare con eventuali credenziali
 * Keycloak configurate via env. Ritorna la coppia completa di token: il
 * refresh token serve a chi deve riprodurre esattamente lo stato che
 * l'app scrive in localStorage dopo il vero redirect da /auth/callback.
 */
export async function devLoginTokens(
  email: string
): Promise<{ accessToken: string; refreshToken: string }> {
  if (isProductionTarget()) {
    throw new Error(
      `[SICUREZZA] devLoginTokens("${email}") userebbe ${DEV_LOGIN_PATH}, disponibile SOLO in ambienti ` +
        'non di produzione (vedi apps/backend/src/auth/auth.module.ts). Il target corrente è di ' +
        `produzione (E2E_BASE_URL): questo client rifiuta di procedere invece di fallire con un ` +
        '404 poco chiaro lato server.'
    )
  }

  const risposta = await fetch(`${getApiUrl()}${DEV_LOGIN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Il DTO del bypass di sviluppo accetta solo email (vedi
    // apps/backend/src/auth/dto/dev-login.dto.ts) e il ValidationPipe
    // globale ha forbidNonWhitelisted:true — mandare anche la password
    // farebbe fallire la richiesta con 400.
    body: JSON.stringify({ email }),
  })

  const corpo = await leggiCorpo(risposta)
  if (!risposta.ok) {
    throw new ApiClientError(
      `Login dev fallito per l'email "${email}": ${risposta.status} ${risposta.statusText} — ` +
        `${JSON.stringify(corpo)}`,
      risposta.status,
      corpo
    )
  }

  const accessToken = (corpo as { accessToken?: string } | null)?.accessToken
  const refreshToken = (corpo as { refreshToken?: string } | null)?.refreshToken
  if (!accessToken || !refreshToken) {
    throw new Error(
      `Risposta di login dev incompleta (manca accessToken o refreshToken) per l'email "${email}": ` +
        `${JSON.stringify(corpo)}`
    )
  }
  return { accessToken, refreshToken }
}

/**
 * Login via il bypass di sviluppo, usando l'email dalle credenziali di ruolo
 * configurate via env (E2E_<RUOLO>_USER). Pensato per chi ha impostato
 * E2E_<RUOLO>_USER/PASS puntando a un utente del seed di sviluppo (la
 * password non viene inviata — il DTO del bypass accetta solo email — ma
 * deve comunque essere presente perché hasRoleCredentials()/getRoleCredentials()
 * considerino il ruolo configurato). Per il caso comune "nessuna credenziale
 * impostata, usa le email note del seed" vedi devLoginTokens() sopra, usato
 * da fixtures/auth.ts.
 */
export async function apiLogin(ruolo: Role): Promise<string> {
  const credenziali = getRoleCredentials(ruolo)
  if (!credenziali) {
    throw new Error(
      `Credenziali mancanti per il ruolo "${ruolo}" (variabili E2E_${ruolo.toUpperCase()}_USER/PASS non ` +
        'impostate). Impostale prima di chiamare apiLogin — vedi e2e/README.md.'
    )
  }

  const { accessToken } = await devLoginTokens(credenziali.email)
  return accessToken
}

function intestazioni(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

async function richiedi<T>(
  metodo: string,
  percorso: string,
  token: string,
  corpo?: unknown
): Promise<T> {
  const url = `${getApiUrl()}${percorso}`

  // Guardrail di sicurezza (vedi utils/blacklist.ts `valutaRichiesta`): un
  // DELETE su un endpoint distruttivo passa solo se l'id nell'URL è stato
  // registrato in questa run. Vale per QUALUNQUE target, non solo produzione
  // — difesa in profondità anche in locale contro bug del chiamante.
  const bloccata = valutaRichiesta(metodo, url)
  if (bloccata) {
    throw new Error(
      `[GUARDRAIL] Richiesta bloccata: ${metodo} ${url} (${bloccata.label}). ` +
        "L'id non risulta registrato in questa run (vedi fixtures/risorse.ts `registra`) — " +
        'questo client rifiuta di eseguire cancellazioni non tracciate.'
    )
  }

  const risposta = await fetch(url, {
    method: metodo,
    headers: intestazioni(token),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })

  const testoCorpo = await leggiCorpo(risposta)
  if (!risposta.ok) {
    throw new ApiClientError(
      `${metodo} ${percorso} fallita: ${risposta.status} ${risposta.statusText} — ` +
        `${JSON.stringify(testoCorpo)}`,
      risposta.status,
      testoCorpo
    )
  }
  return testoCorpo as T
}

export async function apiPost<T>(percorso: string, corpo: unknown, token: string): Promise<T> {
  return richiedi<T>('POST', percorso, token, corpo)
}

export async function apiGet<T>(percorso: string, token: string): Promise<T> {
  return richiedi<T>('GET', percorso, token)
}

export async function apiDelete(percorso: string, token: string): Promise<void> {
  await richiedi<void>('DELETE', percorso, token)
}
