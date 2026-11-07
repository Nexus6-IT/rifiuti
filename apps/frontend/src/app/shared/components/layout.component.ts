import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { HttpClient } from '@angular/common/http'
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router'
import { filter } from 'rxjs/operators'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { AvatarModule } from 'primeng/avatar'
import { TooltipModule } from 'primeng/tooltip'
import { SidebarModule } from 'primeng/sidebar'
import { DropdownModule } from 'primeng/dropdown'
import { MenuItem, MessageService } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { TenantSwitchService } from '../../features/permissions/services/tenant-switch.service'
import { NotificationBellComponent } from '../../core/layout/notification-bell/notification-bell.component'
import {
  TemaService,
  etichettaPreferenzaTema,
  prossimaPreferenzaTema,
} from '../../core/services/tema.service'
import { contrassegnoAzienda } from '../utils/contrassegno-azienda'
import { environment } from '../../../environments/environment'
import { LegamiService } from '../../features/legami/legami.service'
import { rottaVoceAttiva, titoloShell, VoceShell } from './navigazione-shell'
import { SegnoMarchioComponent } from './segno-marchio.component'

interface AdminTenant {
  id: string
  ragioneSociale: string
}

/** Il pathname di un url: senza query ne' frammento. */
function percorsoDi(url: string): string {
  return url.split(/[?#]/)[0] || '/'
}

/** Tenant accessibile da un utente standard multi-azienda (da GET /consultant/tenants). */
interface UserTenant {
  id: string
  name: string
  role?: string
  parentTenantId?: string | null
  annidata?: boolean
}

/** Azienda selezionabile nel selettore, con il solo legame madre/figlia necessario a ordinaAziendePerGruppo. */
export interface AziendaSelezionabile {
  id: string
  name: string
  parentTenantId?: string | null
  annidata?: boolean
}

/**
 * Ordina le aziende per gruppo: ogni figlia compare subito sotto la propria
 * madre e viene marcata `annidata` (il template la indenta). Le aziende senza
 * gruppo restano un elenco piatto nell'ordine ricevuto dal backend.
 */
export function ordinaAziendePerGruppo(
  aziende: AziendaSelezionabile[]
): Array<AziendaSelezionabile & { annidata: boolean }> {
  const figliePerMadre = new Map<string, AziendaSelezionabile[]>()
  for (const a of aziende) {
    if (!a.parentTenantId) continue
    const gruppo = figliePerMadre.get(a.parentTenantId) ?? []
    gruppo.push(a)
    figliePerMadre.set(a.parentTenantId, gruppo)
  }

  const risultato: Array<AziendaSelezionabile & { annidata: boolean }> = []
  for (const a of aziende) {
    if (a.parentTenantId) continue
    risultato.push({ ...a, annidata: false })
    // Le figlie sotto la stessa madre sono ordinate alfabeticamente per
    // leggibilita', indipendentemente dall'ordine in cui il backend le manda.
    const figlie = (figliePerMadre.get(a.id) ?? [])
      .slice()
      .sort((x, y) => x.name.localeCompare(y.name))
    for (const figlia of figlie) {
      risultato.push({ ...figlia, annidata: true })
    }
  }

  // Figlie la cui madre non e' accessibile all'utente: non vanno perse.
  for (const a of aziende) {
    if (a.parentTenantId && !risultato.some(r => r.id === a.id)) {
      risultato.push({ ...a, annidata: false })
    }
  }

  return risultato
}

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    FormsModule,
    AvatarModule,
    TooltipModule,
    SidebarModule,
    DropdownModule,
    NotificationBellComponent,
    SegnoMarchioComponent,
  ],
  template: `
    <!-- Link salta-contenuto per accessibilità (WCAG 2.4.1) -->
    <a href="#main-content" class="skip-to-main" (click)="vaiAlContenuto($event)"
      >Vai al contenuto principale</a
    >

    <!-- ===== Banner globale di impersonificazione (full-width, sopra tutto) ===== -->
    @if (isImpersonating()) {
      <div class="impersonation-banner" role="status" aria-live="polite">
        <span class="impersonation-banner__message">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <span>
            Stai impersonando
            <strong class="impersonation-banner__name">{{ impersonatingName() }}</strong>
          </span>
        </span>
        <button
          type="button"
          class="impersonation-banner__exit"
          (click)="exitImpersonation()"
          [attr.aria-label]="
            'Torna al tuo account di amministratore, termina l\\'impersonificazione di ' +
            impersonatingName()
          "
        >
          <i class="pi pi-sign-out" aria-hidden="true"></i>
          <span>Torna al tuo account</span>
        </button>
      </div>
    }

    <div class="app-shell">
      <!-- ===== Sidebar desktop (fissa ≥992px) ===== -->
      <aside class="sidebar" aria-hidden="false">
        <!-- Brand -->
        <a
          routerLink="/dashboard"
          class="sidebar__brand"
          aria-label="WasteFlow — vai alla dashboard"
        >
          <app-segno-marchio [dimensione]="26" />
          <span class="sidebar__brand-name">WasteFlow</span>
        </a>

        <!-- Selettore Azienda / Unità locale -->
        <ng-container *ngTemplateOutlet="orgSwitcher"></ng-container>

        <!-- Navigazione -->
        <nav class="sidebar__nav" aria-label="Navigazione principale">
          <ng-container *ngTemplateOutlet="navContent; context: { mobile: false }"></ng-container>
        </nav>

        <!-- In fondo: azienda attiva, campanella, tema, utente ed «Esci». Sopra i
             992 px non c'è nessuna barra in alto. -->
        <div class="sidebar__footer">
          <!-- Azienda attiva, solo per chi ne gestisce più d'una: riconoscibile
               a colpo d'occhio prima di registrare qualcosa. -->
          @if (aziendaAttiva(); as azienda) {
            <span class="azienda-attiva" [attr.title]="'Azienda attiva: ' + azienda.nome">
              <span class="contrassegno" aria-hidden="true" [style.background]="azienda.colore">{{
                azienda.iniziali
              }}</span>
              <span class="azienda-attiva__nome"
                ><span class="sr-only">Azienda attiva: </span>{{ azienda.nome }}</span
              >
            </span>
          }

          <div class="sidebar__azioni">
            <ng-container *ngTemplateOutlet="pulsanteTema"></ng-container>
            @if (desktop()) {
              <app-notification-bell />
            }
          </div>

          <div class="user-card">
            <p-avatar
              [label]="userInitials()"
              shape="circle"
              styleClass="user-card__avatar"
              [attr.aria-hidden]="true"
            />
            <span class="user-card__info">
              <span class="user-card__name">{{ userFullName() }}</span>
              <span class="user-card__email">{{ authService.currentUser()?.email }}</span>
            </span>
          </div>
          <button type="button" class="esci" (click)="onLogout()">
            <i class="pi pi-sign-out" aria-hidden="true"></i>
            <span>Esci</span>
          </button>
        </div>
      </aside>

      <!-- ===== Colonna contenuto (barra stretta solo sotto i 992 px + main) ===== -->
      <div class="content">
        <!-- Barra da 48 px: hamburger, nome della pagina (non un heading) e campanella. -->
        <header class="topbar" role="banner">
          <button
            type="button"
            class="topbar__hamburger"
            (click)="toggleMobileSidebar()"
            aria-label="Apri il menu di navigazione"
            [attr.aria-expanded]="mobileSidebarVisible()"
            aria-controls="mobile-drawer"
          >
            <i class="pi pi-bars" aria-hidden="true"></i>
          </button>
          <span class="topbar__title">{{ titolo() }}</span>
          <!-- Chi gestisce piu' aziende vede quale e' attiva anche sul telefono. -->
          @if (aziendaAttiva(); as azienda) {
            <span class="topbar__azienda" [attr.title]="'Azienda attiva: ' + azienda.nome">
              <span
                class="contrassegno contrassegno--sm"
                aria-hidden="true"
                [style.background]="azienda.colore"
                >{{ azienda.iniziali }}</span
              >
              <span class="sr-only">Azienda attiva: {{ azienda.nome }}</span>
            </span>
          }
          @if (!desktop()) {
            <app-notification-bell />
          }
        </header>

        <!-- Drawer mobile (< 992px) -->
        <p-sidebar
          [(visible)]="mobileSidebarVisibleProxy"
          (onHide)="alChiudersiDrawer()"
          position="left"
          [modal]="true"
          [showCloseIcon]="true"
          [style]="{ width: '18rem' }"
          styleClass="mobile-drawer"
          ariaCloseLabel="Chiudi il menu di navigazione"
        >
          <ng-template pTemplate="header">
            <a
              routerLink="/dashboard"
              class="sidebar__brand sidebar__brand--drawer"
              (click)="closeMobileSidebar()"
              aria-label="WasteFlow — vai alla dashboard"
            >
              <app-segno-marchio [dimensione]="26" />
              <span class="sidebar__brand-name">WasteFlow</span>
            </a>
          </ng-template>

          <ng-container *ngTemplateOutlet="orgSwitcher"></ng-container>

          <nav class="sidebar__nav" id="mobile-drawer" aria-label="Navigazione mobile">
            <ng-container *ngTemplateOutlet="navContent; context: { mobile: true }"></ng-container>
          </nav>

          <ng-template pTemplate="footer">
            <div class="drawer__footer">
              <ng-container *ngTemplateOutlet="pulsanteTema"></ng-container>
              <button type="button" class="drawer__logout" (click)="onLogout()">
                <i class="pi pi-sign-out" aria-hidden="true"></i>
                <span>Esci</span>
              </button>
            </div>
          </ng-template>
        </p-sidebar>

        <!-- Contenuto principale -->
        <main class="main" id="main-content" role="main" tabindex="-1">
          <div class="main__inner">
            <router-outlet></router-outlet>
          </div>
        </main>
      </div>
    </div>

    <!-- ===== Template condiviso voci di navigazione ===== -->
    <ng-template #navContent let-mobile="mobile">
      <ul class="nav-group" role="list">
        @for (item of navMain; track item.route) {
          <!-- La Dashboard è sempre visibile; le altre voci dipendono dalla feature. -->
          @if (!item.feature || ff.has(item.feature)) {
            <li>
              <a
                [routerLink]="item.route"
                class="nav-item"
                [class.nav-item--active]="voceAttiva() === item.route"
                [attr.aria-current]="voceAttiva() === item.route ? 'page' : null"
                (click)="mobile ? closeMobileSidebar() : null"
              >
                <i class="nav-item__icon" [ngClass]="item.icon" aria-hidden="true"></i>
                <span class="nav-item__label">{{ item.label }}</span>
                @if (item.contatoreLegami && contatoreLegami() > 0) {
                  <span
                    class="nav-item__contatore"
                    data-testid="contatore-legami"
                    [attr.aria-label]="contatoreLegami() + ' movimenti da collegare'"
                    >{{ contatoreLegami() }}</span
                  >
                }
              </a>
            </li>
          }
        }
      </ul>

      <!-- L'intera sezione Anagrafiche è gated dalla feature 'anagrafiche'. -->
      @if (ff.has('anagrafiche')) {
        <p class="nav-group__title" id="nav-anagrafiche">Anagrafiche</p>
        <ul class="nav-group" role="list" aria-labelledby="nav-anagrafiche">
          @for (item of navAnagrafiche; track item.route) {
            <li>
              <a
                [routerLink]="item.route"
                class="nav-item"
                [class.nav-item--active]="voceAttiva() === item.route"
                [attr.aria-current]="voceAttiva() === item.route ? 'page' : null"
                (click)="mobile ? closeMobileSidebar() : null"
              >
                <i class="nav-item__icon" [ngClass]="item.icon" aria-hidden="true"></i>
                <span class="nav-item__label">{{ item.label }}</span>
              </a>
            </li>
          }
        </ul>
      }

      <!-- La sezione Impostazioni appare solo se almeno una voce è abilitata. -->
      @if (visibleImpostazioni().length > 0) {
        <p class="nav-group__title" id="nav-impostazioni">Impostazioni</p>
        <ul class="nav-group" role="list" aria-labelledby="nav-impostazioni">
          @for (item of visibleImpostazioni(); track item.route) {
            <li>
              <a
                [routerLink]="item.route"
                class="nav-item"
                [class.nav-item--active]="voceAttiva() === item.route"
                [attr.aria-current]="voceAttiva() === item.route ? 'page' : null"
                (click)="mobile ? closeMobileSidebar() : null"
              >
                <i class="nav-item__icon" [ngClass]="item.icon" aria-hidden="true"></i>
                <span class="nav-item__label">{{ item.label }}</span>
              </a>
            </li>
          }
        </ul>
      }

      <!-- ===== Abbonamento (solo SUPER_ADMIN) =====
           Decisione del committente (2026-07-26): la voce non deve essere
           visibile a nessuno tranne il super amministratore — nemmeno agli
           ADMIN dei tenant. Il backend consente checkout/portal anche ad
           ADMIN (billing.controller.ts): questo nascondimento e' quindi
           cosmetico, la rotta resta raggiungibile digitando l'URL. -->
      @if (isSuperAdmin()) {
        <p class="nav-group__title" id="nav-account">Account</p>
        <ul class="nav-group" role="list" aria-labelledby="nav-account">
          <li>
            <a
              routerLink="/abbonamento"
              class="nav-item"
              [class.nav-item--active]="voceAttiva() === '/abbonamento'"
              data-testid="nav-abbonamento"
              [attr.aria-current]="voceAttiva() === '/abbonamento' ? 'page' : null"
              (click)="mobile ? closeMobileSidebar() : null"
            >
              <i class="nav-item__icon pi pi-credit-card" aria-hidden="true"></i>
              <span class="nav-item__label">Abbonamento</span>
            </a>
          </li>
        </ul>
      }

      <!-- ===== Amministrazione (gated per ruolo) ===== -->
      @if (canSeeAdminSection()) {
        <p class="nav-group__title" id="nav-amministrazione">Amministrazione</p>
        <ul class="nav-group" role="list" aria-labelledby="nav-amministrazione">
          @if (canSeeTenants()) {
            <li>
              <a
                routerLink="/admin/tenants"
                class="nav-item"
                [class.nav-item--active]="voceAttiva() === '/admin/tenants'"
                [attr.aria-current]="voceAttiva() === '/admin/tenants' ? 'page' : null"
                (click)="mobile ? closeMobileSidebar() : null"
              >
                <i class="nav-item__icon pi pi-building" aria-hidden="true"></i>
                <span class="nav-item__label">{{ tenantsMenuLabel() }}</span>
              </a>
            </li>
          }
          <li>
            <a
              routerLink="/admin/utenti"
              class="nav-item"
              [class.nav-item--active]="voceAttiva() === '/admin/utenti'"
              [attr.aria-current]="voceAttiva() === '/admin/utenti' ? 'page' : null"
              (click)="mobile ? closeMobileSidebar() : null"
            >
              <i class="nav-item__icon pi pi-users" aria-hidden="true"></i>
              <span class="nav-item__label">Utenti</span>
            </a>
          </li>
          <!-- Stato del sistema: dati aggregati di TUTTE le aziende, quindi
               solo SUPER_ADMIN (l'ADMIN ha la diagnostica della sua azienda). -->
          @if (isSuperAdmin()) {
            <li>
              <a
                routerLink="/admin/stato-sistema"
                class="nav-item"
                [class.nav-item--active]="voceAttiva() === '/admin/stato-sistema'"
                [attr.aria-current]="voceAttiva() === '/admin/stato-sistema' ? 'page' : null"
                (click)="mobile ? closeMobileSidebar() : null"
              >
                <i class="nav-item__icon pi pi-heart" aria-hidden="true"></i>
                <span class="nav-item__label">Stato del sistema</span>
              </a>
            </li>
          }
        </ul>
      }
    </ng-template>

    <!-- ===== Pulsante del tema: dice la scelta attuale e, nell'aria-label, anche la prossima ===== -->
    <ng-template #pulsanteTema>
      <button type="button" class="tema" (click)="tema.cicla()" [attr.aria-label]="ariaLabelTema()">
        <i [class]="iconaTema()" aria-hidden="true"></i>
        <span>Tema: {{ etichettaTema() }}</span>
      </button>
    </ng-template>

    <!-- ===== Selettore Azienda / Unità locale ===== -->
    <ng-template #orgSwitcher>
      @if (isSuperAdmin()) {
        <!-- Tenant switcher reale per SUPER_ADMIN -->
        <div
          class="tenant-switcher"
          role="group"
          aria-label="Selettore tenant (super amministratore)"
        >
          <label class="tenant-switcher__label" for="tenant-switcher-dropdown">Tenant attivo</label>
          <p-dropdown
            inputId="tenant-switcher-dropdown"
            [options]="adminTenants()"
            [ngModel]="selectedTenantId()"
            (onChange)="onTenantChange($event.value)"
            optionLabel="ragioneSociale"
            optionValue="id"
            [filter]="true"
            filterBy="ragioneSociale"
            placeholder="Seleziona tenant…"
            [showClear]="hasTenantSelection()"
            appendTo="body"
            styleClass="tenant-switcher__dropdown"
            [ariaLabel]="'Cambia tenant corrente'"
            (onClear)="onTenantClear()"
          >
            <ng-template let-t pTemplate="selectedItem">
              <span class="azienda-opzione">
                <span
                  class="contrassegno contrassegno--sm"
                  aria-hidden="true"
                  [style.background]="contrassegno(t.id, t.ragioneSociale).colore"
                  >{{ contrassegno(t.id, t.ragioneSociale).iniziali }}</span
                >
                <span class="azienda-opzione__nome">{{ t.ragioneSociale }}</span>
              </span>
            </ng-template>
            <ng-template let-t pTemplate="item">
              <span class="azienda-opzione">
                <span
                  class="contrassegno contrassegno--sm"
                  aria-hidden="true"
                  [style.background]="contrassegno(t.id, t.ragioneSociale).colore"
                  >{{ contrassegno(t.id, t.ragioneSociale).iniziali }}</span
                >
                <span class="azienda-opzione__nome">{{ t.ragioneSociale }}</span>
              </span>
            </ng-template>
          </p-dropdown>
        </div>
      } @else if (userTenants().length >= 2) {
        <!-- Tenant switcher generico per utenti standard multi-azienda -->
        <div class="tenant-switcher" role="group" aria-label="Selettore azienda">
          <label class="tenant-switcher__label" for="user-tenant-switcher">Azienda attiva</label>
          <p-dropdown
            inputId="user-tenant-switcher"
            [options]="userTenants()"
            [ngModel]="currentUserTenantId()"
            (onChange)="onUserTenantChange($event.value)"
            optionLabel="name"
            optionValue="id"
            [filter]="userTenants().length > 6"
            filterBy="name"
            placeholder="Seleziona azienda…"
            appendTo="body"
            styleClass="tenant-switcher__dropdown"
            [ariaLabel]="'Cambia azienda corrente'"
          >
            <ng-template let-azienda pTemplate="selectedItem">
              <span class="azienda-opzione">
                <span
                  class="contrassegno contrassegno--sm"
                  aria-hidden="true"
                  [style.background]="contrassegno(azienda.id, azienda.name).colore"
                  >{{ contrassegno(azienda.id, azienda.name).iniziali }}</span
                >
                <span class="azienda-opzione__nome">{{ azienda.name }}</span>
              </span>
            </ng-template>
            <ng-template let-azienda pTemplate="item">
              <span class="azienda-opzione" [class.azienda-annidata]="azienda.annidata">
                <span
                  class="contrassegno contrassegno--sm"
                  aria-hidden="true"
                  [style.background]="contrassegno(azienda.id, azienda.name).colore"
                  >{{ contrassegno(azienda.id, azienda.name).iniziali }}</span
                >
                <span class="azienda-opzione__nome">{{ azienda.name }}</span>
              </span>
            </ng-template>
          </p-dropdown>
        </div>
      } @else {
        <!-- Utente con una sola azienda: mostro il nome (nessuno switch). -->
        <button type="button" class="org-switcher" aria-label="Azienda corrente" [disabled]="true">
          <span
            class="org-switcher__avatar contrassegno"
            aria-hidden="true"
            [style.background]="contrassegnoSingolo().colore"
            >{{ contrassegnoSingolo().iniziali }}</span
          >
          <span class="org-switcher__text">
            <span class="org-switcher__company">{{ singleTenantName() }}</span>
          </span>
        </button>
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* ============================================================
       Banner globale di impersonificazione
       Full-width, in cima a tutto (sopra topbar/sidebar/drawer).
       Sfondo ambra + testo scuro slate-900 → contrasto AA abbondante.
       ============================================================ */
      .impersonation-banner {
        position: relative;
        z-index: calc(var(--z-sticky) + 10);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm) var(--spacing-base);
        padding: var(--spacing-sm) clamp(1rem, 2vw, var(--spacing-xl));
        background: var(--color-warning-bg);
        color: var(--color-gray-900);
        border-bottom: 2px solid var(--color-warning);
        font-size: var(--font-size-sm);
        line-height: 1.3;
      }
      .impersonation-banner__message {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-weight: var(--font-weight-medium);
        text-align: center;
      }
      .impersonation-banner__message i {
        color: var(--color-warning);
        font-size: 1.15rem;
        flex-shrink: 0;
      }
      .impersonation-banner__name {
        font-weight: var(--font-weight-bold);
      }

      .impersonation-banner__exit {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-height: var(--touch-target-min);
        padding: 0.375rem var(--spacing-md);
        border: 1px solid var(--color-warning);
        border-radius: var(--radius-md);
        background: var(--color-warning);
        color: var(--text-inverse);
        font-family: inherit;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition:
          background var(--transition-fast),
          color var(--transition-fast),
          box-shadow var(--transition-fast);
      }
      .impersonation-banner__exit:hover {
        background: var(--brand-secondary-dark);
        border-color: var(--brand-secondary-dark);
      }
      .impersonation-banner__exit:focus-visible {
        outline: 3px solid var(--color-gray-900);
        outline-offset: 2px;
      }

      /* Mobile: messaggio + bottone vanno a capo restando centrati */
      @media (max-width: 575.98px) {
        .impersonation-banner {
          flex-direction: column;
        }
        .impersonation-banner__exit {
          width: 100%;
          justify-content: center;
        }
      }

      /* ============================================================
       Struttura (Libro mastro): un solo fondo per sidebar e contenuto,
       nessuna cornice e nessun foglio rientrato. Sopra i 992px la sidebar
       e' fissa e non c'e' barra in alto; sotto, la sidebar e' il drawer
       p-sidebar e resta una barra da 48px.
       ============================================================ */
      .app-shell {
        min-height: 100vh;
        background: var(--frame);
      }

      /* ===== Sidebar desktop (nascosta < 992px) ===== */
      .sidebar {
        display: none;
      }

      @media (min-width: 992px) {
        .app-shell {
          display: grid;
          grid-template-columns: var(--sidebar-w) 1fr;
        }
        .sidebar {
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
          background: var(--sidebar-bg);
        }
      }

      /* ===== Brand ===== */
      .sidebar__brand {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        height: var(--topbar-h);
        padding: 0 var(--spacing-base);
        margin-top: var(--spacing-sm);
        text-decoration: none;
      }
      .sidebar__brand:hover {
        text-decoration: none;
      }
      .sidebar__brand--drawer {
        border-bottom: none;
        padding: 0;
        margin-top: 0;
      }
      .sidebar__brand-name {
        font-family: var(--font-display);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        letter-spacing: -0.01em;
        color: var(--sidebar-ink-strong);
      }

      /* ===== Selettore Azienda / Unità locale ===== */
      .org-switcher {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: calc(100% - (var(--spacing-md) * 2));
        margin: var(--spacing-md) var(--spacing-md) 0;
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--frame-control-border);
        border-radius: var(--radius-md);
        background: var(--sidebar-bg-2);
        color: var(--sidebar-ink);
        text-align: left;
        min-height: var(--control-lg);
        cursor: pointer;
        transition:
          background var(--transition-fast),
          border-color var(--transition-fast);
      }
      .org-switcher:hover {
        background: var(--sidebar-hover-bg);
        border-color: var(--sidebar-hover-border);
      }
      .org-switcher__avatar {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        flex-shrink: 0;
        border-radius: var(--radius-md);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        font-family: var(--font-display);
        letter-spacing: 0.02em;
      }
      .org-switcher__text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
        line-height: 1.2;
      }
      .org-switcher__company {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--sidebar-ink-strong);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .org-switcher__unit {
        font-size: var(--font-size-xs);
        color: var(--sidebar-ink-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .org-switcher__chevron {
        font-size: 0.75rem;
        color: var(--sidebar-ink-muted);
        flex-shrink: 0;
      }

      /* ===== Tenant switcher (SUPER_ADMIN) — sul fondo della sidebar ===== */
      .tenant-switcher {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        margin: var(--spacing-md) var(--spacing-md) 0;
      }
      .tenant-switcher__label {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--sidebar-ink-muted);
      }
      /* Override PrimeNG dropdown per renderlo leggibile sul fondo (bordo a 3:1) */
      :host ::ng-deep .tenant-switcher__dropdown.p-dropdown {
        width: 100%;
        background: var(--sidebar-bg-2);
        border: 1px solid var(--frame-control-border);
        border-radius: var(--radius-md);
      }
      :host ::ng-deep .tenant-switcher__dropdown.p-dropdown:not(.p-disabled):hover {
        border-color: var(--sidebar-hover-border);
        background: var(--sidebar-hover-bg);
      }
      :host ::ng-deep .tenant-switcher__dropdown.p-dropdown:not(.p-disabled).p-focus {
        border-color: var(--sidebar-active);
        box-shadow: none;
      }
      :host ::ng-deep .tenant-switcher__dropdown .p-dropdown-label {
        color: var(--sidebar-ink-strong);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
      }
      :host ::ng-deep .tenant-switcher__dropdown .p-dropdown-label.p-placeholder {
        color: var(--sidebar-ink-muted);
        font-weight: var(--font-weight-medium);
      }
      :host ::ng-deep .tenant-switcher__dropdown .p-dropdown-trigger,
      :host ::ng-deep .tenant-switcher__dropdown .p-dropdown-clear-icon {
        color: var(--sidebar-ink-muted);
      }
      /*
       * Azienda figlia nel gruppo: indentata sotto la propria madre.
       * Regola globale (senza prefisso :host) perche' il pannello del
       * p-dropdown e' agganciato al <body> (appendTo="body"), quindi non e'
       * un discendente dell'host di questo componente.
       */
      ::ng-deep .azienda-annidata {
        padding-left: 1.25rem;
      }

      /* ===== Navigazione ===== */
      .sidebar__nav {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-base) var(--spacing-md);
      }

      .nav-group {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
      }

      /* Titolo di gruppo: grigio da 12px in minuscolo. */
      .nav-group__title {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--sidebar-ink-muted);
        margin: var(--spacing-base) var(--spacing-md) var(--spacing-xs);
      }

      /* Voci da 32px con raggio di 8px. */
      .nav-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: 0 var(--spacing-md);
        min-height: 2rem;
        border-radius: var(--radius-lg);
        color: var(--sidebar-ink);
        text-decoration: none;
        font-weight: var(--font-weight-normal);
        font-size: var(--font-size-sm);
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .nav-item:hover {
        background: var(--sidebar-hover-bg);
        color: var(--sidebar-ink-strong);
        text-decoration: none;
      }
      /* Su telefono (drawer) i target touch salgono a 44px. */
      @media (max-width: 991.98px) {
        .nav-item {
          min-height: var(--touch-target-min);
        }
      }

      .nav-item__icon {
        font-size: 1rem;
        width: 1.25rem;
        text-align: center;
        flex-shrink: 0;
        color: var(--sidebar-ink-muted);
        transition: color var(--transition-fast);
      }
      .nav-item__contatore {
        margin-left: auto;
        min-width: 1.4rem;
        padding: 0 var(--spacing-xs);
        border-radius: 999px;
        background: var(--surface-card);
        color: var(--sidebar-ink-strong);
        border: 1px solid var(--surface-border-strong);
        font-size: var(--font-size-xs, 0.75rem);
        font-weight: var(--font-weight-medium);
        font-variant-numeric: tabular-nums;
        text-align: center;
      }
      .nav-item__label {
        flex: 1;
        min-width: 0;
      }

      /* Voce attiva: fondo grigio, testo e icona in inchiostro, peso 500. Nessuna
         barra a sinistra: il segnale e' il fondo piu' il peso, e aria-current. */
      .nav-item--active,
      .nav-item--active:hover {
        background: var(--sidebar-active-bg);
        color: var(--sidebar-ink-strong);
        font-weight: var(--font-weight-medium);
      }
      .nav-item--active .nav-item__icon,
      .nav-item--active:hover .nav-item__icon {
        color: var(--sidebar-active);
      }

      /* ===== In fondo alla sidebar: azienda, tema e campanella, utente, Esci ===== */
      .sidebar__footer {
        display: grid;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
      }
      .azienda-attiva {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 0;
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--sidebar-ink-strong);
      }
      .azienda-attiva__nome {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sidebar__azioni {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
      .sidebar__azioni .tema {
        flex: 1;
        min-width: 0;
      }

      .tema {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        height: var(--control-md);
        min-height: var(--control-md);
        padding: 0 var(--spacing-md);
        border: 1px solid var(--frame-control-border);
        border-radius: var(--radius-lg);
        background: transparent;
        color: var(--sidebar-ink);
        font-family: inherit;
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .tema i {
        font-size: 0.95rem;
        color: var(--sidebar-ink-muted);
      }
      .tema:hover {
        background: var(--sidebar-hover-bg);
        color: var(--sidebar-ink-strong);
      }

      .user-card {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        min-width: 0;
      }
      .user-card__info {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
        line-height: 1.2;
      }
      .user-card__name {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--sidebar-ink-strong);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .user-card__email {
        font-size: var(--font-size-xs);
        color: var(--sidebar-ink-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .esci {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        height: var(--control-md);
        min-height: var(--control-md);
        border: 1px solid var(--sidebar-border);
        border-radius: var(--radius-lg);
        background: transparent;
        color: var(--sidebar-ink);
        font-family: inherit;
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .esci:hover {
        background: var(--sidebar-danger-bg);
        color: var(--sidebar-danger);
      }

      /* Avatar: iniziali in inchiostro (la specificita' di :host ::ng-deep batte quella di p-avatar). */
      :host ::ng-deep .user-card__avatar {
        background: var(--ink-fill);
        color: var(--on-ink);
        font-weight: var(--font-weight-medium);
        font-family: var(--font-display);
      }

      /* ============================================================
       Colonna contenuto
       ============================================================ */
      .content {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        min-width: 0;
      }

      /* ===== Barra stretta (solo < 992px): 48px, hamburger, nome pagina, campanella ===== */
      .topbar {
        position: sticky;
        top: 0;
        z-index: var(--z-sticky);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        height: var(--topbar-h);
        padding: 0 var(--spacing-sm);
        background: var(--frame);
        border-bottom: 1px solid var(--surface-border);
      }
      .topbar__hamburger {
        display: grid;
        place-items: center;
        width: var(--touch-target-min);
        height: var(--touch-target-min);
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: var(--radius-lg);
        color: var(--text-secondary);
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .topbar__hamburger i {
        font-size: 1.35rem;
      }
      .topbar__hamburger:hover {
        background: var(--sidebar-hover-bg);
        color: var(--text-primary);
      }
      .topbar__title {
        flex: 1;
        min-width: 0;
        font-family: var(--font-display);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .topbar__azienda {
        display: inline-flex;
        align-items: center;
      }
      @media (min-width: 992px) {
        .topbar {
          display: none;
        }
      }

      /* ===== Main: sullo stesso fondo, senza bordo ne' raggio ===== */
      .main {
        flex: 1;
        min-width: 0;
        overflow-x: hidden;
      }
      .main:focus {
        outline: none;
      }
      /* Il gutter laterale sta qui perche' le pagine non hanno una radice comune:
         24px sopra i 992px, 20px fra 576 e 992, 16px sotto i 576. */
      .main__inner {
        max-width: 1600px;
        margin: 0 auto;
        padding: 0 var(--spacing-base);
      }
      @media (min-width: 576px) {
        .main__inner {
          padding: 0 1.25rem;
        }
      }
      @media (min-width: 992px) {
        .main__inner {
          padding: 0 var(--spacing-lg);
        }
      }

      /* ===== Drawer mobile (p-sidebar): stesso fondo della sidebar ===== */
      :host ::ng-deep .mobile-drawer {
        background: var(--sidebar-bg);
        color: var(--sidebar-ink);
      }
      :host ::ng-deep .mobile-drawer .p-sidebar-header {
        padding: var(--spacing-base) var(--spacing-base) var(--spacing-sm);
      }
      :host ::ng-deep .mobile-drawer .p-sidebar-content {
        padding: 0 var(--spacing-sm) var(--spacing-base);
      }
      :host ::ng-deep .mobile-drawer .p-sidebar-footer {
        padding: var(--spacing-sm) var(--spacing-base) var(--spacing-base);
      }
      :host ::ng-deep .mobile-drawer .sidebar__nav {
        padding: var(--spacing-sm) var(--spacing-xs);
        overflow: visible;
      }
      /* Pulsante di chiusura del drawer leggibile sul fondo */
      :host ::ng-deep .mobile-drawer .p-sidebar-close {
        color: var(--sidebar-ink);
      }
      :host ::ng-deep .mobile-drawer .p-sidebar-close:hover {
        background: var(--sidebar-bg-2);
        color: var(--sidebar-ink-strong);
      }
      /* Il selettore org nel drawer non ha margini laterali doppi */
      :host ::ng-deep .mobile-drawer .org-switcher {
        width: calc(100% - (var(--spacing-md) * 2));
        margin-top: 0;
      }
      :host ::ng-deep .mobile-drawer .tenant-switcher {
        margin-top: 0;
      }

      .drawer__footer {
        display: grid;
        gap: var(--spacing-sm);
        width: 100%;
      }
      .drawer__footer .tema {
        min-height: var(--touch-target-min);
      }
      .drawer__logout {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        width: 100%;
        min-height: var(--touch-target-min);
        border: 1px solid var(--sidebar-border);
        background: transparent;
        border-radius: var(--radius-lg);
        color: var(--sidebar-danger);
        font-weight: var(--font-weight-medium);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .drawer__logout:hover {
        background: var(--sidebar-danger-bg);
        color: var(--sidebar-danger-strong);
      }
    `,
  ],
})
export class LayoutComponent implements OnInit {
  private readonly http = inject(HttpClient)
  private readonly tenantContext = inject(AdminTenantContextService)
  private readonly tenantSwitchService = inject(TenantSwitchService)
  private readonly legami = inject(LegamiService)

  /** Movimenti in attesa di un legame (voce «Da collegare»); 0 se non si sa. */
  readonly contatoreLegami = this.legami.daCollegare

  /** Servizio feature-flag: pubblico così il template può usare `ff.has(...)`. */
  readonly ff = inject(FeatureFlagsService)

  menuItems: MenuItem[] = []

  // Mobile sidebar visibility signal
  mobileSidebarVisible = signal(false)

  /**
   * Stato di impersonificazione: vero quando un SUPER_ADMIN sta operando come
   * un altro utente. Le chiavi sono impostate da un altro componente all'avvio
   * dell'impersonificazione (NON gestito qui):
   *  - wf_impersonator_token   = access token del super admin (da ripristinare)
   *  - wf_impersonator_refresh = refresh token del super admin (opzionale)
   *  - wf_impersonating_name   = nome dell'utente impersonato
   * In aggiunta, il JWT corrente (localStorage.accessToken) porta il claim
   * `impersonatorId` quando è una sessione di impersonificazione.
   */
  readonly isImpersonating = signal(false)

  /** Nome leggibile dell'utente attualmente impersonato (per il banner). */
  readonly impersonatingName = signal<string>('')

  /** Tenant disponibili (caricati da GET /admin/tenants per il super admin). */
  readonly adminTenants = signal<AdminTenant[]>([])

  /** Tenant attualmente selezionato dal super admin. */
  readonly selectedTenantId = this.tenantContext.selectedTenantId
  readonly hasTenantSelection = this.tenantContext.hasSelection

  /** True se l'utente loggato è SUPER_ADMIN. */
  readonly isSuperAdmin = computed(() => this.authService.currentUser()?.role === 'SUPER_ADMIN')

  /** La sezione Amministrazione è visibile a SUPER_ADMIN e ADMIN (voce Utenti). */
  readonly canSeeAdminSection = computed(() => {
    const role = this.authService.currentUser()?.role
    return role === 'SUPER_ADMIN' || role === 'ADMIN'
  })

  /**
   * La voce "aziende/tenant" è visibile sia al SUPER_ADMIN (gestione tenant
   * della piattaforma) sia all'ADMIN (gestione self-service delle proprie
   * aziende entro la quota assegnata).
   */
  readonly canSeeTenants = computed(() => {
    const role = this.authService.currentUser()?.role
    return role === 'SUPER_ADMIN' || role === 'ADMIN'
  })

  /** Etichetta dinamica della voce: "Tenant" per il super admin, "Le mie aziende" per l'admin. */
  readonly tenantsMenuLabel = computed(() => (this.isSuperAdmin() ? 'Tenant' : 'Le mie aziende'))

  /** Proxy per il two-way binding di p-sidebar (che richiede una proprietà, non una signal). */
  get mobileSidebarVisibleProxy(): boolean {
    return this.mobileSidebarVisible()
  }
  set mobileSidebarVisibleProxy(value: boolean) {
    this.mobileSidebarVisible.set(value)
  }

  /**
   * Voci di navigazione (un'unica fonte per sidebar desktop e drawer mobile).
   * `feature` = chiave feature-flag richiesta per mostrare la voce; se assente
   * (es. Dashboard) la voce è sempre visibile.
   */
  readonly navMain: {
    label: string
    route: string
    icon: string
    feature?: string
    /** Mostra accanto all'etichetta il numero dei movimenti «Da collegare». */
    contatoreLegami?: boolean
  }[] = [
    { label: 'Dashboard', route: '/dashboard', icon: 'pi pi-home' },
    { label: 'FIR', route: '/fir', icon: 'pi pi-file', feature: 'fir' },
    { label: 'Registro C/S', route: '/registro', icon: 'pi pi-book', feature: 'registro' },
    { label: 'Catalogo CER', route: '/cer', icon: 'pi pi-tags', feature: 'cer' },
    { label: 'MUD', route: '/mud', icon: 'pi pi-file-export', feature: 'mud' },
    { label: 'Giacenze', route: '/giacenze', icon: 'pi pi-box', feature: 'giacenze' },
    { label: 'Pese', route: '/pese', icon: 'pi pi-calculator', feature: 'pese' },
    { label: 'Contratti', route: '/contratti', icon: 'pi pi-briefcase', feature: 'contratti' },
    { label: 'Clienti', route: '/clienti', icon: 'pi pi-users', feature: 'contratti' },
    {
      label: 'Contratti clienti',
      route: '/contratti-clienti',
      icon: 'pi pi-file-edit',
      feature: 'contratti',
    },
    {
      label: 'Da collegare',
      route: '/legami/da-collegare',
      icon: 'pi pi-link',
      feature: 'contratti',
      contatoreLegami: true,
    },
    {
      label: 'Fatture per periodo',
      route: '/fatturazione',
      icon: 'pi pi-euro',
      feature: 'contratti',
    },
    {
      label: 'Fatturazione da',
      route: '/clienti/fatturazione',
      icon: 'pi pi-calendar',
      feature: 'contratti',
    },
    { label: 'ESG / CO2', route: '/esg', icon: 'pi pi-chart-line', feature: 'esg' },
    {
      label: 'Anomalie',
      route: '/anomalie',
      icon: 'pi pi-exclamation-triangle',
      feature: 'anomalie',
    },
  ]
  /** Intera sezione gated dalla feature 'anagrafiche' (vedi template). */
  readonly navAnagrafiche = [
    { label: 'Produttori', route: '/produttori', icon: 'pi pi-building' },
    { label: 'Trasportatori', route: '/trasportatori', icon: 'pi pi-truck' },
    { label: 'Destinatari', route: '/destinatari', icon: 'pi pi-inbox' },
  ]
  readonly navImpostazioni: {
    label: string
    route: string
    icon: string
    feature: string
    adminOnly?: boolean
    /** Voce visibile al solo SUPER_ADMIN (piu' restrittiva di `adminOnly`). */
    superAdminOnly?: boolean
  }[] = [
    {
      label: 'Certificato RENTRI',
      route: '/rentri/certificato',
      icon: 'pi pi-key',
      feature: 'rentri',
      // La pagina del certificato RENTRI è riservata agli amministratori
      // (il backend risponde 403 ai non-admin): nascondiamo la voce di menu.
      adminOnly: true,
    },
    {
      // R4 Task 7: unità locali lette dall'ente (backend SUPER_ADMIN/ADMIN, v. RentriSitiController).
      label: 'Unità locali RENTRI',
      route: '/rentri/unita-locali',
      icon: 'pi pi-map-marker',
      feature: 'rentri',
      adminOnly: true,
    },
    {
      // R4 Task 7: diagnostica allineamento codifiche (backend SUPER_ADMIN/ADMIN, v. RentriCodificheController).
      label: 'Codifiche RENTRI',
      route: '/rentri/codifiche',
      icon: 'pi pi-sync',
      feature: 'rentri',
      adminOnly: true,
    },
    {
      // Blocchi virtuali e scorta di numeri vidimati: lettura per
      // SUPER_ADMIN/ADMIN/OPERATOR (gate fine sui ruoli nel componente stesso),
      // quindi NON adminOnly qui — altrimenti l'OPERATOR non vedrebbe la voce
      // che gli serve ogni giorno per sapere se può emettere un FIR.
      label: 'Blocchi e vidimazione RENTRI',
      route: '/rentri/blocchi',
      icon: 'pi pi-verified',
      feature: 'rentri',
    },
    {
      // Manutenzione di tabelle di piattaforma: solo SUPER_ADMIN (2026-07-28).
      label: 'Dati di riferimento',
      route: '/reference-data',
      icon: 'pi pi-database',
      feature: 'reference_data',
      superAdminOnly: true,
    },
  ]

  /**
   * Voci Impostazioni effettivamente visibili: filtrate per feature attiva e,
   * per le voci `adminOnly`, per ruolo amministrativo (SUPER_ADMIN/ADMIN).
   * Le voci `superAdminOnly` richiedono il solo SUPER_ADMIN.
   */
  readonly visibleImpostazioni = computed(() =>
    this.navImpostazioni.filter(
      item =>
        this.ff.has(item.feature) &&
        (!item.adminOnly || this.canSeeAdminSection()) &&
        (!item.superAdminOnly || this.isSuperAdmin())
    )
  )

  /** Tenant accessibili dall'utente standard (GET /consultant/tenants). */
  readonly userTenants = signal<UserTenant[]>([])

  /** Id del tenant attivo per l'utente standard (da GET /me/tenants). */
  readonly currentUserTenantId = signal<string | null>(null)

  /** Nome del tenant quando l'utente ne ha uno solo (placeholder org-switcher). */
  readonly singleTenantName = computed(() => this.userTenants()[0]?.name ?? 'Azienda')
  readonly contrassegnoSingolo = computed(() =>
    contrassegnoAzienda(this.userTenants()[0]?.id, this.singleTenantName())
  )

  /** Contrassegno (iniziali + colore fisso) di un'azienda, usato nei selettori. */
  readonly contrassegno = contrassegnoAzienda

  /**
   * Azienda attiva mostrata nella topbar: solo per chi ne gestisce più d'una
   * (SUPER_ADMIN con un tenant selezionato, utente multi-azienda). Chi ne ha
   * una sola la vede già nella sidebar e non rischia di confonderla.
   */
  readonly aziendaAttiva = computed(() => {
    let id: string | null = null
    let nome: string | null = null
    if (this.isSuperAdmin()) {
      id = this.selectedTenantId()
      nome =
        this.tenantContext.selectedTenantName() ??
        this.adminTenants().find(t => t.id === id)?.ragioneSociale ??
        null
    } else if (this.userTenants().length >= 2) {
      id = this.currentUserTenantId()
      nome = this.userTenants().find(t => t.id === id)?.name ?? null
    }
    if (!id || !nome) return null
    return { nome, ...contrassegnoAzienda(id, nome) }
  })

  readonly tema = inject(TemaService)

  readonly iconaTema = computed(() => {
    const icone = { sistema: 'pi pi-desktop', chiaro: 'pi pi-sun', scuro: 'pi pi-moon' } as const
    return icone[this.tema.preferenza()]
  })

  /** La scelta attuale in una parola: «Chiaro», «Scuro» o «Sistema». */
  readonly etichettaTema = computed(() => etichettaPreferenzaTema(this.tema.preferenza()))

  /**
   * Comincia col testo visibile («Tema: Chiaro», WCAG 2.5.3) e dice anche cosa
   * succede premendo: «Tema: Chiaro. Passa a scuro».
   */
  readonly ariaLabelTema = computed(() => {
    const prossimo = etichettaPreferenzaTema(prossimaPreferenzaTema(this.tema.preferenza()))
    return `Tema: ${this.etichettaTema()}. Passa a ${prossimo.toLowerCase()}`
  })

  /** Percorso corrente (senza query ne' frammento), aggiornato a ogni NavigationEnd. */
  private readonly percorso = signal<string>(percorsoDi(window.location.pathname))

  /** Tutte le voci con una rotta: menu, anagrafiche, impostazioni, amministrazione, account. */
  private readonly vociShell = computed<VoceShell[]>(() => [
    ...this.navMain,
    ...this.navAnagrafiche,
    ...this.navImpostazioni,
    { label: this.tenantsMenuLabel(), route: '/admin/tenants' },
    { label: 'Utenti', route: '/admin/utenti' },
    { label: 'Stato del sistema', route: '/admin/stato-sistema' },
    { label: 'Abbonamento', route: '/abbonamento' },
  ])

  /** Rotta della sola voce di menu accesa (prefisso piu' lungo per segmenti). */
  readonly voceAttiva = computed(() =>
    rottaVoceAttiva(
      this.percorso(),
      this.vociShell().map(v => v.route)
    )
  )

  /** Nome della pagina per la barra sotto i 992 px. */
  readonly titolo = computed(() => titoloShell(this.percorso(), this.vociShell()))

  /** Vero dai 992px in su: la campanella sta in fondo alla sidebar, altrimenti nella barra. */
  readonly desktop = signal(true)

  // Computed signals for reactive user display
  readonly userInitials = computed(() => {
    const user = this.authService.currentUser()
    if (!user) return 'U'
    const firstName = user.firstName || ''
    const lastName = user.lastName || ''

    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase()
    } else if (firstName) {
      return firstName[0].toUpperCase()
    } else if (user.email) {
      return user.email[0].toUpperCase()
    }
    return 'U'
  })

  readonly userFullName = computed(() => {
    const user = this.authService.currentUser()
    if (!user) return 'User'
    const firstName = user.firstName || ''
    const lastName = user.lastName || ''

    if (firstName && lastName) {
      return `${firstName} ${lastName}`
    } else if (firstName) {
      return firstName
    } else if (user.email) {
      return user.email.split('@')[0]
    }
    return 'User'
  })

  private readonly distruzione = inject(DestroyRef)

  constructor(
    readonly authService: AuthService,
    private readonly router: Router,
    private readonly messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.detectImpersonation()
    this.percorso.set(percorsoDi(this.router.url))
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.distruzione)
      )
      .subscribe(e => this.percorso.set(percorsoDi(e.urlAfterRedirects)))
    this.osservaLarghezza()

    // Feature-flag del tenant corrente: guida la visibilità delle voci di menu.
    this.ff.load().subscribe(() => this.caricaContatoreLegami())

    if (this.isSuperAdmin()) {
      // Super admin: tenant switcher basato su X-Tenant-ID (comportamento esistente).
      this.loadAdminTenants()
    } else {
      // Utente standard: se è associato a più aziende mostro un tenant switcher
      // generico (stesso endpoint usato dai consulenti, non richiede ruolo).
      this.loadUserTenants()
    }
  }

  /** Il numero è un di più: se la chiamata fallisce la voce resta senza contatore. */
  private caricaContatoreLegami(): void {
    if (!this.ff.has('contratti')) return
    this.legami.aggiornaContatori()
  }

  /** Carica l'elenco dei tenant (endpoint riservato al SUPER_ADMIN). */
  private loadAdminTenants(): void {
    this.http.get<AdminTenant[]>(`${environment.apiUrl}/admin/tenants`).subscribe({
      next: tenants => this.adminTenants.set(tenants ?? []),
      error: () => this.adminTenants.set([]),
    })
  }

  /**
   * Carica i tenant accessibili dall'utente standard tramite
   * GET /consultant/tenants (l'endpoint richiede solo il login, non il ruolo
   * CONSULTANT). Mappa in modo difensivo: il backend ritorna `tenantId`/`roleId`
   * ma normalizziamo verso `{ id, name, role }` accettando anche eventuali
   * `name`/`ragioneSociale`/`tenantName`. Se ne restituisce <2, il template
   * mostra il semplice placeholder col nome dell'azienda.
   */
  private loadUserTenants(): void {
    this.http
      .get<{ tenants?: any[]; currentTenantId?: string | null }>(`${environment.apiUrl}/me/tenants`)
      .subscribe({
        next: res => {
          const list = Array.isArray(res?.tenants) ? res.tenants : []
          const mapped: UserTenant[] = list.map(t => {
            const id = t.id ?? t.tenantId
            return {
              id,
              name: t.ragioneSociale ?? t.name ?? t.tenantName ?? id,
              parentTenantId: t.parentTenantId ?? null,
            }
          })
          this.userTenants.set(ordinaAziendePerGruppo(mapped))
          this.currentUserTenantId.set(res?.currentTenantId ?? null)
        },
        error: () => this.userTenants.set([]),
      })
  }

  /**
   * Cambio azienda per l'utente multi-azienda: chiama /me/switch-tenant che
   * ri-emette il JWT col nuovo tenant; salva i token e ricarica l'app (così
   * feature-flag e dati ripartono nel nuovo contesto).
   */
  onUserTenantChange(tenantId: string | null): void {
    if (!tenantId || tenantId === this.currentUserTenantId()) {
      return
    }
    this.http
      .post<{
        accessToken: string
        refreshToken?: string
      }>(`${environment.apiUrl}/me/switch-tenant`, { tenantId })
      .subscribe({
        next: res => {
          if (res?.accessToken) localStorage.setItem('accessToken', res.accessToken)
          if (res?.refreshToken) localStorage.setItem('refreshToken', res.refreshToken)
          window.location.reload()
        },
        error: () => {
          console.error('Cambio azienda non riuscito')
          this.messageService.add({
            severity: 'error',
            summary: 'Cambio azienda non riuscito',
            detail: 'Impossibile cambiare azienda. Riprova più tardi.',
          })
        },
      })
  }

  /**
   * Selezione di un tenant da parte del super admin: persiste il contesto e
   * ricarica l'app così che tutte le richieste partano con il nuovo
   * `X-Tenant-ID`. Il reload è una scelta volutamente semplice.
   */
  onTenantChange(tenantId: string | null): void {
    if (!tenantId) {
      this.onTenantClear()
      return
    }
    const tenant = this.adminTenants().find(t => t.id === tenantId)
    this.tenantContext.set(tenantId, tenant?.ragioneSociale ?? tenantId)
    window.location.reload()
  }

  /** Azzeramento del contesto tenant (ritorno al contesto globale). */
  onTenantClear(): void {
    this.tenantContext.clear()
    window.location.reload()
  }

  /** Tiene `desktop` allineato alla media query dei 992px. */
  private osservaLarghezza(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(min-width: 992px)')
    this.desktop.set(media.matches)
    const ascolta = (e: MediaQueryListEvent): void => this.desktop.set(e.matches)
    media.addEventListener('change', ascolta)
    this.distruzione.onDestroy(() => media.removeEventListener('change', ascolta))
  }

  toggleMobileSidebar(): void {
    this.mobileSidebarVisible.update(v => !v)
  }

  /**
   * Skip link: con `<base href="/">` l'href `#main-content` risolverebbe su `/#main-content`
   * (la Dashboard). Si porta il focus su `main` senza toccare la rotta.
   */
  vaiAlContenuto(evento: Event): void {
    evento.preventDefault()
    document.getElementById('main-content')?.focus()
  }

  /** Chiuso il drawer (anche con Esc) il focus torna al bottone che lo aveva aperto. */
  alChiudersiDrawer(): void {
    document.querySelector<HTMLElement>('.topbar__hamburger')?.focus()
  }

  closeMobileSidebar(): void {
    this.mobileSidebarVisible.set(false)
  }

  /**
   * Rileva una sessione di impersonificazione attiva e popola le signal usate
   * dal banner. Considera impersonificazione se è presente
   * `wf_impersonator_token` in localStorage OPPURE se il JWT corrente contiene
   * il claim `impersonatorId`. Il nome mostrato proviene da
   * `wf_impersonating_name` con fallback generico.
   */
  private detectImpersonation(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return
    }
    const hasImpersonatorToken = !!localStorage.getItem('wf_impersonator_token')
    const jwtHasClaim = this.currentTokenHasImpersonatorClaim()
    const active = hasImpersonatorToken || jwtHasClaim
    this.isImpersonating.set(active)
    if (active) {
      this.impersonatingName.set(
        localStorage.getItem('wf_impersonating_name')?.trim() || 'questo utente'
      )
    }
  }

  /**
   * Decodifica (best-effort) il payload base64url del JWT in
   * `localStorage.accessToken` e verifica la presenza del claim
   * `impersonatorId`. Qualsiasi errore di parsing è trattato come "assente".
   */
  private currentTokenHasImpersonatorClaim(): boolean {
    try {
      const token = localStorage.getItem('accessToken')
      const payload = token?.split('.')[1]
      if (!payload) return false
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
      const decoded = JSON.parse(atob(normalized))
      return decoded != null && decoded.impersonatorId != null
    } catch {
      return false
    }
  }

  /**
   * Termina l'impersonificazione: ripristina i token del super admin, ripulisce
   * le chiavi temporanee e ricarica completamente l'app sulla dashboard così da
   * tornare al contesto originale (feature-flag, dati e ruolo ricalcolati).
   */
  exitImpersonation(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return
    }
    const impersonatorToken = localStorage.getItem('wf_impersonator_token')
    const impersonatorRefresh = localStorage.getItem('wf_impersonator_refresh')

    if (impersonatorToken) {
      localStorage.setItem('accessToken', impersonatorToken)
    }
    if (impersonatorRefresh) {
      localStorage.setItem('refreshToken', impersonatorRefresh)
    }

    localStorage.removeItem('wf_impersonator_token')
    localStorage.removeItem('wf_impersonator_refresh')
    localStorage.removeItem('wf_impersonating_name')

    // Reload completo → si torna ad operare come super amministratore.
    window.location.href = '/dashboard'
  }

  onLogout(): void {
    this.authService.logout().subscribe()
  }
}
