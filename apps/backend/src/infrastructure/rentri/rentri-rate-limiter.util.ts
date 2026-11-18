import { MetricsService } from '../../core/metrics/metrics.service'
import { RentriRateLimiterService } from './rentri-rate-limiter.service'

/**
 * Applica il limitatore preventivo per-tenant (R5, v.
 * `rentri-rate-limiter.service.ts`) attorno a UN singolo tentativo HTTP.
 *
 * Stesso comportamento di `RENTRIApiClient.conRateLimiter`, estratto qui perche'
 * lo usano anche i client di xFIR, copie e trasmissioni (piano FIR in viaggio,
 * P0 T4): senza, un loop di polling o una serie di caricamenti dello stesso
 * tenant avrebbe potuto superare la soglia dell'ente (100 richieste/5 s) e far
 * scattare il 423 sul certificato dell'azienda, fermando anche le operazioni
 * dei FIR.
 *
 * - Il permesso si acquisisce PRIMA di ogni tentativo, non una volta per
 *   operazione: un retry per 429/5xx consuma budget come ogni richiesta.
 * - `rilascia()` e' sempre in `finally`.
 * - Senza limitatore (costruzioni dirette nei test) esegue l'azione e basta.
 */
export async function conRateLimiterPerTenant<T>(
  rateLimiter: RentriRateLimiterService | undefined,
  metrics: MetricsService,
  tenantId: string,
  azione: () => Promise<T>
): Promise<T> {
  if (!rateLimiter) {
    return azione()
  }

  const inizio = Date.now()
  const permesso = await rateLimiter.acquisisci(tenantId)
  metrics.rentriRateLimiterWaitSeconds.observe(
    { tenant_id: tenantId },
    (Date.now() - inizio) / 1000
  )

  try {
    return await azione()
  } finally {
    await permesso.rilascia()
  }
}
