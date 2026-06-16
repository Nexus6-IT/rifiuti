/**
 * Keycloak Module
 *
 * Registra il `KeycloakUserAdapter` (provisioning utenti via Admin REST).
 * L'adapter dipende da:
 *  - `HttpService` (@nestjs/axios) per le chiamate REST all'Admin API
 *  - `ConfigService` per leggere KEYCLOAK_URL/REALM/CLIENT_ID/CLIENT_SECRET
 *  - `LoggerService` (fornito globalmente da LoggerModule)
 *
 * Esporta l'adapter così che gli altri moduli (es. AdminUserModule) possano
 * iniettarlo.
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from '../../core/logger/logger.module';
import { KeycloakUserAdapter } from './keycloak-user.adapter';

@Module({
  imports: [HttpModule, ConfigModule, LoggerModule],
  providers: [KeycloakUserAdapter],
  exports: [KeycloakUserAdapter],
})
export class KeycloakModule {}
