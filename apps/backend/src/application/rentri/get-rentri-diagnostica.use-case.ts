import { Injectable } from '@nestjs/common'
import { X509Certificate } from 'node:crypto'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import {
  RentriRateLimiterService,
  StatoLimitatoreRentri,
} from '../../infrastructure/rentri/rentri-rate-limiter.service'

/**
 * Get Rentri Diagnostica — Use Case (R5 Task 3).
 *
 * VINCOLO CHE DECIDE QUESTO USE CASE: nessuna dipendenza qui interroga
 * RENTRI. Tutto ciò che viene restituito viene da dati GIÀ raccolti da altri
 * processi:
 * - il certificato viene letto da `RentriCredentialService` (già salvato,
 *   parsing X.509 locale del campo `notAfter` — nessuna chiamata all'ente
 *   per sapere quando scade la propria credenziale);
 * - le trasmissioni recenti vengono da `RENTRISyncLog` (già scritto da
 *   `SyncFIRToRENTRIUseCase`/dai job di trasmissione, R0/R1);
 * - i formulari che richiedono attenzione vengono da una query locale sui
 *   FIR del tenant (`rentriSyncStatus`/`rentriNumeroFirProposto`);
 * - lo stato del limitatore viene da `RentriRateLimiterService.statoAttuale`,
 *   che legge Redis (infrastruttura locale) senza mai contattare RENTRI.
 *
 * Questo use case NON riceve né importa `RENTRIApiClient` — non per
 * disciplina del chiamante, ma perché la dipendenza semplicemente non serve
 * a nessuno dei quattro dati mostrati. Il test di controller/use-case (R5
 * Task 3, Step 4 del piano) verifica proprio questo: un'implementazione
 * futura che aggiungesse "giusto una letturina" verso l'ente romperebbe il
 * vincolo, ed è quello che il test cattura.
 */

/** Soglie di avviso sulla scadenza del certificato, in giorni.
 *
 * IDENTICHE (non solo "simili") a quelle già usate da
 * `DeadlineCheckerService.NOTIFICATION_INTERVALS` per il MUD — quel servizio
 * usa [30, 15, 7, 3, 1]: qui si riprende il sottoinsieme [30, 15, 7], senza
 * i due avvisi più ravvicinati (3/1 giorni), perché quelli hanno senso per
 * una scadenza annuale FISSA e nota con largo anticipo (30 aprile): un
 * certificato la cui scadenza sfugge fino a 3 giorni prima segnala già un
 * problema di processo che un avviso più fitto non risolverebbe. Un avviso
 * in UI con soglie diverse da quelle degli allarmi (Task 5 dello stesso
 * piano, stessa fonte) confonderebbe l'utente — da qui l'obbligo di
 * riutilizzare esattamente questi numeri, non re-inventarli.
 */
export const RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI = {
  AVVISO_30: 30,
  AVVISO_15: 15,
  AVVISO_7: 7,
} as const

/** Quante trasmissioni recenti mostrare: una diagnostica, non un archivio
 * completo — l'archivio (se serve) resta interrogabile altrove (dettaglio
 * FIR, R1 Task 4). 10 è sufficiente per capire "sta funzionando adesso?". */
export const RENTRI_DIAGNOSTICA_TRASMISSIONI_LIMITE = 10

export type LivelloAvvisoCertificato = 'ok' | 'avviso_30' | 'avviso_15' | 'avviso_7' | 'scaduto'

export interface DiagnosticaCertificato {
  configurato: boolean
  /** ISO 8601, o null se non configurato / non analizzabile. */
  scadenza: string | null
  giorniAllaScadenza: number | null
  livelloAvviso: LivelloAvvisoCertificato
}

export interface DiagnosticaTrasmissione {
  id: string
  firId: string
  firNumber: string | null
  status: string
  attempt: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

export type MotivoAttenzioneFormulario = 'PERMANENTLY_FAILED' | 'ATTESA_CONFERMA_LEGAME'

export interface FormularioAttenzione {
  firId: string
  firNumber: string | null
  motivo: MotivoAttenzioneFormulario
  dettaglio: string
}

export interface RentriDiagnostica {
  certificato: DiagnosticaCertificato
  trasmissioniRecenti: DiagnosticaTrasmissione[]
  formulariAttenzione: FormularioAttenzione[]
  limitatore: StatoLimitatoreRentri
}

@Injectable()
export class GetRentriDiagnosticaUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: RentriCredentialService,
    private readonly rateLimiter: RentriRateLimiterService
  ) {}

  async execute(tenantId: string): Promise<RentriDiagnostica> {
    const [certificato, trasmissioniRecenti, formulariAttenzione, limitatore] = await Promise.all([
      this.leggiCertificato(tenantId),
      this.leggiTrasmissioniRecenti(tenantId),
      this.leggiFormulariAttenzione(tenantId),
      this.rateLimiter.statoAttuale(tenantId),
    ])

    return { certificato, trasmissioniRecenti, formulariAttenzione, limitatore }
  }

  private async leggiCertificato(tenantId: string): Promise<DiagnosticaCertificato> {
    const credenziale = await this.credentialService.getForTenant(tenantId)
    if (!credenziale) {
      return { configurato: false, scadenza: null, giorniAllaScadenza: null, livelloAvviso: 'ok' }
    }

    let scadenza: Date
    try {
      // Parsing locale del certificato X.509 GIÀ salvato — `notAfter` non
      // richiede alcuna chiamata a RENTRI, è un campo del PEM che il tenant
      // ha caricato al momento della configurazione della credenziale.
      const certificato = new X509Certificate(credenziale.certificatePem)
      scadenza = new Date(certificato.validTo)
    } catch {
      // Non dovrebbe accadere: il PEM è già stato validato al salvataggio
      // (`RentriCredentialService.upsertForTenant`). Un certificato non
      // analizzabile non deve però far fallire l'intera diagnostica.
      return { configurato: true, scadenza: null, giorniAllaScadenza: null, livelloAvviso: 'ok' }
    }

    const giorniAllaScadenza = Math.floor((scadenza.getTime() - Date.now()) / (24 * 60 * 60 * 1000))

    return {
      configurato: true,
      scadenza: scadenza.toISOString(),
      giorniAllaScadenza,
      livelloAvviso: this.calcolaLivelloAvviso(giorniAllaScadenza),
    }
  }

  private calcolaLivelloAvviso(giorniAllaScadenza: number): LivelloAvvisoCertificato {
    if (giorniAllaScadenza < 0) return 'scaduto'
    if (giorniAllaScadenza <= RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_7) return 'avviso_7'
    if (giorniAllaScadenza <= RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_15) return 'avviso_15'
    if (giorniAllaScadenza <= RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_30) return 'avviso_30'
    return 'ok'
  }

  private async leggiTrasmissioniRecenti(tenantId: string): Promise<DiagnosticaTrasmissione[]> {
    const logs = await this.prisma.rENTRISyncLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: RENTRI_DIAGNOSTICA_TRASMISSIONI_LIMITE,
      include: { fir: { select: { firNumber: true } } },
    })

    return logs.map((log: (typeof logs)[number]) => ({
      id: log.id,
      firId: log.firId,
      firNumber: log.fir?.firNumber ?? null,
      status: log.status,
      attempt: log.attempt,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      createdAt: log.createdAt.toISOString(),
    }))
  }

  private async leggiFormulariAttenzione(tenantId: string): Promise<FormularioAttenzione[]> {
    // Due query LOCALI distinte, mai un'interrogazione a RENTRI: i FIR falliti
    // in modo permanente (nessun ulteriore tentativo automatico, R1) e quelli
    // in attesa di conferma dell'aggancio proposto in modalità IBRIDA
    // (rentriNumeroFirProposto valorizzato, rentriNumeroFir ancora null).
    const [permanentementeFalliti, attesaConfermaLegame] = await Promise.all([
      this.prisma.fIR.findMany({
        where: { tenantId, rentriSyncStatus: 'PERMANENTLY_FAILED' },
        select: { id: true, firNumber: true, rentriLastSyncError: true },
      }),
      this.prisma.fIR.findMany({
        where: { tenantId, rentriNumeroFirProposto: { not: null } },
        select: { id: true, firNumber: true, rentriNumeroFirProposto: true },
      }),
    ])

    const risultato: FormularioAttenzione[] = []

    for (const fir of permanentementeFalliti) {
      risultato.push({
        firId: fir.id,
        firNumber: fir.firNumber,
        motivo: 'PERMANENTLY_FAILED',
        dettaglio:
          fir.rentriLastSyncError ??
          'La sincronizzazione con RENTRI è fallita in modo permanente: nessun nuovo tentativo automatico.',
      })
    }

    for (const fir of attesaConfermaLegame) {
      risultato.push({
        firId: fir.id,
        firNumber: fir.firNumber,
        motivo: 'ATTESA_CONFERMA_LEGAME',
        dettaglio: `RENTRI ha proposto il numero formulario ${fir.rentriNumeroFirProposto}: in attesa che un operatore confermi l'aggancio.`,
      })
    }

    return risultato
  }
}
