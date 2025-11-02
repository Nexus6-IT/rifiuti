import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: '',
    loadComponent: () => import('./shared/components/layout.component').then(m => m.LayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard-page/dashboard-page.component').then(m => m.DashboardPageComponent)
      },
      {
        path: 'fir',
        loadComponent: () => import('./features/fir/fir-list.component').then(m => m.FirListComponent)
      },
      {
        path: 'cer',
        loadComponent: () => import('./features/cer/cer-search.component').then(m => m.CerSearchComponent)
      },
      {
        path: 'produttori',
        loadComponent: () => import('./features/registry/produttori-list.component').then(m => m.ProduttoriListComponent)
      },
      {
        path: 'trasportatori',
        loadComponent: () => import('./features/registry/trasportatori-list.component').then(m => m.TrasportatoriListComponent)
      },
      {
        path: 'destinatari',
        loadComponent: () => import('./features/registry/destinatari-list.component').then(m => m.DestinatariListComponent)
      },
      {
        path: 'notifications',
        loadComponent: () => import('./features/notifications/notifications-page/notifications-page.component').then(m => m.NotificationsPageComponent)
      },
      // T179: Custom Role Management Routes
      {
        path: 'permissions',
        children: [
          {
            path: 'roles',
            loadComponent: () => import('./features/permissions/pages/role-management/role-management.component').then(m => m.RoleManagementComponent)
          },
          {
            path: 'roles/create',
            loadComponent: () => import('./features/permissions/pages/custom-role-builder/custom-role-builder.component').then(m => m.CustomRoleBuilderComponent)
          },
          {
            path: 'roles/edit/:id',
            loadComponent: () => import('./features/permissions/pages/custom-role-builder/custom-role-builder.component').then(m => m.CustomRoleBuilderComponent)
          },
          {
            path: 'my-permissions',
            loadComponent: () => import('./features/permissions/pages/permission-discovery/permission-discovery.component').then(m => m.PermissionDiscoveryComponent)
          },
          {
            path: 'audit',
            loadComponent: () => import('./features/permissions/pages/audit-trail-viewer/audit-trail-viewer.component').then(m => m.AuditTrailViewerComponent)
          },
          {
            path: 'consultant-dashboard',
            loadComponent: () => import('./features/permissions/pages/consultant-dashboard/consultant-dashboard.component').then(m => m.ConsultantDashboardComponent)
          },
          {
            path: 'my-grants',
            loadComponent: () => import('./features/permissions/pages/my-grants/my-grants.component').then(m => m.MyGrantsComponent)
          },
          {
            path: 'pending-grants',
            loadComponent: () => import('./features/permissions/pages/pending-grants/pending-grants.component').then(m => m.PendingGrantsComponent)
          },
          {
            path: 'my-assignments',
            loadComponent: () => import('./features/permissions/pages/my-assignments/my-assignments.component').then(m => m.MyAssignmentsComponent)
          },
          {
            path: 'denied',
            loadComponent: () => import('./features/permissions/pages/permission-denied/permission-denied.component').then(m => m.PermissionDeniedComponent)
          }
        ]
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
