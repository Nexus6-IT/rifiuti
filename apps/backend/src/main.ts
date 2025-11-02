/**
 * WasteFlow Backend - NestJS Main Entry Point
 * MVP Application Bootstrap
 */

import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'

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
        callback(new Error('Not allowed by CORS'))
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Correlation-ID'],
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Page-Size'],
    maxAge: 3600, // Cache preflight requests for 1 hour
  })

  // API prefix
  app.setGlobalPrefix(process.env.API_PREFIX || 'api/v1')

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
