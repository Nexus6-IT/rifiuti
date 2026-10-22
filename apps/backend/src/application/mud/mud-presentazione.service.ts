import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { formattaDataItaliana } from '../../core/time/anno-italiano'
import { MudVersionRegistry } from './export/mud-version.registry'
import { caricaDichiaranteDellAzienda } from './export/mud-dichiarante'
import { MudAggregazioneService, type MudAggregato } from './aggregazione/mud-aggregazione.service'
import { hashAggregato, hashDichiarante } from './aggregazione/mud-regole'
import {
  aggiornaReportData,
  type MotivoAnnullamento,
  type ReportDataJson,
  type RecordMudReport,
} from './mud-report-data'

export interface StatoPresentazioneMud {
  year: number
  status: 'DRAFT' | 'REVIEWING' | 'SUBMITTED' | 'ARCHIVED'
  submittedAt: Date | null
  /** SUBMITTED e dati attuali (righe o dichiarante) diversi da quelli salvati alla segnatura */
  datiModificatiDopoPresentazione: boolean
  /** null se non SUBMITTED; false se il file non è uscito da questa versione (Decisione 22) */
  fileTracciato: boolean | null
  /** File generati per l'anno, dal più vecchio: la segnatura si lega a uno di questi (A-W-03) */
  esportazioni: EsportazioneMud[]
}

/** Esportazione registrata, come la pagina la propone per la segnatura. */
export interface EsportazioneMud {
  /** Chiave della voce: si rimanda come `esportazioneGenerataIl` */
  generatoIl: string
  versione: string | null
  avvisiConfermati: string[]
  /** Quantità dichiarate in meno e in più rispetto al registro, dal riepilogo del file */
  kgInMeno: number
  kgInPiu: number
}

const isRecord = (v: unknown): v is ReportDataJson =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const stringaONull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const elenco = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const elencoDiStringhe = (v: unknown): string[] =>
  elenco(v).filter((x): x is string => typeof x === 'string')

const numeroOZero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Esportazioni di `reportData`, lette in modo difensivo: una voce senza `generatoIl` si salta. */
function esportazioniRegistrate(reportData: unknown): EsportazioneMud[] {
  const p = isRecord(reportData) ? reportData : {}
  return elenco(p.esportazioni).flatMap(v => {
    if (!isRecord(v) || typeof v.generatoIl !== 'string') return []
    const riepilogo = isRecord(v.riepilogo) ? v.riepilogo : {}
    return [
      {
        generatoIl: v.generatoIl,
        versione: stringaONull(v.versione),
        avvisiConfermati: elencoDiStringhe(v.avvisiConfermati),
        kgInMeno: numeroOZero(riepilogo.kgInMeno),
        kgInPiu: numeroOZero(riepilogo.kgInPiu),
      },
    ]
  })
}

/**
 * Segnatura del MUD come presentato e suo annullamento, con lo storico in
 * `MUDReport.reportData` e nel registro attività.
 *
 * La segnatura si lega a una esportazione registrata (A-W-03): hash, avvisi confermati e
 * riepilogo sono quelli del file uscito, che ha già superato i controlli quando è stato
 * generato; se i dati sono cambiati dopo, la segnatura riesce e `stato()` lo dice. Senza
 * esportazioni (file fatto altrove, A-W-02) si salvano l'hash attuale e una fotografia dei
 * controlli. Un MUD già presentato non si segna di nuovo: prima si annulla (409), così lo
 * storico resta in `annullamenti`.
 */
@Injectable()
export class MudPresentazioneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: MudVersionRegistry,
    private readonly aggregazione: MudAggregazioneService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(MudPresentazioneService.name)
  }

  async stato(tenantId: string, year: number): Promise<StatoPresentazioneMud> {
    const record = await this.prisma.mUDReport.findUnique({
      where: { tenantId_year: { tenantId, year } },
    })
    if (!record) {
      return {
        year,
        status: 'DRAFT',
        submittedAt: null,
        datiModificatiDopoPresentazione: false,
        fileTracciato: null,
        esportazioni: [],
      }
    }
    const status = record.status as StatoPresentazioneMud['status']
    const esportazioni = esportazioniRegistrate(record.reportData)
    if (status !== 'SUBMITTED') {
      return {
        year,
        status,
        submittedAt: record.submittedAt ?? null,
        datiModificatiDopoPresentazione: false,
        fileTracciato: null,
        esportazioni,
      }
    }

    const reportData = isRecord(record.reportData) ? record.reportData : {}
    const hashSalvato = stringaONull(reportData.hashAggregato)
    let datiModificatiDopoPresentazione = false
    if (hashSalvato !== null) {
      const aggregato = await this.aggregazione.aggrega(tenantId, year)
      datiModificatiDopoPresentazione = hashAggregato(aggregato.righe) !== hashSalvato
      // hashAggregato copre solo le righe: anagrafica (AA) e autorizzazioni (AU) si confrontano
      // a parte (segnature precedenti a questo controllo non lo hanno). Senza azienda non c'è
      // nulla da confrontare.
      const dichiaranteSalvato = stringaONull(reportData.hashDichiarante)
      if (!datiModificatiDopoPresentazione && dichiaranteSalvato !== null) {
        const attuale = await this.hashDichiaranteAttuale(tenantId, aggregato)
        datiModificatiDopoPresentazione = attuale !== null && attuale !== dichiaranteSalvato
      }
    }
    return {
      year,
      status,
      submittedAt: record.submittedAt ?? null,
      datiModificatiDopoPresentazione,
      // un record segnato prima di questo piano non ha la chiave: vale false
      fileTracciato: reportData.fileTracciato === true,
      esportazioni,
    }
  }

  /**
   * Gli avvisi confermati non si chiedono: con un'esportazione valgono quelli confermati alla
   * generazione del file, senza esportazioni non c'è nulla da confermare (A-W-02, A-W-03).
   */
  async segnaPresentato(
    tenantId: string,
    year: number,
    userId: string,
    dataPresentazione?: Date,
    esportazioneGenerataIl?: string
  ): Promise<StatoPresentazioneMud> {
    // anno non supportato: 404 col messaggio del registro
    this.registry.getForYear(year)

    if (dataPresentazione && dataPresentazione.getTime() > Date.now()) {
      throw new BadRequestException('La data di presentazione non può essere nel futuro.')
    }
    const submittedAt = dataPresentazione ?? new Date()

    const aggregato = await this.aggregazione.aggrega(tenantId, year)
    const hashAttuale = hashAggregato(aggregato.righe)
    const dichiaranteAttuale = await this.hashDichiaranteAttuale(tenantId, aggregato)

    let traccia: Record<string, unknown> = {}
    await this.prisma.$transaction(async tx => {
      // Stato e esportazioni si leggono sotto il lock del report: due segnature concorrenti non
      // passano entrambe, e un'esportazione concorrente non cambia la voce a cui ci si lega.
      await aggiornaReportData(tx, tenantId, year, (p, record) => {
        if (record?.status === 'SUBMITTED') {
          throw new ConflictException({
            message: `Il MUD dei dati ${year} risulta già presentato: per segnarlo di nuovo annullare prima la segnatura.`,
            error: 'MUD_GIA_PRESENTATO',
          })
        }
        const esportazioni = elenco(p.esportazioni)
        const fileTracciato = esportazioni.length > 0

        let presentazione: {
          hashAggregato: string
          hashDichiarante: string | null
          esportazionePresentata: string | null
          avvisiConfermatiAllaPresentazione: string[]
          riepilogoAllaPresentazione: ReportDataJson | null
          controlliAllaPresentazione: Array<{ codice: string; gravita: string }> | null
        }
        if (!fileTracciato) {
          // A-W-02: il file è stato fatto altrove, non c'è nulla da confermare né da bloccare;
          // i controlli del momento restano come fotografia.
          presentazione = {
            hashAggregato: hashAttuale,
            hashDichiarante: dichiaranteAttuale,
            esportazionePresentata: null,
            avvisiConfermatiAllaPresentazione: [],
            riepilogoAllaPresentazione: null,
            controlliAllaPresentazione: aggregato.controlli.map(c => ({
              codice: c.codice,
              gravita: c.gravita,
            })),
          }
        } else {
          // A-W-03: tutto dal file esportato, nessun controllo rifatto sui dati di oggi
          const voce = this.esportazioneScelta(esportazioni, esportazioneGenerataIl)
          presentazione = {
            // ripiego solo per una voce di forma inattesa: l'export scrive sempre l'hash
            hashAggregato: stringaONull(voce.hashAggregato) ?? hashAttuale,
            hashDichiarante: stringaONull(voce.hashDichiarante),
            esportazionePresentata: stringaONull(voce.generatoIl),
            avvisiConfermatiAllaPresentazione: elencoDiStringhe(voce.avvisiConfermati),
            riepilogoAllaPresentazione: isRecord(voce.riepilogo) ? voce.riepilogo : null,
            controlliAllaPresentazione: null,
          }
        }

        traccia = {
          year,
          submittedAt: submittedAt.toISOString(),
          hashAggregato: presentazione.hashAggregato,
          hashDichiarante: presentazione.hashDichiarante,
          esportazionePresentata: presentazione.esportazionePresentata,
          avvisiConfermati: presentazione.avvisiConfermatiAllaPresentazione,
          riepilogo: presentazione.riepilogoAllaPresentazione,
          fileTracciato,
        }
        return {
          reportData: {
            ...p,
            ...presentazione,
            fileTracciato,
            annullamenti: elenco(p.annullamenti),
          },
          campi: { status: 'SUBMITTED', submittedAt, submittedBy: userId },
        }
      })

      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'MUD_PRESENTATO',
          description:
            `MUD dei dati ${year} segnato come presentato il ${formattaDataItaliana(submittedAt)}` +
            (traccia.fileTracciato ? '' : ' (file non generato da questa versione)'),
          metadata: traccia as Prisma.InputJsonValue,
        },
      })
    })

    this.logger.info(`MUD segnato come presentato: tenant ${tenantId}, anno ${year}`)
    return this.stato(tenantId, year)
  }

  /**
   * Annulla la presentazione, conservandola in `annullamenti` con il motivo: con
   * `DICHIARAZIONE_DA_SOSTITUIRE` il prossimo file annulla e sostituisce quella comunicazione
   * (A-W-04); `SEGNATURA_ERRATA` non era una presentazione, quindi non cambia cosa sostituisce
   * il prossimo file (vedi `dataComunicazioneSostituita`).
   */
  async annullaPresentazione(
    tenantId: string,
    year: number,
    userId: string,
    motivo: MotivoAnnullamento
  ): Promise<StatoPresentazioneMud> {
    await this.prisma.$transaction(async tx => {
      // voce dello storico costruita sotto il lock, riusata nel registro attività
      const annullamento: Record<string, unknown> = {}
      const { scritto } = await aggiornaReportData(
        tx,
        tenantId,
        year,
        (p: ReportDataJson, record: RecordMudReport | null) => {
          if (!record || record.status !== 'SUBMITTED') return null
          Object.assign(annullamento, {
            annullataIl: new Date().toISOString(),
            annullataDa: userId,
            motivo,
            submittedAt: record.submittedAt?.toISOString() ?? null,
            submittedBy: record.submittedBy,
            hashAggregato: stringaONull(p.hashAggregato),
            hashDichiarante: stringaONull(p.hashDichiarante),
            esportazionePresentata: stringaONull(p.esportazionePresentata),
            avvisiConfermati: elenco(p.avvisiConfermatiAllaPresentazione),
            riepilogo: isRecord(p.riepilogoAllaPresentazione) ? p.riepilogoAllaPresentazione : null,
            controlli: Array.isArray(p.controlliAllaPresentazione)
              ? p.controlliAllaPresentazione
              : null,
            fileTracciato: typeof p.fileTracciato === 'boolean' ? p.fileTracciato : null,
          })
          return {
            reportData: {
              ...p,
              hashAggregato: null,
              hashDichiarante: null,
              esportazionePresentata: null,
              avvisiConfermatiAllaPresentazione: [],
              riepilogoAllaPresentazione: null,
              controlliAllaPresentazione: null,
              fileTracciato: null,
              annullamenti: [...elenco(p.annullamenti), annullamento],
            },
            campi: { status: 'DRAFT', submittedAt: null, submittedBy: null },
          }
        }
      )
      if (!scritto) return

      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'MUD_PRESENTAZIONE_ANNULLATA',
          description:
            `Annullata la presentazione del MUD dei dati ${year}: ` +
            (motivo === 'DICHIARAZIONE_DA_SOSTITUIRE'
              ? 'dichiarazione da sostituire'
              : 'segnatura errata'),
          metadata: { year, ...annullamento } as Prisma.InputJsonValue,
        },
      })
      this.logger.info(`Presentazione del MUD annullata: tenant ${tenantId}, anno ${year}`)
    })
    return this.stato(tenantId, year)
  }

  /** Voce di `reportData.esportazioni` indicata, o l'ultima; 422 se quella indicata non c'è. */
  private esportazioneScelta(esportazioni: unknown[], generatoIl?: string): ReportDataJson {
    if (generatoIl === undefined) {
      const ultima = esportazioni[esportazioni.length - 1]
      return isRecord(ultima) ? ultima : {}
    }
    const voce = esportazioni.find(v => isRecord(v) && v.generatoIl === generatoIl)
    if (!voce) {
      throw new UnprocessableEntityException({
        message: "Esportazione indicata non trovata fra quelle dell'anno.",
        error: 'MUD_ESPORTAZIONE_NON_TROVATA',
      })
    }
    return voce as ReportDataJson
  }

  /** Hash dei dati del dichiarante di oggi (AA e AU), come entrerebbero nel file. */
  private async hashDichiaranteAttuale(
    tenantId: string,
    aggregato: MudAggregato
  ): Promise<string | null> {
    const dichiarante = await caricaDichiaranteDellAzienda(
      this.prisma,
      tenantId,
      aggregato.dichiarante
    )
    return dichiarante ? hashDichiarante(dichiarante) : null
  }
}
