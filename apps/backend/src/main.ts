/**
 * WasteFlow Backend - NestJS Main Entry Point
 * MVP Application Bootstrap
 */

import * as Sentry from '@sentry/node'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'

// Error tracking Bugsink/Sentry — attivo solo se SENTRY_DSN è impostato.
// In assenza della variabile l'SDK è un no-op completo: nessun impatto runtime.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION,
    // Campionamento 100% in produzione (Bugsink self-hosted: nessun costo)
    tracesSampleRate: 1.0,
  })
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // Security: Helmet.js - Set various HTTP headers for security (T256)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow embedding for Swagger UI
    })
  )

  // Global validation pipe (class-validator)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip non-whitelisted properties
      forbidNonWhitelisted: true,
      transform: true,
    })
  )

  // Security: CORS configuration for production (T255)
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3001', 'http://localhost:4200']

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true)

      if (allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        // NON lanciare: un throw qui diventa un 500 e rompe le navigazioni
        // cross-site legittime (es. il POST del callback SAML da Keycloak, che
        // puo' arrivare con Origin: null). Per origini non in allowlist si
        // risponde senza header CORS: le XHR cross-origin restano bloccate dal
        // browser (sicurezza preservata), ma le navigazioni proseguono.
        callback(null, false)
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Correlation-ID'],
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Page-Size'],
    maxAge: 3600, // Cache preflight requests for 1 hour
  })

  // API prefix — /metrics è escluso: Prometheus scraper accede direttamente
  app.setGlobalPrefix(process.env.API_PREFIX || 'api/v1', {
    exclude: ['metrics'],
  })

  // Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('WasteFlow API')
    .setDescription('API per gestione digitale rifiuti - Integrazione RENTRI')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Autenticazione SPID/CIE')
    .addTag('fir', 'Formulario Identificazione Rifiuti')
    .addTag('registry', 'Registri Carico/Scarico')
    .addTag('cer', 'Catalogo Codici CER')
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)

  const port = process.env.PORT || 3000
  await app.listen(port)

  console.log(`🚀 WasteFlow Backend running on http://localhost:${port}`)
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`)
}

bootstrap()
