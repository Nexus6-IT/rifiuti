/**
 * Valore predefinito di `trust proxy`. In produzione la catena e': client -> nginx dell'host
 * (127.0.0.1) -> nginx del container frontend (IP privato della rete docker) -> backend:3000, e
 * ciascuno dei due nginx aggiunge il proprio `X-Forwarded-For`. Con il solo `loopback` il backend
 * vedrebbe come client l'IP del container frontend e ogni limite per IP diventerebbe globale.
 * Si fidano quindi gli indirizzi di loopback, link-local e privati (rete docker): `req.ip` e' il
 * primo indirizzo NON fidato risalendo la catena, cioe' il client reale, e un `X-Forwarded-For`
 * inventato dal client (a sinistra) non conta.
 */
export const TRUST_PROXY_PREDEFINITO = 'loopback, linklocal, uniquelocal'

/**
 * Valore di `trust proxy` di Express (vedi `TRUST_PROXY_PREDEFINITO`).
 * `TRUST_PROXY` puo' sovrascrivere: `false`, un numero di hop (`1`) o un elenco di subnet.
 * Vale anche per gli altri throttler (per IP), che prima vedevano tutti l'IP del proxy.
 */
export function valoreTrustProxy(env: string | undefined): boolean | number | string {
  const v = env?.trim()
  if (!v) return TRUST_PROXY_PREDEFINITO
  if (v === 'false') return false
  if (v === 'true')
    throw new Error(
      'TRUST_PROXY=true e` insicuro (X-Forwarded-For falsificabile): usare un numero di hop o subnet'
    )
  if (/^\d+$/.test(v)) return Number(v)
  return v
}
