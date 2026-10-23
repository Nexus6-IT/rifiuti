import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import * as Handlebars from 'handlebars'
import * as fs from 'fs/promises'
import * as path from 'path'

/**
 * Template Service
 *
 * Handles email template rendering with Handlebars.
 * Supports base layout and partial templates.
 */
@Injectable()
export class TemplateService {
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map()
  private baseTemplate: HandlebarsTemplateDelegate | null = null
  private readonly templatesDir: string

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(TemplateService.name)
    this.templatesDir = path.join(__dirname, 'templates')
    this.initializeTemplates()
  }

  /**
   * Initialize templates - load base template
   */
  private async initializeTemplates() {
    try {
      const basePath = path.join(this.templatesDir, 'base.hbs')
      const baseContent = await fs.readFile(basePath, 'utf-8')
      this.baseTemplate = Handlebars.compile(baseContent)
      this.logger.info('Email templates initialized')
    } catch (error) {
      this.logger.error('Failed to initialize email templates', error)
    }
  }

  /**
   * Render template with data
   */
  async render(templateName: string, data: Record<string, any>): Promise<string> {
    try {
      // Get or compile template
      let template = this.templateCache.get(templateName)

      if (!template) {
        const templatePath = path.join(this.templatesDir, `${templateName}.hbs`)
        const templateContent = await fs.readFile(templatePath, 'utf-8')
        template = Handlebars.compile(templateContent)
        this.templateCache.set(templateName, template)
      }

      // Render content with template
      const content = template({
        ...data,
        year: new Date().getFullYear(),
      })

      // Wrap in base template if available
      if (this.baseTemplate) {
        return this.baseTemplate({
          content,
          subject: data.subject || templateName,
          year: new Date().getFullYear(),
        })
      }

      return content
    } catch (error) {
      this.logger.error(`Failed to render template: ${templateName}`, error)
      throw new Error(`Template rendering failed: ${templateName}`)
    }
  }

  /**
   * Render MUD deadline reminder
   */
  async renderMudDeadlineReminder(data: {
    recipientName: string
    year: number
    deadline: string
    daysRemaining: number
    companyName: string
    referenceYear: number
    mudUrl: string
  }): Promise<string> {
    return this.render('mud-deadline-reminder', {
      subject: 'Promemoria Scadenza MUD',
      ...data,
    })
  }

  /**
   * Render vidimazione reminder
   */
  async renderVidimazioneReminder(data: {
    recipientName: string
    year: number
    deadline: string
    daysRemaining: number
    companyName: string
    registerTypes: string
    registers: Array<{
      name: string
      pages?: number
      lastEntry?: string
    }>
    registersUrl: string
  }): Promise<string> {
    return this.render('vidimazione-reminder', {
      subject: 'Promemoria Vidimazione Registri',
      ...data,
    })
  }

  /**
   * Render authorization expiration notice
   */
  async renderAuthorizationExpiration(data: {
    recipientName: string
    authorizationType: string
    authorizationNumber: string
    expirationDate: string
    isExpired: boolean
    daysRemaining?: number
    companyName: string
    issuingAuthority: string
    activities: string[]
    // Facoltativo (correzione di revisione, rilievo critico dello
    // scadenzario): non tutte le entità con scadenza hanno una pagina di
    // dettaglio nel frontend (le autorizzazioni impianto, ad oggi, non ce
    // l'hanno). Quando manca, il template non deve inventare un link morto:
    // omette del tutto il pulsante "Visualizza Autorizzazione".
    authorizationUrl?: string
    isProroga?: boolean
    contactInfo?: {
      name: string
      phone?: string
      email?: string
      website?: string
    }
  }): Promise<string> {
    return this.render('authorization-expiration', {
      subject: data.isExpired
        ? 'URGENTE: Autorizzazione Scaduta'
        : 'Promemoria: Scadenza Autorizzazione',
      ...data,
    })
  }

  /**
   * Render counterparty (trasportatore/destinatario) expiration notice.
   *
   * Modello DEDICATO, distinto da `renderAuthorizationExpiration`
   * (correzione di revisione, rilievo critico): quel modello parla in prima
   * persona di "autorizzazione della tua azienda" ed è corretto per le
   * autorizzazioni impianto (caso proprio), ma FALSO quando l'entità in
   * scadenza è un trasportatore o un destinatario in rubrica — soggetti
   * TERZI, non l'azienda del destinatario dell'email. Questo modello dice
   * la verità: è scaduta l'anagrafica di una controparte, il rischio per chi
   * legge è affidarle un formulario non conforme, non un reato proprio.
   */
  async renderCounterpartyExpiration(data: {
    recipientName: string
    counterpartyKind: 'trasportatore' | 'destinatario'
    // Facoltativo: se l'anagrafica non ha ragione sociale valorizzata, il
    // template omette del tutto la riga invece di lasciarla in bianco.
    counterpartyName?: string
    // Etichetta del dato che scade ("Iscrizione Albo Gestori Ambientali" /
    // "Autorizzazione destinatario"), mostrata come label nel dettaglio.
    tipoDato: string
    identificativo: string
    expirationDate: string
    isExpired: boolean
    daysRemaining?: number
    // Sempre valorizzato: assoluto quando chiama da un'email (unico canale
    // che ne ha bisogno), relativo per la notifica in applicazione — la
    // distinzione è responsabilità del chiamante, non di questo metodo.
    counterpartyUrl: string
  }): Promise<string> {
    return this.render('counterparty-expiration', {
      subject: data.isExpired
        ? 'Attenzione: anagrafica controparte scaduta'
        : 'Promemoria: anagrafica controparte in scadenza',
      ...data,
      isTrasportatore: data.counterpartyKind === 'trasportatore',
      isDestinatario: data.counterpartyKind === 'destinatario',
    })
  }

  /**
   * Clear template cache (useful for development)
   */
  clearCache() {
    this.templateCache.clear()
    this.logger.info('Template cache cleared')
  }
}
