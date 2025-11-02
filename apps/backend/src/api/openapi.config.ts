import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

/**
 * OpenAPI/Swagger Configuration
 * T236: API documentation for WasteFlow platform
 *
 * Purpose: Comprehensive API documentation for developers
 *
 * Features:
 * - Complete endpoint documentation
 * - Request/response schemas
 * - Authentication requirements
 * - Permission requirements
 * - Example requests/responses
 * - Error codes and messages
 */
export class OpenApiConfig {
  static setup(app: INestApplication): void {
    const config = new DocumentBuilder()
      .setTitle('WasteFlow API')
      .setDescription(`
# WasteFlow Platform API Documentation

WasteFlow is a comprehensive waste management SaaS platform for Italian municipalities and waste management companies.

## Authentication

All endpoints (except public ones) require JWT authentication via Bearer token:

\`\`\`
Authorization: Bearer <your_jwt_token>
\`\`\`

### Getting a Token

1. **SPID/CIE Authentication** (Production):
   - POST /api/v1/auth/spid/login - Initiate SPID authentication
   - Callback redirects with JWT token

2. **Email/Password** (Development):
   - POST /api/v1/auth/login
   - Returns JWT token in response

## Multi-Tenancy

All requests must include tenant context in the JWT token. The API automatically filters data by tenant.

## Rate Limiting

- **Authenticated users**: 100 requests/minute
- **Unauthenticated**: 20 requests/minute
- **Admin users**: 200 requests/minute
- **Sensitive endpoints** (auth): 10 requests/minute

## CSRF Protection

All state-changing requests (POST, PUT, DELETE, PATCH) require CSRF token:

\`\`\`
X-CSRF-Token: <csrf_token>
\`\`\`

Get CSRF token from \`XSRF-TOKEN\` cookie after authentication.

## Permissions

Endpoints are protected by granular permissions in format: \`resource:action:scope\`

Examples:
- \`fir:read:own\` - Read own FIRs
- \`fir:read:facility\` - Read FIRs for entire facility
- \`fir:read:all\` - Read all FIRs (admin)
- \`user:create:facility\` - Create users in facility

## Error Handling

All errors follow consistent format:

\`\`\`json
{
  "success": false,
  "error": {
    "statusCode": 400,
    "message": "Validation failed",
    "error": "BadRequest",
    "timestamp": "2025-10-31T10:00:00.000Z",
    "path": "/api/v1/fir",
    "correlationId": "err-1730368800000-abc123"
  }
}
\`\`\`

## Pagination

List endpoints support cursor-based pagination:

\`\`\`
GET /api/v1/fir?limit=50&cursor=eyJpZCI6IjEyMyJ9
\`\`\`

Response includes:
\`\`\`json
{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6IjE3MyJ9",
    "hasMore": true
  }
}
\`\`\`

## Filtering & Sorting

Most list endpoints support filtering and sorting:

\`\`\`
GET /api/v1/fir?status=pending&sortBy=createdAt&sortOrder=desc
\`\`\`

## WebSocket Real-Time Updates

Subscribe to real-time notifications via Socket.IO:

\`\`\`javascript
const socket = io('wss://api.wasteflow.it', {
  auth: { token: '<jwt_token>' }
});

socket.on('fir:created', (data) => {
  console.log('New FIR:', data);
});
\`\`\`

## API Versioning

Current version: **v1**

Base URL: \`https://api.wasteflow.it/api/v1\`

## Support

- Documentation: https://docs.wasteflow.it
- Support: support@wasteflow.it
- Status: https://status.wasteflow.it
      `)
      .setVersion('1.0')
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
          name: 'Authorization',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'X-CSRF-Token',
          in: 'header',
          description: 'CSRF token for state-changing requests',
        },
        'CSRF',
      )
      .addTag('Authentication', 'Login, logout, SPID/CIE authentication')
      .addTag('FIR', 'Formulario di Identificazione dei Rifiuti (Waste Tracking Forms)')
      .addTag('Users', 'User management and profiles')
      .addTag('Roles', 'Role and permission management')
      .addTag('Task Assignment', 'Driver task assignment and routing')
      .addTag('Temporary Permissions', 'Time-bound permission requests')
      .addTag('Audit', 'Audit trail and compliance logs')
      .addTag('Notifications', 'Real-time notifications and alerts')
      .addTag('Analytics', 'Dashboard metrics and reporting')
      .addTag('Admin', 'Administrative operations')
      .addTag('Health', 'System health and monitoring')
      .build();

    const document = SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controllerKey: string, methodKey: string) =>
        `${controllerKey}_${methodKey}`,
    });

    // Customize Swagger UI
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'WasteFlow API Documentation',
      customfavIcon: 'https://wasteflow.it/favicon.ico',
      customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info { margin: 50px 0 }
        .swagger-ui .info .title { color: #2c3e50 }
      `,
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        defaultModelsExpandDepth: 3,
        defaultModelExpandDepth: 3,
        docExpansion: 'list',
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });

    // Also export JSON/YAML for external tools
    const documentJson = JSON.stringify(document, null, 2);
    const fs = require('fs');
    const path = require('path');
    const docsDir = path.join(__dirname, '../../docs');

    // Create docs directory if doesn't exist
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    // Write OpenAPI spec to file
    fs.writeFileSync(path.join(docsDir, 'openapi.json'), documentJson);

    console.log('✅ OpenAPI documentation available at: /api/docs');
    console.log('✅ OpenAPI JSON spec exported to: docs/openapi.json');
  }

  /**
   * Common response schemas for reuse
   */
  static getCommonSchemas() {
    return {
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              statusCode: { type: 'number', example: 400 },
              message: { type: 'string', example: 'Validation failed' },
              error: { type: 'string', example: 'BadRequest' },
              timestamp: { type: 'string', format: 'date-time' },
              path: { type: 'string', example: '/api/v1/fir' },
              correlationId: { type: 'string', example: 'err-1730368800000-abc123' },
            },
          },
        },
      },
      PaginatedResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: {} },
          pagination: {
            type: 'object',
            properties: {
              nextCursor: { type: 'string', nullable: true },
              hasMore: { type: 'boolean' },
              total: { type: 'number' },
            },
          },
        },
      },
    };
  }

  /**
   * Common API responses
   */
  static getCommonResponses() {
    return {
      400: {
        description: 'Bad Request - Invalid input',
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
      401: {
        description: 'Unauthorized - Authentication required',
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
      403: {
        description: 'Forbidden - Insufficient permissions',
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
      404: {
        description: 'Not Found - Resource does not exist',
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
      409: {
        description: 'Conflict - Resource already exists',
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
      429: {
        description: 'Too Many Requests - Rate limit exceeded',
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
      500: {
        description: 'Internal Server Error',
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
    };
  }
}

/**
 * Decorator helpers for controllers
 */
export const ApiCommonResponses = () => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    // This would be implemented with @nestjs/swagger decorators
    // Applied to all controller methods
  };
};

/**
 * Example DTO decorators for auto-documentation
 */
export class SwaggerExamples {
  static FIR_CREATE = {
    cerCode: '170904',
    quantity: 5000,
    unit: 'kg',
    wasteDescription: 'Plastica mista da imballaggio',
    producerFacilityId: 'facility-123',
    destinationFacilityId: 'facility-456',
    transportDate: '2025-11-01T08:00:00Z',
    vehicleId: 'vehicle-789',
    driverId: 'driver-101',
  };

  static USER_CREATE = {
    email: 'mario.rossi@example.com',
    firstName: 'Mario',
    lastName: 'Rossi',
    role: 'operator',
    facilityId: 'facility-123',
    permissions: ['fir:read:own', 'fir:create:own'],
  };

  static PERMISSION_REQUEST = {
    permissions: ['fir:export:all', 'report:read:all'],
    startTime: '2025-11-01T09:00:00Z',
    endTime: '2025-11-01T17:00:00Z',
    justification: 'Quarterly audit - need to export all FIRs for compliance report',
  };

  static TASK_ASSIGNMENT = {
    firId: 'fir-123',
    driverId: 'driver-456', // Optional - omit for automatic assignment
    reason: 'Driver has experience with this waste type',
  };
}
