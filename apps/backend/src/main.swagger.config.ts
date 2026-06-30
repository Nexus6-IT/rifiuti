/**
 * Swagger/OpenAPI Configuration
 * T237: Phase 10 - API Documentation
 *
 * Generates interactive API documentation at /api/docs
 */

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { INestApplication } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('WasteFlow API - Roles & Permissions System')
    .setDescription(
      `
# WasteFlow Roles & Permissions API

Complete API documentation for the WasteFlow Italian waste management platform.

## Features Implemented (Phase 10 Complete)

### ABAC Policy Engine
- Attribute-Based Access Control for fine-grained authorization
- Dynamic policy evaluation with <5ms overhead
- Support for complex conditions (AND/OR, multiple operators)

### Performance Monitoring
- Prometheus metrics exposed at /metrics
- Real-time performance tracking (P99 latency, cache hit rate)
- Grafana dashboards for visualization

### Security Hardening
- Rate limiting on sensitive endpoints
- CSP headers and security best practices
- OWASP ZAP security scanning

### Audit Trail
- Tamper-proof audit logs with cryptographic chaining
- 10-year retention for compliance
- Comprehensive permission check logging

## Authentication

All endpoints (except /api/health and /api/docs) require JWT authentication.

Include the token in the Authorization header:
\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

## Rate Limits

- **Permission requests**: 10/hour per user
- **Audit exports**: 5/hour per user
- **Role changes**: 20/hour per admin
- **General API**: 100/minute per user

## Permissions Format

Permissions follow the format: \`resource:action:scope\`

**Examples:**
- \`fir:read:own\` - Read own FIRs
- \`fir:create:facility\` - Create FIRs for facility
- \`report:export:all\` - Export all reports
- \`policies:create:all\` - Create ABAC policies (admin only)

## Error Responses

All error responses follow this format:
\`\`\`json
{
  "statusCode": 403,
  "message": "Insufficient permissions",
  "error": "Forbidden",
  "requiredPermission": "fir:read:facility",
  "currentRole": "operator"
}
\`\`\`

## Performance Targets

- **P99 Latency**: < 10ms (permission checks)
- **Cache Hit Rate**: > 95%
- **Throughput**: > 1000 RPS
- **Availability**: 99.9% uptime

## Contact & Support

- **Email**: api-support@wasteflow.it
- **Documentation**: https://docs.wasteflow.it
- **Status Page**: https://status.wasteflow.it
      `
    )
    .setVersion('2.0.0')
    .setContact('WasteFlow Support', 'https://wasteflow.it', 'support@wasteflow.it')
    .setLicense('Proprietary', 'https://wasteflow.it/license')
    .addServer('https://api.wasteflow.it', 'Production')
    .addServer('https://staging-api.wasteflow.it', 'Staging')
    .addServer('http://localhost:3000', 'Development')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token obtained from /api/v1/auth/login',
      },
      'JWT'
    )
    .addTag('Authentication', 'SPID/CIE authentication and session management')
    .addTag('FIR', 'Formulario Identificazione Rifiuti management')
    .addTag('Permissions', 'Role-based access control (RBAC)')
    .addTag('Policies (ABAC)', 'Attribute-based access control policies')
    .addTag('Users', 'User management and profiles')
    .addTag('Audit', 'Audit trail and compliance logs')
    .addTag('Reports', 'MUD reports and analytics')
    .addTag('Monitoring', 'Metrics and health checks')
    .addTag('Admin', 'Administrative operations')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Tenant-ID',
        in: 'header',
        description: 'Tenant identifier for multi-tenant isolation',
      },
      'TenantID'
    )
    .build()

  const document = SwaggerModule.createDocument(app, config, {
    ignoreGlobalPrefix: false,
    deepScanRoutes: true,
  })

  // Customize Swagger UI
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'WasteFlow API Documentation',
    customfavIcon: '/favicon.ico',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #3b82f6 }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 3,
      defaultModelExpandDepth: 3,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  })

  // Export OpenAPI JSON for external tools
  const outputPath = path.join(process.cwd(), 'docs', 'openapi.json')
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2))
  console.log(`OpenAPI spec written to: ${outputPath}`)
}

/**
 * Example API responses for Swagger documentation
 */
export const swaggerExamples = {
  // Permission check response
  permissionCheckSuccess: {
    decision: 'ALLOW',
    reason: null,
    evaluatedPolicies: [
      {
        policyId: 'policy-uuid',
        policyName: 'Allow FIR read for same facility',
        effect: 'ALLOW',
        matched: true,
        evaluationTimeMs: 0.8,
      },
    ],
    totalDurationMs: 8.5,
    cacheHit: true,
  },

  // Audit log entry
  auditLogEntry: {
    id: 'log-uuid',
    timestamp: '2025-11-01T10:30:00Z',
    userId: 'user-uuid',
    tenantId: 'tenant-uuid',
    spidFiscalCode: 'RSSMRA85M01H501U',
    actionAttempted: 'fir:read:facility',
    resourceType: 'fir',
    resourceId: 'fir-uuid',
    decision: 'ALLOW',
    evaluatedPolicies: [],
    sessionId: 'session-uuid',
    ipAddress: '192.168.1.1',
    currentHash: 'abc123...',
    previousEntryHash: 'xyz789...',
  },

  // ABAC policy
  abacPolicy: {
    id: 'policy-uuid',
    name: 'FIR Facility Scoping',
    resourceType: 'fir',
    effect: 'ALLOW',
    conditions: {
      operator: 'AND',
      rules: [
        {
          attribute: 'user.facility',
          operator: 'eq',
          value: 'resource.producerFacility',
        },
      ],
    },
    priority: 100,
    isActive: true,
    description: 'Allow FIR access only for same facility',
    createdBy: 'admin-uuid',
    createdAt: '2025-11-01T00:00:00Z',
    updatedAt: '2025-11-01T00:00:00Z',
  },

  // Temporary permission grant
  temporaryGrant: {
    id: 'grant-uuid',
    userId: 'user-uuid',
    tenantId: 'tenant-uuid',
    permissions: ['fir:delete:all', 'report:export:all'],
    startTime: '2025-11-01T09:00:00Z',
    endTime: '2025-11-01T17:00:00Z',
    grantedBy: 'admin-uuid',
    businessJustification: 'Emergency data cleanup required',
    autoRevoked: false,
    revokedAt: null,
  },
}
