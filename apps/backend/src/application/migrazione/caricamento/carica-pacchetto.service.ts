/**
 * Caricamento di un pacchetto (`migrazione:carica`): rivalida lato server ogni record e lo scrive a
 * blocchi sul lotto dell'azienda. Solo client APPLICATIVO (RLS): mai il client di sistema.
 *
 * `verifica` e' di sola lettura, e lo e' per costruzione: gira in una transazione con
 * `transaction_read_only = on`, quindi il database stesso rifiuta qualunque scrittura.
 *
 * Log e rapporti: solo codici, id tecnici e conteggi. Mai valori dei record.
 */
import { Injectable } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { PacchettoError } from '../pacchetto/errori-pacchetto'
import type { PacchettoAperto } from '../pacchetto/lettore-pacchetto'
import { AmbitoPacchetto, FORMATO_PACCHETTO, IMPORT_SOURCE_WINWASTE } from '../pacchetto/manifest-pacchetto'
import { caricaAmbito, EsitoCaricamento, FaseCaricamento } from './carica-ambito'
import { Collisione, DefinizioneFase, FASI_AMBITO } from './fasi-ambito'
import { LottiImportService } from './lotti-import.service'
import { DIMENSIONE_BLOCCO_DEFAULT, Tx } from './tipi'

export interface RapportoVerifica {
  /** Cose che farebbero fallire il caricamento. Vuoto = si puo' caricare. */
  readonly bloccanti: readonly Collisione[]
  /** Conteggi informativi (righe per fase, gia' caricate...). */
  readonly informazioni: Readonly<Record<string, number>>
}

export interface RichiestaCaricamento {
  readonly tenantId: string
  readonly pacchetto: PacchettoAperto
  readonly ambito: AmbitoPacchetto
  readonly dimensioneBlocco?: number
  readonly avviatoDa?: string | null
}

/** Una fase dell'ambito non e' (ancora) presente nel pacchetto, o l'ambito non e' supportato. */
export class AmbitoNonCaricabileError extends Error {
  constructor(readonly ambito: string) {
    super(`Ambito ${ambito}: nessuna fase caricabile nel pacchetto`)
    this.name = 'AmbitoNonCaricabileError'
  }
}

/** Il ruolo del database aggira la RLS (proprietario, superutente o ruolo di sistema). */
export class RuoloNonApplicativoError extends Error {
  constructor() {
    super('Il ruolo del database aggira la sicurezza per azienda: il caricamento richiede il ruolo applicativo')
    this.name = 'RuoloNonApplicativoError'
  }
}

@Injectable()
export class CaricaPacchettoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lotti: LottiImportService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('CaricaPacchettoService')
  }

  /**
   * Rifiuta di lavorare con un ruolo che aggira la sicurezza per azienda (RLS): il caricamento
   * deve girare SOLO come ruolo applicativo, mai come proprietario o ruolo di sistema.
   * @throws RuoloNonApplicativoError
   */
  async verificaRuoloApplicativo(): Promise<void> {
    const [ruolo] = await this.prisma.$queryRaw<Array<{ bypass: boolean }>>`
      SELECT (r.rolbypassrls OR r.rolsuper) AS bypass FROM pg_roles r WHERE r.rolname = current_user`
    if (!ruolo || ruolo.bypass) throw new RuoloNonApplicativoError()
  }

  private fasiDa(r: { pacchetto: PacchettoAperto; ambito: AmbitoPacchetto }): Array<DefinizioneFase<any>> {
    const presenti = new Set(r.pacchetto.fasi(r.ambito).map(f => f.fase))
    const fasi = FASI_AMBITO[r.ambito].filter(f => presenti.has(f.nome))
    // Una fase del pacchetto che il server non conosce non si salta in silenzio.
    for (const f of presenti) {
      if (!FASI_AMBITO[r.ambito].some(d => d.nome === f)) throw new AmbitoNonCaricabileError(r.ambito)
    }
    if (fasi.length === 0) throw new AmbitoNonCaricabileError(r.ambito)
    return fasi
  }

  /** Legge e rivalida TUTTI i record di una fase. @throws PacchettoError `RIGA_NON_VALIDA` (senza valori) */
  private async leggiFase<R>(p: PacchettoAperto, ambito: AmbitoPacchetto, def: DefinizioneFase<R>): Promise<R[]> {
    const out: R[] = []
    for await (const { numeroRiga, record } of p.leggi(ambito, def.nome)) {
      try {
        out.push(def.valida(record, p.mappa))
      } catch (e) {
        if (e instanceof PacchettoError) {
          throw new PacchettoError('RIGA_NON_VALIDA', `fase ${def.nome}, riga ${numeroRiga}: ${e.dettaglio}`)
        }
        throw e
      }
    }
    return out
  }

  private async leggiTutto(r: { pacchetto: PacchettoAperto; ambito: AmbitoPacchetto }) {
    const def = this.fasiDa(r)
    const lette: Array<{ def: DefinizioneFase<any>; righe: unknown[] }> = []
    for (const d of def) lette.push({ def: d, righe: await this.leggiFase(r.pacchetto, r.ambito, d) })
    return lette
  }

  /** Solo letture (transazione read-only). Non crea lotti, non scrive nulla. */
  async verifica(r: RichiestaCaricamento): Promise<RapportoVerifica> {
    const bloccanti: Collisione[] = []
    const informazioni: Record<string, number> = {}
    let lette: Awaited<ReturnType<CaricaPacchettoService['leggiTutto']>> = []
    try {
      lette = await this.leggiTutto(r)
    } catch (e) {
      if (!(e instanceof PacchettoError) || e.codice !== 'RIGA_NON_VALIDA') throw e
      bloccanti.push({ codice: 'RECORD_NON_VALIDO', conteggio: 1 })
    }
    await TenantContext.run({ tenantId: r.tenantId }, async () =>
      this.prisma.$transaction(async (tx: Tx) => {
        await tx.$executeRaw`SET LOCAL transaction_read_only = on`
        bloccanti.push(...(await this.verificaMappa(tx, r)))
        const [inCorso] = await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM "lotti_import"
          WHERE "tenant_id" = ${r.tenantId}::uuid AND "archivio" = ${r.pacchetto.manifest.archivio}
            AND "ambito" = ${r.ambito}::"ambito_lotto_import" AND "stato" = 'IN_CORSO'`
        if (Number(inCorso.n) > 0) bloccanti.push({ codice: 'LOTTO_GIA_IN_CORSO', conteggio: Number(inCorso.n) })
        for (const { def, righe } of lette) {
          informazioni[`righe.${def.nome}`] = righe.length
          const esito = await def.collisioni(tx, r.tenantId, righe)
          informazioni[`gia_caricate.${def.nome}`] = esito.giaCaricate
          bloccanti.push(...esito.collisioni)
        }
      })
    )
    return { bloccanti, informazioni }
  }

  /** Registri, sedi, unita' locali, causali e agganci della mappa devono esistere nell'azienda. */
  private async verificaMappa(tx: Tx, r: RichiestaCaricamento): Promise<Collisione[]> {
    const m = r.pacchetto.mappa
    const t = r.tenantId
    const out: Collisione[] = []
    const aggiungi = (codice: string, conteggio: number) => {
      if (conteggio > 0) out.push({ codice, conteggio })
    }
    const mancanti = async (tabella: 'registri_rifiuti' | 'sedi_ditte' | 'rentri_unita_locali', ids: string[]) => {
      if (ids.length === 0) return 0
      const sql =
        tabella === 'registri_rifiuti'
          ? tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "registri_rifiuti" WHERE "tenant_id" = ${t}::uuid AND "id" = ANY(${ids}::uuid[])`
          : tabella === 'sedi_ditte'
            ? tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "sedi_ditte" WHERE "tenant_id" = ${t}::uuid AND "id" = ANY(${ids}::uuid[])`
            : tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "rentri_unita_locali" WHERE "tenant_id" = ${t}::uuid AND "id" = ANY(${ids}::uuid[])`
      const [{ n }] = await sql
      return new Set(ids).size - Number(n)
    }
    aggiungi('REGISTRO_INESISTENTE', await mancanti('registri_rifiuti', m.registri.map(x => x.registroId)))
    aggiungi('SEDE_INESISTENTE', await mancanti('sedi_ditte', m.unitaLocali.map(x => x.sedeId)))
    aggiungi(
      'UNITA_LOCALE_INESISTENTE',
      await mancanti('rentri_unita_locali', m.unitaLocali.map(x => x.unitaLocaleId).filter((v): v is string => v !== null))
    )
    aggiungi('CAUSALE_NON_CONFERMATA', m.causali.filter(c => !c.confermata).length)
    let causaliMancanti = 0
    for (const c of m.causali) {
      const [{ n }] = await tx.$queryRaw<Array<{ n: bigint }>>`
        SELECT (
          (SELECT count(*) FROM "causali_registro"
             WHERE "codice" = ${c.causale} AND "verso" = ${c.verso}::"waste_movement_type" AND "attiva")
          +
          (SELECT count(*) FROM "causali_registro_azienda"
             WHERE "tenant_id" = ${t}::uuid AND "natura" = 'PROPRIA' AND "codice" = ${c.causale}
               AND "verso" = ${c.verso}::"waste_movement_type")
        )::bigint AS n`
      if (Number(n) === 0) causaliMancanti++
    }
    aggiungi('CAUSALE_INESISTENTE', causaliMancanti)
    let agganciMancanti = 0
    for (const a of m.agganci) {
      const [{ n }] = await tx.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM "ditte"
        WHERE "tenant_id" = ${t}::uuid AND "id" = ${a.dittaId}::uuid AND "partita_iva" = ${a.partitaIva}`
      if (Number(n) === 0) agganciMancanti++
    }
    aggiungi('AGGANCIO_INESISTENTE', agganciMancanti)
    return out
  }

  /**
   * Carica l'ambito sullo stesso lotto, fase per fase. Rivalida TUTTO prima di aprire il lotto: un
   * record non valido ferma il caricamento senza lasciare un lotto `FALLITO`.
   * @throws PacchettoError `RIGA_NON_VALIDA`, AmbitoNonCaricabileError, FaseCaricamentoFallitaError,
   *   LottoGiaInCorsoError
   */
  async carica(r: RichiestaCaricamento): Promise<EsitoCaricamento> {
    const lette = await this.leggiTutto(r)
    const fasi: Array<FaseCaricamento<any>> = lette.map(({ def, righe }) => ({
      nome: def.nome,
      righe: async () => righe,
      opzioni: {
        inserisciBlocco: def.inserisciBlocco,
        dimensioneBlocco: r.dimensioneBlocco ?? DIMENSIONE_BLOCCO_DEFAULT,
      },
    }))
    return await caricaAmbito(
      { prisma: this.prisma, lotti: this.lotti, logger: this.logger },
      r.tenantId,
      {
        importSource: IMPORT_SOURCE_WINWASTE,
        archivio: r.pacchetto.manifest.archivio,
        ambito: r.ambito,
        formatoStaging: FORMATO_PACCHETTO,
        hashStaging: r.pacchetto.hashManifest,
        avviatoDa: r.avviatoDa ?? null,
      },
      fasi
    )
  }
}
