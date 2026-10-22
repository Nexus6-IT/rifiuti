import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { MudVersionRegistry } from './mud-version.registry'
import { MudAggregazioneService } from '../aggregazione/mud-aggregazione.service'
import {
  avvisiCambianoQuantita,
  avvisiNonConfermati,
  codiciAvvisoDaConfermare,
  haBloccanti,
  riepilogaAvvisi,
} from '../aggregazione/mud-controlli'
import { leggiIntegrazioni } from '../aggregazione/mud-integrazioni'
import { hashAggregato, hashDichiarante } from '../aggregazione/mud-regole'
import { aggiornaReportData, dataComunicazioneSostituita } from '../mud-report-data'
import { MudExportData, MudExportResult } from './mud-export.types'
import { caricaDichiarante } from './mud-dichiarante'

/** Ruoli che possono confermare gli avvisi che cambiano le quantità (Decisione 19). */
export const RUOLI_CONFERMA_AVVISI = ['ADMIN', 'SUPER_ADMIN'] as const

/**
 * Orchestratore dell'export telematico MUD, **versionato e diviso per anno**.
 *
 * Dato (tenant, anno): seleziona il tracciato della versione corretta (per
 * anno), recupera l'anagrafica del dichiarante e l'aggregazione dal registro
 * (con i controlli), si ferma sui bloccanti, chiede la conferma degli avvisi,
 * genera il file conforme e registra l'esportazione.
 */
@Injectable()
export class MudExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: MudVersionRegistry,
    private readonly aggregazione: MudAggregazioneService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(MudExportService.name)
  }

  /** Anni supportati (con versione tracciato). */
  supportedVersions() {
    return this.registry.listVersions()
  }

  /**
   * Genera il file MUD telematico per il tenant e l'anno indicati.
   *
   * Con errori bloccanti → 422 `MUD_NON_GENERABILE`; con avvisi e un utente che non è
   * amministratore → 403; con avvisi non confermati → 422 `MUD_AVVISI_DA_CONFERMARE`.
   * I controlli viaggiano in `details`, l'unico campo strutturato che il filtro globale
   * copia nella risposta.
   */
  async exportTelematico(
    tenantId: string,
    year: number,
    utente: { id: string; role: string },
    avvisiConfermati: readonly string[] = []
  ): Promise<MudExportResult> {
    // Seleziona la versione per anno (lancia se anno non supportato).
    const tracciato = this.registry.getForYear(year)

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) {
      throw new NotFoundException('Tenant non trovato')
    }

    // Righe dal registro e controlli (aggregazione, dichiarante e profilo).
    const aggregato = await this.aggregazione.aggrega(tenantId, year)
    const controlli = aggregato.controlli
    const riepilogo = riepilogaAvvisi(controlli)

    if (haBloccanti(controlli)) {
      const bloccanti = controlli.filter(c => c.gravita === 'BLOCCANTE')
      throw new UnprocessableEntityException({
        message: `Il file MUD non può essere generato: ci sono errori da correggere (${bloccanti.length}).`,
        error: 'MUD_NON_GENERABILE',
        details: { controlli },
      })
    }

    const codiciAvviso = codiciAvvisoDaConfermare(controlli)
    // Decisione 19: la conferma di un avviso che fa dichiarare quantità diverse dal registro
    // è una scelta sul contenuto della dichiarazione e spetta a un amministratore. Gli avvisi
    // solo informativi (per esempio gli scarichi senza FIR) li conferma chiunque: altrimenti
    // nessun altro utente scaricherebbe il MUD.
    const puoConfermare = (RUOLI_CONFERMA_AVVISI as readonly string[]).includes(utente.role)
    if (avvisiCambianoQuantita(controlli) && !puoConfermare) {
      throw new ForbiddenException({
        message: 'Il file MUD ha avvisi da confermare: chiedi a un amministratore di generarlo.',
        error: 'MUD_CONFERMA_RISERVATA_AMMINISTRATORI',
        details: { controlli, riepilogo },
      })
    }

    const avvisiDaConfermare = avvisiNonConfermati(controlli, avvisiConfermati)
    if (avvisiDaConfermare.length > 0) {
      throw new UnprocessableEntityException({
        message: `Il file MUD non è stato generato: ci sono avvisi da confermare (${avvisiDaConfermare.length}).`,
        error: 'MUD_AVVISI_DA_CONFERMARE',
        details: { controlli, avvisiDaConfermare, riepilogo },
      })
    }

    // Dichiarazione sostitutiva (A-W-04): se l'anno risulta presentato, o la presentazione è
    // stata annullata per sostituirla, il file annulla e sostituisce quella comunicazione. La
    // lettura è fuori dal lock del report: la voce registra comunque cosa dice il file.
    const sostituita = dataComunicazioneSostituita(
      await this.prisma.mUDReport.findUnique({
        where: { tenantId_year: { tenantId, year } },
        select: { status: true, submittedAt: true, reportData: true },
      })
    )

    // Anagrafica (AA) e schede SA-AUT (AU): le autorizzazioni escono solo se registrate; per i
    // soggetti estranei alla gestione rifiuti la lista è vuota e il record AU non c'è.
    const dichiarante = await caricaDichiarante(
      this.prisma,
      tenantId,
      tenant,
      aggregato.dichiarante
    )
    const data: MudExportData = {
      year,
      azienda: dichiarante.azienda,
      rifiuti: aggregato.righe,
      autorizzazioni: dichiarante.autorizzazioni,
      ...(sostituita ? { sostituisce: { dataComunicazione: sostituita } } : {}),
    }

    const content = tracciato.generate(data)
    this.logger.info(
      `MUD export generato: tenant ${tenantId}, anno ${year}, versione ${tracciato.version}, ${data.rifiuti.length} righe, ${codiciAvviso.length} avvisi confermati`
    )

    const result: MudExportResult = {
      filename: `MUD_${year}_${tenant.partitaIva}.txt`,
      content,
      version: tracciato.version,
      year,
    }

    // Traccia dell'esportazione, solo dopo un file generato: con quali avvisi confermati,
    // quale aggregato e quali integrazioni è uscito (rilievo G3-D-06).
    const hash = hashAggregato(aggregato.righe)
    const riepilogoQuantita = {
      kgInMeno: riepilogo.kgInMeno,
      kgInPiu: riepilogo.kgInPiu,
      movimentiNonQuantificati: riepilogo.movimentiNonQuantificati,
      voci: riepilogo.voci,
    }
    await this.prisma.$transaction(async tx => {
      await aggiornaReportData(tx, tenantId, year, p => {
        const voce = {
          generatoIl: new Date().toISOString(),
          generatoDa: utente.id,
          versione: result.version,
          hashAggregato: hash,
          // i dati del dichiarante (AA e AU) non entrano in hashAggregato (solo righe): la
          // segnatura della presentazione li confronta a parte
          hashDichiarante: hashDichiarante(dichiarante),
          // comunicazione che il file annulla e sostituisce (record AA), o null
          sostituisce: sostituita ? sostituita.toISOString() : null,
          avvisiConfermati: codiciAvviso,
          riepilogo: riepilogoQuantita,
          integrazioniUsate: leggiIntegrazioni(p),
        }
        return {
          reportData: {
            ...p,
            esportazioni: [...(Array.isArray(p.esportazioni) ? p.esportazioni : []), voce],
          },
        }
      })
      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utente.id,
          action: 'MUD_ESPORTATO',
          description: `File MUD dei dati ${year} generato (tracciato ${result.version}) con ${codiciAvviso.length} avvisi confermati: ${riepilogo.testo}`,
          metadata: {
            year,
            versione: result.version,
            hashAggregato: hash,
            avvisiConfermati: codiciAvviso,
            riepilogo: riepilogoQuantita,
          } as unknown as Prisma.InputJsonValue,
        },
      })
    })

    return result
  }
}
