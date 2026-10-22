import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { ReferenceDataService } from '../../reference-data/reference-data.service'
import { cerCanonico, chiaveConfrontoCer } from '../../../domain/waste-movement/cer-registro'
import {
  convertiInKg,
  normalizzaUnitaRegistro,
} from '../../../domain/waste-movement/unita-misura-registro'
import { collegabilitaFir, etichettaFir, STATI_FIR_EMESSI } from '../../../domain/fir/stati-fir'
import { stessiDatiRicopia } from '../../registro/ricopia-fir'
import type { MudAllegatoDR, MudAllegatoTE, MudRifiutoLine } from '../export/mud-export.types'
import {
  classificaMovimento,
  limitiAnnoMud,
  operazioneDaCausale,
  operazioneDaCodice,
} from './mud-regole'
import { controlliMud, type MudEsitoControllo, type RifMovimento } from './mud-controlli'
import {
  chiaveDestinatario,
  chiavePesoSpecifico,
  leggiIntegrazioni,
  pesoSpecificoPlausibile,
  type IntegrazioniMud,
} from './mud-integrazioni'

export interface MudAggregato {
  anno: number
  /** cerCode a 6 cifre (chiaveConfrontoCer), una riga per CER con almeno un movimento conteggiato */
  righe: MudRifiutoLine[]
  /** movimenti conteggiati (prodotto + avviato) per CER */
  movimentiPerCer: Record<string, number>
  /** aggregazione + dichiarante + profilo */
  controlli: MudEsitoControllo[]
}

interface Movimento {
  progressiveNumber: number
  progressiveYear: number
  type: string
  causale: string
  cerCode: string
  quantity: Prisma.Decimal | number | string
  unit: string | null
  operationCode: string | null
  firId: string | null
  firIdRicopia: string | null
  counterpartName: string | null
  movementDate: Date
}

interface FirCollegato {
  id: string
  firNumber: string | null
  rentriNumeroFir: string | null
  status: string
  rentriStatoFormulario: string | null
  wasteOperationType: string | null
  wasteOperationCode: string | null
  receiverId: string | null
  receiverName: string | null
  receiverPartitaIva: string | null
  carrierId: string | null
  carrierName: string | null
  carrierPartitaIva: string | null
}

interface DestinatarioInfo {
  ragioneSociale: string
  partitaIVA: string
  via: string
  civico: string
  cap: string
  istatProvincia?: string
  istatComune?: string
}

interface VoceDr {
  dr: MudAllegatoDR
  /** per il messaggio del CF mancante: `FIR <etichetta>` o `dal registro` */
  origine: string
  conFir: boolean
}

interface RigaInCorso {
  prodottoKg: number
  recuperoKg: number
  smaltimentoKg: number
  dr: Map<string, VoceDr>
  te: Map<string, MudAllegatoTE>
}

interface GruppoUnita {
  cer6: string
  unita: string
  kgPerUnita?: number
  movimenti: RifMovimento[]
}

// Confronto dei doppi storici senza la data (Decisione 20).
const EPOCA = new Date(0)
const ORIGINE_REGISTRO = 'dal registro'
const arrotonda3 = (n: number): number => Math.round(n * 1000) / 1000

/** CF o partita IVA per la fusione dei DR: maiuscolo, senza spazi né prefisso IT. */
function cfConfronto(cf: string): string {
  const pulito = cf.replace(/\s+/g, '').toUpperCase()
  return pulito.startsWith('IT') ? pulito.slice(2) : pulito
}

/**
 * Il MUD dal registro di carico e scarico: righe per CER (prodotto, recupero,
 * smaltimento, DR e TE dai FIR collegabili o dal registro) e l'elenco dei controlli.
 * Export, riepilogo, PDF e presentazione partono tutti da qui.
 */
@Injectable()
export class MudAggregazioneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceData: ReferenceDataService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(MudAggregazioneService.name)
  }

  async aggrega(tenantId: string, anno: number): Promise<MudAggregato> {
    const { inizio, fine } = limitiAnnoMud(anno)

    // Il servizio usa il client Prisma senza estensione RLS: ogni query porta il tenantId.
    const movimenti: Movimento[] = await this.prisma.wasteMovement.findMany({
      where: { tenantId, movementDate: { gte: inizio, lt: fine } },
      select: {
        progressiveNumber: true,
        progressiveYear: true,
        type: true,
        causale: true,
        cerCode: true,
        quantity: true,
        unit: true,
        operationCode: true,
        firId: true,
        firIdRicopia: true,
        counterpartName: true,
        movementDate: true,
      },
      orderBy: [{ movementDate: 'asc' }, { progressiveNumber: 'asc' }],
    })

    const firIds = [...new Set(movimenti.map(m => m.firId).filter((id): id is string => !!id))]
    const firCollegati: FirCollegato[] =
      firIds.length > 0
        ? await this.prisma.fIR.findMany({
            where: { tenantId, id: { in: firIds } },
            select: {
              id: true,
              firNumber: true,
              rentriNumeroFir: true,
              status: true,
              rentriStatoFormulario: true,
              wasteOperationType: true,
              wasteOperationCode: true,
              receiverId: true,
              receiverName: true,
              receiverPartitaIva: true,
              carrierId: true,
              carrierName: true,
              carrierPartitaIva: true,
            },
          })
        : []
    const firPerId = new Map(firCollegati.map(f => [f.id, f]))

    // FIR emessi e non annullati con trasporto nell'anno: la data di trasporto vale solo
    // se la presa in carico è avvenuta qui, cioè se c'è la firma del trasportatore.
    const firAnno = await this.prisma.fIR.findMany({
      where: {
        tenantId,
        status: { in: [...STATI_FIR_EMESSI] },
        signatures: { some: { role: 'TRASPORTATORE' } },
        transportDate: { gte: inizio, lt: fine },
        OR: [{ rentriStatoFormulario: null }, { rentriStatoFormulario: { not: 'Annullato' } }],
      },
      select: { id: true, firNumber: true, rentriNumeroFir: true },
    })
    const idsFirAnno = firAnno.map(f => f.id)
    // Scarichi che citano i FIR dell'anno, registrati in qualunque anno.
    const scarichiDeiFirAnno: Array<{ firId: string | null }> =
      idsFirAnno.length > 0
        ? await this.prisma.wasteMovement.findMany({
            where: { tenantId, type: 'SCARICO', firId: { in: idsFirAnno } },
            select: { firId: true },
          })
        : []

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { city: true, province: true, atecoCode: true },
    })
    const comuneDichiarante = tenant?.city
      ? await this.referenceData.findComuneByName(tenant.city, tenant.province ?? undefined)
      : undefined

    const unitaLocali = await this.prisma.rentriUnitaLocale.findMany({
      where: { tenantId, attiva: true },
      select: { denominazione: true, numIscrSito: true, principale: true },
      orderBy: [{ principale: 'desc' }, { denominazione: 'asc' }],
    })

    const record = await this.prisma.mUDReport.findUnique({
      where: { tenantId_year: { tenantId, year: anno } },
      select: { reportData: true },
    })
    const integrazioni = leggiIntegrazioni(record?.reportData)

    const destinatari = await this.caricaDestinatari(
      tenantId,
      firCollegati.map(f => f.receiverId)
    )

    const controlli: MudEsitoControllo[] = []
    const rif = (m: Movimento): RifMovimento => ({
      progressiveNumber: m.progressiveNumber,
      progressiveYear: m.progressiveYear,
      cerCode: cerCanonico(m.cerCode),
      causale: m.causale,
      quantity: Number(m.quantity),
      unit: m.unit ?? '',
      movementDate: m.movementDate,
    })
    const etichettaPerId = (firId: string): string =>
      etichettaFir(firPerId.get(firId) ?? { id: firId, firNumber: null })

    // Passo 0: doppi identici dello stesso FIR e tipo (Decisione 20). Un doppio si
    // confronta con i movimenti già contati del gruppo, mai con quelli già scartati.
    const doppiDi = new Map<Movimento, Movimento[]>()
    const doppi = new Set<Movimento>()
    const contatiPerGruppo = new Map<string, Movimento[]>()
    for (const m of movimenti) {
      if (!m.firId) continue
      const gruppo = `${m.firId}|${m.type}`
      const contati = contatiPerGruppo.get(gruppo) ?? []
      const originale = contati.find(
        c =>
          stessiDatiRicopia(c, m) ||
          // Registrati prima del piano C: la ricopia prendeva la data di oggi.
          (c.firIdRicopia === null &&
            m.firIdRicopia === null &&
            stessiDatiRicopia({ ...c, movementDate: EPOCA }, { ...m, movementDate: EPOCA }))
      )
      if (originale) {
        doppi.add(m)
        doppiDi.set(originale, [...(doppiDi.get(originale) ?? []), m])
      } else {
        contatiPerGruppo.set(gruppo, [...contati, m])
      }
    }

    const righe = new Map<string, RigaInCorso>()
    const riga = (cer6: string): RigaInCorso => {
      let r = righe.get(cer6)
      if (!r) {
        r = { prodottoKg: 0, recuperoKg: 0, smaltimentoKg: 0, dr: new Map(), te: new Map() }
        righe.set(cer6, r)
      }
      return r
    }
    const movimentiPerCer: Record<string, number> = {}
    const inclusi = new Set<Movimento>()
    const avviatiPerFir = new Map<string, Movimento[]>()
    const ricevuti: RifMovimento[] = []
    const nonConvertiti = new Map<string, GruppoUnita>()
    const convertiti = new Map<string, GruppoUnita>()

    for (const m of movimenti) {
      if (doppi.has(m)) continue
      const r = rif(m)

      // 1. Classificazione
      const ruolo = classificaMovimento(m.type as 'CARICO' | 'SCARICO', m.causale)
      if (ruolo === 'ESCLUSO') {
        controlli.push(controlliMud.causaleEsclusa(r))
        continue
      }
      if (ruolo === 'RICEVUTO_DA_TERZI') {
        ricevuti.push(r)
        continue
      }

      // 2. Collegabilità del FIR, prima dell'unità (Decisione 23)
      let fir: FirCollegato | undefined
      if (ruolo === 'AVVIATO' && m.firId) {
        fir = firPerId.get(m.firId)
        if (!fir) {
          controlli.push(controlliMud.firNonTrovato(r))
        } else {
          const c = collegabilitaFir(fir)
          if (!c.collegabile) {
            controlli.push(
              c.motivo === 'ANNULLATO'
                ? controlliMud.firAnnullato(r, etichettaFir(fir))
                : controlliMud.firInBozza(r, etichettaFir(fir))
            )
            continue
          }
        }
      }

      // 3. Unità di misura
      const cer6 = chiaveConfrontoCer(m.cerCode)
      const u = normalizzaUnitaRegistro(m.unit)
      const quantita = Number(m.quantity)
      let kg: number
      if (!u.massa) {
        const chiave = chiavePesoSpecifico(cer6, m.unit ?? '')
        const peso = integrazioni.pesiSpecifici[chiave]
        const destinazione = peso ? convertiti : nonConvertiti
        const gruppo = destinazione.get(chiave) ?? {
          cer6,
          unita: u.unita,
          kgPerUnita: peso?.kgPerUnita,
          movimenti: [],
        }
        gruppo.movimenti.push(r)
        destinazione.set(chiave, gruppo)
        if (!peso) continue
        kg = arrotonda3(quantita * peso.kgPerUnita)
      } else {
        kg = convertiInKg(quantita, m.unit) as number
        if (u.vuota) controlli.push(controlliMud.unitaVuotaComeKg(r))
      }

      const acc = riga(cer6)
      movimentiPerCer[cer6] = (movimentiPerCer[cer6] ?? 0) + 1
      inclusi.add(m)

      // 4. Prodotto
      if (ruolo === 'PRODOTTO') {
        acc.prodottoKg += kg
        continue
      }

      // 5. Avviato a terzi (il FIR, se c'è, è collegabile)
      if (!m.firId) controlli.push(controlliMud.scaricoSenzaFir(r))
      else avviatiPerFir.set(m.firId, [...(avviatiPerFir.get(m.firId) ?? []), m])

      const operazione = this.recuperoOSmaltimento(m, r, fir, controlli)
      if (operazione === 'R') acc.recuperoKg += kg
      else acc.smaltimentoKg += kg

      this.aggiungiDestinatario(acc, m, r, fir, kg, destinatari, controlli)

      if (fir?.rentriStatoFormulario === 'RespintoAccettatoParzialmente') {
        controlli.push(controlliMud.esitoFirRespinto(r, etichettaFir(fir)))
      }
    }

    // 6. Dopo il ciclo
    for (const g of nonConvertiti.values()) {
      controlli.push(controlliMud.unitaNonDiMassa(anno, g.cer6, g.unita, g.movimenti))
    }
    for (const g of convertiti.values()) {
      const kgPerUnita = g.kgPerUnita as number
      controlli.push(
        controlliMud.convertitoConPesoSpecifico(
          g.cer6,
          g.unita,
          kgPerUnita,
          g.movimenti,
          !pesoSpecificoPlausibile(g.unita, kgPerUnita)
        )
      )
    }

    // Un avviso per ogni originale, con i soli suoi doppi (preflight A11).
    for (const [originale, suoiDoppi] of doppiDi) {
      const esito = controlliMud.firDoppioIdentico(etichettaPerId(originale.firId as string), [
        rif(originale),
        ...suoiDoppi.map(rif),
      ])
      // L'originale è incluso solo se l'aggregazione l'ha davvero contato.
      if (!inclusi.has(originale) && esito.movimenti) {
        esito.movimenti[0] = { ...esito.movimenti[0], incluso: false }
      }
      controlli.push(esito)
    }

    for (const [firId, ms] of avviatiPerFir) {
      if (ms.length > 1) {
        controlli.push(controlliMud.firScaricatoPiuVolte(etichettaPerId(firId), ms.map(rif)))
      }
    }

    const righeFinali = this.completaRighe(righe, integrazioni, anno, controlli)

    if (righeFinali.length > 0) controlli.push(controlliMud.giacenzeNonCalcolate(anno))

    if (movimenti.length === 0) {
      controlli.push(
        firAnno.length > 0
          ? controlliMud.registroVuotoConFir(anno, firAnno.map(etichettaFir))
          : controlliMud.nessunMovimento(anno)
      )
    } else {
      const scaricati = new Set(scarichiDeiFirAnno.map(s => s.firId))
      const nonRegistrati = firAnno.filter(f => !scaricati.has(f.id))
      if (nonRegistrati.length > 0) {
        controlli.push(controlliMud.firNonRegistrato(anno, nonRegistrati.map(etichettaFir)))
      }
    }

    if (ricevuti.length > 0) controlli.push(controlliMud.profiloNonSupportato(anno, ricevuti))
    if (unitaLocali.length > 1) controlli.push(controlliMud.piuUnitaLocali(unitaLocali))

    if (!comuneDichiarante?.code) {
      controlli.push(controlliMud.dichiaranteSenzaComuneIstat(tenant?.city, tenant?.province))
    }
    if (!tenant?.atecoCode?.trim()) controlli.push(controlliMud.dichiaranteSenzaAteco())

    this.logger.info(
      `MUD aggregato: tenant ${tenantId}, anno ${anno}, ${movimenti.length} movimenti, ${righeFinali.length} righe, ${controlli.length} controlli`
    )
    return { anno, righe: righeFinali, movimentiPerCer, controlli }
  }

  /** Recupero o smaltimento di uno scarico, nell'ordine della Decisione 5. */
  private recuperoOSmaltimento(
    m: Movimento,
    r: RifMovimento,
    fir: FirCollegato | undefined,
    controlli: MudEsitoControllo[]
  ): 'R' | 'D' {
    const indicata =
      operazioneDaCodice(m.operationCode) ??
      operazioneDaCausale(m.causale) ??
      (fir ? operazioneDaCodice(fir.wasteOperationCode) : undefined)
    if (indicata) return indicata

    // `wasteOperationType` ha default DISPOSAL: la deduzione va verificata.
    const dedotta =
      fir?.wasteOperationType === 'RECOVERY'
        ? 'R'
        : fir?.wasteOperationType === 'DISPOSAL'
          ? 'D'
          : undefined
    if (fir && dedotta) {
      controlli.push(controlliMud.operazioneDedottaDalFir(r, etichettaFir(fir), dedotta))
      return dedotta
    }
    controlli.push(controlliMud.operazioneNonIndicata(r))
    return 'D'
  }

  /** DR e TE di uno scarico conteggiato: dal FIR collegabile, altrimenti dal registro. */
  private aggiungiDestinatario(
    acc: RigaInCorso,
    m: Movimento,
    r: RifMovimento,
    fir: FirCollegato | undefined,
    kg: number,
    destinatari: Map<string, DestinatarioInfo>,
    controlli: MudEsitoControllo[]
  ): void {
    const nomeFir = fir?.receiverName?.trim()
    const chiaveFir = fir
      ? fir.receiverId || fir.receiverPartitaIva || (nomeFir ? `nome:${nomeFir.toUpperCase()}` : '')
      : ''

    if (fir && chiaveFir) {
      const info = fir.receiverId ? destinatari.get(fir.receiverId) : undefined
      const esistente = acc.dr.get(chiaveFir)
      if (esistente) {
        esistente.dr.quantitaKg += kg
      } else {
        acc.dr.set(chiaveFir, {
          dr: {
            codiceFiscale: info?.partitaIVA || fir.receiverPartitaIva || '',
            ragioneSociale: info?.ragioneSociale || nomeFir || '',
            istatProvincia: info?.istatProvincia,
            istatComune: info?.istatComune,
            indirizzo: info?.via,
            civico: info?.civico,
            cap: info?.cap,
            quantitaKg: kg,
          },
          origine: `FIR ${etichettaFir(fir)}`,
          conFir: true,
        })
      }
    } else {
      // Senza FIR, o con un FIR che non indica il destinatario: quello del registro.
      const nome = m.counterpartName?.trim()
      if (!nome) {
        controlli.push(controlliMud.destinatarioNonIndicato(r))
      } else {
        const chiave = `nome:${nome.toUpperCase()}`
        const esistente = acc.dr.get(chiave)
        if (esistente) {
          esistente.dr.quantitaKg += kg
        } else {
          acc.dr.set(chiave, {
            dr: { codiceFiscale: '', ragioneSociale: nome, quantitaKg: kg },
            origine: ORIGINE_REGISTRO,
            conFir: false,
          })
        }
      }
    }

    if (fir) {
      const chiaveTe = fir.carrierId || fir.carrierPartitaIva
      if (chiaveTe && !acc.te.has(chiaveTe)) {
        acc.te.set(chiaveTe, {
          codiceFiscale: fir.carrierPartitaIva || '',
          ragioneSociale: fir.carrierName || '',
        })
      }
    }
  }

  /**
   * Righe finali, ordinate per CER: CF dei DR dalle integrazioni, fusione dei DR con lo
   * stesso CF (rilievo G3-D-08), controlli sui DR senza CF o senza ISTAT, quantità al grammo.
   */
  private completaRighe(
    righe: Map<string, RigaInCorso>,
    integrazioni: IntegrazioniMud,
    anno: number,
    controlli: MudEsitoControllo[]
  ): MudRifiutoLine[] {
    // Lo stesso destinatario sotto più CER dà un solo controllo.
    const segnalati = new Set<string>()
    const segnalaUnaVolta = (esito: MudEsitoControllo) => {
      if (segnalati.has(esito.messaggio)) return
      segnalati.add(esito.messaggio)
      controlli.push(esito)
    }

    return [...righe.keys()].sort().map(cer6 => {
      const acc = righe.get(cer6) as RigaInCorso

      const voci: VoceDr[] = [...acc.dr.values()].map(v => ({ ...v, dr: { ...v.dr } }))
      for (const v of voci) {
        if (v.dr.codiceFiscale.trim()) continue
        const integrato = integrazioni.destinatari[chiaveDestinatario(v.dr.ragioneSociale)]
        if (integrato) v.dr.codiceFiscale = integrato.codiceFiscale
        else segnalaUnaVolta(controlliMud.destinatarioSenzaCf(v.dr.ragioneSociale, v.origine, anno))
      }

      // Stesso CF: un solo DR, quantità sommate, anagrafica del primo con FIR (o del primo).
      const gruppi = new Map<string, VoceDr[]>()
      const ordine: Array<VoceDr | string> = []
      for (const v of voci) {
        const cf = cfConfronto(v.dr.codiceFiscale)
        if (!cf) {
          ordine.push(v)
        } else if (gruppi.has(cf)) {
          gruppi.get(cf)!.push(v)
        } else {
          gruppi.set(cf, [v])
          ordine.push(cf)
        }
      }
      const dr: MudAllegatoDR[] = ordine.map(voce => {
        if (typeof voce !== 'string') return voce.dr
        const gruppo = gruppi.get(voce)!
        const rappresentante = gruppo.find(g => g.conFir) ?? gruppo[0]
        return {
          ...rappresentante.dr,
          quantitaKg: gruppo.reduce((s, g) => s + g.dr.quantitaKg, 0),
        }
      })

      for (const d of dr) {
        d.quantitaKg = arrotonda3(d.quantitaKg)
        if (!d.istatComune) segnalaUnaVolta(controlliMud.destinatarioSenzaIstat(d.ragioneSociale))
      }

      return {
        cerCode: cer6,
        prodottoKg: arrotonda3(acc.prodottoKg),
        recuperoKg: arrotonda3(acc.recuperoKg),
        smaltimentoKg: arrotonda3(acc.smaltimentoKg),
        dr,
        te: [...acc.te.values()],
      }
    })
  }

  /**
   * Anagrafica e codice ISTAT (provincia 3 + comune 3) dei destinatari dei FIR,
   * con il comune risolto dalle tabelle di riferimento condivise.
   */
  private async caricaDestinatari(
    tenantId: string,
    receiverIds: Array<string | null>
  ): Promise<Map<string, DestinatarioInfo>> {
    const ids = Array.from(new Set(receiverIds.filter((id): id is string => !!id)))
    const info = new Map<string, DestinatarioInfo>()
    if (ids.length === 0) return info

    // Il `tenantId` è obbligatorio anche se gli id arrivano dai FIR del tenant:
    // questo service usa il client Prisma senza estensione RLS, quindi il
    // perimetro dell'azienda esiste solo se sta scritto nella query.
    const destinatari = await this.prisma.destinatario.findMany({
      where: { id: { in: ids }, tenantId },
    })

    // Un solo lookup per coppia (comune, provincia) distinta.
    const comuni = new Map<
      string,
      Awaited<ReturnType<typeof this.referenceData.findComuneByName>>
    >()
    for (const d of destinatari) {
      const chiave = `${d.comune}|${d.provincia}`
      if (!comuni.has(chiave)) {
        comuni.set(chiave, await this.referenceData.findComuneByName(d.comune, d.provincia))
      }
    }

    for (const d of destinatari) {
      const comune = comuni.get(`${d.comune}|${d.provincia}`)
      info.set(d.id, {
        ragioneSociale: d.ragioneSociale,
        partitaIVA: d.partitaIVA,
        via: d.via,
        civico: d.civico,
        cap: d.cap,
        // Codice ISTAT 6 cifre = provincia(3) + comune(3).
        istatProvincia: comune?.code?.slice(0, 3),
        istatComune: comune?.code?.slice(3, 6),
      })
    }
    return info
  }
}
