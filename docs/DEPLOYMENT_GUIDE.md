# WasteFlow Production Deployment Guide

**Version**: 1.0
**Target Environment**: AWS (Production)
**Last Updated**: 2025-11-01

---

## Prerequisites

### Required Tools

```bash
# AWS CLI v2
aws --version  # >= 2.x

# Docker
docker --version  # >= 24.x

# Node.js & npm
node --version  # >= 20.x
npm --version   # >= 10.x

# Terraform (for infrastructure)
terraform --version  # >= 1.6.x

# psql (PostgreSQL client)
psql --version  # >= 16.x
```

### Required AWS Resources

Before deployment, ensure these resources exist:

- ✅ VPC with public/private subnets
- ✅ RDS PostgreSQL 16 instance (Multi-AZ)
- ✅ ElastiCache Redis cluster
- ✅ ECS Cluster (Fargate)
- ✅ Application Load Balancer (ALB)
- ✅ S3 bucket for document storage
- ✅ CloudFront distribution
- ✅ Route53 hosted zone
- ✅ ACM SSL certificate
- ✅ SES verified domain

---

## Infrastructure Setup (First-Time Only)

### 1. Provision AWS Infrastructure

```bash
cd infrastructure/terraform

# Initialize Terraform
terraform init

# Review planned changes
terraform plan -var-file=environments/production.tfvars

# Apply infrastructure
terraform apply -var-file=environments/production.tfvars

# Save outputs
terraform output -json > ../outputs.json
```

**Key Resources Created**:
- VPC (10.0.0.0/16)
- RDS PostgreSQL (db.r6g.xlarge, Multi-AZ)
- ElastiCache Redis (cache.r6g.large)
- ECS Cluster + Task Definitions
- ALB + Target Groups
- S3 Bucket (versioning enabled)
- CloudWatch Log Groups

### 2. Configure Database

```bash
# Get RDS endpoint from Terraform outputs
export DATABASE_URL=$(terraform output -raw database_url)

# Connect to database
psql $DATABASE_URL

# Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

# Verify extensions
\dx
```

### 3. Setup Secrets in AWS Secrets Manager

```bash
# Database credentials
aws secretsmanager create-secret \
  --name wasteflow/prod/database \
  --description "Production database credentials" \
  --secret-string '{
    "username": "wasteflow_admin",
    "password": "<STRONG_PASSWORD>",
    "host": "wasteflow-prod.xxxxx.rds.amazonaws.com",
    "port": 5432,
    "database": "wasteflow"
  }'

# JWT secrets
aws secretsmanager create-secret \
  --name wasteflow/prod/jwt \
  --description "JWT signing keys" \
  --secret-string '{
    "secret": "<RANDOM_256_BIT_KEY>",
    "expiresIn": "1d",
    "refreshExpiresIn": "7d"
  }'

# RENTRI API credentials
aws secretsmanager create-secret \
  --name wasteflow/prod/rentri \
  --description "RENTRI API credentials" \
  --secret-string '{
    "apiUrl": "https://api.rentri.gov.it/v1",
    "apiKey": "<RENTRI_API_KEY>",
    "certificatePath": "/app/certs/rentri-cert.pem"
  }'

# SPID/CIE certificates
aws secretsmanager create-secret \
  --name wasteflow/prod/spid \
  --description "SPID authentication certificates" \
  --secret-string '{
    "certPath": "/app/certs/spid-cert.pem",
    "keyPath": "/app/certs/spid-key.pem",
    "entityId": "https://wasteflow.it"
  }'
```

---

## Application Deployment

### Step 1: Prepare Release

```bash
# 1. Checkout release branch
git checkout main
git pull origin main

# 2. Create release tag
git tag -a v1.0.0 -m "Production release v1.0.0"
git push origin v1.0.0

# 3. Verify all tests pass
npm install
npm run test
npm run test:e2e

# 4. Build production bundle
npm run build

# 5. Run security audit
npm audit --production
npm audit fix --production
```

### Step 2: Build Docker Image

```bash
# Navigate to backend directory
cd apps/backend

# Build production image
docker build \
  --platform linux/amd64 \
  --build-arg NODE_ENV=production \
  --build-arg BUILD_VERSION=v1.0.0 \
  -t wasteflow-backend:v1.0.0 \
  -f Dockerfile.production \
  .

# Test image locally
docker run -p 3000:3000 \
  -e DATABASE_URL=$DATABASE_URL \
  -e REDIS_URL=$REDIS_URL \
  wasteflow-backend:v1.0.0

# Verify health endpoint
curl http://localhost:3000/health
```

### Step 3: Push to ECR

```bash
# Login to ECR
aws ecr get-login-password --region eu-south-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.eu-south-1.amazonaws.com

# Tag image
docker tag wasteflow-backend:v1.0.0 \
  123456789012.dkr.ecr.eu-south-1.amazonaws.com/wasteflow-backend:v1.0.0

docker tag wasteflow-backend:v1.0.0 \
  123456789012.dkr.ecr.eu-south-1.amazonaws.com/wasteflow-backend:latest

# Push to ECR
docker push 123456789012.dkr.ecr.eu-south-1.amazonaws.com/wasteflow-backend:v1.0.0
docker push 123456789012.dkr.ecr.eu-south-1.amazonaws.com/wasteflow-backend:latest

# Verify image
aws ecr describe-images \
  --repository-name wasteflow-backend \
  --image-ids imageTag=v1.0.0
```

### Step 4: Database Migrations

```bash
# IMPORTANT: Always test migrations in staging first!

# Connect to production database
export DATABASE_URL="postgresql://user:pass@prod-db.rds.amazonaws.com:5432/wasteflow"

# Preview migrations
npm run prisma:migrate status

# Deploy migrations
npm run prisma:migrate deploy

# Verify migration success
psql $DATABASE_URL -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"

# ROLLBACK if needed (keep rollback scripts in migrations/rollback/)
# psql $DATABASE_URL < migrations/rollback/20251101_revert.sql
```

### Step 5: Deploy to ECS

#### Option A: Manual Deployment

```bash
# Update task definition
aws ecs register-task-definition \
  --cli-input-json file://task-definition-prod.json

# Get new task definition revision
TASK_DEF_ARN=$(aws ecs describe-task-definition \
  --task-definition wasteflow-backend \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

# Update service with new task definition
aws ecs update-service \
  --cluster wasteflow-prod \
  --service backend \
  --task-definition $TASK_DEF_ARN \
  --desired-count 3 \
  --deployment-configuration '{
    "maximumPercent": 200,
    "minimumHealthyPercent": 100,
    "deploymentCircuitBreaker": {
      "enable": true,
      "rollback": true
    }
  }'

# Monitor deployment
aws ecs wait services-stable \
  --cluster wasteflow-prod \
  --services backend

# Verify deployment
aws ecs describe-services \
  --cluster wasteflow-prod \
  --services backend \
  --query 'services[0].deployments'
```

#### Option B: Blue-Green Deployment (Recommended)

```bash
# Create new CodeDeploy deployment
aws deploy create-deployment \
  --application-name wasteflow \
  --deployment-group-name prod-backend \
  --deployment-config-name CodeDeployDefault.ECSAllAtOnce \
  --description "Deploy v1.0.0" \
  --s3-location bucket=wasteflow-deployments,key=appspec.yaml,bundleType=YAML

# Monitor deployment
DEPLOYMENT_ID=$(aws deploy list-deployments --query 'deployments[0]' --output text)
aws deploy wait deployment-successful --deployment-id $DEPLOYMENT_ID

# Verify deployment
aws deploy get-deployment --deployment-id $DEPLOYMENT_ID
```

### Step 6: Frontend Deployment

```bash
# Build Angular frontend
cd apps/frontend
npm run build:production

# Sync to S3
aws s3 sync dist/frontend/ s3://wasteflow-frontend-prod/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "*.html" \
  --exclude "*.json"

# Upload HTML files (no cache)
aws s3 sync dist/frontend/ s3://wasteflow-frontend-prod/ \
  --cache-control "no-cache, no-store, must-revalidate" \
  --exclude "*" \
  --include "*.html" \
  --include "*.json"

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"

# Verify frontend
curl https://wasteflow.it
```

---

## Post-Deployment Verification

### Health Checks

```bash
# 1. Application health
curl https://api.wasteflow.it/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2025-11-01T10:00:00.000Z",
#   "service": "wasteflow-backend",
#   "version": "1.0.0",
#   "database": "connected",
#   "redis": "connected"
# }

# 2. API documentation
open https://api.wasteflow.it/api/docs

# 3. Frontend
open https://wasteflow.it

# 4. Database connectivity
psql $DATABASE_URL -c "SELECT NOW();"

# 5. Redis connectivity
redis-cli -h wasteflow-redis-prod.xxxxx.cache.amazonaws.com ping
```

### Smoke Tests

```bash
# Run automated smoke tests
npm run test:smoke -- --env production

# Test critical flows:
# ✅ User authentication (SPID/CIE)
# ✅ FIR creation
# ✅ FIR PDF export
# ✅ RENTRI sync
# ✅ Notification delivery
```

### Performance Verification

```bash
# Run load test (30 seconds, 50 users)
k6 run --vus 50 --duration 30s test/performance/load-test.js

# Verify metrics:
# ✅ Response time p95 < 200ms
# ✅ Response time p99 < 500ms
# ✅ Error rate < 1%
# ✅ Permission checks < 10ms

# Check error rates
curl https://api.wasteflow.it/api/v1/admin/metrics/errors

# Check performance metrics
curl https://api.wasteflow.it/api/v1/admin/metrics/performance
```

### Security Verification

```bash
# 1. SSL certificate
curl -vI https://api.wasteflow.it 2>&1 | grep -i "SSL certificate verify ok"

# 2. Security headers
curl -I https://api.wasteflow.it | grep -E "(X-Frame-Options|Strict-Transport-Security|Content-Security-Policy)"

# 3. Rate limiting
for i in {1..25}; do
  curl -w "%{http_code}\n" https://api.wasteflow.it/api/v1/fir
done
# Should see 429 (Too Many Requests) after ~20 requests

# 4. CSRF protection
curl -X POST https://api.wasteflow.it/api/v1/fir \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
# Should return 403 (Missing CSRF token)
```

---

## Monitoring Setup

### CloudWatch Alarms

```bash
# Create critical alarms
aws cloudwatch put-metric-alarm \
  --alarm-name wasteflow-high-error-rate \
  --alarm-description "Error rate > 2%" \
  --metric-name ErrorRate \
  --namespace WasteFlow \
  --statistic Average \
  --period 300 \
  --threshold 2.0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:eu-south-1:123456789012:wasteflow-critical

aws cloudwatch put-metric-alarm \
  --alarm-name wasteflow-high-response-time \
  --alarm-description "p95 response time > 300ms" \
  --metric-name ResponseTimeP95 \
  --namespace WasteFlow \
  --statistic Average \
  --period 300 \
  --threshold 300 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:eu-south-1:123456789012:wasteflow-critical

aws cloudwatch put-metric-alarm \
  --alarm-name wasteflow-db-connections \
  --alarm-description "Database connections > 90%" \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 90 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=DBInstanceIdentifier,Value=wasteflow-prod \
  --alarm-actions arn:aws:sns:eu-south-1:123456789012:wasteflow-warning
```

### Dashboard Setup

```bash
# Create main dashboard
aws cloudwatch put-dashboard \
  --dashboard-name WasteFlow-Production \
  --dashboard-body file://cloudwatch-dashboard.json
```

---

## Rollback Procedures

### Immediate Rollback (< 5 minutes)

```bash
# Rollback to previous task definition
aws ecs update-service \
  --cluster wasteflow-prod \
  --service backend \
  --task-definition wasteflow-backend:41 \
  --force-new-deployment

# Wait for rollback to complete
aws ecs wait services-stable \
  --cluster wasteflow-prod \
  --services backend

# Verify rollback
curl https://api.wasteflow.it/health | jq .version
```

### Database Rollback

```bash
# If migration needs to be reverted
psql $DATABASE_URL < migrations/rollback/20251101_rollback.sql

# Verify rollback
psql $DATABASE_URL -c "SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
```

### Full Disaster Recovery

See [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md#disaster-recovery-procedure)

---

## Maintenance Windows

### Scheduled Maintenance

```bash
# 1. Announce maintenance (24 hours notice)
# Update status page: https://status.wasteflow.it

# 2. Pre-maintenance checklist
- [ ] Backup database
- [ ] Notify users via email
- [ ] Prepare rollback plan
- [ ] Test changes in staging

# 3. Execute during maintenance window (Sunday 2-6 AM UTC)
# Scale down to 1 instance for database operations
aws ecs update-service \
  --cluster wasteflow-prod \
  --service backend \
  --desired-count 1

# Perform maintenance (migrations, reindexing, etc.)

# Scale back up
aws ecs update-service \
  --cluster wasteflow-prod \
  --service backend \
  --desired-count 3

# 4. Post-maintenance verification
npm run test:smoke -- --env production
```

---

## Troubleshooting

### Deployment Failed

**Symptoms**: ECS service fails to stabilize

**Check**:
```bash
# View recent ECS events
aws ecs describe-services \
  --cluster wasteflow-prod \
  --services backend \
  --query 'services[0].events[:10]'

# Check task logs
aws logs tail /aws/ecs/wasteflow-backend --follow --since 10m

# Common issues:
# - Health check failing (incorrect endpoint)
# - Database connection failed (wrong credentials)
# - Out of memory (increase task memory)
# - Image pull failed (verify ECR permissions)
```

### Database Migration Failed

**Symptoms**: Migration hangs or errors

**Check**:
```bash
# Check migration status
npm run prisma:migrate status

# View migration logs
psql $DATABASE_URL -c "SELECT * FROM _prisma_migrations WHERE finished_at IS NULL;"

# Check for locks
psql $DATABASE_URL -c "
  SELECT pid, query, state
  FROM pg_stat_activity
  WHERE state != 'idle'
    AND query LIKE '%ALTER TABLE%' OR query LIKE '%CREATE INDEX%';
"

# Kill stuck migration (if safe)
psql $DATABASE_URL -c "SELECT pg_terminate_backend(<PID>);"
```

### High Error Rate After Deployment

**Symptoms**: Error rate > 5%

**Immediate Actions**:
```bash
# 1. Check error logs
aws logs tail /aws/ecs/wasteflow-backend --follow | grep ERROR

# 2. Check error aggregation metrics
curl https://api.wasteflow.it/api/v1/admin/metrics/errors

# 3. If critical, rollback immediately
aws ecs update-service \
  --cluster wasteflow-prod \
  --service backend \
  --task-definition wasteflow-backend:41 \
  --force-new-deployment
```

---

## Appendix

### Environment Variables

**Production Environment Variables** (stored in ECS task definition):

```bash
NODE_ENV=production
LOG_LEVEL=info
PORT=3000

# Database (from Secrets Manager)
DATABASE_URL=<from-secret>

# Redis
REDIS_URL=<redis-endpoint>:6379

# JWT (from Secrets Manager)
JWT_SECRET=<from-secret>
JWT_EXPIRES_IN=1d

# RENTRI (from Secrets Manager)
RENTRI_API_URL=<from-secret>
RENTRI_API_KEY=<from-secret>

# AWS
AWS_REGION=eu-south-1
AWS_S3_BUCKET=wasteflow-documents-prod
AWS_SES_FROM_EMAIL=noreply@wasteflow.it

# SPID/CIE (from Secrets Manager)
SPID_CERT_PATH=<from-secret>
SPID_KEY_PATH=<from-secret>
SPID_ENTITY_ID=https://wasteflow.it

# Feature Flags
FEATURE_ANALYTICS=true
FEATURE_NOTIFICATIONS=true
FEATURE_MUD_REPORTING=true
```

### Task Definition Template

See `infrastructure/ecs/task-definition-prod.json`

### Useful Commands

```bash
# View running tasks
aws ecs list-tasks --cluster wasteflow-prod --service-name backend

# SSH into task (if enabled)
aws ecs execute-command \
  --cluster wasteflow-prod \
  --task <task-id> \
  --container backend \
  --interactive \
  --command "/bin/bash"

# View CloudWatch logs
aws logs tail /aws/ecs/wasteflow-backend --follow

# Force new deployment
aws ecs update-service \
  --cluster wasteflow-prod \
  --service backend \
  --force-new-deployment
```

---

**Document Maintenance**:
- Review quarterly
- Update after major changes
- Keep rollback procedures tested

**Next Review**: 2025-02-01
