/**
 * AccessRequestService — gestione delle richieste di accesso (lead capture).
 *
 * Sostituisce il vecchio signup self-service: il form pubblico NON crea più
 * alcun Tenant/utente/utente Keycloak. Qui si limita a:
 *   1. persistere la richiesta (AccessRequest, stato PENDING)
 *   2. notificare l'admin/commerciale (email best-effort, altrimenti solo log)
 *
 * L'attivazione di una prova guidata (TRIAL) resta un'operazione white-glove
 * eseguita dal consulente tramite il provisioning admin (/admin/tenants +
 * /admin/utenti). Nessun piano gratuito è ottenibile in self-service.
 */

import { Injectable } from '@nestjs/common'
import { AccessRequestStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'
import { AccessRequestDto } from '../../api/access-request/dto/access-request.dto'

export interface AccessRequestResult {
  /** Messaggio localizzato da mostrare all'utente. */
  message: string
  /** UUID della richiesta appena registrata. */
  requestId: string
}

@Injectable()
export class AccessRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(AccessRequestService.name)
  }

  /**
   * Registra una richiesta di accesso e notifica l'admin (best-effort).
   * Non crea tenant né utenti: ritorna sempre un messaggio "richiesta ricevuta".
   */
  async submit(dto: AccessRequestDto): Promise<AccessRequestResult> {
    const request = await this.prisma.accessRequest.create({
      data: {
        ragioneSociale: dto.ragioneSociale,
        partitaIva: dto.partitaIva ?? null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone ?? null,
        message: dto.message ?? null,
        status: AccessRequestStatus.PENDING,
      },
    })

    this.logger.info('Nuova richiesta di accesso registrata', {
      requestId: request.id,
      ragioneSociale: dto.ragioneSociale,
      email: dto.email,
    })

    // Notifica best-effort al commerciale/admin. Se SMTP non è configurato
    // l'EmailService logga in console (dev) senza lanciare; in prod un errore
    // di invio non deve compromettere la registrazione della richiesta.
    await this.notifyAdminBestEffort(request)

    return {
      message:
        'Richiesta ricevuta. Un nostro consulente ti contatterà a breve per attivare la prova guidata.',
      requestId: request.id,
    }
  }

  /**
   * Elenca le richieste di accesso (più recenti prima), opzionalmente filtrate
   * per stato. Uso admin (SUPER_ADMIN).
   */
  async list(status?: AccessRequestStatus) {
    const where: Prisma.AccessRequestWhereInput = status ? { status } : {}
    return this.prisma.accessRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Aggiorna lo stato di lavorazione di una richiesta (e opzionalmente una nota
   * interna). Uso admin (SUPER_ADMIN) per tracciare l'esito del contatto.
   */
  async updateStatus(id: string, status: AccessRequestStatus, handledNote?: string) {
    return this.prisma.accessRequest.update({
      where: { id },
      data: { status, ...(handledNote !== undefined ? { handledNote } : {}) },
    })
  }

  // ── Helper privati ────────────────────────────────────────────────────────

  private async notifyAdminBestEffort(request: {
    id: string
    ragioneSociale: string
    partitaIva: string | null
    firstName: string
    lastName: string
    email: string
    phone: string | null
    message: string | null
  }): Promise<void> {
    const to = process.env.ACCESS_REQUEST_NOTIFY_EMAIL || process.env.EMAIL_FROM || ''
    if (!to) {
      this.logger.warn(
        'Nessun destinatario per la notifica richiesta accesso (ACCESS_REQUEST_NOTIFY_EMAIL/EMAIL_FROM non impostati): notifica saltata',
        { requestId: request.id }
      )
      return
    }

    const rows: string[] = [
      `<li><strong>Azienda:</strong> ${request.ragioneSociale}</li>`,
      request.partitaIva ? `<li><strong>P.IVA:</strong> ${request.partitaIva}</li>` : '',
      `<li><strong>Contatto:</strong> ${request.firstName} ${request.lastName}</li>`,
      `<li><strong>Email:</strong> ${request.email}</li>`,
      request.phone ? `<li><strong>Telefono:</strong> ${request.phone}</li>` : '',
      request.message ? `<li><strong>Messaggio:</strong> ${request.message}</li>` : '',
    ].filter(Boolean)

    const html = `
      <h2>Nuova richiesta di accesso a WasteFlow</h2>
      <p>È arrivata una richiesta di prova guidata dal form pubblico.</p>
      <ul>${rows.join('')}</ul>
      <p>Lavora la richiesta dalla sezione Amministrazione &rarr; Richieste di accesso.</p>
    `
    const text =
      `Nuova richiesta di accesso a WasteFlow\n\n` +
      `Azienda: ${request.ragioneSociale}\n` +
      (request.partitaIva ? `P.IVA: ${request.partitaIva}\n` : '') +
      `Contatto: ${request.firstName} ${request.lastName}\n` +
      `Email: ${request.email}\n` +
      (request.phone ? `Telefono: ${request.phone}\n` : '') +
      (request.message ? `Messaggio: ${request.message}\n` : '')

    try {
      await this.email.sendEmail({
        to,
        subject: `[WasteFlow] Nuova richiesta di accesso: ${request.ragioneSociale}`,
        html,
        text,
      })
    } catch (error) {
      // Non blocca: la richiesta è già persistita e visibile in admin.
      this.logger.warn(
        'Invio notifica richiesta accesso fallito (best-effort). La richiesta resta comunque registrata.',
        { requestId: request.id, error: (error as Error)?.message }
      )
    }
  }
}
