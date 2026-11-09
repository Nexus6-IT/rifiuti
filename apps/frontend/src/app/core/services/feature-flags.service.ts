import { Injectable, computed, inject, signal } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable, of, tap, catchError, finalize, shareReplay } from 'rxjs'
import { environment } from '../../../environments/environment'
import { AdminTenantContextService } from './admin-tenant-context.service'

/**
 * Risposta di GET /api/v1/me/features per il tenant corrente.
 * Un super admin senza tenant riceve TUTTE le feature.
 */
export interface MeFeaturesResponse {
  features: string[]
  tier?: string | null
  userLimitTotal?: number | null
}

/**
 * FeatureFlagsService
 *
 * Sorgente unica dei moduli (feature) abilitati per l'azienda attiva. Il layout la
 * carica in `ngOnInit` tramite `load()` e usa `has(key)` per il gating del menu; il
 * `moduloGuard` la usa per le rotte.
 *
 * Cache in memoria: una volta caricati, i moduli restano disponibili senza altre chiamate.
 * La cache vale per l'azienda selezionata al momento del caricamento: se la selezione cambia
 * (`AdminTenantContextService`), il `load()` successivo ricalcola con una nuova richiesta.
 * Le richieste concorrenti condividono la stessa chiamata: un guard che parte mentre il layout
 * sta ancora caricando aspetta la stessa risposta invece di decidere su un elenco ancora vuoto.
 * `ricarica()` forza una nuova richiesta (usata quando il backend risponde `MODULO_NON_ATTIVO`).
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private readonly http = inject(HttpClient)
  private readonly tenantContext = inject(AdminTenantContextService)

  /** Elenco delle feature abilitate per il tenant corrente. */
  readonly features = signal<string[]>([])

  /** Metadati del piano (tier) e limite utenti, se forniti dal backend. */
  readonly tier = signal<string | null>(null)
  readonly userLimitTotal = signal<number | null>(null)

  /** True quando il caricamento iniziale è andato a buon fine. */
  readonly loaded = signal<boolean>(false)

  /** True mentre è in corso la chiamata a /me/features. */
  readonly loading = signal<boolean>(false)

  /** Set derivato per lookup O(1) in `has()`. */
  private readonly featureSet = computed(() => new Set(this.features()))

  /** Azienda selezionata (null = primaria) per cui i moduli in cache sono stati calcolati. */
  private tenantCaricato: string | null = null

  /** Richiesta in volo, condivisa fra i chiamanti, con l'azienda per cui è partita. */
  private inVolo: { tenant: string | null; richiesta$: Observable<MeFeaturesResponse> } | null =
    null

  /**
   * Carica i moduli dal backend. Idempotente: se già caricati per l'azienda selezionata
   * risponde dalla cache senza HTTP; se una richiesta è in volo per la stessa azienda la
   * condivide. In caso di errore lascia l'elenco vuoto (fail-closed per il menu) e NON segna
   * `loaded`: un tentativo successivo riprova.
   */
  load(): Observable<MeFeaturesResponse> {
    const tenant = this.tenantContext.selectedTenantId()
    if (this.loaded() && this.tenantCaricato === tenant) {
      return of(this.istantanea())
    }
    return this.richiedi(tenant)
  }

  /** Forza una nuova richiesta, anche con i moduli già in cache (o riusa quella in volo). */
  ricarica(): Observable<MeFeaturesResponse> {
    return this.richiedi(this.tenantContext.selectedTenantId())
  }

  /** True se la feature indicata è abilitata per il tenant corrente. */
  has(key: string): boolean {
    return this.featureSet().has(key)
  }

  private istantanea(): MeFeaturesResponse {
    return { features: this.features(), tier: this.tier(), userLimitTotal: this.userLimitTotal() }
  }

  private richiedi(tenant: string | null): Observable<MeFeaturesResponse> {
    if (this.inVolo && this.inVolo.tenant === tenant) {
      return this.inVolo.richiesta$
    }

    this.loading.set(true)
    const richiesta$ = this.http.get<MeFeaturesResponse>(`${environment.apiUrl}/me/features`).pipe(
      tap(res => {
        this.features.set(Array.isArray(res?.features) ? res.features : [])
        this.tier.set(res?.tier ?? null)
        this.userLimitTotal.set(res?.userLimitTotal ?? null)
        this.tenantCaricato = tenant
        this.loaded.set(true)
      }),
      catchError(() => {
        this.features.set([])
        this.tier.set(null)
        this.userLimitTotal.set(null)
        this.loaded.set(false)
        return of({ features: [] as string[], tier: null, userLimitTotal: null })
      }),
      finalize(() => {
        if (this.inVolo?.richiesta$ === richiesta$) {
          this.inVolo = null
          this.loading.set(false)
        }
      }),
      shareReplay(1)
    )
    this.inVolo = { tenant, richiesta$ }
    // Parte subito: chi chiama load()/ricarica() senza sottoscrivere ottiene comunque i moduli.
    richiesta$.subscribe()
    return richiesta$
  }
}
