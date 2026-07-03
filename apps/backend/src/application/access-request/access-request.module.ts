/**
 * AccessRequestModule — richieste di accesso (lead capture) che sostituiscono
 * il vecchio signup self-service.
 *
 * Espone:
 *  - controller pubblico  POST /auth/access-request  (persiste + notifica)
 *  - controller admin     GET/PATCH /admin/access-requests  (SUPER_ADMIN)
 *
 * Dipendenze:
 *  - PrismaModule → accesso DB (AccessRequest)
 *  - AuthModule   → JwtAuthGuard + RolesGuard per il controller admin
 *  - LoggerModule → logging strutturato (già globale)
 *  - EmailService → notifica best-effort al commerciale (SMTP o log in dev)
 */

import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { AuthModule } from '../../auth/auth.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { EmailService } from '../../infrastructure/email/email.service'
import { AccessRequestService } from './access-request.service'
import { AccessRequestController } from '../../api/access-request/access-request.controller'
import { AccessRequestAdminController } from '../../api/admin/access-request-admin.controller'

@Module({
  imports: [PrismaModule, AuthModule, LoggerModule],
  controllers: [AccessRequestController, AccessRequestAdminController],
  providers: [AccessRequestService, EmailService],
  exports: [AccessRequestService],
})
export class AccessRequestModule {}
