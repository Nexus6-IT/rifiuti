/**
 * Stampa dei ritiri (4.7, T16; P7 §4): distinta per giorno e mezzo e PDF unico dei FIR attivi dei
 * ritiri scelti. Tutto nel contesto dell'azienda (RLS) e con filtro `tenantId` esplicito.
 *
 * La distinta usa il modello DISTINTA_RITIRI predefinito, altrimenti il GENERALE, altrimenti nessuno;
 * i FIR il predefinito FIR, poi il GENERALE (come `GET /pdf/fir/:id`). Con `modelloId` esplicito il
 * modello deve essere dell'azienda (404) e dell'ambito giusto (400).
 */
import { Injectable } from '@nestjs/common'
import { generaQrVidimazione } from '../../infrastructure/rentri/qr/qr-vidimazione'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  DIMENSIONE_MASSIMA,
  RitiriRepository,
} from '../../infrastructure/persistence/ritiri.repository'
import { ModelliStampaService } from '../modelli-stampa/modelli-stampa.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { FIR_SERIE_MAX } from '../../infrastructure/pdf/definizione-fir'
import {
  AutomezzoNonTrovatoError,
  ModelloAmbitoNonValidoError,
  NessunFirDaStampareError,
  RitiroDatiNonValidiError,
} from './errori-ritiri'
import { eUuid } from './ritiri.input'
import type { RitiroVista } from './ritiri.tipi'
import {
  nomeFileDistinta,
  sceglieModelloDistinta,
  type DatiDistinta,
  type ModelloStampaDistinta,
} from './stampa/distinta-pdf'
import { sceglieModelloFir } from '../modelli-stampa/scelta-modello-fir'

const DATA = /^\d{4}-\d{2}-\d{2}$/

const INCLUDE_FIR = {
  producerUser: true,
  carrierUser: true,
  receiverUser: true,
  signatures: true,
  tenant: true,
} as const

export interface PdfStampato {
  buffer: Buffer
  nomeFile: string
}

export interface FirStampati extends PdfStampato {
  /** Ritiri richiesti che non hanno dato un FIR (senza FIR attivo, o non dell'azienda). */
  saltati: number
}

@Injectable()
export class StampaRitiriService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RitiriRepository,
    private readonly pdf: PDFService,
    private readonly modelli: ModelliStampaService
  ) {}

  /** Distinta dei ritiri PROGRAMMATI del giorno (un solo mezzo, o tutti). */
  async distinta(
    tenantId: string,
    data: string,
    automezzoId?: string,
    modelloId?: string
  ): Promise<PdfStampato> {
    if (!DATA.test(data ?? '')) throw new RitiroDatiNonValidiError(['La data non è valida.'])
    if (automezzoId !== undefined && !eUuid(automezzoId)) {
      throw new RitiroDatiNonValidiError(['Automezzo non valido.'])
    }
    return nelContestoTenant(tenantId, async () => {
      const modello = await this.modelloDistinta(tenantId, modelloId)
      const { righe, automezzo } = await this.prisma.$transaction(async tx => {
        const mezzo = automezzoId
          ? await tx.automezzo.findFirst({
              where: { id: automezzoId, tenantId },
              select: { targa: true },
            })
          : null
        if (automezzoId && !mezzo) throw new AutomezzoNonTrovatoError()
        const elenco = await this.repo.elenca(
          tx,
          tenantId,
          { dal: data, al: data, stato: 'PROGRAMMATO', ...(automezzoId ? { automezzoId } : {}) },
          1,
          DIMENSIONE_MASSIMA
        )
        if (elenco.totale > elenco.righe.length) {
          throw new RitiroDatiNonValidiError([
            automezzoId
              ? 'Troppi ritiri per questo mezzo in un giorno per una sola distinta.'
              : 'Troppi ritiri nel giorno per una sola distinta: scegli un mezzo.',
          ])
        }
        return { righe: elenco.righe, automezzo: mezzo }
      })
      const dati: DatiDistinta = {
        data,
        automezzo: automezzo ? { targa: automezzo.targa, descrizione: null } : null,
        righe: righe.map(r => ({
          fascia: r.fascia,
          ordineGiro: r.ordineGiro,
          produttore: r.produttore.nome,
          indirizzoSede: r.produttore.indirizzo,
          cerCode: r.cerCode,
          quantitaPresunta: r.quantitaPresunta,
          numeroFir: r.fir?.numero ?? null,
          mezzo: r.automezzo?.targa ?? null,
        })),
      }
      const buffer = await this.pdf.generateDistintaPDF(dati, modello)
      return { buffer, nomeFile: nomeFileDistinta(dati) }
    })
  }

  /** PDF unico dei FIR attivi dei ritiri, nell'ordine dei ritiri (data, mezzo, giro, creazione). */
  async stampaFir(
    tenantId: string,
    ritiroIds: readonly string[],
    modelloId?: string
  ): Promise<FirStampati> {
    if (!Array.isArray(ritiroIds) || ritiroIds.length < 1) {
      throw new RitiroDatiNonValidiError(['Indica almeno un ritiro.'])
    }
    const ids = [...new Set(ritiroIds)]
    if (ids.length > FIR_SERIE_MAX) {
      throw new RitiroDatiNonValidiError([`Si possono stampare al massimo ${FIR_SERIE_MAX} FIR.`])
    }
    if (!ids.every(eUuid)) throw new RitiroDatiNonValidiError(['Un identificativo non è valido.'])

    return nelContestoTenant(tenantId, async () => {
      const modello = await this.modelloFir(tenantId, modelloId)
      // Una sola transazione: ritiri e FIR letti nello stesso istante.
      const { firs } = await this.prisma.$transaction(async tx => {
        const ordinati: RitiroVista[] = await this.repo.leggiMolti(tx, tenantId, ids)
        const firIds = ordinati.flatMap(r => (r.fir ? [r.fir.id] : []))
        if (firIds.length === 0) throw new NessunFirDaStampareError()
        const trovati = await tx.fIR.findMany({
          where: { id: { in: firIds }, tenantId },
          include: INCLUDE_FIR,
        })
        const perId = new Map(trovati.map(f => [f.id, f]))
        return { firIds, firs: firIds.flatMap(id => perId.get(id) ?? []) }
      })
      if (firs.length === 0) throw new NessunFirDaStampareError()

      const elementi = await Promise.all(
        firs.map(async fir => ({
          fir,
          qrCodeDataUrl: fir.rentriQrCodeBytes
            ? await generaQrVidimazione(fir.rentriQrCodeBytes)
            : undefined,
        }))
      )
      const buffer = await this.pdf.generateFIRSeriePDF(elementi, modello)
      return { buffer, nomeFile: 'FIR-ritiri.pdf', saltati: ids.length - firs.length }
    })
  }

  private async modelloDistinta(
    tenantId: string,
    modelloId: string | undefined
  ): Promise<ModelloStampaDistinta | null> {
    if (modelloId !== undefined) {
      const m = await this.modelli.getById(tenantId, modelloId)
      if (m.ambito === 'FIR') {
        throw new ModelloAmbitoNonValidoError(
          'Il modello del FIR non si usa per la distinta dei ritiri.'
        )
      }
      return comeModelloDistinta(m)
    }
    const predefiniti = (await this.modelli.list(tenantId)).filter(m => m.predefinito)
    const scelto = sceglieModelloDistinta(predefiniti.map(comeModelloDistinta))
    return scelto
  }

  private async modelloFir(tenantId: string, modelloId: string | undefined) {
    const esito = sceglieModelloFir(
      modelloId !== undefined
        ? { tipo: 'ESPLICITO', modello: await this.modelli.getById(tenantId, modelloId) }
        : { tipo: 'PREDEFINITO', elenco: await this.modelli.list(tenantId) }
    )
    if (esito.esito === 'AMBITO_NON_VALIDO') {
      throw new ModelloAmbitoNonValidoError(
        'Il modello della distinta dei ritiri non si usa per il FIR.'
      )
    }
    return esito.modello
  }
}

function comeModelloDistinta(m: {
  ambito: ModelloStampaDistinta['ambito']
  logoBase64: string | null
  testoIntestazione: string | null
  testoPiePagina: string | null
  colorePrimario: string
  coloreSecondario: string
}): ModelloStampaDistinta {
  return {
    ambito: m.ambito,
    logoBase64: m.logoBase64,
    headerText: m.testoIntestazione,
    footerText: m.testoPiePagina,
    primaryColor: m.colorePrimario,
    secondaryColor: m.coloreSecondario,
  }
}
