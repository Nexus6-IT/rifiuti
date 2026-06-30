import { Injectable, computed, inject, signal } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable, of, tap, catchError, finalize } from 'rxjs'
import { environment } from '../../../environments/environment'

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
 * Sorgente unica delle feature abilitate per il tenant attivo. Il layout la
 * carica in `ngOnInit` tramite `load()` e usa `has(key)` per il gating del
 * menu di sinistra. La cache è in memoria: una volta caricate, le feature
 * restano disponibili senza ulteriori chiamate finché l'app non viene
 * ricaricata (lo switch di tenant fa un reload, quindi le ricarica da zero).
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private readonly http = inject(HttpClient)

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

  /**
   * Carica le feature dal backend. Idempotente: se già caricate (o in
   * caricamento) non rifà la chiamata. In caso di errore lascia l'elenco
   * vuoto (fail-closed: nessuna voce opzionale visibile, la Dashboard resta
   * comunque sempre accessibile lato layout).
   */
  load(): Observable<MeFeaturesResponse> {
    if (this.loaded() || this.loading()) {
      return of({
        features: this.features(),
        tier: this.tier(),
        userLimitTotal: this.userLimitTotal(),
      })
    }

    this.loading.set(true)

    return this.http.get<MeFeaturesResponse>(`${environment.apiUrl}/me/features`).pipe(
      tap(res => {
        this.features.set(Array.isArray(res?.features) ? res.features : [])
        this.tier.set(res?.tier ?? null)
        this.userLimitTotal.set(res?.userLimitTotal ?? null)
        this.loaded.set(true)
      }),
      catchError(() => {
        this.features.set([])
        this.tier.set(null)
        this.userLimitTotal.set(null)
        // Non segno `loaded`: un eventuale retry successivo è permesso.
        return of({ features: [] as string[], tier: null, userLimitTotal: null })
      }),
      finalize(() => this.loading.set(false))
    )
  }

  /** True se la feature indicata è abilitata per il tenant corrente. */
  has(key: string): boolean {
    return this.featureSet().has(key)
  }
}
