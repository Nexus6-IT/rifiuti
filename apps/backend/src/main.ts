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
import { jsonConLimite } from './core/http/json-con-limite'
import { opzioniSentry } from './core/monitoring/opzioni-sentry'

// Error tracking Bugsink/Sentry — attivo solo se SENTRY_DSN è impostato.
// In assenza della variabile l'SDK è un no-op completo: nessun impatto runtime.
if (process.env.SENTRY_DSN) {
  // Niente tracing e niente dati personali (Decisione 5 della Fase 0): v. opzioni-sentry.ts
  Sentry.init(opzioniSentry(process.env))
}

async function bootstrap() {
  // rawBody: true è necessario per la verifica della firma webhook Stripe.
  // Il raw body è accessibile via req.rawBody (Buffer) nei controller.
  const app = await NestFactory.create(AppModule, { rawBody: true })

  // Il logo di un modello di stampa (4.7) pesa fino a 256 KiB: in base64 sono ~350 KB, oltre il
  // limite di 100 KB del parser JSON di default (413). Il limite piu' alto vale solo su questa
  // rotta, montato PRIMA del parser globale (che salta le richieste gia' lette).
  app.use(`/${process.env.API_PREFIX || 'api/v1'}/modelli-stampa`, jsonConLimite('600kb'))

  // Un lotto di 50 letture dell'agente di pesa puo' arrivare a ~145 KB in base64 (4.8b).
  app.use(`/${process.env.API_PREFIX || 'api/v1'}/agenti-pesa/letture`, jsonConLimite('200kb'))

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
    exposedHeaders: [
      'X-Total-Count',
      'X-Page',
      'X-Page-Size',
      'Content-Disposition',
      'X-Documenti-Saltati',
      'X-Fir-Esclusi',
      'X-Ritiri-Saltati',
    ],
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

  // La spec OpenAPI completa (moduli admin, billing e rentri inclusi) abbassa
  // drasticamente il costo di ricognizione per un attaccante se pubblicata
  // senza autenticazione: in produzione non va esposta né su /api/docs né su
  // /api/docs-json. Riattivabile con SWAGGER_ENABLED=true per diagnosi mirata.
  const swaggerAbilitato =
    process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true'

  if (swaggerAbilitato) {
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
  }

  const port = process.env.PORT || 3000
  await app.listen(port)

  console.log(`🚀 WasteFlow Backend running on http://localhost:${port}`)
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`)
}

bootstrap()
