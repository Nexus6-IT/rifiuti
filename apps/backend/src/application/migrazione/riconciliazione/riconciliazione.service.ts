/**
 * Riconciliazione di un import (I8 T5): genera il rapporto versionato, accetta le differenze una per
 * una con motivo, registra l'esito del campione a mano, carica il verbale e chiude. Tutto dal client
 * APPLICATIVO dentro `TenantContext.run` (RLS ENABLE+FORCE); le scritture sono insert (una versione
 * nuova per ogni cambiamento) e l'unica UPDATE di un rapporto e' APERTO -> CHIUSO.
 *
 * Log: solo id tecnici e conteggi, mai valori dei record.
 */
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash, randomUUID } from 'crypto'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { nuovoSeme } from '../../../domain/migrazione/riconciliazione/campione'
import {
  EsitoCampione,
  motivoValido,
  StatoCampioni,
  valutaChiusura,
  ValutazioneChiusura,
} from '../../../domain/migrazione/riconciliazione/chiusura'
import {
  confrontiDa1A5,
  SorgenteRiconciliazione,
} from '../../../domain/migrazione/riconciliazione/confronti'
import { hashCanonico } from '../../../domain/migrazione/riconciliazione/hash-rapporto'
import {
  Accettazione,
  chiaveDifferenza,
  ConfrontoRiconciliazione,
  EsitiRiconciliazione,
  GiacenzaAttesa,
  VerificaRentri,
} from '../../../domain/migrazione/riconciliazione/tipi'
import {
  CampioneInesistenteError,
  DifferenzaInesistenteError,
  MotivoNonValidoError,
  RapportoChiusoError,
  RapportoNonChiudibileError,
  RapportoNonTrovatoError,
  VerbaleGiaCaricatoError,
  VerbaleNonValidoError,
  VersioneCambiataError,
} from './errori'
import { leggiDestinazione } from './leggi-destinazione'
import { LettoreRentri, verificaRentriSolaLettura } from './verifica-rentri'

type Tx = Prisma.TransactionClient

export const DIMENSIONE_CAMPIONE_PREDEFINITA = 10
export const DIMENSIONE_MASSIMA_VERBALE = 10 * 1024 * 1024

export interface GeneraRapporto {
  readonly tenantId: string
  readonly lottiIds: readonly string[]
  readonly sorgente: SorgenteRiconciliazione
  /** Impronta del file del rapporto sorgente (`hashCanonico` del JSON letto). */
  readonly hashSorgente: string
  readonly giacenzeAttese?: readonly GiacenzaAttesa[]
  /** Se presente, si verificano in sola lettura gli identificativi RENTRI importati. */
  readonly lettoreRentri?: LettoreRentri
  readonly pausaRentriMs?: number
  readonly seme?: string
  readonly dimensioneCampione?: number
  readonly creatoDa?: string | null
  /** Ricalcola un rapporto esistente (radice): stessi lotti, stesso campione. */
  readonly radiceId?: string
}

export interface RapportoLetto {
  readonly id: string
  readonly radiceId: string
  readonly versione: number
  readonly stato: 'APERTO' | 'CHIUSO'
  readonly lottiImportIds: readonly string[]
  readonly esiti: EsitiRiconciliazione
  readonly hashRapporto: string
  readonly hashSorgente: string
  readonly chiusoIl: Date | null
  readonly campioni: ReadonlyArray<{
    id: string
    tipo: 'MOVIMENTO' | 'FIR'
    riferimentoId: string
    legacyKey: string | null
    esito: EsitoCampione | null
    nota: string | null
  }>
  readonly verbali: ReadonlyArray<{
    id: string
    versioneRapporto: number
    nomeFile: string
    dimensione: number
    sha256: string
    createdAt: Date
  }>
  readonly valutazione: ValutazioneChiusura
}

export interface RiepilogoRapporto {
  readonly radiceId: string
  readonly versione: number
  readonly stato: 'APERTO' | 'CHIUSO'
  readonly archivio: string
  readonly lottiImportIds: readonly string[]
  readonly creatoIl: Date
  readonly chiudibile: boolean
  readonly differenzeAperte: number
  readonly campioniSenzaEsito: number
  readonly verbali: number
}

export interface EsitoGenerazione {
  readonly rapporto: RapportoLetto
  /** `false` se il ricalcolo ha dato lo stesso rapporto (stessa impronta): nessuna versione nuova. */
  readonly nuovaVersione: boolean
}

const JSON_ESITI = (e: EsitiRiconciliazione) => e as unknown as Prisma.InputJsonValue

@Injectable()
export class RiconciliazioneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('RiconciliazioneService')
  }

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  // --- Generazione ---------------------------------------------------------------------------

  async genera(richiesta: GeneraRapporto): Promise<EsitoGenerazione> {
    const { tenantId } = richiesta
    // 1. Letture (nessuna scrittura): destinazione e rapporto precedente.
    const precedente = richiesta.radiceId
      ? await this.nelTenant(tenantId, tx => this.ultimaVersione(tx, tenantId, richiesta.radiceId!))
      : null
    if (richiesta.radiceId && !precedente) throw new RapportoNonTrovatoError()
    if (precedente?.stato === 'CHIUSO') throw new RapportoChiusoError()
    const lottiIds = precedente
      ? precedente.lottiImportIds
      : [...new Set(richiesta.lottiIds)].sort()
    const destinazione = await this.nelTenant(tenantId, tx =>
      leggiDestinazione(tx, tenantId, lottiIds)
    )

    // 2. Verifica RENTRI in sola lettura, fuori da ogni transazione (rete).
    let verifiche: VerificaRentri[] | undefined
    if (richiesta.lettoreRentri && destinazione.rentri.identificativi.length > 0) {
      verifiche = await verificaRentriSolaLettura(
        richiesta.lettoreRentri,
        destinazione.rentri.identificativi,
        { pausaMs: richiesta.pausaRentriMs, tenantId }
      )
    }

    const confronti = confrontiDa1A5({
      sorgente: richiesta.sorgente,
      destinazione,
      giacenzeAttese: richiesta.giacenzeAttese,
      verificheRentri: verifiche,
    })

    // 3. Scrittura: una versione nuova solo se il rapporto e' cambiato.
    return await this.nelTenant(tenantId, async tx => {
      const ultima = precedente
        ? await this.ultimaVersione(tx, tenantId, precedente.radiceId)
        : null
      if (ultima && ultima.versione !== precedente!.versione) {
        throw new VersioneCambiataError(precedente!.versione, ultima.versione)
      }
      const vecchio = ultima ? (ultima.esiti as unknown as EsitiRiconciliazione) : null
      const dimensione = vecchio
        ? { movimenti: vecchio.campione.richiesti, fir: vecchio.campione.richiesti }
        : {
            movimenti: richiesta.dimensioneCampione ?? DIMENSIONE_CAMPIONE_PREDEFINITA,
            fir: richiesta.dimensioneCampione ?? DIMENSIONE_CAMPIONE_PREDEFINITA,
          }
      const seme = vecchio?.campione.seme ?? richiesta.seme ?? nuovoSeme()
      const radiceId = ultima?.radiceId ?? randomUUID()
      const idRiga = ultima ? randomUUID() : radiceId

      // Il campione si sceglie una volta, alla prima versione.
      let nMovimenti = vecchio?.campione.movimenti ?? 0
      let nFir = vecchio?.campione.fir ?? 0
      let daCreare: Array<{
        tipo: 'MOVIMENTO' | 'FIR'
        riferimentoId: string
        legacyKey: string | null
      }> = []
      if (!ultima) {
        const movimenti = await this.scegliCampione(
          tx,
          tenantId,
          lottiIds,
          'waste_movements',
          seme,
          dimensione.movimenti
        )
        const fir = await this.scegliCampione(tx, tenantId, lottiIds, 'firs', seme, dimensione.fir)
        daCreare = [
          ...movimenti.map(m => ({ tipo: 'MOVIMENTO' as const, ...m })),
          ...fir.map(m => ({ tipo: 'FIR' as const, ...m })),
        ]
        nMovimenti = movimenti.length
        nFir = fir.length
      }

      const accettazioni = this.accettazioniValide(vecchio?.accettazioni ?? {}, confronti)
      const esiti: EsitiRiconciliazione = {
        formato: 'wasteflow-riconciliazione/1',
        archivioSorgente: richiesta.sorgente.archivio,
        hashRapportoSorgente: richiesta.hashSorgente,
        confronti,
        campione: {
          seme,
          richiesti: dimensione.movimenti,
          movimenti: nMovimenti,
          fir: nFir,
        },
        accettazioni,
      }
      const hash = hashCanonico({ lotti: lottiIds, esiti })
      if (ultima && ultima.hashRapporto === hash) {
        return { rapporto: await this.leggiVersione(tx, tenantId, ultima), nuovaVersione: false }
      }
      const creata = await tx.rapportoRiconciliazione.create({
        data: {
          id: idRiga,
          tenantId,
          radiceId,
          versione: (ultima?.versione ?? 0) + 1,
          lottiImportIds: [...lottiIds],
          esiti: JSON_ESITI(esiti),
          hashRapporto: hash,
          hashSorgente: richiesta.hashSorgente,
          creatoDa: richiesta.creatoDa ?? null,
        },
      })
      if (daCreare.length > 0) {
        await tx.campioneRiconciliazione.createMany({
          data: daCreare.map(c => ({
            tenantId,
            rapportoRadiceId: radiceId,
            tipo: c.tipo,
            riferimentoId: c.riferimentoId,
            legacyKey: c.legacyKey,
          })),
        })
      }
      this.logger.info('Rapporto di riconciliazione generato', {
        tenantId,
        rapportoId: creata.id,
        versione: creata.versione,
      })
      return { rapporto: await this.leggiVersione(tx, tenantId, creata), nuovaVersione: true }
    })
  }

  /** Righe ordinate per l'impronta di `seme|id`, la stessa regola di `scegliCampione` (provata in test). */
  private async scegliCampione(
    tx: Tx,
    tenantId: string,
    lottiIds: readonly string[],
    tabella: 'waste_movements' | 'firs',
    seme: string,
    n: number
  ): Promise<Array<{ riferimentoId: string; legacyKey: string | null }>> {
    if (n <= 0) return []
    const sql =
      tabella === 'waste_movements'
        ? Prisma.sql`SELECT id::text AS id, legacy_key FROM waste_movements`
        : Prisma.sql`SELECT id::text AS id, legacy_key FROM firs`
    const righe = await tx.$queryRaw<Array<{ id: string; legacy_key: string | null }>>`
      ${sql}
      WHERE tenant_id = ${tenantId}::uuid AND lotto_import_id = ANY(${[...lottiIds]}::uuid[])
      ORDER BY encode(sha256(convert_to(${seme} || '|' || id::text, 'UTF8')), 'hex'), id::text
      LIMIT ${n}`
    return righe.map(r => ({ riferimentoId: r.id, legacyKey: r.legacy_key }))
  }

  /** Un'accettazione sopravvive a un nuovo calcolo solo se la voce e' ancora una differenza con gli stessi valori. */
  private accettazioniValide(
    precedenti: Readonly<Record<string, Accettazione>>,
    confronti: readonly ConfrontoRiconciliazione[]
  ): Record<string, Accettazione> {
    const valide: Record<string, Accettazione> = {}
    for (const c of confronti)
      for (const v of c.voci) {
        if (v.esito !== 'DIFFERENZA') continue
        const k = chiaveDifferenza(c.numero, v.chiave)
        const a = precedenti[k]
        if (a && a.sorgente === v.sorgente && a.destinazione === v.destinazione) valide[k] = a
      }
    return valide
  }

  // --- Accettazione delle differenze ---------------------------------------------------------

  async accettaDifferenza(richiesta: {
    tenantId: string
    radiceId: string
    versione: number
    chiave: string
    motivo: unknown
    utenteId: string
  }): Promise<RapportoLetto> {
    const motivo = motivoValido(richiesta.motivo)
    if (!motivo) throw new MotivoNonValidoError()
    return await this.nelTenant(richiesta.tenantId, async tx => {
      const ultima = await this.versioneAggiornata(tx, richiesta)
      const esiti = ultima.esiti as unknown as EsitiRiconciliazione
      const voce = esiti.confronti
        .flatMap(c => c.voci.map(v => ({ k: chiaveDifferenza(c.numero, v.chiave), v })))
        .find(x => x.k === richiesta.chiave)
      if (!voce || voce.v.esito !== 'DIFFERENZA')
        throw new DifferenzaInesistenteError(richiesta.chiave)
      const nuovi: EsitiRiconciliazione = {
        ...esiti,
        accettazioni: {
          ...esiti.accettazioni,
          [richiesta.chiave]: {
            motivo,
            da: richiesta.utenteId,
            il: new Date().toISOString(),
            sorgente: voce.v.sorgente,
            destinazione: voce.v.destinazione,
          },
        },
      }
      const creata = await tx.rapportoRiconciliazione.create({
        data: {
          tenantId: richiesta.tenantId,
          radiceId: ultima.radiceId,
          versione: ultima.versione + 1,
          lottiImportIds: ultima.lottiImportIds,
          esiti: JSON_ESITI(nuovi),
          hashRapporto: hashCanonico({ lotti: [...ultima.lottiImportIds], esiti: nuovi }),
          hashSorgente: ultima.hashSorgente,
          creatoDa: richiesta.utenteId,
        },
      })
      this.logger.info('Differenza di riconciliazione accettata', {
        tenantId: richiesta.tenantId,
        rapportoId: creata.id,
        versione: creata.versione,
      })
      return await this.leggiVersione(tx, richiesta.tenantId, creata)
    })
  }

  // --- Campione ------------------------------------------------------------------------------

  async registraEsitoCampione(richiesta: {
    tenantId: string
    campioneId: string
    esito: EsitoCampione
    nota?: string | null
    utenteId: string
  }): Promise<void> {
    if (richiesta.nota && richiesta.nota.length > 500) throw new MotivoNonValidoError()
    await this.nelTenant(richiesta.tenantId, async tx => {
      const c = await tx.campioneRiconciliazione.findFirst({
        where: { id: richiesta.campioneId, tenantId: richiesta.tenantId },
        select: { id: true, rapportoRadiceId: true },
      })
      if (!c) throw new CampioneInesistenteError()
      const chiuso = await tx.rapportoRiconciliazione.count({
        where: { radiceId: c.rapportoRadiceId, tenantId: richiesta.tenantId, stato: 'CHIUSO' },
      })
      if (chiuso > 0) throw new RapportoChiusoError()
      await tx.campioneRiconciliazione.update({
        where: { id: c.id },
        data: {
          esito: richiesta.esito,
          nota: richiesta.nota?.trim() || null,
          esitoDa: richiesta.utenteId,
          esitoIl: new Date(),
        },
      })
    })
  }

  // --- Verbale e chiusura --------------------------------------------------------------------

  async caricaVerbale(richiesta: {
    tenantId: string
    radiceId: string
    versione: number
    nomeFile: string
    contenuto: Buffer
    utenteId: string
  }): Promise<RapportoLetto> {
    const { contenuto } = richiesta
    if (contenuto.length === 0) throw new VerbaleNonValidoError('file vuoto')
    if (contenuto.length > DIMENSIONE_MASSIMA_VERBALE)
      throw new VerbaleNonValidoError('oltre i 10 MB')
    if (contenuto.subarray(0, 5).toString('latin1') !== '%PDF-')
      throw new VerbaleNonValidoError('non e un PDF')
    const nome = richiesta.nomeFile
      .replace(/[\\/\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 255)
    if (!nome) throw new VerbaleNonValidoError('nome del file mancante')
    return await this.nelTenant(richiesta.tenantId, async tx => {
      const ultima = await this.versioneAggiornata(tx, richiesta)
      try {
        await tx.verbaleRiconciliazione.create({
          data: {
            tenantId: richiesta.tenantId,
            rapportoRadiceId: ultima.radiceId,
            versioneRapporto: ultima.versione,
            nomeFile: nome,
            mime: 'application/pdf',
            dimensione: contenuto.length,
            sha256: createHash('sha256').update(contenuto).digest('hex'),
            contenuto,
            caricatoDa: richiesta.utenteId,
          },
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new VerbaleGiaCaricatoError()
        throw e
      }
      return await this.leggiVersione(tx, richiesta.tenantId, ultima)
    })
  }

  async chiudi(richiesta: {
    tenantId: string
    radiceId: string
    versione: number
    utenteId: string
  }): Promise<RapportoLetto> {
    return await this.nelTenant(richiesta.tenantId, async tx => {
      const ultima = await this.versioneAggiornata(tx, richiesta)
      const lettura = await this.leggiVersione(tx, richiesta.tenantId, ultima)
      if (!lettura.valutazione.chiudibile) throw new RapportoNonChiudibileError(lettura.valutazione)
      const chiusa = await tx.rapportoRiconciliazione.update({
        where: { id: ultima.id },
        data: { stato: 'CHIUSO', chiusoDa: richiesta.utenteId, chiusoIl: new Date() },
      })
      this.logger.info('Rapporto di riconciliazione chiuso', {
        tenantId: richiesta.tenantId,
        rapportoId: chiusa.id,
        versione: chiusa.versione,
      })
      return await this.leggiVersione(tx, richiesta.tenantId, chiusa)
    })
  }

  // --- Lettura -------------------------------------------------------------------------------

  async leggi(tenantId: string, radiceId: string): Promise<RapportoLetto> {
    return await this.nelTenant(tenantId, async tx => {
      const ultima = await this.ultimaVersione(tx, tenantId, radiceId)
      if (!ultima) throw new RapportoNonTrovatoError()
      return await this.leggiVersione(tx, tenantId, ultima)
    })
  }

  /** Rapporti dell'azienda: l'ultima versione di ciascuno, dal piu' recente. Solo il riepilogo. */
  async elenca(tenantId: string): Promise<RiepilogoRapporto[]> {
    return await this.nelTenant(tenantId, async tx => {
      const radici = await tx.rapportoRiconciliazione.findMany({
        where: { tenantId, versione: 1 },
        select: { id: true },
      })
      const riepiloghi: RiepilogoRapporto[] = []
      for (const r of radici) {
        const ultima = await this.ultimaVersione(tx, tenantId, r.id)
        if (!ultima) continue
        const l = await this.leggiVersione(tx, tenantId, ultima)
        riepiloghi.push({
          radiceId: l.radiceId,
          versione: l.versione,
          stato: l.stato,
          archivio: l.esiti.archivioSorgente,
          lottiImportIds: l.lottiImportIds,
          creatoIl: ultima.createdAt,
          chiudibile: l.valutazione.chiudibile,
          differenzeAperte: l.valutazione.differenzeAperte.length,
          campioniSenzaEsito: l.valutazione.campioniSenzaEsito,
          verbali: l.verbali.length,
        })
      }
      return riepiloghi.sort((a, b) => b.creatoIl.getTime() - a.creatoIl.getTime())
    })
  }

  /** I lotti `COMPLETATO` dell'archivio per l'azienda: l'insieme predefinito di un rapporto. */
  async lottiCompletati(tenantId: string, archivio: string): Promise<string[]> {
    return await this.nelTenant(tenantId, async tx =>
      (
        await tx.lottoImport.findMany({
          where: { tenantId, archivio, stato: 'COMPLETATO' },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      ).map(l => l.id)
    )
  }

  // --- Interni -------------------------------------------------------------------------------

  private async ultimaVersione(tx: Tx, tenantId: string, radiceId: string) {
    return await tx.rapportoRiconciliazione.findFirst({
      where: { tenantId, radiceId },
      orderBy: { versione: 'desc' },
    })
  }

  /** L'ultima versione, verificando che sia quella che l'operatore ha letto e che il rapporto sia aperto. */
  private async versioneAggiornata(
    tx: Tx,
    r: { tenantId: string; radiceId: string; versione: number }
  ) {
    const ultima = await this.ultimaVersione(tx, r.tenantId, r.radiceId)
    if (!ultima) throw new RapportoNonTrovatoError()
    if (ultima.stato === 'CHIUSO') throw new RapportoChiusoError()
    if (ultima.versione !== r.versione) throw new VersioneCambiataError(r.versione, ultima.versione)
    return ultima
  }

  private async leggiVersione(
    tx: Tx,
    tenantId: string,
    v: NonNullable<Awaited<ReturnType<RiconciliazioneService['ultimaVersione']>>>
  ): Promise<RapportoLetto> {
    const [campioni, verbali] = await Promise.all([
      tx.campioneRiconciliazione.findMany({
        where: { tenantId, rapportoRadiceId: v.radiceId },
        orderBy: [{ tipo: 'asc' }, { riferimentoId: 'asc' }],
        select: {
          id: true,
          tipo: true,
          riferimentoId: true,
          legacyKey: true,
          esito: true,
          nota: true,
        },
      }),
      tx.verbaleRiconciliazione.findMany({
        where: { tenantId, rapportoRadiceId: v.radiceId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          versioneRapporto: true,
          nomeFile: true,
          dimensione: true,
          sha256: true,
          createdAt: true,
        },
      }),
    ])
    const stato: StatoCampioni = {
      totale: campioni.length,
      senzaEsito: campioni.filter(c => c.esito === null).length,
      nonCorrispondono: campioni.filter(c => c.esito === 'NON_CORRISPONDE').length,
    }
    const esiti = v.esiti as unknown as EsitiRiconciliazione
    return {
      id: v.id,
      radiceId: v.radiceId,
      versione: v.versione,
      stato: v.stato,
      lottiImportIds: v.lottiImportIds,
      esiti,
      hashRapporto: v.hashRapporto,
      hashSorgente: v.hashSorgente,
      chiusoIl: v.chiusoIl,
      campioni,
      verbali,
      valutazione: valutaChiusura(esiti, stato),
    }
  }
}
