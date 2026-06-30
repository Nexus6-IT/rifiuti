import { Routes } from '@angular/router'
import { authGuard } from './core/guards/auth.guard'

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent),
  },
  {
    // Registrazione self-service azienda + utente admin (WS-G)
    path: 'signup',
    loadComponent: () =>
      import('./features/auth/signup/signup.component').then(m => m.SignupComponent),
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
        path: 'giacenze',
        loadComponent: () =>
          import('./features/giacenze/giacenze.component').then(m => m.GiacenzeComponent),
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
        path: 'contratti',
        loadComponent: () =>
          import('./features/contracts/contracts-list.component').then(
            m => m.ContractsListComponent
          ),
      },
      {
        path: 'reference-data',
        loadComponent: () =>
          import('./features/reference-data/reference-data.component').then(
            m => m.ReferenceDataComponent
          ),
      },
      {
        // Gestione abbonamento SaaS (pagamento, upgrade piano, Billing Portal Stripe)
        path: 'abbonamento',
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
        // Gestione certificato RENTRI (solo admin — enforcement lato componente + backend)
        path: 'rentri/certificato',
        loadComponent: () =>
          import('./features/rentri/rentri-credential.component').then(
            m => m.RentriCredentialComponent
          ),
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
