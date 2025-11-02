# Angular Frontend Architecture - Visual Overview

**Feature**: 002-roles-permissions-system

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ANGULAR 17 FRONTEND                                 │
│                    (Standalone Components + Signals)                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRESENTATION LAYER                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │  Pages (Smart)   │  │  Components      │  │  Directives      │         │
│  │  - Container     │  │  - Presentational│  │  - *appHasPerm   │         │
│  │  - Route-aware   │  │  - OnPush        │  │  - appRequirePerm│         │
│  │  - Store inject  │  │  - Pure I/O      │  │  - Tooltip       │         │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘         │
│           │                     │                      │                    │
│           └─────────────────────┴──────────────────────┘                    │
│                                  │                                           │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │
┌──────────────────────────────────┼───────────────────────────────────────────┐
│                         STATE MANAGEMENT LAYER                               │
├──────────────────────────────────┼───────────────────────────────────────────┤
│                                  │                                           │
│  ┌───────────────────────────────▼────────────────────────────────────┐    │
│  │                     NgRx SignalStore                                │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │    │
│  │  │ PermissionStore │  │   RoleStore     │  │ TempPermStore    │  │    │
│  │  ├─────────────────┤  ├─────────────────┤  ├──────────────────┤  │    │
│  │  │ State:          │  │ State:          │  │ State:           │  │    │
│  │  │ • permissions   │  │ • roles         │  │ • requests       │  │    │
│  │  │ • tenantContext │  │ • userRoles     │  │ • activeGrants   │  │    │
│  │  │ • cache         │  │ • selected      │  │ • countdown      │  │    │
│  │  │                 │  │                 │  │                  │  │    │
│  │  │ Computed:       │  │ Computed:       │  │ Computed:        │  │    │
│  │  │ • effective     │  │ • filtered      │  │ • expiringSoon   │  │    │
│  │  │ • byModule      │  │ • byType        │  │ • timeRemaining  │  │    │
│  │  │ • isStale       │  │ • userCounts    │  │ • pendingCount   │  │    │
│  │  │                 │  │                 │  │                  │  │    │
│  │  │ Methods:        │  │ Methods:        │  │ Methods:         │  │    │
│  │  │ • hasPermission │  │ • loadRoles     │  │ • requestPerm    │  │    │
│  │  │ • switchTenant  │  │ • createRole    │  │ • approvePerm    │  │    │
│  │  │ • invalidate    │  │ • assignRole    │  │ • startCountdown │  │    │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘  │    │
│  │                                                                      │    │
│  └───────────────────────────┬──────────────────────────────────────────┘    │
│                              │                                               │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────────────┐
│                           SERVICE LAYER                                      │
├──────────────────────────────┼───────────────────────────────────────────────┤
│                              │                                               │
│  ┌───────────────────────────▼────────────────────────────────────┐         │
│  │                      Angular Services                           │         │
│  ├─────────────────────────────────────────────────────────────────┤         │
│  │                                                                  │         │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │         │
│  │  │ PermissionService│  │   RoleService    │  │ CacheService │ │         │
│  │  ├──────────────────┤  ├──────────────────┤  ├──────────────┤ │         │
│  │  │ • getUserPerms() │  │ • getRoles()     │  │ • set()      │ │         │
│  │  │ • getTenantPerms││  │ • createRole()   │  │ • get()      │ │         │
│  │  │ • requestTemp()  │  │ • assignRole()   │  │ • clear()    │ │         │
│  │  └──────────────────┘  └──────────────────┘  └──────────────┘ │         │
│  │                                                                  │         │
│  │  ┌──────────────────┐  ┌──────────────────┐                    │         │
│  │  │ ResponsiveService│  │   AuthService    │                    │         │
│  │  ├──────────────────┤  ├──────────────────┤                    │         │
│  │  │ • isMobile()     │  │ • currentUser()  │                    │         │
│  │  │ • isTablet()     │  │ • isAuth()       │                    │         │
│  │  │ • isDesktop()    │  │ • logout()       │                    │         │
│  │  └──────────────────┘  └──────────────────┘                    │         │
│  │                                                                  │         │
│  └───────────────────────────┬──────────────────────────────────────┘         │
│                              │                                               │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │
                               │ HTTP/WebSocket
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                            BACKEND API                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐               │
│  │ GET /permissions│  │ POST /roles    │  │ POST /temp-perm│               │
│  │ GET /roles      │  │ PUT /roles/:id │  │ GET /audit-log │               │
│  │ POST /assign    │  │ DELETE /roles  │  │ WebSocket: perm│               │
│  └────────────────┘  └────────────────┘  └────────────────┘               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Hierarchy Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         APP SHELL                                   │
│                     (Layout Component)                              │
└─────────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐   ┌───────────────────┐   ┌──────────────────┐
│  Header       │   │  Main Content     │   │  Footer          │
│               │   │  <router-outlet>  │   │                  │
└───────────────┘   └───────────────────┘   └──────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐   ┌───────────────────┐   ┌──────────────────┐
│ Tenant        │   │ Permission Routes │   │ Other Routes     │
│ Selector      │   │ /permissions/...  │   │ /dashboard, /fir │
└───────────────┘   └───────────────────┘   └──────────────────┘
                                │
        ┌───────────────────────┼───────────────────────────────┐
        │                       │                               │
        ▼                       ▼                               ▼
┌───────────────┐   ┌───────────────────┐   ┌──────────────────────┐
│ PAGES (Smart) │   │ PAGES (Smart)     │   │ PAGES (Smart)        │
│               │   │                   │   │                      │
│ • RoleMgmt    │   │ • UserRoles       │   │ • MyPermissions      │
│ • PermMgmt    │   │ • PermRequests    │   │ • ViewAsUser         │
│               │   │                   │   │                      │
└───────┬───────┘   └───────┬───────────┘   └──────────┬───────────┘
        │                   │                           │
        │                   │                           │
        ▼                   ▼                           ▼
┌────────────────────────────────────────────────────────────────┐
│              PRESENTATIONAL COMPONENTS                         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ RoleList     │  │ RoleForm     │  │ RoleCard     │       │
│  │ (Table)      │  │ (Form)       │  │ (Mobile)     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ PermMatrix   │  │ PermList     │  │ PermBadge    │       │
│  │ (Builder)    │  │ (Display)    │  │ (Visual)     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ UserRoleList │  │ AssignWizard │  │ InviteDialog │       │
│  │ (Assignments)│  │ (Multi-step) │  │ (Modal)      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ TempPermReq  │  │ TempPermAppr │  │ Countdown    │       │
│  │ (Dialog)     │  │ (Card)       │  │ (Timer)      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ AuditLog     │  │ DiscoveryCard│  │ TooltipComp  │       │
│  │ (Timeline)   │  │ (Mobile UX)  │  │ (Help)       │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER INTERACTION                             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │  Template Binding / Event Handler │
        └───────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Signal Read   │   │ Store Method  │   │ Service Call  │
│ permissions() │   │ createRole()  │   │ deleteRole()  │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        │                   ▼                   │
        │           ┌───────────────┐           │
        │           │ RxJS Pipeline │           │
        │           │ • switchMap   │           │
        │           │ • tapResponse │           │
        │           │ • catchError  │           │
        │           └───────────────┘           │
        │                   │                   │
        │                   ▼                   │
        │           ┌───────────────┐           │
        │           │ HTTP Request  │◄──────────┘
        │           │ POST /roles   │
        │           └───────────────┘
        │                   │
        │                   ▼
        │           ┌───────────────┐
        │           │ Backend API   │
        │           └───────────────┘
        │                   │
        │                   ▼
        │           ┌───────────────┐
        │           │ patchState()  │
        │           │ Update Store  │
        │           └───────────────┘
        │                   │
        └───────────────────┼───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   Signal Change Detection         │
        │   • Computed signals recalculate  │
        │   • Effects run side effects      │
        │   • Components re-render (OnPush) │
        └───────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │         UI UPDATE                 │
        │   • List updates automatically    │
        │   • Badges reflect new counts     │
        │   • Directives re-evaluate perms  │
        └───────────────────────────────────┘
```

---

## Permission Check Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Template: *appHasPermission="'fir:delete:all'"                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   Directive.ngOnInit()            │
        │   Create effect() for reactivity  │
        └───────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   effect(() => {                  │
        │     const hasPerm = checkPerm()   │
        │     updateView(hasPerm)           │
        │   })                              │
        └───────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   PermissionStore.hasPermission() │
        └───────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────┐
        │                   │               │
        ▼                   ▼               ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Check Cache   │   │ Cache Hit?    │   │ Cache Miss    │
│ O(1) lookup   │   │ Return cached │   │ Compute value │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        │                   │                   ▼
        │                   │           ┌───────────────┐
        │                   │           │ Query Store   │
        │                   │           │ effective     │
        │                   │           │ Permissions() │
        │                   │           └───────────────┘
        │                   │                   │
        │                   │                   ▼
        │                   │           ┌───────────────┐
        │                   │           │ Match Pattern │
        │                   │           │ fir:delete:all│
        │                   │           │ or wildcard   │
        │                   │           └───────────────┘
        │                   │                   │
        │                   │                   ▼
        │                   │           ┌───────────────┐
        │                   │           │ Store in Cache│
        │                   │           └───────────────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   Return boolean result           │
        │   • true: Show element            │
        │   • false: Hide element           │
        └───────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   Directive.updateView()          │
        │   • Create/destroy view           │
        │   • Or show elseTemplate          │
        └───────────────────────────────────┘
```

---

## Mobile Responsive Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              RESPONSIVE SERVICE INITIALIZATION                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   Angular CDK BreakpointObserver  │
        │   Observe media queries           │
        └───────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ XSmall        │   │ Medium        │   │ XLarge        │
│ 0-575px       │   │ 768-991px     │   │ 1200px+       │
└───────────────┘   └───────────────┘   └───────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   Convert to Signal               │
        │   toSignal(observable)            │
        └───────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ isMobile()    │   │ isTablet()    │   │ isDesktop()   │
│ Signal<bool>  │   │ Signal<bool>  │   │ Signal<bool>  │
└───────────────┘   └───────────────┘   └───────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   Component Computed Signals      │
        │   cardClass = computed(() => {    │
        │     return isMobile()             │
        │       ? 'mobile-card'             │
        │       : 'desktop-card'            │
        │   })                              │
        └───────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   Template Conditional Rendering  │
        │   @if (isMobile()) {              │
        │     <p-accordion />               │
        │   } @else {                       │
        │     <p-card />                    │
        │   }                               │
        └───────────────────────────────────┘
```

---

## Performance Optimization Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPTIMIZATION LAYERS                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Change Detection                                      │
├─────────────────────────────────────────────────────────────────┤
│  ✓ ChangeDetectionStrategy.OnPush on all presentational        │
│  ✓ Signal-based reactivity (fine-grained updates)              │
│  ✓ Effect() for side effects, not manual subscriptions         │
│  Result: 80-90% reduction in change detection cycles           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: Rendering Optimization                               │
├─────────────────────────────────────────────────────────────────┤
│  ✓ trackBy functions on all *ngFor                             │
│  ✓ Virtual scrolling for 100+ items (PrimeNG)                  │
│  ✓ Lazy loading routes (code splitting)                        │
│  ✓ Computed signals (automatic memoization)                    │
│  Result: <100ms render for 1000 items                          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: Data Caching                                         │
├─────────────────────────────────────────────────────────────────┤
│  ✓ Permission checks cached in Map (O(1) lookup)               │
│  ✓ 1-hour cache expiry with stale detection                    │
│  ✓ Cache invalidation on permission changes                    │
│  ✓ Cache hit rate >95%                                          │
│  Result: <10ms permission check at 99th percentile             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: Bundle Optimization                                  │
├─────────────────────────────────────────────────────────────────┤
│  ✓ Tree-shakeable imports (no barrel exports of large libs)    │
│  ✓ Lazy-loaded feature modules                                 │
│  ✓ PrimeNG component-level imports only                        │
│  ✓ Code splitting per route                                    │
│  Result: <150KB per feature module (gzipped)                   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 5: Network Optimization                                 │
├─────────────────────────────────────────────────────────────────┤
│  ✓ HTTP request batching (combine related queries)             │
│  ✓ WebSocket for real-time permission updates                  │
│  ✓ Optimistic UI updates (no loading spinners)                 │
│  ✓ Service Worker caching (future)                             │
│  Result: <2s tenant context switch                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: Authentication (SPID/CIE)                            │
├─────────────────────────────────────────────────────────────────┤
│  • SAML 2.0 federation with SPID/CIE                            │
│  • JWT tokens (access + refresh)                               │
│  • Fiscal code correlation for audit                           │
│  • Step-up re-auth for sensitive operations                    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: Authorization (Permissions)                          │
├─────────────────────────────────────────────────────────────────┤
│  • Permission checks on every UI interaction                    │
│  • Route guards prevent unauthorized navigation                │
│  • Directives hide/disable unauthorized elements               │
│  • Backend validates all permissions (never trust frontend)    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: Tenant Isolation                                     │
├─────────────────────────────────────────────────────────────────┤
│  • Tenant context in JWT claims                                 │
│  • Frontend validates tenant context matches                   │
│  • Cross-tenant data access prevented                          │
│  • Backend: Schema-per-tenant + RLS                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: Audit Logging                                        │
├─────────────────────────────────────────────────────────────────┤
│  • All permission checks logged (ALLOW/DENY)                   │
│  • User actions tracked with SPID fiscal code                  │
│  • Immutable append-only log                                   │
│  • 10-year retention for compliance                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 5: XSS/CSRF Protection                                  │
├─────────────────────────────────────────────────────────────────┤
│  • Angular sanitization (auto-escape)                          │
│  • CSRF tokens on state-changing requests                      │
│  • Content Security Policy headers                             │
│  • HTTPOnly cookies for sensitive data                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       PRODUCTION DEPLOYMENT                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  CDN (CloudFront)                                               │
│  • Static assets (JS, CSS, images)                             │
│  • Gzip compression                                             │
│  • Cache: 1 year with cache-busting hashes                     │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Load Balancer (ALB)                                            │
│  • SSL termination                                              │
│  • Health checks                                                │
│  • WebSocket support (upgrade headers)                         │
└─────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Frontend App  │   │ Backend API   │   │ WebSocket     │
│ (S3 + CF)     │   │ (ECS/Fargate) │   │ (Socket.IO)   │
│ Angular 17    │   │ NestJS 10     │   │ Real-time     │
└───────────────┘   └───────────────┘   └───────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ PostgreSQL    │   │ Redis         │   │ S3            │
│ (RDS)         │   │ (ElastiCache) │   │ (Audit Logs)  │
│ Multi-tenant  │   │ Perm Cache    │   │ Cold Storage  │
└───────────────┘   └───────────────┘   └───────────────┘
```

---

**Architecture Version**: 1.0
**Last Updated**: 2025-10-31
**Designed By**: Claude Code (Angular Expert)
