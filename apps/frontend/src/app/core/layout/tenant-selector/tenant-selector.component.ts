import { Component, OnInit, inject, signal, computed } from '@angular/core'
import { CommonModule } from '@angular/common'
import { DropdownModule } from 'primeng/dropdown'
import { FormsModule } from '@angular/forms'
import { HttpClient } from '@angular/common/http'
import { Router } from '@angular/router'
import { AdminTenantContextService } from '../../services/admin-tenant-context.service'
import { environment } from '../../../../environments/environment'

interface TenantOption {
  id: string
  ragioneSociale: string
}

interface ListTenantsResponse {
  tenants: TenantOption[]
  currentTenantId: string | null
}

/**
 * TenantSelectorComponent (header)
 *
 * Dropdown che permette a qualunque utente con accesso a PIÙ società di cambiare
 * il contesto attivo. Visibile solo quando `GET /api/v1/me/tenants` restituisce
 * più di una società.
 *
 * Al cambio di selezione:
 *   1. Aggiorna `AdminTenantContextService` → il `tenantInterceptor` aggiungerà
 *      `X-Tenant-ID: <id>` a tutte le richieste successive.
 *   2. Naviga alla rotta corrente per ricaricare i dati con il nuovo tenant.
 *
 * Non emette un nuovo JWT (approccio a header): il backend `TenantSwitchInterceptor`
 * valida la membership e aggiorna il TenantContext server-side su ogni richiesta.
 *
 * Per gli utenti SUPER_ADMIN il meccanismo è identico: `AdminTenantContextService`
 * era già il loro punto di switch.
 */
@Component({
  selector: 'app-tenant-selector',
  standalone: true,
  imports: [CommonModule, DropdownModule, FormsModule],
  template: `
    @if (hasPiuSocieta()) {
      <div class="tenant-selector" data-cy="tenant-selector">
        <p-dropdown
          [(ngModel)]="tenantSelezionato"
          [options]="societa()"
          optionLabel="ragioneSociale"
          optionValue="id"
          placeholder="Seleziona società"
          (onChange)="onCambioSocieta()"
          styleClass="w-full"
          [showClear]="false"
        >
          <ng-template pTemplate="selectedItem" let-option>
            <div class="flex align-items-center gap-2">
              <i class="pi pi-building"></i>
              <span>{{ option.ragioneSociale }}</span>
            </div>
          </ng-template>
          <ng-template pTemplate="item" let-option>
            <div class="flex align-items-center gap-2" data-cy="tenant-option">
              <i class="pi pi-building"></i>
              <span>{{ option.ragioneSociale }}</span>
            </div>
          </ng-template>
        </p-dropdown>
      </div>
    }
  `,
  styles: [
    `
      .tenant-selector {
        min-width: 200px;
      }

      :host ::ng-deep .p-dropdown {
        border-radius: 6px;
      }
    `,
  ],
})
export class TenantSelectorComponent implements OnInit {
  private readonly http = inject(HttpClient)
  private readonly router = inject(Router)
  private readonly tenantContext = inject(AdminTenantContextService)

  protected readonly societa = signal<TenantOption[]>([])
  protected readonly hasPiuSocieta = computed(() => this.societa().length > 1)
  protected tenantSelezionato = ''

  ngOnInit(): void {
    this.caricaSocieta()
  }

  private caricaSocieta(): void {
    this.http.get<ListTenantsResponse>(`${environment.apiUrl}/me/tenants`).subscribe({
      next: response => {
        this.societa.set(response.tenants ?? [])

        // Inizializza la selezione: usa il tenant già scelto (persistito in
        // localStorage) oppure il tenant corrente dal JWT.
        const stored = this.tenantContext.selectedTenantId()
        const defaultId = response.currentTenantId ?? ''

        // Se il tenant memorizzato è tra quelli accessibili, mantienilo.
        const tenantValido = response.tenants?.find(t => t.id === stored)
        this.tenantSelezionato = tenantValido?.id ?? defaultId

        // Se non è già impostato nel contesto, imposta il default.
        if (!stored && defaultId) {
          const nome = response.tenants?.find(t => t.id === defaultId)?.ragioneSociale ?? ''
          this.tenantContext.set(defaultId, nome)
        }
      },
      error: () => {
        // Errore di rete o utente con un solo tenant: il selettore resta
        // nascosto (hasPiuSocieta() = false).
      },
    })
  }

  protected onCambioSocieta(): void {
    if (!this.tenantSelezionato) return

    const societa = this.societa().find(t => t.id === this.tenantSelezionato)
    const nome = societa?.ragioneSociale ?? ''

    // Aggiorna il contesto: il tenantInterceptor aggiungerà X-Tenant-ID a tutte
    // le richieste successive. La validazione è sul backend (TenantSwitchInterceptor).
    this.tenantContext.set(this.tenantSelezionato, nome)

    // Ricarica la rotta corrente per aggiornare i dati con la nuova società.
    const url = this.router.url
    this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
      this.router.navigateByUrl(url)
    })
  }
}
