/**
 * Sceglie l'URL del client di sistema e dice se si e' ripiegato sulla connessione
 * applicativa. Condiviso da `PrismaSistemaService` e dai seed cross-tenant.
 * L'URL contiene la password: non va MAI nei log.
 */
export function risolviUrlSistema(env: NodeJS.ProcessEnv = process.env): {
  url: string | undefined
  fallback: boolean
} {
  const dedicato = env.DATABASE_URL_SISTEMA
  if (dedicato) return { url: dedicato, fallback: false }
  return { url: env.DATABASE_URL, fallback: true }
}
