import { Injectable, OnModuleInit } from '@nestjs/common'
import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client'

/**
 * Prometheus metrics service
 *
 * Exposes application metrics for monitoring dashboards (Grafana, CloudWatch, etc.)
 *
 * Metrics include:
 * - HTTP request duration and count
 * - FIR creation and sync rates
 * - Queue depths
 * - Database connection pool status
 * - Cache hit rates
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry

  // HTTP metrics
  public readonly httpRequestDuration: Histogram
  public readonly httpRequestTotal: Counter
  public readonly httpRequestErrors: Counter

  // Business metrics - FIR
  public readonly firCreatedTotal: Counter
  public readonly firSyncedTotal: Counter
  public readonly firSyncDuration: Histogram
  public readonly firSyncErrors: Counter

  // Business metrics - RENTRI
  public readonly rentriApiRequestDuration: Histogram
  public readonly rentriApiErrors: Counter

  // RENTRI robustezza (R5 Task 5 — allarmi)
  public readonly rentriCertificateExpiryDays: Gauge
  public readonly rentriTenantLocked: Gauge
  public readonly rentriReconciliationDivergences: Counter

  // RENTRI robustezza (R5 Task 2 — limitatore preventivo per tenant)
  public readonly rentriRateLimiterWaitSeconds: Histogram

  // Queue metrics
  public readonly queueDepth: Gauge
  public readonly queueJobDuration: Histogram
  public readonly queueJobErrors: Counter

  // Database metrics
  public readonly dbConnectionsActive: Gauge
  public readonly dbQueryDuration: Histogram

  // Cache metrics
  public readonly cacheHitTotal: Counter
  public readonly cacheMissTotal: Counter

  constructor() {
    this.registry = new Registry()

    // HTTP Metrics
    this.httpRequestDuration = new Histogram({
      name: 'wasteflow_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.3, 0.5, 1, 3, 5, 10],
      registers: [this.registry],
    })

    this.httpRequestTotal = new Counter({
      name: 'wasteflow_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    })

    this.httpRequestErrors = new Counter({
      name: 'wasteflow_http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error_code'],
      registers: [this.registry],
    })

    // FIR Metrics
    this.firCreatedTotal = new Counter({
      name: 'wasteflow_fir_created_total',
      help: 'Total number of FIRs created',
      labelNames: ['tenant_id', 'waste_type'],
      registers: [this.registry],
    })

    this.firSyncedTotal = new Counter({
      name: 'wasteflow_fir_synced_total',
      help: 'Total number of FIRs synced to RENTRI',
      labelNames: ['tenant_id', 'status'],
      registers: [this.registry],
    })

    this.firSyncDuration = new Histogram({
      name: 'wasteflow_fir_sync_duration_seconds',
      help: 'Duration of FIR RENTRI sync in seconds',
      labelNames: ['tenant_id'],
      buckets: [1, 3, 5, 10, 30, 60],
      registers: [this.registry],
    })

    this.firSyncErrors = new Counter({
      name: 'wasteflow_fir_sync_errors_total',
      help: 'Total number of FIR sync errors',
      labelNames: ['tenant_id', 'error_type'],
      registers: [this.registry],
    })

    // RENTRI API Metrics
    this.rentriApiRequestDuration = new Histogram({
      name: 'wasteflow_rentri_api_request_duration_seconds',
      help: 'Duration of RENTRI API requests in seconds',
      labelNames: ['endpoint', 'status'],
      buckets: [0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    })

    this.rentriApiErrors = new Counter({
      name: 'wasteflow_rentri_api_errors_total',
      help: 'Total number of RENTRI API errors',
      labelNames: ['endpoint', 'error_type'],
      registers: [this.registry],
    })

    // RENTRI robustezza (R5 Task 5): metriche di supporto agli allarmi
    // Prometheus (monitoring/alerts/rentri.yml) — riusano MetricsService/
    // Registry esistenti, nessun meccanismo nuovo.
    this.rentriCertificateExpiryDays = new Gauge({
      name: 'wasteflow_rentri_certificate_expiry_days',
      help: 'Giorni mancanti alla scadenza del certificato RENTRI del tenant (calcolati dal campo notAfter del PEM salvato, aggiornati dal job giornaliero rentri-certificato-scadenza.job.ts). Valore negativo = certificato già scaduto.',
      labelNames: ['tenant_id'],
      registers: [this.registry],
    })

    this.rentriTenantLocked = new Gauge({
      name: 'wasteflow_rentri_tenant_locked',
      help: "Indica (1) se il tenant ha ricevuto un 423 (risorsa bloccata) confermato dall'ultima risposta RENTRI, tornato a 0 alla prima risposta non-423 successiva (successo o altro errore). Non distingue un singolo 423 transitorio da un pattern persistente: quella distinzione è nella regola di allarme (increase(...) su una finestra di 1h), non in questo gauge.",
      labelNames: ['tenant_id'],
      registers: [this.registry],
    })

    this.rentriReconciliationDivergences = new Counter({
      name: 'wasteflow_rentri_reconciliation_divergences_total',
      help: 'Numero di divergenze rilevate dalla riconciliazione periodica dello stato RENTRI (R5 Task 4), per esito: "corretto" (il sistema ha riempito un buco con lo stesso metodo di dominio del flusso normale) o "segnalato" (richiede verifica manuale, nessuna correzione automatica).',
      labelNames: ['tenant_id', 'esito'],
      registers: [this.registry],
    })

    // R5 Task 2: quanto tempo un'operazione RENTRI ha atteso il limitatore
    // preventivo per-tenant (rentri-rate-limiter.service.ts) prima di poter
    // eseguire un tentativo HTTP. Distinta da `rentriApiErrors`: qui non è
    // avvenuto alcun errore, è un'attesa VOLUTA per restare sotto la soglia
    // dichiarata dal contratto RENTRI. Bucket fino a 5s: coerenti con
    // l'ampiezza della finestra scorrevole del limitatore (5s,
    // RENTRI_RATE_LIMIT_FINESTRA_MS) — un'attesa oltre quell'ordine di
    // grandezza indicherebbe un tenant che satura sistematicamente il
    // proprio budget, non un picco isolato.
    this.rentriRateLimiterWaitSeconds = new Histogram({
      name: 'wasteflow_rentri_rate_limiter_wait_seconds',
      help: 'Tempo (secondi) atteso dal limitatore preventivo per-tenant RENTRI prima di un tentativo HTTP, per tenant. Un valore diverso da zero non è un errore: è il limitatore che rallenta di proposito il traffico nostro per restare sotto la soglia dichiarata dal contratto (100 richieste/5s).',
      labelNames: ['tenant_id'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    })

    // Queue Metrics
    this.queueDepth = new Gauge({
      name: 'wasteflow_queue_depth',
      help: 'Number of jobs waiting in queue',
      labelNames: ['queue_name', 'status'],
      registers: [this.registry],
    })

    this.queueJobDuration = new Histogram({
      name: 'wasteflow_queue_job_duration_seconds',
      help: 'Duration of queue job processing in seconds',
      labelNames: ['queue_name', 'job_type'],
      buckets: [1, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    })

    this.queueJobErrors = new Counter({
      name: 'wasteflow_queue_job_errors_total',
      help: 'Total number of queue job errors',
      labelNames: ['queue_name', 'job_type', 'error_type'],
      registers: [this.registry],
    })

    // Database Metrics
    this.dbConnectionsActive = new Gauge({
      name: 'wasteflow_db_connections_active',
      help: 'Number of active database connections',
      registers: [this.registry],
    })

    this.dbQueryDuration = new Histogram({
      name: 'wasteflow_db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['query_type'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.registry],
    })

    // Cache Metrics
    this.cacheHitTotal = new Counter({
      name: 'wasteflow_cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_key_prefix'],
      registers: [this.registry],
    })

    this.cacheMissTotal = new Counter({
      name: 'wasteflow_cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_key_prefix'],
      registers: [this.registry],
    })
  }

  onModuleInit() {
    // Collect default Node.js metrics (CPU, memory, event loop lag, etc.)
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'wasteflow_nodejs_',
    })
  }

  /**
   * Get all metrics in Prometheus text format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics()
  }

  /**
   * Get Prometheus registry for custom metric registration
   */
  getRegistry(): Registry {
    return this.registry
  }

  /**
   * Reset all metrics (useful for testing)
   */
  resetMetrics(): void {
    this.registry.resetMetrics()
  }
}
