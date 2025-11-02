# API Contracts: Production-Ready Web Application

**Feature**: 001-production-ready-app | **Date**: 2025-10-30

This directory contains OpenAPI 3.0 specifications for all WasteFlow REST API modules.

## Contract Files

1. **rentri-sync-api.yaml** - RENTRI synchronization endpoints
2. **auth-api.yaml** - SPID/CIE authentication & session management
3. **dashboard-api.yaml** - Dashboard KPIs, analytics, real-time updates
4. **notifications-api.yaml** - User notifications & alerts
5. **admin-api.yaml** - Monitoring, backups, system health

## API Versioning

All endpoints are versioned under `/api/v1/` prefix:

- Base URL (dev): `http://localhost:3000/api/v1/`
- Base URL (staging): `https://api-staging.wasteflow.it/api/v1/`
- Base URL (production): `https://api.wasteflow.it/api/v1/`

## Authentication

All endpoints (except `/health` and `/auth/*`) require JWT Bearer token:

```
Authorization: Bearer <jwt_token>
```

JWT payload includes:
```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "fiscalCode": "RSSMRA80A01H501U",
  "tenantId": "current_tenant_id",
  "roles": ["ADMIN", "OPERATOR"],
  "iat": 1698765432,
  "exp": 1698851832
}
```

## Multi-Tenant Context

All data operations are scoped to the active tenant from JWT `tenantId` claim.

Tenant switching:
```http
POST /api/v1/auth/switch-tenant
{
  "tenantId": "new_tenant_id"
}
```

Returns new JWT with updated `tenantId`.

## Rate Limiting

| Tier | Rate Limit | Burst |
|------|-----------|-------|
| FREE | 60 req/min | 10 |
| PRO | 600 req/min | 100 |
| BUSINESS | 6000 req/min | 1000 |
| ENTERPRISE | Unlimited | Unlimited |

Rate limit headers:
```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 573
X-RateLimit-Reset: 1698765492
```

## Error Format

Standard error response (RFC 7807):

```json
{
  "type": "https://wasteflow.it/errors/validation-error",
  "title": "Validation Error",
  "status": 400,
  "detail": "FIR quantity exceeds 10% tolerance",
  "instance": "/api/v1/fir/abc-123",
  "errors": [
    {
      "field": "quantitaConsegnata",
      "message": "Value 1100 exceeds tolerance (max 1000 + 10%)"
    }
  ],
  "correlationId": "req-xyz-789"
}
```

## Key Endpoints Summary

### RENTRI Sync API (`/api/v1/rentri-sync`)

- `GET /rentri-sync/status` - Get sync status for tenant
- `POST /rentri-sync/fir/{firId}` - Trigger manual FIR sync
- `POST /rentri-sync/registry/batch` - Batch sync registry entries
- `GET /rentri-sync/failed` - List failed syncs for retry
- `POST /rentri-sync/retry/{syncLogId}` - Retry failed sync

### Auth API (`/api/v1/auth`)

- `GET /auth/spid/login` - Initiate SPID login (redirects to IdP)
- `POST /auth/spid/callback` - SPID callback handler (SAML response)
- `POST /auth/logout` - Logout and invalidate session
- `POST /auth/switch-tenant` - Switch active tenant context
- `GET /auth/me` - Get current user info + tenant list

### Dashboard API (`/api/v1/dashboard`)

- `GET /dashboard/kpis` - Get all KPI tiles (waste totals, FIR counts, etc.)
- `GET /dashboard/charts/waste-by-cer` - Waste by CER category chart data
- `GET /dashboard/charts/cost-trend` - Cost trend over time
- `WebSocket /dashboard` - Real-time KPI updates (Socket.IO)

### Notifications API (`/api/v1/notifications`)

- `GET /notifications` - List user notifications (paginated, filter by unread)
- `GET /notifications/unread/count` - Unread notification count (for badge)
- `PATCH /notifications/{id}/read` - Mark notification as read
- `DELETE /notifications/{id}` - Dismiss notification
- `GET /notifications/preferences` - Get user notification settings
- `PUT /notifications/preferences` - Update notification preferences

### Admin API (`/api/v1/admin`)

- `GET /admin/monitoring/metrics` - System metrics (response time, error rate, queue depth)
- `GET /admin/monitoring/health` - Health check (database, Redis, RENTRI API)
- `GET /admin/backups` - List backup logs
- `POST /admin/backups/trigger` - Trigger manual backup
- `POST /admin/backups/{id}/restore` - Restore from backup point
- `GET /admin/errors` - Error log search & filtering

## Pagination

All list endpoints support cursor-based pagination:

```http
GET /api/v1/notifications?limit=20&cursor=eyJpZCI6ImFiYy0xMjMiLCJjcmVhdGVkQXQiOiIyMDI1LTEwLTMwVDEwOjAwOjAwWiJ9
```

Response:
```json
{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6ImRlZi00NTYiLCJjcmVhdGVkQXQiOiIyMDI1LTEwLTI5VDA5OjAwOjAwWiJ9",
    "hasMore": true,
    "total": 156
  }
}
```

## WebSocket Events

Dashboard WebSocket (`/dashboard` namespace):

```javascript
// Client subscribes to tenant-scoped room
socket.emit('subscribe', { tenantId: 'tenant-123' });

// Server broadcasts KPI updates
socket.on('kpi:update', (data) => {
  // { totalWasteKg: 12345, activeFirs: 23, ... }
});

// Server broadcasts FIR state changes
socket.on('fir:completed', (data) => {
  // { firId: 'abc-123', numeroProgressivo: 'FIR-2025-001234' }
});
```

## OpenAPI Documentation

Interactive API documentation available at:
- Development: http://localhost:3000/api/docs
- Production: https://api.wasteflow.it/api/docs

**Note**: Full OpenAPI 3.0 YAML specifications to be generated during implementation phase.