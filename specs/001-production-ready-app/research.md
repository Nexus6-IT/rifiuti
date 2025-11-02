# Research: Production-Ready Web Application

**Feature**: 001-production-ready-app | **Date**: 2025-10-30 | **Status**: Complete

## Key Technical Decisions

### 1. RENTRI API Integration
**Decision**: Official RENTRI sandbox (OAuth2 + JWT) with exponential backoff retry
- Endpoint: `https://rentri-test.mase.gov.it/api/v1/`
- Rate limit: 100 req/min (prod), 20 req/min (sandbox)
- Retry strategy: 5min → 15min → 60min (per FR-003)
- Library: Custom HTTP client (`axios` + retry interceptor)

### 2. SPID Authentication
**Decision**: `passport-saml` library with multi-IdP configuration
- Supported IdPs: Poste, Infocert, Aruba, TIM, Sielte
- SPID Level 2 required (legal signature compliance)
- Test environment: SPID Validator (https://validator.spid.gov.it/)
- Attributes: fiscal_code, email, name, family_name

### 3. Digital Signatures
**Decision**: ECDSA-SHA256 with SPID fiscal code as signer identity
- Algorithm: ECDSA P-256 curve (NIST-approved, eIDAS-compliant)
- Signature components: FIR_ID + DATA_HASH + FISCAL_CODE + TIMESTAMP + SPID_SESSION_ID
- Key management: AWS Secrets Manager, 90-day rotation
- Legal basis: CAD Art. 21 (Advanced Electronic Signature)

### 4. Real-Time Dashboard
**Decision**: WebSocket (Socket.IO) with SSE fallback
- NestJS adapter: `@nestjs/platform-socket.io`
- Tenant-scoped rooms for multi-tenant isolation
- Redis pub/sub for horizontal scaling
- Fallback: Server-Sent Events if WebSocket blocked

### 5. Multi-Tenancy
**Decision**: Schema-per-tenant + PostgreSQL Row-Level Security
- Schema naming: `tenant_{uuid_without_hyphens}`
- Shared schema: `public` (tenants, cer_catalog)
- RLS policy: Enforce tenant_id = current_setting('app.current_tenant_id')
- Provisioning: Automated schema creation + seed data

### 6. PDF Export
**Decision**: PDFKit for server-side generation
- Features: Custom letterhead, QR codes, headers/footers, page numbers
- Performance: Async generation via BullMQ, S3 caching
- Template storage: Company logos in S3 with CloudFront CDN

### 7. Notifications
**Decision**: Multi-channel (in-app + email) via BullMQ queues
- Email: AWS SES ($0.10/1K emails, high deliverability)
- Templates: Handlebars for HTML emails
- Scheduling: Cron job daily at 9 AM for deadline checks
- Rate limiting: Max 100 emails/hour per user

### 8. Monitoring & Observability
**Decision**: Winston + CloudWatch Logs + Grafana
- Structured logging: JSON format with correlation IDs
- Metrics: API response time, error rate, RENTRI sync status, queue depth
- Alerts: Error rate >5% (15min), p95 >1s (5min), queue depth >1000
- Dashboards: Grafana Cloud free tier (10K metrics)

## Implementation References

**Libraries**:
- Auth: `passport-saml`, `@nestjs/passport`
- Signatures: Node.js `crypto` module, `node-forge`
- Real-time: `socket.io`, `@nestjs/platform-socket.io`
- PDF: `pdfkit`, `qrcode`
- Queues: `@nestjs/bullmq`, `bullmq`
- Logging: `winston`, `nestjs-winston`

**External Services**:
- RENTRI API: https://rentri-test.mase.gov.it (sandbox)
- SPID Validator: https://validator.spid.gov.it
- AWS SES: Email delivery
- AWS S3: Backups, PDFs, letterhead templates
- CloudWatch: Logs and metrics
- Grafana Cloud: Dashboards and alerts

**Standards & Compliance**:
- SPID Technical Rules: https://docs.italia.it/italia/spid/spid-regole-tecniche
- eIDAS Regulation (EU) 910/2014: Digital signatures legal framework
- CAD Art. 21: Advanced Electronic Signature requirements
- NIST FIPS 186-4: ECDSA cryptographic standard
- GDPR: Data protection, encryption, audit logs

**Next Phase**: Generate data-model.md with entity definitions