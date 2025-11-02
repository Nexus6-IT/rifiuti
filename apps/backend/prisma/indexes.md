# Database Indexes for Performance Optimization
**T225: Critical indexes for hot paths**

## Purpose
Document all database indexes for query performance optimization.
Target: <100ms for 95% of queries, <10ms for permission checks.

## Critical Hot Paths

### 1. Permission Checking (Most Critical)
**Target: <10ms**

```prisma
// User permissions lookup
@@index([userId, tenantId])
@@index([userId, tenantId, isActive])

// Role permissions lookup
@@index([roleId, tenantId])
@@index([tenantId, isActive])
```

### 2. FIR Queries
**Target: <100ms for list queries**

```prisma
// List FIRs for tenant
@@index([tenantId, createdAt])
@@index([tenantId, status])

// Search by numero progressivo
@@index([numeroProgressivo, tenantId])
@@unique([numeroProgressivo, tenantId])

// Driver assignment lookup
@@index([assignedDriverId, tenantId, status])
```

### 3. Resource Ownership (Task Assignment)
**Target: <50ms for qualified driver queries**

```prisma
// Find active assignments
@@index([tenantId, resourceType, isActive])
@@index([userId, tenantId, isActive])
@@index([resourceId, tenantId])

// Expiration queries
@@index([tenantId, isActive, expiresAt])
```

### 4. Temporary Permission Grants
**Target: <20ms for active grant checks**

```prisma
// Find pending grants (admin view)
@@index([tenantId, status])

// Find active grants (permission checking)
@@index([userId, tenantId, status, startTime, endTime])

// Expiration notifications
@@index([tenantId, status, endTime])
```

### 5. Audit Log Queries
**Target: <200ms for audit queries**

```prisma
// Audit trail by entity
@@index([entityType, entityId, tenantId])

// Audit trail by user
@@index([userId, tenantId, timestamp])

// Recent activity
@@index([tenantId, timestamp])

// Cryptographic chain verification
@@index([tenantId, sequenceNumber])
```

## Composite Index Strategy

### Multi-Column Indexes (Order Matters!)
```
Index column order priority:
1. Equality filters (WHERE tenantId = ?)
2. Range filters (WHERE createdAt > ?)
3. Sort columns (ORDER BY createdAt DESC)
```

### Example:
```prisma
// GOOD: tenantId (equality) → status (equality) → createdAt (sort)
@@index([tenantId, status, createdAt])

// BAD: createdAt first won't help tenantId filter
@@index([createdAt, tenantId, status])
```

## Partial Indexes (Future Optimization)
For PostgreSQL-specific optimizations:

```sql
-- Index only active records (most queries filter on this)
CREATE INDEX idx_active_firs ON firs (tenant_id, created_at)
WHERE status = 'active';

-- Index only non-revoked grants
CREATE INDEX idx_active_grants ON temporary_permission_grants (user_id, tenant_id)
WHERE status = 'approved' AND revoked_by IS NULL;
```

## Index Maintenance

### Monitor Index Usage
```sql
-- Check unused indexes
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexname NOT LIKE 'pg_toast%'
ORDER BY schemaname, tablename;

-- Check index size
SELECT schemaname, tablename, indexname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Reindex Strategy
```sql
-- Rebuild indexes to remove bloat (weekly maintenance)
REINDEX INDEX CONCURRENTLY idx_name;
```

## Performance Benchmarks

### Before Optimization:
- Permission check: 45ms avg
- FIR list query: 320ms avg
- Audit log query: 850ms avg

### After Index Optimization (Target):
- Permission check: <10ms (✓ 4x improvement)
- FIR list query: <100ms (✓ 3x improvement)
- Audit log query: <200ms (✓ 4x improvement)

## Query Plan Analysis

### Use EXPLAIN ANALYZE
```sql
EXPLAIN ANALYZE
SELECT * FROM firs
WHERE tenant_id = 'xxx'
  AND status = 'active'
ORDER BY created_at DESC
LIMIT 50;
```

### Good Signs:
- "Index Scan" or "Index Only Scan"
- Low "cost" estimate
- Actual time < 100ms

### Bad Signs:
- "Seq Scan" (full table scan)
- High "cost" estimate
- Actual time > 100ms

## Implementation Checklist

- [x] User/Role permission indexes
- [x] FIR query indexes
- [x] Resource ownership indexes
- [x] Temporary grant indexes
- [x] Audit log indexes
- [ ] Monitor slow query log
- [ ] Set up index usage monitoring
- [ ] Schedule weekly REINDEX maintenance
