# WasteFlow - Production Deployment Guide

## Pre-Deployment Checklist

### 1. Environment Configuration

Create `.env` file in `apps/backend`:

```env
# Application
NODE_ENV=production
APP_VERSION=1.0.0
PORT=3000
PUBLIC_URL=https://wasteflow.it

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=wasteflow_prod
DB_USER=wasteflow
DB_PASSWORD=<STRONG_PASSWORD>
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<STRONG_PASSWORD>

# JWT
JWT_SECRET=<GENERATE_STRONG_SECRET>
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=<GENERATE_STRONG_SECRET>
JWT_REFRESH_EXPIRES_IN=7d

# Keycloak (SPID/CIE)
KEYCLOAK_URL=https://auth.wasteflow.it
KEYCLOAK_REALM=wasteflow
KEYCLOAK_CLIENT_ID=wasteflow-backend
KEYCLOAK_CLIENT_SECRET=<FROM_KEYCLOAK>

# RENTRI
RENTRI_API_URL=https://api.rentri.gov.it
RENTRI_API_KEY=<FROM_RENTRI>
RENTRI_TIMEOUT=30000

# Email (SendGrid/AWS SES)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<SENDGRID_API_KEY>
EMAIL_FROM=noreply@wasteflow.it

# File Storage (AWS S3 / Azure Blob)
AWS_REGION=eu-south-1
AWS_ACCESS_KEY_ID=<AWS_KEY>
AWS_SECRET_ACCESS_KEY=<AWS_SECRET>
S3_BUCKET=wasteflow-prod

# Monitoring
SENTRY_DSN=<SENTRY_DSN>
NEW_RELIC_LICENSE_KEY=<NEW_RELIC_KEY>
```

### 2. Database Migration

```bash
# Run Prisma migrations
cd apps/backend
npx prisma migrate deploy

# Seed initial data (CER codes, etc.)
npx prisma db seed
```

### 3. Keycloak Configuration

1. Create `wasteflow` realm
2. Configure SPID providers:
   - Aruba ID
   - InfoCert ID
   - Poste ID
   - Register ID
   - Sielte ID
   - Tim ID
   - Namirial ID
   - Lepida ID
3. Configure CIE provider
4. Set up client `wasteflow-backend`:
   - Valid redirect URIs: `https://wasteflow.it/auth/callback`
   - Web origins: `https://wasteflow.it`
   - Client authentication: ON
   - Authorization: ON
5. Create roles:
   - admin
   - tenant_admin
   - user
   - consultant

### 4. SSL/TLS Certificates

```bash
# Using Let's Encrypt with Certbot
certbot certonly --nginx -d wasteflow.it -d auth.wasteflow.it
```

### 5. Nginx Configuration

`/etc/nginx/sites-available/wasteflow`:

```nginx
upstream backend {
    server 127.0.0.1:3000;
}

server {
    listen 443 ssl http2;
    server_name wasteflow.it;

    ssl_certificate /etc/letsencrypt/live/wasteflow.it/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wasteflow.it/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # Frontend
    location / {
        root /var/www/wasteflow/frontend;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name wasteflow.it;
    return 301 https://$server_name$request_uri;
}
```

### 6. Docker Compose Production

`docker-compose.prod.yml`:

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_DB: wasteflow_prod
      POSTGRES_USER: wasteflow
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    networks:
      - wasteflow

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    networks:
      - wasteflow

  keycloak:
    image: quay.io/keycloak/keycloak:23.0
    restart: always
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: wasteflow
      KC_DB_PASSWORD: ${DB_PASSWORD}
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD}
    command: start --optimized
    depends_on:
      - postgres
    networks:
      - wasteflow

  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile.prod
    restart: always
    environment:
      NODE_ENV: production
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    networks:
      - wasteflow
    ports:
      - "3000:3000"

  nginx:
    image: nginx:alpine
    restart: always
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./apps/frontend/dist:/usr/share/nginx/html:ro
      - ./certs:/etc/nginx/certs:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend
    networks:
      - wasteflow

  prometheus:
    image: prom/prometheus
    restart: always
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    networks:
      - wasteflow

  grafana:
    image: grafana/grafana
    restart: always
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    networks:
      - wasteflow

volumes:
  postgres_data:
  redis_data:
  prometheus_data:
  grafana_data:

networks:
  wasteflow:
    driver: bridge
```

### 7. Build Frontend

```bash
cd apps/frontend
npm run build -- --configuration production

# Output in dist/browser
```

### 8. Build Backend

`apps/backend/Dockerfile.prod`:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

### 9. Automated Backups

Setup cron job:

```bash
# /etc/cron.d/wasteflow-backup

# Daily backup at 2 AM
0 2 * * * root /opt/wasteflow/scripts/backup.sh >> /var/log/wasteflow-backup.log 2>&1

# Weekly cleanup (Sunday 3 AM)
0 3 * * 0 root find /backups -name "*.sql" -mtime +30 -delete
```

`scripts/backup.sh`:

```bash
#!/bin/bash

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="wasteflow-backup-${DATE}.sql"

pg_dump -h localhost -U wasteflow -d wasteflow_prod -F c -b -v -f /backups/${BACKUP_FILE}

# Upload to S3
aws s3 cp /backups/${BACKUP_FILE} s3://wasteflow-backups/

echo "Backup completed: ${BACKUP_FILE}"
```

### 10. Monitoring Setup

**Prometheus** (`monitoring/prometheus.yml`):

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'wasteflow-backend'
    static_configs:
      - targets: ['backend:3000']
    metrics_path: '/metrics'
```

**Grafana Dashboards**:
- System health
- API performance
- Database metrics
- Error rates
- User activity

### 11. Security Hardening

```bash
# Firewall rules (ufw)
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Fail2ban for SSH
apt install fail2ban
systemctl enable fail2ban

# Regular updates
apt update && apt upgrade -y

# Docker security
docker run --security-opt=no-new-privileges --read-only ...
```

### 12. Application Optimization

**Backend**:
- Enable Prisma query caching
- Redis caching for analytics
- BullMQ queue optimization
- Compression middleware
- Rate limiting

**Frontend**:
- Lazy loading all routes
- Tree-shaking optimizations
- CDN for static assets
- Service worker for offline support
- Image optimization

### 13. Performance Testing

```bash
# Load test with k6
k6 run --vus 100 --duration 5m load-test.js

# Results should show:
# - p95 < 200ms
# - Error rate < 0.1%
# - 1000+ req/s sustained
```

### 14. Go-Live Checklist

- [ ] Database migrations complete
- [ ] Environment variables configured
- [ ] SSL certificates installed
- [ ] Keycloak SPID configured
- [ ] SMTP server tested
- [ ] S3/Azure storage configured
- [ ] Backup schedule active
- [ ] Monitoring dashboards live
- [ ] Sentry error tracking enabled
- [ ] Load testing passed
- [ ] Security audit complete
- [ ] Documentation complete
- [ ] Support team trained
- [ ] Incident response plan ready

## Post-Deployment

### Monitoring Checklist

Daily:
- Check error logs (Sentry)
- Monitor API response times
- Verify backup completion
- Review RENTRI sync status

Weekly:
- Review performance metrics
- Check backup restoration
- Update dependencies
- Security patch review

Monthly:
- Generate compliance reports
- Review user analytics
- Capacity planning
- Disaster recovery drill

## Support Contacts

- **Technical Support**: support@wasteflow.it
- **Emergency Hotline**: +39 XXX XXX XXXX
- **RENTRI Support**: https://rentri.gov.it/support

## Disaster Recovery

In case of system failure:

1. Alert team via PagerDuty
2. Assess impact and severity
3. Switch to backup database (if needed)
4. Restore from latest backup:
   ```bash
   pg_restore -h localhost -U wasteflow -d wasteflow_prod -c -v /backups/latest.sql
   ```
5. Verify system health
6. Communicate with users
7. Post-mortem analysis

**RTO (Recovery Time Objective)**: 4 hours
**RPO (Recovery Point Objective)**: 24 hours

---

**WasteFlow v1.0**
Built with ❤️ for Italian waste management compliance
