import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { TemplateService } from '../../infrastructure/email/template.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'
import { calcolaGiorniAllaScadenzaCertificato } from '../../infrastructure/rentri/rentri-certificato-scadenza.util'

/**
 * Deadline Checker Service
 *
 * Scheduled jobs for monitoring compliance deadlines:
 * - MUD report submission deadlines
 * - Register vidimazione deadlines
 * - Authorization expiration dates
 */
@Injectable()
export class DeadlineCheckerService {
  // MUD deadline: April 30th each year
  private readonly MUD_DEADLINE_MONTH = 3 // April (0-indexed)
  private readonly MUD_DEADLINE_DAY = 30

  // Notification intervals (days before deadline)
  private readonly NOTIFICATION_INTERVALS = [30, 15, 7, 3, 1]

  // Finestra di deduplicazione: una notifica dello stesso tipo per la stessa
  // entità non va ripetuta se ne esiste già una creata in questi giorni.
  // Settimanale (non giornaliera) perché uno stato "già scaduto" resta tale
  // ogni giorno finché non viene risolto — un avviso quotidiano identico
  // smetterebbe di essere letto, ottenendo l'effetto opposto a quello voluto.
  private readonly NOTIFICATION_DEDUP_GIORNI = 7

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateService: TemplateService,
    private readonly emailService: EmailService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(DeadlineCheckerService.name)
  }

  /**
   * Check MUD deadlines daily at 8:00 AM
   * Sends reminder notifications at 30, 15, 7, 3, and 1 days before deadline
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkMudDeadlines(): Promise<void> {
    this.logger.info('Starting MUD deadline check')

    try {
      const today = new Date()
      const currentYear = today.getFullYear()
      const previousYear = currentYear - 1

      // Calculate this year's MUD deadline (April 30th)
      const deadline = new Date(currentYear, this.MUD_DEADLINE_MONTH, this.MUD_DEADLINE_DAY)
      const daysUntilDeadline = Math.ceil(
        (deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      )

      // Skip if deadline has passed or too far in future
      if (daysUntilDeadline < 0 || daysUntilDeadline > 30) {
        this.logger.debug(`MUD deadline is ${daysUntilDeadline} days away, skipping notifications`)
        return
      }

      // Check if we should send notifications today
      if (!this.NOTIFICATION_INTERVALS.includes(daysUntilDeadline)) {
        this.logger.debug(`No notification scheduled for ${daysUntilDeadline} days before deadline`)
        return
      }

      this.logger.info(`Sending MUD deadline reminders: ${daysUntilDeadline} days remaining`)

      // Find all active tenants with MUD reports for previous year
      const tenants = await this.prisma.tenant.findMany({
        where: {
          subscriptionStatus: {
            in: ['ACTIVE', 'TRIAL'], // Include active and trial subscriptions
          },
        },
        include: {
          mudReports: {
            where: {
              year: previousYear,
            },
          },
          users: {
            where: {
              role: {
                in: ['ADMIN', 'OPERATOR'], // Only notify admins and operators
              },
            },
          },
        },
      })

      let notificationsSent = 0

      for (const tenant of tenants) {
        // Get or create MUD report for previous year
        let mudReport = tenant.mudReports[0]

        if (!mudReport) {
          this.logger.info(
            `Creating draft MUD report for tenant ${tenant.id}, year ${previousYear}`
          )
          mudReport = await this.prisma.mUDReport.create({
            data: {
              tenantId: tenant.id,
              year: previousYear,
              status: 'DRAFT',
              reportData: {},
            },
          })
        }

        // Determine completion status
        const isComplete = mudReport.status === 'SUBMITTED'
        const reportData = mudReport.reportData as any
        const completionPercentage = this.calculateMudCompletionPercentage(reportData)
        const missingData = this.getMudMissingData(reportData)

        // Send notifications to all admin/operator users
        for (const user of tenant.users) {
          try {
            const html = await this.templateService.renderMudDeadlineReminder({
              recipientName: `${user.firstName} ${user.lastName}`,
              year: currentYear,
              deadline: deadline.toLocaleDateString('it-IT', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
              daysRemaining: daysUntilDeadline,
              companyName: tenant.ragioneSociale,
              referenceYear: previousYear,
              isComplete,
              completionPercentage,
              missingData,
              mudUrl: `${process.env.PUBLIC_URL || 'https://wasteflow.app'}/mud/${mudReport.id}`,
            })

            await this.emailService.sendEmail({
              to: user.email,
              subject: `[WasteFlow] Promemoria Scadenza MUD ${previousYear}`,
              html,
            })

            // Create in-app notification
            await this.prisma.notification.create({
              data: {
                tenantId: tenant.id,
                userId: user.id,
                type: 'MUD_DEADLINE_APPROACHING',
                title: `Promemoria Scadenza MUD ${previousYear}`,
                message: `Mancano ${daysUntilDeadline} giorni alla scadenza del MUD. ${isComplete ? "Il MUD è pronto per l'invio." : `Completamento: ${completionPercentage}%`}`,
                severity: daysUntilDeadline <= 7 ? 'WARNING' : 'INFO',
                actionUrl: `/mud/${mudReport.id}`,
                isRead: false,
              },
            })

            notificationsSent++
            this.logger.debug(`Sent MUD reminder to ${user.email}`)
          } catch (error) {
            this.logger.error(`Failed to send MUD reminder to ${user.email}`, error)
          }
        }
      }

      this.logger.info(`MUD deadline check completed: ${notificationsSent} notifications sent`)
    } catch (error) {
      this.logger.error('Failed to check MUD deadlines', error)
      throw error
    }
  }

  /**
   * Check vidimazione (register validation) deadlines daily at 9:00 AM
   * TODO: Implement when Register entities are added to schema
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkVidimazioneDeadlines(): Promise<void> {
    this.logger.info('Starting vidimazione deadline check')

    try {
      // TODO: Implement when Register models are added
      // - Query registers needing vidimazione
      // - Check deadline (typically 60 days from first use)
      // - Send reminders using templateService.renderVidimazioneReminder()

      this.logger.debug('Vidimazione deadline check not yet implemented (awaiting Register schema)')
    } catch (error) {
      this.logger.error('Failed to check vidimazione deadlines', error)
    }
  }

  /**
   * Controllo giornaliero (10:00) delle scadenze delle autorizzazioni degli
   * impianti, su `AutorizzazioneImpianto.dataScadenza`.
   *
   * Stessa forma di `checkMudDeadlines`: avvisa agli intervalli previsti da
   * `NOTIFICATION_INTERVALS` finché la scadenza è futura; un'autorizzazione
   * già scaduta non deve restare silenziosa, quindi viene segnalata ogni
   * giorno con severità maggiore (ERROR) finché non viene rinnovata.
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async checkAuthorizationExpirations(): Promise<void> {
    this.logger.info('Avvio controllo scadenza autorizzazioni impianto')

    try {
      const oggi = new Date()
      const massimoGiorniAvviso = Math.max(...this.NOTIFICATION_INTERVALS)
      const limite = new Date(oggi)
      limite.setDate(limite.getDate() + massimoGiorniAvviso)

      // Un'autorizzazione già scaduta ha dataScadenza nel passato, quindi
      // rientra comunque nel filtro `lte: limite`.
      const autorizzazioni = await this.prisma.autorizzazioneImpianto.findMany({
        where: {
          dataScadenza: { not: null, lte: limite },
        },
      })

      if (autorizzazioni.length === 0) {
        this.logger.debug('Nessuna autorizzazione impianto in scadenza o scaduta')
        return
      }

      const tenantIds = [...new Set(autorizzazioni.map(a => a.tenantId))]
      const utenti = await this.prisma.user.findMany({
        where: {
          tenantId: { in: tenantIds },
          role: { in: ['ADMIN', 'OPERATOR'] },
        },
        include: { tenant: true },
      })

      let notificationsSent = 0

      for (const autorizzazione of autorizzazioni) {
        const dataScadenza = autorizzazione.dataScadenza as Date
        const giorniAllaScadenza = Math.ceil(
          (dataScadenza.getTime() - oggi.getTime()) / (1000 * 60 * 60 * 24)
        )
        const scaduta = giorniAllaScadenza < 0

        // Finché non è scaduta, avvisare solo agli intervalli previsti,
        // esattamente come per il MUD.
        if (!scaduta && !this.NOTIFICATION_INTERVALS.includes(giorniAllaScadenza)) {
          continue
        }

        // Deduplicazione settimanale: se questa autorizzazione ha già
        // generato una notifica negli ultimi 7 giorni, non se ne crea
        // un'altra identica oggi (vale sia per l'avviso preventivo sia per
        // lo stato "già scaduta").
        const giaNotificata = await this.esisteNotificaRecente(
          autorizzazione.tenantId,
          'AUTORIZZAZIONE_IN_SCADENZA',
          autorizzazione.id,
          'AutorizzazioneImpianto'
        )
        if (giaNotificata) {
          this.logger.debug(
            `Autorizzazione ${autorizzazione.estremi} già notificata negli ultimi ${this.NOTIFICATION_DEDUP_GIORNI} giorni, salto`
          )
          continue
        }

        const dataScadenzaFormattata = dataScadenza.toLocaleDateString('it-IT', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })

        const titolo = scaduta
          ? `Autorizzazione ${autorizzazione.estremi} scaduta`
          : `Promemoria scadenza autorizzazione ${autorizzazione.estremi}`
        const messaggio = scaduta
          ? `L'autorizzazione ${autorizzazione.estremi} è scaduta il ${dataScadenzaFormattata}.`
          : `L'autorizzazione ${autorizzazione.estremi} scadrà fra ${giorniAllaScadenza} giorni, il ${dataScadenzaFormattata}.`

        const destinatari = utenti.filter(u => u.tenantId === autorizzazione.tenantId)

        for (const utente of destinatari) {
          try {
            const html = await this.templateService.renderAuthorizationExpiration({
              recipientName: `${utente.firstName} ${utente.lastName}`,
              authorizationType: 'Autorizzazione impianto',
              authorizationNumber: autorizzazione.estremi,
              expirationDate: dataScadenzaFormattata,
              isExpired: scaduta,
              daysRemaining: scaduta ? undefined : giorniAllaScadenza,
              companyName: utente.tenant?.ragioneSociale ?? '',
              issuingAuthority: '',
              activities: [
                ...(autorizzazione.operazioniRecupero ?? []),
                ...(autorizzazione.operazioniSmaltimento ?? []),
              ],
              authorizationUrl: `${process.env.PUBLIC_URL || 'https://wasteflow.app'}/impianti/autorizzazioni/${autorizzazione.id}`,
            })

            await this.emailService.sendEmail({
              to: utente.email,
              subject: scaduta
                ? '[WasteFlow] URGENTE: Autorizzazione impianto scaduta'
                : '[WasteFlow] Promemoria scadenza autorizzazione impianto',
              html,
            })

            await this.prisma.notification.create({
              data: {
                tenantId: autorizzazione.tenantId,
                userId: utente.id,
                type: 'AUTORIZZAZIONE_IN_SCADENZA',
                title: titolo,
                message: messaggio,
                severity: scaduta ? 'ERROR' : 'WARNING',
                relatedEntityId: autorizzazione.id,
                relatedEntityType: 'AutorizzazioneImpianto',
                actionUrl: `/impianti/autorizzazioni/${autorizzazione.id}`,
                isRead: false,
              },
            })

            notificationsSent++
            this.logger.debug(`Avviso scadenza autorizzazione inviato a ${utente.email}`)
          } catch (error) {
            this.logger.error(
              `Invio avviso scadenza autorizzazione fallito per ${utente.email}`,
              error
            )
          }
        }
      }

      this.logger.info(
        `Controllo scadenza autorizzazioni impianto completato: ${notificationsSent} notifiche inviate`
      )
    } catch (error) {
      this.logger.error('Controllo scadenza autorizzazioni impianto fallito', error)
    }
  }

  /**
   * Controllo giornaliero (11:00) della scadenza del certificato RENTRI per
   * ogni tenant. Senza certificato valido ogni trasmissione all'ente si
   * ferma: è la scadenza più costosa dello scadenzario.
   *
   * Riusa `calcolaGiorniAllaScadenzaCertificato` (stessa logica di lettura
   * del `notAfter` usata dal gauge Prometheus in
   * `RentriCertificatoScadenzaJob`) — non duplica il parsing del certificato.
   */
  @Cron(CronExpression.EVERY_DAY_AT_11AM)
  async checkRentriCertificateExpiration(): Promise<void> {
    this.logger.info('Avvio controllo scadenza certificato RENTRI')

    try {
      const tenantsAttivi = await this.prisma.tenant.findMany({
        where: { subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } },
        select: { id: true },
      })

      const credenziali = await this.prisma.rentriCredential.findMany({
        where: { tenantId: { in: tenantsAttivi.map(t => t.id) } },
        select: { tenantId: true, certificatePem: true },
      })

      let notificationsSent = 0

      for (const credenziale of credenziali) {
        const giorniAllaScadenza = calcolaGiorniAllaScadenzaCertificato(credenziale.certificatePem)

        if (giorniAllaScadenza === null) {
          this.logger.warn(
            'Certificato RENTRI non analizzabile: avviso in applicazione (nessuna email)',
            { tenantId: credenziale.tenantId }
          )

          // Il canale email non esiste per questo caso (nessun template
          // dedicato, decisione presa a monte: non se ne inventa uno qui),
          // ma quello in applicazione sì — un certificato illeggibile non
          // deve restare silenzioso solo perché manca l'email. Stessa
          // deduplicazione settimanale degli altri avvisi.
          const giaNotificatoIllegibile = await this.esisteNotificaRecente(
            credenziale.tenantId,
            'CERTIFICATO_RENTRI_IN_SCADENZA',
            credenziale.tenantId,
            'RentriCredential'
          )
          if (giaNotificatoIllegibile) {
            continue
          }

          const utentiDaAvvisare = await this.prisma.user.findMany({
            where: {
              tenantId: credenziale.tenantId,
              role: { in: ['ADMIN', 'OPERATOR'] },
            },
          })

          for (const utente of utentiDaAvvisare) {
            try {
              await this.prisma.notification.create({
                data: {
                  tenantId: credenziale.tenantId,
                  userId: utente.id,
                  type: 'CERTIFICATO_RENTRI_IN_SCADENZA',
                  title: 'Certificato RENTRI non leggibile',
                  message:
                    "Il certificato RENTRI configurato non è analizzabile: verificare che sia valido e caricato correttamente. Le trasmissioni verso l'ente potrebbero non funzionare finché non viene corretto.",
                  severity: 'ERROR',
                  relatedEntityId: credenziale.tenantId,
                  relatedEntityType: 'RentriCredential',
                  actionUrl: '/rentri/credenziali',
                  isRead: false,
                },
              })

              notificationsSent++
              this.logger.debug(`Avviso certificato RENTRI non leggibile inviato a ${utente.email}`)
            } catch (error) {
              this.logger.error(
                `Creazione avviso certificato RENTRI non leggibile fallita per ${utente.email}`,
                error
              )
            }
          }

          continue
        }

        const scaduto = giorniAllaScadenza < 0

        // Finché non è scaduto, avvisare solo agli intervalli previsti,
        // esattamente come per le autorizzazioni degli impianti.
        if (!scaduto && !this.NOTIFICATION_INTERVALS.includes(giorniAllaScadenza)) {
          continue
        }

        // Deduplicazione settimanale: stesso criterio del Task 1, entità
        // identificata dal tenant (un solo certificato RENTRI per tenant).
        const giaNotificato = await this.esisteNotificaRecente(
          credenziale.tenantId,
          'CERTIFICATO_RENTRI_IN_SCADENZA',
          credenziale.tenantId,
          'RentriCredential'
        )
        if (giaNotificato) {
          this.logger.debug(
            `Certificato RENTRI del tenant ${credenziale.tenantId} già notificato negli ultimi ${this.NOTIFICATION_DEDUP_GIORNI} giorni, salto`
          )
          continue
        }

        const titolo = scaduto
          ? 'Certificato RENTRI scaduto'
          : 'Promemoria scadenza certificato RENTRI'
        const messaggio = scaduto
          ? "Il certificato RENTRI è scaduto: tutte le trasmissioni all'ente sono ferme finché non viene rinnovato."
          : `Il certificato RENTRI scadrà fra ${giorniAllaScadenza} giorni: le trasmissioni all'ente si fermeranno alla scadenza.`

        const utenti = await this.prisma.user.findMany({
          where: {
            tenantId: credenziale.tenantId,
            role: { in: ['ADMIN', 'OPERATOR'] },
          },
        })

        for (const utente of utenti) {
          try {
            await this.prisma.notification.create({
              data: {
                tenantId: credenziale.tenantId,
                userId: utente.id,
                type: 'CERTIFICATO_RENTRI_IN_SCADENZA',
                title: titolo,
                message: messaggio,
                severity: scaduto ? 'ERROR' : 'WARNING',
                relatedEntityId: credenziale.tenantId,
                relatedEntityType: 'RentriCredential',
                actionUrl: '/rentri/credenziali',
                isRead: false,
              },
            })

            notificationsSent++
            this.logger.debug(`Avviso scadenza certificato RENTRI inviato a ${utente.email}`)
          } catch (error) {
            this.logger.error(
              `Creazione avviso scadenza certificato RENTRI fallita per ${utente.email}`,
              error
            )
          }
        }
      }

      this.logger.info(
        `Controllo scadenza certificato RENTRI completato: ${notificationsSent} notifiche inviate`
      )
    } catch (error) {
      this.logger.error('Controllo scadenza certificato RENTRI fallito', error)
    }
  }

  /**
   * Cleanup old read notifications weekly (Sundays at midnight)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOldNotifications(): Promise<void> {
    this.logger.info('Starting notification cleanup')

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      const result = await this.prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: thirtyDaysAgo,
          },
          isRead: true,
        },
      })

      this.logger.info(`Cleaned up ${result.count} old notifications`)
    } catch (error) {
      this.logger.error('Failed to cleanup old notifications', error)
    }
  }

  /**
   * Vero se esiste già, per lo stesso tenant, lo stesso tipo e la stessa
   * entità (`relatedEntityId` + `relatedEntityType`), una notifica creata
   * negli ultimi `NOTIFICATION_DEDUP_GIORNI` giorni. Usata per non ripetere
   * ogni giorno lo stesso avviso di scadenza (autorizzazioni impianto,
   * certificato RENTRI): una notifica settimanale resta letta, una
   * quotidiana identica no.
   *
   * `tenantId` è OBBLIGATORIO nel filtro (regola di isolamento del
   * progetto: ogni query filtra per tenant, il tenant è l'azienda). Senza
   * di esso una notifica di un ALTRO tenant sulla stessa entità
   * sopprimerebbe l'avviso dovuto a questo tenant — non un eccesso di
   * lettura, ma un avviso mancato.
   *
   * Il confronto `createdAt: { gte: sogliaDedup }` include il limite: una
   * notifica creata esattamente `NOTIFICATION_DEDUP_GIORNI` giorni fa conta
   * ancora come "recente" e blocca la creazione di una nuova — la finestra
   * di deduplicazione è quindi di 7 giorni pieni, non di "più di 7 giorni".
   */
  private async esisteNotificaRecente(
    tenantId: string,
    type: 'AUTORIZZAZIONE_IN_SCADENZA' | 'CERTIFICATO_RENTRI_IN_SCADENZA',
    relatedEntityId: string,
    relatedEntityType: string
  ): Promise<boolean> {
    const sogliaDedup = new Date()
    sogliaDedup.setDate(sogliaDedup.getDate() - this.NOTIFICATION_DEDUP_GIORNI)

    const notificaRecente = await this.prisma.notification.findFirst({
      where: {
        tenantId,
        type,
        relatedEntityId,
        relatedEntityType,
        createdAt: { gte: sogliaDedup },
      },
    })

    return notificaRecente !== null
  }

  /**
   * Calculate MUD completion percentage based on reportData
   */
  private calculateMudCompletionPercentage(reportData: any): number {
    if (!reportData || typeof reportData !== 'object') {
      return 0
    }

    const requiredFields = [
      'companyInfo',
      'legalRepresentative',
      'wasteProduced',
      'wasteReceived',
      'wasteTransported',
      'certificates',
    ]

    let completedFields = 0

    for (const field of requiredFields) {
      if (reportData[field] && Object.keys(reportData[field]).length > 0) {
        completedFields++
      }
    }

    return Math.round((completedFields / requiredFields.length) * 100)
  }

  /**
   * Get list of missing data sections for MUD report
   */
  private getMudMissingData(reportData: any): string[] {
    if (!reportData || typeof reportData !== 'object') {
      return [
        'Dati azienda',
        'Rappresentante legale',
        'Rifiuti prodotti',
        'Rifiuti ricevuti',
        'Rifiuti trasportati',
        'Certificati analitici',
      ]
    }

    const missing: string[] = []

    if (!reportData.companyInfo || Object.keys(reportData.companyInfo).length === 0) {
      missing.push('Dati azienda')
    }
    if (
      !reportData.legalRepresentative ||
      Object.keys(reportData.legalRepresentative).length === 0
    ) {
      missing.push('Rappresentante legale')
    }
    if (!reportData.wasteProduced || Object.keys(reportData.wasteProduced).length === 0) {
      missing.push('Rifiuti prodotti')
    }
    if (!reportData.wasteReceived || Object.keys(reportData.wasteReceived).length === 0) {
      missing.push('Rifiuti ricevuti')
    }
    if (!reportData.wasteTransported || Object.keys(reportData.wasteTransported).length === 0) {
      missing.push('Rifiuti trasportati')
    }
    if (!reportData.certificates || Object.keys(reportData.certificates).length === 0) {
      missing.push('Certificati analitici')
    }

    return missing
  }
}
