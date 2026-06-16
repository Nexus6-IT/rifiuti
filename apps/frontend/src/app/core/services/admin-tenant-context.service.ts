import { Injectable, computed, signal } from '@angular/core';

/**
 * Admin Tenant Context Service
 *
 * Mantiene il tenant attualmente "impersonato" da un utente SUPER_ADMIN
 * per operare in un contesto multi-tenant. La selezione viene persistita in
 * localStorage (`wf_admin_tenant`) così da sopravvivere a reload/refresh.
 *
 * Per gli utenti non SUPER_ADMIN il servizio resta inattivo: non viene mai
 * impostato alcun tenant, quindi `selectedTenantId()` resta `null` e
 * l'interceptor non aggiunge alcun header (no-op).
 */

const STORAGE_KEY = 'wf_admin_tenant';

interface StoredTenant {
  id: string;
  name: string;
}

@Injectable({
  providedIn: 'root',
})
export class AdminTenantContextService {
  private readonly _selectedTenantId = signal<string | null>(null);
  private readonly _selectedTenantName = signal<string | null>(null);

  /** ID del tenant selezionato dal super admin (null se nessuno). */
  readonly selectedTenantId = this._selectedTenantId.asReadonly();
  /** Ragione sociale del tenant selezionato dal super admin (null se nessuno). */
  readonly selectedTenantName = this._selectedTenantName.asReadonly();

  /** True se un tenant è attualmente selezionato. */
  readonly hasSelection = computed(() => this._selectedTenantId() !== null);

  constructor() {
    this.restoreFromStorage();
  }

  /**
   * Imposta il tenant corrente (solo super admin) e lo persiste.
   */
  set(id: string, name: string): void {
    this._selectedTenantId.set(id);
    this._selectedTenantName.set(name);
    try {
      const payload: StoredTenant = { id, name };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage non disponibile (es. modalità privata): ignora, lo stato
      // in memoria resta comunque valido per la sessione corrente.
    }
  }

  /**
   * Pulisce la selezione del tenant (ritorno al contesto "globale").
   */
  clear(): void {
    this._selectedTenantId.set(null);
    this._selectedTenantName.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
  }

  private restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoredTenant>;
      if (parsed && typeof parsed.id === 'string' && parsed.id) {
        this._selectedTenantId.set(parsed.id);
        this._selectedTenantName.set(typeof parsed.name === 'string' ? parsed.name : null);
      }
    } catch {
      // valore corrotto: ripulisci silenziosamente
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // no-op
      }
    }
  }
}
