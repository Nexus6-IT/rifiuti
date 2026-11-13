/**
 * Valore di `trust proxy` di Express. nginx sta sullo stesso host e inoltra su loopback: si fida di
 * UN solo hop, quello di loopback, cosi' `req.ip` e' l'indirizzo del client (ultimo valore di
 * `X-Forwarded-For` aggiunto da nginx) e un `X-Forwarded-For` inventato dal client non conta.
 * `TRUST_PROXY` puo' sovrascrivere: `false`, un numero di hop (`1`) o un elenco di subnet.
 * Vale anche per gli altri throttler (per IP), che prima vedevano tutti l'IP del proxy.
 */
export function valoreTrustProxy(env: string | undefined): boolean | number | string {
  const v = env?.trim()
  if (!v) return 'loopback'
  if (v === 'false') return false
  if (v === 'true')
    throw new Error(
      'TRUST_PROXY=true e` insicuro (X-Forwarded-For falsificabile): usare un numero di hop o subnet'
    )
  if (/^\d+$/.test(v)) return Number(v)
  return v
}
