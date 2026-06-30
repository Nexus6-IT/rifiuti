import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import * as nodemailer from 'nodemailer'
import { Transporter } from 'nodemailer'

/**
 * Email Service
 *
 * Sends email notifications using Nodemailer.
 * Supports templates and HTML formatting.
 *
 * In production: Configure SMTP server (SendGrid, AWS SES, etc.)
 * For development: Uses console logging
 */
@Injectable()
export class EmailService {
  private transporter: Transporter
  private isDevelopment: boolean

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(EmailService.name)
    this.isDevelopment = process.env.NODE_ENV !== 'production'
    this.initializeTransporter()
  }

  /**
   * Initialize email transporter
   */
  private async initializeTransporter() {
    if (this.isDevelopment) {
      // Use ethereal for development testing
      this.logger.info('Email service running in DEVELOPMENT mode (console logging)')
      return
    }

    const smtpConfig = {
      host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || 'apikey',
        pass: process.env.SMTP_PASSWORD || '',
      },
    }

    this.transporter = nodemailer.createTransport(smtpConfig)

    // Verify connection
    try {
      await this.transporter.verify()
      this.logger.info('SMTP server ready to send emails')
    } catch (error) {
      this.logger.error('SMTP connection failed', error)
    }
  }

  /**
   * Send email
   */
  async sendEmail(params: {
    to: string
    subject: string
    html: string
    text?: string
  }): Promise<void> {
    this.logger.info(`Sending email to ${params.to}: ${params.subject}`)

    try {
      if (this.isDevelopment) {
        // For development: log email to console
        this.logger.debug(`
=== EMAIL (Development Mode) ===
To: ${params.to}
Subject: ${params.subject}
---
${params.text || params.html}
================================
        `)
        return
      }

      // Production: send real email
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@wasteflow.it',
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }

      const info = await this.transporter.sendMail(mailOptions)
      this.logger.info(`Email sent successfully to ${params.to} - MessageID: ${info.messageId}`)
    } catch (error) {
      this.logger.error(`Failed to send email to ${params.to}`, error)
      throw error
    }
  }

  /**
   * Send FIR signature required notification
   */
  async sendFIRSignatureRequired(params: {
    to: string
    recipientName: string
    firNumber: string
    role: 'PRODUCER' | 'CARRIER' | 'RECEIVER'
    actionUrl: string
  }): Promise<void> {
    const roleLabel = {
      PRODUCER: 'Produttore',
      CARRIER: 'Trasportatore',
      RECEIVER: 'Destinatario',
    }[params.role]

    const html = `
      <h2>Firma Digitale Richiesta - FIR ${params.firNumber}</h2>
      <p>Gentile ${params.recipientName},</p>
      <p>È richiesta la tua firma digitale come <strong>${roleLabel}</strong> per il FIR <strong>${params.firNumber}</strong>.</p>
      <p>
        <a href="${params.actionUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Firma Ora
        </a>
      </p>
      <p>Ricorda: è richiesta autenticazione SPID Level 2+ per firmare documenti.</p>
      <hr>
      <p style="font-size: 12px; color: #666;">
        Questa email è stata inviata automaticamente dal sistema WasteFlow.<br>
        Per supporto: support@wasteflow.it
      </p>
    `

    const text = `
Firma Digitale Richiesta - FIR ${params.firNumber}

Gentile ${params.recipientName},

È richiesta la tua firma digitale come ${roleLabel} per il FIR ${params.firNumber}.

Accedi al sistema per firmare: ${params.actionUrl}

Ricorda: è richiesta autenticazione SPID Level 2+ per firmare documenti.
    `

    await this.sendEmail({
      to: params.to,
      subject: `[WasteFlow] Firma richiesta: FIR ${params.firNumber}`,
      html,
      text,
    })
  }

  /**
   * Send FIR completed notification
   */
  async sendFIRCompleted(params: {
    to: string
    recipientName: string
    firNumber: string
  }): Promise<void> {
    const html = `
      <h2>FIR Completato - ${params.firNumber}</h2>
      <p>Gentile ${params.recipientName},</p>
      <p>Il FIR <strong>${params.firNumber}</strong> è stato completato con tutte le firme digitali.</p>
      <p>Il documento è ora immutabile e verrà sincronizzato automaticamente con RENTRI.</p>
      <p>✅ Firma Produttore</p>
      <p>✅ Firma Trasportatore</p>
      <p>✅ Firma Destinatario</p>
    `

    await this.sendEmail({
      to: params.to,
      subject: `[WasteFlow] FIR completato: ${params.firNumber}`,
      html,
    })
  }

  /**
   * Send RENTRI sync failed notification
   */
  async sendRENTRISyncFailed(params: {
    to: string
    recipientName: string
    firNumber: string
    error: string
  }): Promise<void> {
    const html = `
      <h2>⚠️ Errore Sincronizzazione RENTRI</h2>
      <p>Gentile ${params.recipientName},</p>
      <p>La sincronizzazione del FIR <strong>${params.firNumber}</strong> con RENTRI è fallita.</p>
      <p><strong>Errore:</strong> ${params.error}</p>
      <p>Il sistema riproverà automaticamente. Se il problema persiste, contatta il supporto.</p>
    `

    await this.sendEmail({
      to: params.to,
      subject: `[WasteFlow] ⚠️ Errore RENTRI: ${params.firNumber}`,
      html,
    })
  }

  /**
   * Send compliance alert
   */
  async sendComplianceAlert(params: {
    to: string
    recipientName: string
    message: string
    severity: 'WARNING' | 'CRITICAL'
  }): Promise<void> {
    const emoji = params.severity === 'CRITICAL' ? '🚨' : '⚠️'

    const html = `
      <h2>${emoji} Allerta Conformità</h2>
      <p>Gentile ${params.recipientName},</p>
      <p>${params.message}</p>
      <p><strong>Livello:</strong> ${params.severity}</p>
      <p>Si prega di verificare e risolvere la situazione al più presto.</p>
    `

    await this.sendEmail({
      to: params.to,
      subject: `[WasteFlow] ${emoji} Allerta Conformità`,
      html,
    })
  }
}
