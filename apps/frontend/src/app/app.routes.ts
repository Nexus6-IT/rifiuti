import { Routes } from '@angular/router'
import { authGuard } from './core/guards/auth.guard'
import { superAdminGuard } from './core/guards/super-admin.guard'

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent),
  },
  {
    // Richiesta di accesso (lead capture): il form pubblico NON crea più un
    // tenant/utente. Un consulente attiva la prova guidata (TRIAL) via admin.
    path: 'richiedi-accesso',
    loadComponent: () =>
      import('./features/auth/signup/signup.component').then(m => m.AccessRequestComponent),
  },
  {
    // Alias storico: /signup → /richiedi-accesso
    path: 'signup',
    redirectTo: 'richiedi-accesso',
    pathMatch: 'full',
  },
  {
    // Riceve i token dopo il login SAML/Keycloak (rotta pubblica)
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/auth-callback.component').then(m => m.AuthCallbackComponent),
  },
  {
    // Pagine legali pubbliche (ToS, Privacy, DPA) — senza authGuard
    path: 'legal/termini',
    loadComponent: () =>
      import('./features/legal/legal-page.component').then(m => m.LegalPageComponent),
    data: { page: 'termini' },
  },
  {
    path: 'legal/privacy',
    loadComponent: () =>
      import('./features/legal/legal-page.component').then(m => m.LegalPageComponent),
    data: { page: 'privacy' },
  },
  {
    path: 'legal/dpa',
    loadComponent: () =>
      import('./features/legal/legal-page.component').then(m => m.LegalPageComponent),
    data: { page: 'dpa' },
  },
  {
    path: '',
    loadComponent: () =>
      import('./shared/components/layout.component').then(m => m.LayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard-page/dashboard-page.component').then(
            m => m.DashboardPageComponent
          ),
      },
      {
        path: 'fir',
        loadComponent: () =>
          import('./features/fir/fir-list.component').then(m => m.FirListComponent),
      },
      {
        // Dettaglio di un singolo formulario: dati, stato RENTRI, cronologia trasmissioni, azioni.
        path: 'fir/:id',
        loadComponent: () =>
          import('./features/fir/fir-detail.component').then(m => m.FirDetailComponent),
      },
      {
        path: 'cer',
        loadComponent: () =>
          import('./features/cer/cer-search.component').then(m => m.CerSearchComponent),
      },
      {
        path: 'produttori',
        loadComponent: () =>
          import('./features/registry/produttori-list.component').then(
            m => m.ProduttoriListComponent
          ),
      },
      {
        path: 'trasportatori',
        loadComponent: () =>
          import('./features/registry/trasportatori-list.component').then(
            m => m.TrasportatoriListComponent
          ),
      },
      {
        path: 'destinatari',
        loadComponent: () =>
          import('./features/registry/destinatari-list.component').then(
            m => m.DestinatariListComponent
          ),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications-page/notifications-page.component').then(
            m => m.NotificationsPageComponent
          ),
      },
      {
        path: 'mud',
        loadComponent: () => import('./features/mud/mud.component').then(m => m.MudComponent),
      },
      {
        path: 'esg',
        loadComponent: () => import('./features/esg/esg.component').then(m => m.EsgComponent),
      },
      {
        path: 'pese',
        loadComponent: () => import('./features/pese/pese.component').then(m => m.PeseComponent),
      },
      {
        path: 'giacenze',
        loadComponent: () =>
          import('./features/giacenze/giacenze.component').then(m => m.GiacenzeComponent),
      },
      {
        path: 'giacenze/abbinamenti',
        loadComponent: () =>
          import('./features/giacenze/abbinamenti.component').then(m => m.AbbinamentiComponent),
      },
      {
        // Registro cronologico di carico/scarico (art. 190 D.Lgs 152/2006)
        path: 'registro',
        loadComponent: () =>
          import('./features/registro/registro.component').then(m => m.RegistroComponent),
      },
      {
        path: 'anomalie',
        loadComponent: () =>
          import('./features/anomaly/anomaly.component').then(m => m.AnomalyComponent),
      },
      {
        path: 'clienti',
        loadComponent: () =>
          import('./features/clienti/clienti-list.component').then(m => m.ClientiListComponent),
      },
      {
        path: 'clienti/tabelle',
        loadComponent: () =>
          import('./features/clienti/tabelle/tabelle-fatturazione.component').then(
            m => m.TabelleFatturazioneComponent
          ),
      },
      {
        path: 'clienti/agenti',
        loadComponent: () =>
          import('./features/clienti/agenti-list.component').then(m => m.AgentiListComponent),
      },
      {
        path: 'clienti/addebiti',
        loadComponent: () =>
          import('./features/listino/addebiti-list.component').then(m => m.AddebitiListComponent),
      },
      {
        path: 'contratti-clienti',
        loadComponent: () =>
          import('./features/contratti-cliente/contratti-cliente-list.component').then(
            m => m.ContrattiClienteListComponent
          ),
      },
      {
        path: 'contratti-clienti/:id/listino',
        loadComponent: () =>
          import('./features/listino/listino-contratto.component').then(
            m => m.ListinoContrattoComponent
          ),
      },
      {
        path: 'contratti',
        loadComponent: () =>
          import('./features/contracts/contracts-list.component').then(
            m => m.ContractsListComponent
          ),
      },
      {
        // Dati di riferimento (tabelle condivise ISTAT/ATECO): manutenzione di
        // piattaforma, riservata al SUPER_ADMIN (2026-07-28). Il guard evita
        // l'accesso digitando l'URL; l'autorizzazione reale resta sul backend
        // (reference-data.controller.ts, @Roles('SUPER_ADMIN')).
        path: 'reference-data',
        canActivate: [superAdminGuard],
        loadComponent: () =>
          import('./features/reference-data/reference-data.component').then(
            m => m.ReferenceDataComponent
          ),
      },
      {
        // Gestione abbonamento SaaS (pagamento, upgrade piano, Billing Portal Stripe).
        // Riservata al SUPER_ADMIN per decisione del committente (2026-07-26):
        // nemmeno gli ADMIN dei tenant devono potervi accedere. Il guard evita
        // l'accesso via URL; l'autorizzazione reale resta sul backend
        // (billing.controller.ts, @Roles('SUPER_ADMIN')).
        path: 'abbonamento',
        canActivate: [superAdminGuard],
        loadComponent: () =>
          import('./features/billing/billing-page.component').then(m => m.BillingPageComponent),
      },
      {
        // Amministrazione piattaforma — gestione tenant (SUPER_ADMIN; enforcement lato backend)
        path: 'admin/tenants',
        loadComponent: () =>
          import('./features/admin/tenants/tenant-admin.component').then(
            m => m.TenantAdminComponent
          ),
      },
      {
        // Amministrazione — gestione utenti (SUPER_ADMIN / ADMIN; enforcement lato backend)
        path: 'admin/utenti',
        loadComponent: () =>
          import('./features/admin/users/user-admin.component').then(m => m.UserAdminComponent),
      },
      {
        // Stato del sistema — pagina di piattaforma (SUPER_ADMIN: espone
        // aggregati di TUTTE le aziende; enforcement lato backend, guard qui
        // per non mostrare una pagina che risponderebbe 403)
        path: 'admin/stato-sistema',
        canActivate: [superAdminGuard],
        loadComponent: () =>
          import('./features/admin/system-health/system-health.component').then(
            m => m.SystemHealthComponent
          ),
      },
      {
        // Gestione certificato RENTRI (solo admin — enforcement lato componente + backend)
        path: 'rentri/certificato',
        loadComponent: () =>
          import('./features/rentri/rentri-credential.component').then(
            m => m.RentriCredentialComponent
          ),
      },
      {
        // Modalità di legame RENTRI (solo admin — enforcement lato componente + backend)
        path: 'rentri/modalita-legame',
        loadComponent: () =>
          import('./features/rentri/rentri-modalita-legame.component').then(
            m => m.RentriModalitaLegameComponent
          ),
      },
      {
        // Sedi RENTRI / unità locali del tenant, R2 multi-sede (solo admin — enforcement lato componente + backend)
        path: 'rentri/sedi',
        loadComponent: () =>
          import('./features/rentri/rentri-unita-locale.component').then(
            m => m.RentriUnitaLocaleComponent
          ),
      },
      {
        // Ricerca e aggancio formulari RENTRI (R2 Task 8) — SUPER_ADMIN/ADMIN/OPERATOR,
        // enforcement lato componente + backend (RentriFormulariController)
        path: 'rentri/formulari',
        loadComponent: () =>
          import('./features/rentri/rentri-formulari.component').then(
            m => m.RentriFormulariComponent
          ),
      },
      {
        // Unità locali lette dall'ente RENTRI, R4 Task 7 (solo admin — enforcement lato componente + backend)
        path: 'rentri/unita-locali',
        loadComponent: () =>
          import('./features/rentri/rentri-siti.component').then(m => m.RentriSitiComponent),
      },
      {
        // Diagnostica allineamento codifiche RENTRI, R4 Task 7 (solo admin — enforcement lato componente + backend)
        path: 'rentri/codifiche',
        loadComponent: () =>
          import('./features/rentri/rentri-codifiche-diagnostica.component').then(
            m => m.RentriCodificheDiagnosticaComponent
          ),
      },
      {
        // Diagnostica RENTRI — salute del collegamento da dati locali, R5 Task 3
        // (SUPER_ADMIN/ADMIN/OPERATOR — enforcement lato componente + backend)
        path: 'rentri/diagnostica',
        loadComponent: () =>
          import('./features/rentri/rentri-diagnostica.component').then(
            m => m.RentriDiagnosticaComponent
          ),
      },
      {
        // Blocchi virtuali e scorta di numeri vidimati (SUPER_ADMIN/ADMIN/OPERATOR
        // in lettura, scrittura solo admin — enforcement lato componente + backend)
        path: 'rentri/blocchi',
        loadComponent: () =>
          import('./features/rentri/rentri-blocchi.component').then(m => m.RentriBlocchiComponent),
      },
      // T179: Custom Role Management Routes
      {
        path: 'permissions',
        children: [
          {
            path: 'roles',
            loadComponent: () =>
              import('./features/permissions/pages/role-management/role-management.component').then(
                m => m.RoleManagementComponent
              ),
          },
          {
            path: 'roles/create',
            loadComponent: () =>
              import(
                './features/permissions/pages/custom-role-builder/custom-role-builder.component'
              ).then(m => m.CustomRoleBuilderComponent),
          },
          {
            path: 'roles/edit/:id',
            loadComponent: () =>
              import(
                './features/permissions/pages/custom-role-builder/custom-role-builder.component'
              ).then(m => m.CustomRoleBuilderComponent),
          },
          {
            path: 'my-permissions',
            loadComponent: () =>
              import(
                './features/permissions/pages/permission-discovery/permission-discovery.component'
              ).then(m => m.PermissionDiscoveryComponent),
          },
          {
            path: 'audit',
            loadComponent: () =>
              import(
                './features/permissions/pages/audit-trail-viewer/audit-trail-viewer.component'
              ).then(m => m.AuditTrailViewerComponent),
          },
          {
            path: 'consultant-dashboard',
            loadComponent: () =>
              import(
                './features/permissions/pages/consultant-dashboard/consultant-dashboard.component'
              ).then(m => m.ConsultantDashboardComponent),
          },
          {
            path: 'my-grants',
            loadComponent: () =>
              import('./features/permissions/pages/my-grants/my-grants.component').then(
                m => m.MyGrantsComponent
              ),
          },
          {
            path: 'pending-grants',
            loadComponent: () =>
              import('./features/permissions/pages/pending-grants/pending-grants.component').then(
                m => m.PendingGrantsComponent
              ),
          },
          {
            path: 'my-assignments',
            loadComponent: () =>
              import('./features/permissions/pages/my-assignments/my-assignments.component').then(
                m => m.MyAssignmentsComponent
              ),
          },
          {
            path: 'denied',
            loadComponent: () =>
              import(
                './features/permissions/pages/permission-denied/permission-denied.component'
              ).then(m => m.PermissionDeniedComponent),
          },
        ],
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
]
