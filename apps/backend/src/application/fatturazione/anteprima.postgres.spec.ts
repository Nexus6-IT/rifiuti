/**
 * Anteprima di un'elaborazione (fase 4.4b1, Task 18, spec §5.3, decisione 20 e Q1-Q3, Q8, Q16, Q17)
 * contro un Postgres reale, collegato COME `wasteflow_app` (RLS FORCE). Il proprietario prepara gli
 * scenari e legge lo stato finale; pulizia solo per id esatti (`pulisciTenantDiTest`).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=fatt-t18-${process.pid}-anteprima&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import { improntaElaborazione } from '../../domain/fatturazione/impronta'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDocumentoDiTest } from '../../test-support/fatturazione-di-test'
import {
  creaAziendaT18,
  creaContrattoT18,
  creaLegameConfermatoT18,
  creaRigaT18,
  inserisciElaborazioneT18,
  type AziendaT18,
} from '../../test-support/fatturazione-t18-di-test'
import { creaContrattoConElenco, creaRiga } from '../../test-support/listino-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { LegamiService } from '../legami-movimento/conferma-legame.service'
import { PropostaLegameService } from '../legami-movimento/proposta-legame.service'
import { eseguiAnteprima, segnaFallita } from './anteprima'
import { chiaveNumerazione, riservaNumeri, suffissiDelleSerie } from './numerazione'
import { selezionaElaborazione, type ParametriElaborazione } from './selezione-fatturazione'

const P: ParametriElaborazione = {
  periodoDal: '2026-03-01',
  periodoAl: '2026-03-31',
  dataDocumento: '2026-04-05',
  raggruppamento: 'PER_CONTRATTO',
  includiArretrati: false,
  filtri: {},
}

describe('Anteprima — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
  })
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  const azienda = (o: { cedente?: boolean; predefinito?: boolean } = {}) =>
    creaAziendaT18(owner, tenantCreati, o)

  /** Inserisce l'elaborazione (IN_CODA, versione 1) e fa girare il job di anteprima. */
  async function anteprima(
    az: AziendaT18,
    p: Partial<ParametriElaborazione> = {}
  ): Promise<string> {
    const par = { ...P, ...p }
    const [r] = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO elaborazioni_fatturazione
         (tenant_id, stato, periodo_dal, periodo_al, data_documento, filtri, raggruppamento,
          includi_arretrati, updated_at)
       VALUES ($1::uuid, 'IN_CODA', $2::date, $3::date, $4::date, $5::jsonb,
               $6::raggruppamento_fatturazione, $7::boolean, now())
       RETURNING id::text AS id`,
      az.tenantId,
      par.periodoDal,
      par.periodoAl,
      par.dataDocumento,
      JSON.stringify(par.filtri),
      par.raggruppamento,
      par.includiArretrati
    )
    await nel(az.tenantId, () => eseguiAnteprima(app, az.tenantId, r.id, 1))
    return r.id
  }

  const elaborazione = async (id: string) =>
    (
      await owner.$queryRawUnsafe<
        {
          stato: string
          impronta: string | null
          riepilogo: Record<string, unknown> | null
          esito: unknown
          errore_tecnico: string | null
          errori_generali: string[]
        }[]
      >(
        `SELECT stato::text, impronta, riepilogo, esito, errore_tecnico, errori_generali
         FROM elaborazioni_fatturazione WHERE id = $1::uuid`,
        id
      )
    )[0]

  const documenti = (id: string) =>
    owner.$queryRawUnsafe<
      {
        id: string
        stato: string
        numero: number | null
        contratto_id: string
        elenco_id: string | null
        errori: string[]
        avvisi: string[]
        totale_documento: string
        fotografia: {
          segnalazioni: {
            errori: { codice: string; dettaglio?: string }[]
            avvisi: { codice: string }[]
          }
          cedente: unknown
        }
      }[]
    >(
      `SELECT id::text, stato::text, numero, contratto_id::text, elenco_id::text, errori, avvisi,
              totale_documento::text, fotografia
       FROM documenti_fattura WHERE elaborazione_id = $1::uuid ORDER BY created_at, id`,
      id
    )

  const statoLegami = (ids: string[]) =>
    owner.$queryRawUnsafe<
      { id: string; stato: string; versione: number; fatturato_il: Date | null }[]
    >(
      `SELECT id::text, stato::text, versione, fatturato_il FROM legami_movimento
       WHERE id = ANY($1::uuid[]) ORDER BY id`,
      ids
    )

  it('anteprima: bozze con righe, riepiloghi e rate; impronta di 64 caratteri; legami e numerazioni invariati', async () => {
    const az = await azienda()
    const c = await creaContrattoT18(owner, az)
    const l1 = await creaLegameConfermatoT18(owner, az, c, { data: '2026-03-10' })
    const l2 = await creaLegameConfermatoT18(owner, az, c, { data: '2026-03-12', quantita: '50' })
    const prima = await statoLegami([l1.legameId, l2.legameId])
    const id = await anteprima(az)

    const e = await elaborazione(id)
    expect(e.stato).toBe('ANTEPRIMA_PRONTA')
    expect(e.impronta).toMatch(/^[0-9a-f]{64}$/)
    expect(e.esito).toBeNull()
    expect(e.errore_tecnico).toBeNull()

    const docs = await documenti(id)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      stato: 'BOZZA',
      numero: null,
      errori: [],
      contratto_id: c.contrattoId,
    })
    expect(docs[0].elenco_id).toBeNull()
    expect(docs[0].fotografia.segnalazioni).toEqual({ errori: [], avvisi: expect.any(Array) })

    const righe = await owner.$queryRawUnsafe<
      { tipo_riga: string; legame_id: string | null; riga_legame_id: string | null }[]
    >(
      `SELECT tipo_riga::text, legame_id::text, riga_legame_id::text FROM righe_documento_fattura
       WHERE documento_id = $1::uuid ORDER BY numero_linea`,
      docs[0].id
    )
    expect(righe.filter(r => r.tipo_riga === 'MOVIMENTO')).toHaveLength(2)
    // I1, Q1, Q2: il legame c'e', la riga del legame mai.
    for (const r of righe.filter(x => x.tipo_riga === 'MOVIMENTO')) {
      expect(r.legame_id).not.toBeNull()
      expect(r.riga_legame_id).toBeNull()
    }
    const riep = await owner.$queryRawUnsafe<
      { aliquota: string; imponibile: string; imposta: string }[]
    >(
      `SELECT aliquota::text, imponibile::text, imposta::text FROM riepiloghi_iva_documento
       WHERE documento_id = $1::uuid`,
      docs[0].id
    )
    expect(riep).toEqual([{ aliquota: '22.00', imponibile: '150.00', imposta: '33.00' }])
    const rate = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM rate_documento_fattura WHERE documento_id = $1::uuid`,
      docs[0].id
    )
    expect(rate[0].n).toBe(1)

    expect(await statoLegami([l1.legameId, l2.legameId])).toEqual(prima)
    const num = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM numerazioni_fattura WHERE tenant_id = $1::uuid`,
      az.tenantId
    )
    expect(num[0].n).toBe(0)
    const marcatori = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM marcatori_addebiti_fatturati WHERE tenant_id = $1::uuid`,
      az.tenantId
    )
    expect(marcatori[0].n).toBe(0)
  })

  it('riepilogo: le chiavi di RiepilogoElaborazione e prontaIl (Q17)', async () => {
    const az = await azienda()
    const c = await creaContrattoT18(owner, az)
    await creaLegameConfermatoT18(owner, az, c)
    const id = await anteprima(az)
    const r = (await elaborazione(id)).riepilogo as Record<string, unknown>
    expect(Object.keys(r).sort()).toEqual(
      [
        'avvisi',
        'documenti',
        'documentiNonGenerati',
        'errori',
        'erroriPeriodo',
        'numerazionePrevista',
        'prontaIl',
        'totale',
        'totaliPerRegistro',
      ].sort()
    )
    expect(r).toMatchObject({ documenti: 1, totale: '122.00', errori: 0, documentiNonGenerati: [] })
    expect(r.prontaIl).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(r.totaliPerRegistro).toEqual([
      { registroIvaId: az.tab.registroId, imponibile: '100.00', iva: '22.00', totale: '122.00' },
    ])
  })

  it('bozza con FAMIGLIA_NON_CALCOLATA: fotografia.segnalazioni.errori con dettaglio «TS riga N» (Q16)', async () => {
    const az = await azienda()
    const c = await creaContrattoT18(owner, az)
    await creaLegameConfermatoT18(owner, az, c)
    await creaRigaT18(owner, az, c.elencoId, 'TS', '1')
    const id = await anteprima(az)
    const [d] = await documenti(id)
    expect(d.errori).toContain('FAMIGLIA_NON_CALCOLATA')
    const e = d.fotografia.segnalazioni.errori.find(x => x.codice === 'FAMIGLIA_NON_CALCOLATA')
    expect(e?.dettaglio).toBe('TS riga 2')
    expect((await elaborazione(id)).riepilogo).toMatchObject({ errori: 1, documenti: 1 })
  })

  it('contratto senza registro e senza predefinito: nessuna bozza, una voce in documentiNonGenerati con SENZA_REGISTRO_IVA, contata negli errori (Q3)', async () => {
    const az = await azienda({ predefinito: false })
    const c = await creaContrattoT18(owner, az, { registroIvaId: null })
    await creaLegameConfermatoT18(owner, az, c)
    const id = await anteprima(az)
    expect(await documenti(id)).toHaveLength(0)
    const e = await elaborazione(id)
    expect(e.stato).toBe('ANTEPRIMA_PRONTA')
    const r = e.riepilogo as {
      errori: number
      documenti: number
      documentiNonGenerati: { contrattoId: string; errori: { codice: string }[] }[]
    }
    expect(r.documenti).toBe(0)
    expect(r.errori).toBe(1)
    expect(r.documentiNonGenerati).toHaveLength(1)
    expect(r.documentiNonGenerati[0]).toMatchObject({ contrattoId: c.contrattoId })
    expect(r.documentiNonGenerati[0].errori.map(x => x.codice)).toContain('SENZA_REGISTRO_IVA')
  })

  it('PER_ELENCO: la bozza porta l’elenco; PER_CONTRATTO no', async () => {
    const az = await azienda()
    const c = await creaContrattoT18(owner, az)
    await creaLegameConfermatoT18(owner, az, c)
    const id = await anteprima(az, { raggruppamento: 'PER_ELENCO' })
    const [d] = await documenti(id)
    expect(d.elenco_id).toBe(c.elencoId)
  })

  it('errori generali dell’elaborazione: il cedente incompleto resta nella colonna e nel dettaglio', async () => {
    const az = await azienda({ cedente: false })
    const c = await creaContrattoT18(owner, az)
    await creaLegameConfermatoT18(owner, az, c)
    const id = await anteprima(az)
    expect((await elaborazione(id)).errori_generali).toContain('CEDENTE_INCOMPLETO')
  })

  describe('numerazione prevista e suffisso della serie (decisione 20, Q8)', () => {
    async function conNumerazione(
      az: AziendaT18,
      registroId: string,
      anno: number,
      ultimo: number
    ): Promise<void> {
      await owner.$executeRawUnsafe(
        `INSERT INTO numerazioni_fattura
           (tenant_id, registro_iva_id, anno, ultimo_numero, numero_partenza, ultima_data, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::int, $4::int, 0, make_date($3::int, 3, 15), now())`,
        az.tenantId,
        registroId,
        anno,
        ultimo
      )
    }
    const impostaSuffisso = (registroId: string, suffisso: string | null) =>
      owner.registroIva.update({ where: { id: registroId }, data: { suffissoNumero: suffisso } })
    /** Il trigger rifiuta la modifica di un definitivo anche al proprietario: serve la replica. */
    const impostaNumeroTesto = (documentoId: string, testo: string) =>
      owner.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`)
        await tx.$executeRawUnsafe(
          `UPDATE documenti_fattura SET numero_testo = $2 WHERE id = $1::uuid`,
          documentoId,
          testo
        )
      })
    const definitivo = async (
      az: AziendaT18,
      registroId: string,
      anno: number,
      numero: number,
      testo: string
    ) => {
      const { documentoId } = await creaDocumentoDiTest(owner, az.tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: registroId,
        anno,
        numero,
      })
      await impostaNumeroTesto(documentoId, testo)
      return documentoId
    }
    const suffissi = (az: AziendaT18, coppie: { registroIvaId: string; anno: number }[]) =>
      nel(az.tenantId, () => app.$transaction(tx => suffissiDelleSerie(tx, az.tenantId, coppie)))

    it('numerazione prevista «da 15/A a 16/A» senza toccare numerazioni_fattura', async () => {
      const az = await azienda()
      await impostaSuffisso(az.tab.registroId, '/A')
      await conNumerazione(az, az.tab.registroId, 2026, 14)
      for (let i = 0; i < 2; i++) {
        const c = await creaContrattoT18(owner, az)
        await creaLegameConfermatoT18(owner, az, c)
      }
      const id = await anteprima(az)
      const r = (await elaborazione(id)).riepilogo as { numerazionePrevista: unknown[] }
      expect(r.numerazionePrevista).toEqual([
        { registroIvaId: az.tab.registroId, codiceRegistro: '01', da: '15/A', a: '16/A' },
      ])
      const dopo = await owner.$queryRawUnsafe<{ ultimo_numero: number; versione: number }[]>(
        `SELECT ultimo_numero, versione FROM numerazioni_fattura WHERE tenant_id = $1::uuid`,
        az.tenantId
      )
      expect(dopo).toEqual([{ ultimo_numero: 14, versione: 1 }])
    })

    it('suffisso cambiato da /A a /B a gennaio: un documento di una serie con definitivi prende /A in anteprima e in riservaNumeri; una serie nuova prende /B', async () => {
      const az = await azienda()
      // Il registro oggi ha /B; la serie 2026 ha gia' definitivi numerati con /A.
      await impostaSuffisso(az.tab.registroId, '/B')
      await definitivo(az, az.tab.registroId, 2026, 15, '15/A')
      await conNumerazione(az, az.tab.registroId, 2026, 15)
      const c = await creaContrattoT18(owner, az)
      await creaLegameConfermatoT18(owner, az, c)
      const id = await anteprima(az)
      const r = (await elaborazione(id)).riepilogo as {
        numerazionePrevista: { da: string; a: string }[]
      }
      expect(r.numerazionePrevista[0]).toMatchObject({ da: '16/A', a: '16/A' })

      const riservati = await nel(az.tenantId, () =>
        app.$transaction(tx =>
          riservaNumeri(tx, az.tenantId, [
            {
              registroIvaId: az.tab.registroId,
              anno: 2026,
              quanti: 1,
              dataDocumento: '2026-04-05',
            },
            // Coppia senza definitivi (altro anno): suffisso attuale del registro.
            {
              registroIvaId: az.tab.registroId,
              anno: 2025,
              quanti: 1,
              dataDocumento: '2025-04-05',
            },
          ])
        )
      )
      const di = (anno: number) => riservati.find(x => x.anno === anno)!
      expect(di(2026)).toMatchObject({ da: 16, a: 16, suffisso: '/A' })
      expect(di(2025)).toMatchObject({ da: 1, a: 1, suffisso: '/B' })
    })

    it('suffissiDelleSerie: senza definitivi il suffisso del registro; «15/A» da «/A»; senza suffisso null; vince il numero piu’ alto', async () => {
      const az = await azienda()
      const reg = az.tab.registroId
      const split = az.tab.registroSplitId
      await impostaSuffisso(reg, '/B')
      await impostaSuffisso(split, '/Z')
      // reg 2026: nessun definitivo -> /B. reg 2025: definitivi 14 con /B e 15 con /A -> /A.
      await definitivo(az, reg, 2025, 14, '14/B')
      await definitivo(az, reg, 2025, 15, '15/A')
      // split 2026: un definitivo senza suffisso -> null (il registro dice /Z ma la serie e' nata senza).
      await definitivo(az, split, 2026, 1, '1')
      const m = await suffissi(az, [
        { registroIvaId: reg, anno: 2026 },
        { registroIvaId: reg, anno: 2025 },
        { registroIvaId: split, anno: 2026 },
        { registroIvaId: split, anno: 2025 },
      ])
      expect(m.get(chiaveNumerazione(reg, 2026))).toBe('/B')
      expect(m.get(chiaveNumerazione(reg, 2025))).toBe('/A')
      expect(m.get(chiaveNumerazione(split, 2026))).toBeNull()
      expect(m.get(chiaveNumerazione(split, 2025))).toBe('/Z')
    })

    it('suffissiDelleSerie e’ di sola lettura e rispetta il tenant', async () => {
      const a = await azienda()
      const b = await azienda()
      await definitivo(b, b.tab.registroId, 2026, 3, '3/Q')
      const m = await suffissi(a, [{ registroIvaId: a.tab.registroId, anno: 2026 }])
      expect(m.get(chiaveNumerazione(a.tab.registroId, 2026))).toBeNull()
      expect(await suffissi(a, [])).toEqual(new Map())
    })
  })

  describe('legami e anteprima aperta (I1, Q2)', () => {
    it('legame in un’anteprima aperta: la conferma della 4.3 con cambio di elenco riesce (nessun 23503) e l’impronta risulta superata', async () => {
      const az = await azienda()
      const c = await creaContrattoT18(owner, az)
      const l = await creaLegameConfermatoT18(owner, az, c)
      const id = await anteprima(az)
      const impronta = (await elaborazione(id)).impronta

      // Secondo contratto dello stesso cliente, con la sua riga CER: il legame cambia elenco.
      const c2 = await creaContrattoConElenco(owner, az.tenantId, { clienteId: c.clienteId })
      await creaRiga(owner, az.tenantId, c2.elencoId, {
        tipo: 'CER',
        cerCode: '20 03 01',
        codiceIvaId: az.listino.iva22Id,
      })
      const [{ versione }] = await owner.$queryRawUnsafe<{ versione: number }[]>(
        `SELECT versione FROM legami_movimento WHERE id = $1::uuid`,
        l.legameId
      )
      const legami = new LegamiService(app, new PropostaLegameService(app))
      const v = await legami.conferma(az.tenantId, az.utenteId, l.legameId, versione, {
        contrattoId: c2.contrattoId,
      })
      expect(v.stato).toBe('CONFERMATO')

      const nuova = await nel(az.tenantId, () =>
        app.$transaction(tx => selezionaElaborazione(tx, az.tenantId, P))
      )
      expect(improntaElaborazione(nuova.versioni)).not.toBe(impronta)
    })
  })

  describe('contesto del tenant', () => {
    it('FALLITA non si scrive per un’elaborazione di un altro tenant (RLS)', async () => {
      const a = await azienda()
      const b = await azienda()
      const id = await inserisciElaborazioneT18(owner, a.tenantId, 'IN_CORSO')
      await segnaFallita(app, b.tenantId, id, 'Errore tecnico')
      expect((await elaborazione(id)).stato).toBe('IN_CORSO')
      await segnaFallita(app, a.tenantId, id, 'Errore tecnico')
      expect(await elaborazione(id)).toMatchObject({
        stato: 'FALLITA',
        errore_tecnico: 'Errore tecnico',
      })
    })

    it('segnaFallita non tocca un’elaborazione gia’ pronta', async () => {
      const a = await azienda()
      const id = await inserisciElaborazioneT18(owner, a.tenantId, 'ANTEPRIMA_PRONTA')
      await segnaFallita(app, a.tenantId, id, 'Errore tecnico')
      expect((await elaborazione(id)).stato).toBe('ANTEPRIMA_PRONTA')
    })
  })
})
