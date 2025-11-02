# Deployment Checklist - WasteFlow Roles & Permissions System
**T239: Phase 10 - Deployment Guide**

## Pre-Deployment Checklist

### 1. Code Review and Testing
- [ ] All PR reviews completed and approved
- [ ] Unit tests passing (100% coverage for domain layer)
- [ ] Integration tests passing
- [ ] Performance tests passing (P99 < 10ms)
- [ ] k6 load tests passing (>1000 RPS)
- [ ] OWASP ZAP security scan passed (no high-risk vulnerabilities)
- [ ] E2E tests passing in staging environment

### 2. Database Migrations
- [ ] Generate migration files: `npx prisma migrate dev --name phase-10-abac`
- [ ] Review migration SQL for correctness
- [ ] Test migration on staging database
- [ ] Backup production database before migration
- [ ] Verify migration rollback procedure

```bash
# Generate migration
cd apps/backend
npx prisma migrate dev --name phase-10-abac-policies

# Review generated SQL
cat prisma/migrations/*/migration.sql

# Test on staging
DATABASE_URL=$STAGING_DB_URL npx prisma migrate deploy

# Backup production
pg_dump $PROD_DB_URL > backup_pre_deployment_$(date +%Y%m%d).sql
```

### 3. Environment Variables
- [ ] All required environment variables documented
- [ ] Environment variables configured in production
- [ ] Secrets rotated (database passwords, Redis auth, JWT secrets)
- [ ] Validate configuration with `npm run validate:env`

**Required Environment Variables:**
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/wasteflow

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=xxxxx

# Monitoring
PROMETHEUS_ENABLED=true
GRAFANA_URL=https://grafana.wasteflow.it

# Security
JWT_SECRET=xxxxx
ABAC_EVALUATION_ENABLED=true
RATE_LIMIT_ENABLED=true

# Performance
PERMISSION_CACHE_TTL=3600
MAX_ABAC_POLICIES_PER_RESOURCE=100
```

### 4. Infrastructure
- [ ] Kubernetes cluster health check passed
- [ ] Database connection pool sized appropriately
- [ ] Redis cluster healthy and configured
- [ ] Load balancer configured for new endpoints
- [ ] CDN cache purged
- [ ] SSL certificates valid

```bash
# Check cluster health
kubectl get nodes
kubectl top nodes

# Check database connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Check Redis
redis-cli PING
redis-cli INFO replication
```

### 5. Monitoring and Alerting
- [ ] Grafana dashboard imported and tested
- [ ] CloudWatch alarms created
- [ ] PagerDuty integration configured
- [ ] Slack notifications configured
- [ ] Log aggregation (ELK/Datadog) configured

```bash
# Import Grafana dashboard
curl -X POST http://grafana.wasteflow.it/api/dashboards/db \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -d @monitoring/grafana-dashboard.json

# Deploy CloudWatch alarms
aws cloudformation deploy \
  --template-file monitoring/cloudwatch-alarms.yaml \
  --stack-name wasteflow-permissions-alarms \
  --parameter-overrides Environment=production
```

---

## Deployment Steps

### Step 1: Database Migration (5 minutes)

```bash
# 1. Backup database
pg_dump $PROD_DB_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Run migration
DATABASE_URL=$PROD_DB_URL npx prisma migrate deploy

# 3. Verify tables created
psql $PROD_DB_URL -c "\dt abac*"
psql $PROD_DB_URL -c "SELECT count(*) FROM abac_policies;"

# 4. Seed default ABAC policies (optional)
psql $PROD_DB_URL -f prisma/seeds/abac-policies.sql
```

### Step 2: Deploy Backend (10 minutes)

```bash
# 1. Build Docker image
docker build -t wasteflow-backend:phase-10 .

# 2. Tag and push to registry
docker tag wasteflow-backend:phase-10 gcr.io/wasteflow/backend:phase-10
docker push gcr.io/wasteflow/backend:phase-10

# 3. Update Kubernetes deployment
kubectl set image deployment/wasteflow-backend \
  backend=gcr.io/wasteflow/backend:phase-10

# 4. Wait for rollout
kubectl rollout status deployment/wasteflow-backend

# 5. Verify pods are running
kubectl get pods -l app=wasteflow-backend
```

### Step 3: Deploy Frontend (5 minutes)

```bash
# 1. Build Angular app
cd apps/frontend
npm run build:prod

# 2. Deploy to CDN/S3
aws s3 sync dist/frontend s3://wasteflow-frontend-prod --delete

# 3. Invalidate CDN cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890 \
  --paths "/*"
```

### Step 4: Cache Warm-Up (2 minutes)

```bash
# Warm up permission cache for active users
curl -X POST http://api.wasteflow.it/api/v1/admin/cache/warm-up \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Verify cache population
redis-cli KEYS "permissions:*" | wc -l
```

### Step 5: Smoke Tests (5 minutes)

```bash
# Test health endpoint
curl http://api.wasteflow.it/api/health

# Test authentication
curl -X POST http://api.wasteflow.it/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@wasteflow.it","password":"test123"}'

# Test permission check
curl -X GET http://api.wasteflow.it/api/v1/firs \
  -H "Authorization: Bearer $TEST_TOKEN"

# Test ABAC policy endpoint
curl -X GET http://api.wasteflow.it/api/v1/policies \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Test metrics endpoint
curl http://api.wasteflow.it/metrics | grep permission_check
```

---

## Post-Deployment Verification

### 1. Functional Verification (15 minutes)

- [ ] Users can log in successfully
- [ ] Permission checks work for all roles
- [ ] ABAC policies are evaluated correctly
- [ ] Temporary grants can be created and revoked
- [ ] Audit logs are being written
- [ ] Rate limiting is enforced
- [ ] Security headers are present

### 2. Performance Verification (10 minutes)

```bash
# Check P99 latency
curl http://api.wasteflow.it/metrics | grep "permission_check_duration.*quantile=\"0.99\""

# Check cache hit ratio
curl http://api.wasteflow.it/metrics | grep permission_cache_hit_ratio

# Run quick load test
k6 run --duration 1m --vus 100 tests/load/permission-checks.js
```

**Acceptance Criteria:**
- P99 latency < 10ms
- Cache hit ratio > 95%
- No errors in logs
- Throughput > 1000 RPS

### 3. Monitoring Verification (5 minutes)

- [ ] Grafana dashboard showing metrics
- [ ] CloudWatch alarms in OK state
- [ ] Logs flowing to centralized logging
- [ ] No error spikes in APM

```bash
# Check Grafana
open http://grafana.wasteflow.it/d/permissions-dashboard

# Check CloudWatch alarms
aws cloudwatch describe-alarms \
  --alarm-name-prefix "production-permission"

# Check recent logs
kubectl logs -f deployment/wasteflow-backend --tail=100 | grep ERROR
```

---

## Rollback Procedure

### If Deployment Fails (Execute Within 15 minutes)

```bash
# 1. Rollback Kubernetes deployment
kubectl rollout undo deployment/wasteflow-backend

# 2. Wait for rollback
kubectl rollout status deployment/wasteflow-backend

# 3. Rollback database migration (if needed)
DATABASE_URL=$PROD_DB_URL npx prisma migrate resolve --rolled-back MIGRATION_NAME

# 4. Clear Redis cache
redis-cli FLUSHDB

# 5. Verify rollback
curl http://api.wasteflow.it/api/health
```

### If Data Corruption Detected

```bash
# 1. Stop application
kubectl scale deployment/wasteflow-backend --replicas=0

# 2. Restore database
psql $PROD_DB_URL < backup_YYYYMMDD_HHMMSS.sql

# 3. Verify data integrity
psql $PROD_DB_URL -c "SELECT count(*) FROM users;"
psql $PROD_DB_URL -c "SELECT count(*) FROM roles;"

# 4. Restart application
kubectl scale deployment/wasteflow-backend --replicas=3
```

---

## Post-Deployment Tasks

### Within 1 Hour

- [ ] Monitor error rates in Grafana for 1 hour
- [ ] Check PagerDuty for any alerts
- [ ] Review CloudWatch logs for errors
- [ ] Notify team in Slack: "Phase 10 deployed successfully"

### Within 24 Hours

- [ ] Review performance metrics (P99, cache hit rate)
- [ ] Analyze audit logs for anomalies
- [ ] Check ABAC policy evaluation counts
- [ ] Update deployment documentation

### Within 1 Week

- [ ] Conduct post-deployment review meeting
- [ ] Document lessons learned
- [ ] Update runbook based on deployment experience
- [ ] Plan next phase improvements

---

## Emergency Contacts

- **Deployment Lead**: deployment@wasteflow.it
- **On-Call Engineer**: +39 XXX XXX XXXX
- **Database Admin**: dba@wasteflow.it
- **DevOps Team**: devops@wasteflow.it

---

## Deployment Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Tech Lead | _________ | _________ | _____ |
| DevOps | _________ | _________ | _____ |
| QA Lead | _________ | _________ | _____ |
| Product Owner | _________ | _________ | _____ |

---

**Deployment Date**: YYYY-MM-DD
**Deployment Time**: HH:MM UTC
**Deployed By**: __________
**Version**: phase-10-abac-policies
**Duration**: ____ minutes
**Status**: [ ] Success [ ] Partial [ ] Rolled Back

**Last Updated**: 2025-11-01
**Document Owner**: DevOps Team
