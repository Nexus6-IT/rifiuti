/**
 * Client HTTP minimale per il setup/teardown via API della suite E2E
 * (vedi vincoli globali del piano: "Setup via API, non via interfaccia,
 * tranne il passo sotto test"). Usa fetch nativo (Node 20+, vedi
 * package.json "engines").
 */

import {
  canUseDevLogin,
  getApiUrl,
  getDevLoginSeedEmail,
  getRoleCredentials,
  isProductionTarget,
  type Role,
} from './env'
import { valutaRichiesta } from './blacklist'
import {
  decidiRetryDevLogin,
  decidiRetryRichiesta,
  leggiRetryAfterSecondi,
} from './dev-login-retry'

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

  // Il token non si può cachare fra test (sessione unica per utente: un nuovo
  // login invalida il precedente), quindi con più worker il throttler globale
  // del backend può rispondere 429. Si riprova attendendo il Retry-After (o un
  // backoff) entro un tetto; il rate limit del backend resta invariato.
  let tentativo = 0
  let attesaTotaleMs = 0
  let risposta: Response
  let corpo: unknown
  for (;;) {
    tentativo++
    risposta = await fetch(`${getApiUrl()}${DEV_LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Il DTO del bypass di sviluppo accetta solo email (vedi
      // apps/backend/src/auth/dto/dev-login.dto.ts) e il ValidationPipe
      // globale ha forbidNonWhitelisted:true — mandare anche la password
      // farebbe fallire la richiesta con 400.
      body: JSON.stringify({ email }),
    })
    corpo = await leggiCorpo(risposta)
    if (risposta.ok) break
    const decisione = decidiRetryDevLogin(
      risposta.status,
      tentativo,
      attesaTotaleMs,
      leggiRetryAfterSecondi(risposta.headers)
    )
    if (!decisione.riprova) break
    attesaTotaleMs += decisione.attesaMs
    await new Promise(r => setTimeout(r, decisione.attesaMs))
  }
  if (!risposta.ok) {
    throw new ApiClientError(
      `Login dev fallito per l'email "${email}" dopo ${tentativo} tentativi: ${risposta.status} ${risposta.statusText} — ` +
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
 * Sceglie l'email con cui apiLogin() chiede il token al bypass dev-login.
 * Funzione pura (nessuna rete): legge solo process.env, così è testabile
 * senza server (vedi tests/public/api-login-email.spec.ts).
 *
 * Regola, identica a quella di hasRoleCredentials() in env.ts (così apiLogin
 * accetta esattamente i ruoli che hasRoleCredentials dichiara autenticabili):
 *  1. credenziali reali E2E_<RUOLO>_USER/PASS presenti: vince la loro email
 *     (la password non viene inviata, il DTO accetta solo email);
 *  2. altrimenti, se canUseDevLogin(ruolo) (target non di produzione e
 *     ruolo con utente seed): l'email del seed (getDevLoginSeedEmail);
 *  3. altrimenti errore: mai dev-login su un target di produzione, e
 *     superAdmin non ha un utente seed.
 */
export function scegliEmailApiLogin(ruolo: Role): string {
  const credenziali = getRoleCredentials(ruolo)
  if (credenziali) return credenziali.email

  if (canUseDevLogin(ruolo)) {
    const emailSeed = getDevLoginSeedEmail(ruolo)
    if (emailSeed) return emailSeed
  }

  throw new Error(
    `Credenziali mancanti per il ruolo "${ruolo}" (variabili E2E_${ruolo.toUpperCase()}_USER/PASS non ` +
      'impostate e dev-login non utilizzabile: target di produzione o ruolo senza utente seed). ' +
      'Impostale prima di chiamare apiLogin — vedi e2e/README.md.'
  )
}

/**
 * Login via il bypass di sviluppo (POST /auth/dev/login). L'email è scelta
 * da scegliEmailApiLogin(): credenziali reali E2E_<RUOLO>_USER/PASS se ci
 * sono, altrimenti l'email del seed di sviluppo del ruolo quando il
 * dev-login è utilizzabile (stessa regola di hasRoleCredentials). Per
 * passare direttamente un'email vedi devLoginTokens() sopra.
 */
export async function apiLogin(ruolo: Role): Promise<string> {
  const { accessToken } = await devLoginTokens(scegliEmailApiLogin(ruolo))
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

  // Con piu' worker in parallelo il throttler del backend (100 richieste/minuto) puo' rispondere
  // 429 al setup/teardown: si attende (Retry-After, o un backoff breve e crescente) e si riprova,
  // al massimo 5 tentativi. Il limite del backend resta com'e'.
  let tentativo = 0
  let risposta: Response
  let testoCorpo: unknown
  for (;;) {
    tentativo++
    risposta = await fetch(url, {
      method: metodo,
      headers: intestazioni(token),
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
    testoCorpo = await leggiCorpo(risposta)
    if (risposta.ok) break
    const decisione = decidiRetryRichiesta(
      risposta.status,
      tentativo,
      leggiRetryAfterSecondi(risposta.headers)
    )
    if (!decisione.riprova) break
    await new Promise(r => setTimeout(r, decisione.attesaMs))
  }
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
