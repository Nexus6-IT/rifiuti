import { BadRequestException, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { formattaQuantita } from '../../core/format/formatta-quantita'
import {
  codiceFiscaleSoggettoValido,
  normalizzaCodiceFiscaleSoggetto,
} from '../../domain/shared/codice-fiscale-soggetto'
import { chiaveConfrontoCer, cerSoloCifre } from '../../domain/waste-movement/cer-registro'
import { normalizzaUnitaRegistro } from '../../domain/waste-movement/unita-misura-registro'
import type { IntegrazioniMudDto } from '../../api/mud/dtos/integrazioni-mud.dto'
import { MudVersionRegistry } from './export/mud-version.registry'
import {
  chiaveDestinatario,
  chiaveMovimento,
  chiavePesoSpecifico,
  intervalloPesoSpecifico,
  leggiIntegrazioni,
  pesoSpecificoPlausibile,
  type IntegrazioniMud,
  type SoggettoIntegrato,
} from './aggregazione/mud-integrazioni'
import { etichetteRegistri } from './aggregazione/mud-registri'
import { aggiornaReportData } from './mud-report-data'

export type TipoModificaIntegrazione =
  | 'CF_DESTINATARIO'
  | 'DESTINATARIO_MOVIMENTO'
  | 'CF_TRASPORTATORE'
  | 'PESO_SPECIFICO'

export interface ModificaIntegrazione {
  tipo: TipoModificaIntegrazione
  chiave: string
  prima: string | number | null
  dopo: string | number | null
}

/** Valore di un soggetto come compare nel registro attività. */
function valoreSoggetto(s: SoggettoIntegrato): string {
  if (s.nazione) return `estero: ${s.nazione}`
  return s.confermatoPropriaAzienda
    ? `${s.codiceFiscale} (codice della propria azienda, confermato)`
    : s.codiceFiscale
}

/** Per il destinatario di un movimento conta anche il nome: la chiave è il movimento. */
function valoreDestinatarioMovimento(s: SoggettoIntegrato): string {
  return `${s.ragioneSociale} – ${valoreSoggetto(s)}`
}

/** Una voce per chiave aggiunta, tolta o con valore diverso, nell'ordine delle chiavi. */
function differenze<T>(
  tipo: TipoModificaIntegrazione,
  prima: Record<string, T>,
  dopo: Record<string, T>,
  valore: (v: T) => string | number
): ModificaIntegrazione[] {
  const chiavi = [...new Set([...Object.keys(prima), ...Object.keys(dopo)])].sort()
  return chiavi.flatMap(chiave => {
    const p = chiave in prima ? valore(prima[chiave]) : null
    const d = chiave in dopo ? valore(dopo[chiave]) : null
    return p === d ? [] : [{ tipo, chiave, prima: p, dopo: d }]
  })
}

function differenzeIntegrazioni(
  prima: IntegrazioniMud,
  dopo: IntegrazioniMud
): ModificaIntegrazione[] {
  return [
    ...differenze('CF_DESTINATARIO', prima.destinatari, dopo.destinatari, valoreSoggetto),
    ...differenze(
      'DESTINATARIO_MOVIMENTO',
      prima.destinatariMovimento,
      dopo.destinatariMovimento,
      valoreDestinatarioMovimento
    ),
    ...differenze('CF_TRASPORTATORE', prima.trasportatori, dopo.trasportatori, valoreSoggetto),
    ...differenze('PESO_SPECIFICO', prima.pesiSpecifici, dopo.pesiSpecifici, v => v.kgPerUnita),
  ]
}

/**
 * Integrazioni annuali del MUD (Decisione 18): dati che il registro non ha (CF dei destinatari e
 * dei trasportatori, destinatario di uno scarico senza FIR, peso specifico per le unità non di
 * massa). Si salvano in `MUDReport.reportData.integrazioni` senza toccare il registro; il PUT
 * sostituisce quelle dell'anno e ogni modifica finisce nel registro attività con i valori prima e
 * dopo. Un MUD già presentato si può integrare: l'hash della presentazione segnalerà i dati
 * cambiati.
 */
@Injectable()
export class MudIntegrazioniService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: MudVersionRegistry,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(MudIntegrazioniService.name)
  }

  async leggi(tenantId: string, year: number): Promise<IntegrazioniMud> {
    const record = await this.prisma.mUDReport.findUnique({
      where: { tenantId_year: { tenantId, year } },
      select: { reportData: true },
    })
    return leggiIntegrazioni(record?.reportData)
  }

  /**
   * Partita IVA e codice fiscale dell'azienda, normalizzati e distinti: un destinatario con uno
   * di questi codici si accetta solo con la conferma (A-W-13). La pagina li usa per mostrare la
   * casella di conferma.
   */
  async codiciAzienda(tenantId: string): Promise<string[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { partitaIva: true, codiceFiscale: true },
    })
    const codici = [tenant?.partitaIva, tenant?.codiceFiscale].map(c =>
      normalizzaCodiceFiscaleSoggetto(c)
    )
    return [...new Set(codici.filter(Boolean))]
  }

  /** Registro -> sede, solo se l'azienda ha più registri (vuota altrimenti): per le etichette dei movimenti. */
  async etichetteRegistri(tenantId: string): Promise<Record<string, string>> {
    return Object.fromEntries(await etichetteRegistri(this.prisma, tenantId))
  }

  async salva(
    tenantId: string,
    year: number,
    userId: string,
    dati: IntegrazioniMudDto
  ): Promise<IntegrazioniMud> {
    this.registry.getForYear(year)

    const codiciPropri = new Set(await this.codiciAzienda(tenantId))

    /** CF verificato; il codice della propria azienda solo con la conferma (A-W-13). */
    const soggetto = (
      v: { ragioneSociale: string; codiceFiscale: string; confermaPropriaAzienda?: boolean },
      propriaAziendaConConferma: boolean
    ): SoggettoIntegrato => {
      const ragioneSociale = v.ragioneSociale.trim()
      const cf = normalizzaCodiceFiscaleSoggetto(v.codiceFiscale)
      if (!codiceFiscaleSoggettoValido(cf)) {
        throw new BadRequestException(
          `Codice fiscale o partita IVA "${cf}" di "${ragioneSociale}" non valido: il carattere di controllo non corrisponde.`
        )
      }
      if (propriaAziendaConConferma && codiciPropri.has(cf)) {
        if (v.confermaPropriaAzienda !== true) {
          throw new BadRequestException(
            `Il codice "${cf}" è quello della vostra azienda: se "${ragioneSociale}" è un vostro impianto confermarlo esplicitamente, altrimenti inserire il codice del destinatario.`
          )
        }
        return { ragioneSociale, codiceFiscale: cf, confermatoPropriaAzienda: true }
      }
      return { ragioneSociale, codiceFiscale: cf }
    }

    const destinatari: IntegrazioniMud['destinatari'] = {}
    for (const v of dati.destinatari) {
      const nazione = v.nazione?.trim()
      destinatari[chiaveDestinatario(v.ragioneSociale)] = nazione
        ? // Destinatario estero (A-W-05): la nazione al posto del CF, che non si verifica
          { ragioneSociale: v.ragioneSociale.trim(), codiceFiscale: '', nazione }
        : soggetto(v, true)
    }

    const destinatariMovimento: IntegrazioniMud['destinatariMovimento'] = {}
    for (const v of dati.destinatariMovimento ?? []) {
      destinatariMovimento[chiaveMovimento(v.anno, v.numero, v.registroId)] = soggetto(v, true)
    }

    // Il codice della propria azienda vale per un trasportatore: trasporto in conto proprio.
    const trasportatori: IntegrazioniMud['trasportatori'] = {}
    for (const v of dati.trasportatori ?? []) {
      trasportatori[chiaveDestinatario(v.ragioneSociale)] = soggetto(v, false)
    }

    const pesiSpecifici: IntegrazioniMud['pesiSpecifici'] = {}
    for (const v of dati.pesiSpecifici) {
      if (cerSoloCifre(v.cerCode).length !== 6) {
        throw new BadRequestException(`Il codice CER "${v.cerCode}" non è valido: servono 6 cifre.`)
      }
      const u = normalizzaUnitaRegistro(v.unita)
      if (u.massa) {
        throw new BadRequestException(
          'Il peso specifico serve solo per le unità diverse da kg e tonnellate.'
        )
      }
      const cerCode = chiaveConfrontoCer(v.cerCode)
      const fuoriIntervallo = !pesoSpecificoPlausibile(u.unita, v.kgPerUnita)
      if (fuoriIntervallo && v.confermaFuoriIntervallo !== true) {
        const i = intervalloPesoSpecifico(u.unita)
        const kg = formattaQuantita(v.kgPerUnita)
        throw new BadRequestException(
          i
            ? `Il peso specifico di ${kg} kg per ${u.unita} del CER ${cerCode} è fuori dall'intervallo consueto (${formattaQuantita(i.min)}–${formattaQuantita(i.max)} kg per ${u.unita}): controllare l'unità (kg, non tonnellate) o confermarlo esplicitamente.`
            : `Per l'unità ${u.unita} non c'è un intervallo di riferimento: confermare esplicitamente il peso specifico di ${kg} kg per ${u.unita} del CER ${cerCode}.`
        )
      }
      pesiSpecifici[chiavePesoSpecifico(cerCode, u.unita)] = {
        cerCode,
        unita: u.unita,
        kgPerUnita: v.kgPerUnita,
        ...(fuoriIntervallo ? { confermatoFuoriIntervallo: true } : {}),
      }
    }

    const integrazioni: IntegrazioniMud = {
      destinatari,
      destinatariMovimento,
      trasportatori,
      pesiSpecifici,
      // Le destinazioni delle giacenze si salvano dal Task 7 (D9): qui non c'è ancora l'input
      destinazioniGiacenza: {},
      aggiornateIl: new Date().toISOString(),
      aggiornateDa: userId,
    }

    await this.prisma.$transaction(async tx => {
      const { precedente } = await aggiornaReportData(tx, tenantId, year, p => ({
        reportData: { ...p, integrazioni },
      }))
      const modifiche = differenzeIntegrazioni(leggiIntegrazioni(precedente), integrazioni)
      if (modifiche.length === 0) return
      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'MUD_INTEGRAZIONI_MODIFICATE',
          description: `Integrazioni del MUD dei dati ${year} aggiornate (${modifiche.length} ${modifiche.length === 1 ? 'modifica' : 'modifiche'})`,
          metadata: { year, modifiche } as unknown as Prisma.InputJsonValue,
        },
      })
    })
    this.logger.info('Integrazioni del MUD salvate', { tenantId, year })
    return integrazioni
  }
}
