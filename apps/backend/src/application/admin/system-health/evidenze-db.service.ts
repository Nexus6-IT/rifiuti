import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { ChiaveEvidenza, LettoreEvidenze } from './probes/job-schedulati.probe'
import { MisuraFreschezza } from './probes/freschezza.probe'
import { StatoCredenziale } from './probes/credenziali.probe'
import { calcolaGiorniAllaScadenzaCertificato } from '../../../infrastructure/rentri/rentri-certificato-scadenza.util'

/**
 * Le letture in banca dati che alimentano la pagina «Stato del sistema».
 *
 * USA IL CLIENT BASE, NON `prisma.db`: la vista RLS inietta il tenant del
 * chiamante, e questa pagina misura la PIATTAFORMA, non un'azienda — un
 * conteggio filtrato per tenant risponderebbe a una domanda diversa da
 * quella posta. E' anche il motivo per cui la pagina e' riservata al
 * SUPER_ADMIN (v. controller): mostrare dati di sistema a un ADMIN di
 * tenant sarebbe una fuga di informazioni fra aziende.
 *
 * Ogni lettura e' un aggregato (`_max`/`findFirst` su indice): nessuna
 * scansione di tabella, nessun carico apprezzabile ad ogni apertura della
 * pagina — che comunque risponde da cache per la maggior parte delle volte.
 */
@Injectable()
export class EvidenzeDbService implements LettoreEvidenze {
  constructor(private readonly prisma: PrismaService) {}

  async ultimoEffetto(chiave: ChiaveEvidenza): Promise<Date | null> {
    switch (chiave) {
      case 'riconciliazione-rentri': {
        const riga = await this.prisma.rENTRISyncLog.findFirst({
          where: { origine: 'RICONCILIAZIONE' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
        return riga?.createdAt ?? null
      }
      case 'codifiche-rentri': {
        const aggregato = await this.prisma.rentriCodificaSemplice.aggregate({
          _max: { updatedAt: true },
        })
        return aggregato._max.updatedAt ?? null
      }
      case 'dati-riferimento': {
        const aggregato = await this.prisma.cERCode.aggregate({ _max: { updatedAt: true } })
        return aggregato._max.updatedAt ?? null
      }
      case 'notifiche': {
        const aggregato = await this.prisma.notification.aggregate({ _max: { createdAt: true } })
        return aggregato._max.createdAt ?? null
      }
    }
  }

  /**
   * Misure di freschezza. Solo il backup ha una cadenza attesa, e viene letta
   * dalla pianificazione attiva invece di essere scritta a mano qui: se
   * qualcuno cambia la frequenza dei backup, la soglia della pagina cambia
   * con lei — altrimenti la pagina allarmerebbe (o tacerebbe) sulla base di
   * un numero che nessuno ha piu' aggiornato.
   */
  async freschezza(): Promise<MisuraFreschezza[]> {
    const [ultimoFir, ultimaTrasmissione, ultimaAttivita, backup] = await Promise.all([
      this.prisma.fIR.aggregate({ _max: { createdAt: true } }),
      this.prisma.rENTRISyncLog.findFirst({
        where: { status: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.activityLog.aggregate({ _max: { createdAt: true } }),
      this.misuraBackup(),
    ])

    return [
      {
        key: 'ultimo-fir',
        label: 'Ultimo formulario emesso',
        ultimo: ultimoFir._max.createdAt ?? null,
        descrizioneEvento: 'ultimo formulario emesso',
      },
      {
        key: 'ultima-trasmissione-rentri',
        label: 'Ultima trasmissione RENTRI riuscita',
        ultimo: ultimaTrasmissione?.createdAt ?? null,
        descrizioneEvento: 'ultima trasmissione riuscita',
      },
      {
        key: 'ultima-attivita',
        label: "Ultima attivita' registrata",
        ultimo: ultimaAttivita._max.createdAt ?? null,
        descrizioneEvento: "ultima attivita' registrata",
      },
      backup,
    ]
  }

  /**
   * Credenziali RENTRI delle sole aziende ATTIVE/TRIAL — stesso insieme che
   * il job giornaliero di scadenza considera (`RentriCertificatoScadenzaJob`):
   * allarmare sul certificato scaduto di un'azienda cessata sarebbe rumore.
   *
   * Legge il solo `certificatePem` (dato pubblico del certificato): la chiave
   * privata cifrata non viene nemmeno caricata in memoria per fare questo
   * conto.
   */
  async credenziali(): Promise<StatoCredenziale[]> {
    const tenantAttivi = await this.prisma.tenant.findMany({
      where: { subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } },
      select: { id: true },
    })

    const credenziali = await this.prisma.rentriCredential.findMany({
      where: { tenantId: { in: tenantAttivi.map(t => t.id) } },
      select: { tenantId: true, certificatePem: true },
    })

    return credenziali.map(credenziale => {
      const giorni = calcolaGiorniAllaScadenzaCertificato(credenziale.certificatePem)
      return {
        key: credenziale.tenantId,
        label: 'Certificato RENTRI',
        giorniAllaScadenza: giorni,
        scadenzaAl: giorni === null ? null : new Date(Date.now() + giorni * 86_400_000),
        presente: true,
      }
    })
  }

  /** Verifica di raggiungibilita' della banca dati: contatto reale, non config. */
  async verificaConnessione(): Promise<string> {
    await this.prisma.$queryRaw`SELECT 1`
    return 'query SELECT 1 eseguita'
  }

  private async misuraBackup(): Promise<MisuraFreschezza> {
    const pianificazione = await this.prisma.backupSchedule.findFirst({
      where: { isActive: true },
      orderBy: { nextRunAt: 'asc' },
      select: { frequency: true },
    })

    const base = {
      key: 'ultimo-backup',
      label: 'Ultimo backup riuscito',
      descrizioneEvento: 'ultimo backup riuscito',
    }

    if (!pianificazione) {
      return {
        ...base,
        ultimo: null,
        spenta: {
          motivo:
            'Nessuna pianificazione di backup attiva: nulla da rispettare, nulla da misurare.',
        },
      }
    }

    const ultimo = await this.prisma.backupHistory.findFirst({
      where: { status: 'SUCCESS' },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    })

    return {
      ...base,
      ultimo: ultimo?.completedAt ?? null,
      cadenzaAttesaMs: CADENZA_BACKUP_MS[pianificazione.frequency],
    }
  }
}

/** Cadenza attesa per frequenza dichiarata nella pianificazione di backup. */
const CADENZA_BACKUP_MS: Record<string, number> = {
  HOURLY: 3_600_000,
  DAILY: 24 * 3_600_000,
  WEEKLY: 7 * 24 * 3_600_000,
  MONTHLY: 31 * 24 * 3_600_000,
}
