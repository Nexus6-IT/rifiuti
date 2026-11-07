/**
 * Selezione dell'elaborazione di fatturazione (fase 4.4b1, Task 17, spec §5.2, decisioni 21, 24 e
 * 25) contro un Postgres reale, collegato COME `wasteflow_app` (RLS FORCE). Il proprietario prepara
 * gli scenari; la pulizia e' solo per id esatti (`pulisciTenantDiTest`). Le prove di volume
 * scrivono l'id dell'azienda su file PRIMA del caricamento e ripuliscono anche un giro interrotto.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { calcolaDocumento } from '../../domain/fatturazione/calcola-documento'
import { improntaElaborazione } from '../../domain/fatturazione/impronta'
import { ERRORI_GENERALI_BLOCCANTI } from '../../domain/fatturazione/codici'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  completaCedenteDiTest,
  creaDocumentoDiTest,
  creaScenarioFatturazione,
  creaScenarioVolume,
  creaTabelleFatturazione,
  impostaFatturazioneDaDiTest,
  type TabelleFatturazioneDiTest,
} from '../../test-support/fatturazione-di-test'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  pulisciTenantDiTest,
} from '../../test-support/legami-di-test'
import {
  creaAddebito,
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
  type ListinoDiTest,
} from '../../test-support/listino-di-test'
import { bloccaElaborazione, bloccaPerDefinitiva, insiemiPerDefinitiva } from './lock-fatturazione'
import {
  selezionaElaborazione,
  type DocumentoSelezionato,
  type ParametriElaborazione,
  type SelezioneElaborazione,
} from './selezione-fatturazione'

const NOME_APPLICAZIONE = `fatt-t17-${process.pid}`
const baseUrl =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const urlProprietario = `${baseUrl}&application_name=${NOME_APPLICAZIONE}`

type Tx = Prisma.TransactionClient

const P: ParametriElaborazione = {
  periodoDal: '2026-03-01',
  periodoAl: '2026-03-31',
  dataDocumento: '2026-04-05',
  raggruppamento: 'PER_CONTRATTO',
  includiArretrati: false,
  filtri: {},
}

interface Azienda {
  tenantId: string
  listino: ListinoDiTest
  tab: TabelleFatturazioneDiTest
}

interface ContrattoDiTest {
  contrattoId: string
  clienteId: string
  elencoId: string
  /** Riga `CER` a 1 euro/KG (22%) dell'elenco. */
  rigaCerId: string
}

describe('Selezione dell’elaborazione (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []
  const OPZ = { timeout: 120_000, maxWait: 30_000 }
  // Nome fisso: un giro interrotto lascia gli id qui e il giro dopo li ripulisce.
  const FILE_VOLUME = join(tmpdir(), 'wasteflow-fatt-t17-volume-tenants.json')

  const nel = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    }, OPZ)

  const seleziona = (az: { tenantId: string }, p: Partial<ParametriElaborazione> = {}) =>
    nel(az.tenantId, tx => selezionaElaborazione(tx, az.tenantId, { ...P, ...p }))

  // -------------------------------------------------------------------------------------------
  // Fixture
  // -------------------------------------------------------------------------------------------

  /**
   * Azienda con codici IVA, tabelle di fatturazione, «fatturazione da» al 2026-01-01 e (a meno che
   * `cedente: false`) cedente completo. `predefinito` imposta il registro predefinito del cedente.
   */
  async function azienda(o: { cedente?: boolean; predefinito?: boolean } = {}): Promise<Azienda> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Cedente di prova SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const listino = await creaCodiciIvaEcodifiche(owner, t.id)
    const tab = await creaTabelleFatturazione(owner, t.id)
    if (o.cedente !== false) {
      await completaCedenteDiTest(owner, t.id, {
        registroIvaPredefinitoId: o.predefinito === false ? null : tab.registroId,
      })
    }
    await impostaFatturazioneDaDiTest(owner, t.id, '2026-01-01')
    return { tenantId: t.id, listino, tab }
  }

  interface OpzContratto {
    clienteId?: string
    stato?: 'BOZZA' | 'ATTIVO' | 'SOSPESO' | 'SOSPESO_MOVIMENTI' | 'ANNULLATO'
    codiceElenco?: string
    principaleId?: string
    /** `undefined`: registro `01` dell'azienda; `null`: nessuno. */
    registroIvaId?: string | null
    senzaCondizione?: boolean
    periodi?: [number, number, number, number][]
    clienteFatturazioneId?: string
    rigaCer?: boolean
    prezzoCer?: string
  }

  async function contratto(az: Azienda, o: OpzContratto = {}): Promise<ContrattoDiTest> {
    const c = await creaContrattoConElenco(owner, az.tenantId, {
      clienteId: o.clienteId,
      stato: o.stato,
      codiceElenco: o.codiceElenco,
      contrattoPrincipaleId: o.principaleId,
    })
    await owner.contrattoCliente.update({
      where: { id: c.contrattoId },
      data: {
        registroIvaId: o.registroIvaId === undefined ? az.tab.registroId : o.registroIvaId,
        condizionePagamentoId: o.senzaCondizione ? null : az.tab.condizioneId,
        contoCorrenteId: az.tab.contoId,
        clienteFatturazioneId: o.clienteFatturazioneId ?? null,
      },
    })
    if (o.periodi) {
      await owner.periodoFatturazioneCliente.createMany({
        data: o.periodi.map(([gi, mi, gf, mf], i) => ({
          tenantId: az.tenantId,
          contrattoId: c.contrattoId,
          ordine: i + 1,
          giornoInizio: gi,
          meseInizio: mi,
          giornoFine: gf,
          meseFine: mf,
        })),
      })
    }
    const rigaCer =
      o.rigaCer === false
        ? null
        : await creaRiga(owner, az.tenantId, c.elencoId, {
            tipo: 'CER',
            codiceIvaId: az.listino.iva22Id,
            prezzo: o.prezzoCer ?? '1',
          })
    return { ...c, rigaCerId: rigaCer?.id ?? '' }
  }

  /** Dodici periodi mensili. */
  const MENSILI: [number, number, number, number][] = [
    [1, 1, 31, 1],
    [1, 2, 28, 2],
    [1, 3, 31, 3],
    [1, 4, 30, 4],
    [1, 5, 31, 5],
    [1, 6, 30, 6],
    [1, 7, 31, 7],
    [1, 8, 31, 8],
    [1, 9, 30, 9],
    [1, 10, 31, 10],
    [1, 11, 30, 11],
    [1, 12, 31, 12],
  ]

  async function riga(
    az: Azienda,
    elencoId: string,
    tipo: string,
    prezzo: string | null,
    altro: Partial<Prisma.RigaAddebitoUncheckedCreateInput> = {},
    unitaMisura?: string
  ): Promise<string> {
    // Le famiglie T e M hanno il loro addebito d'archivio.
    const addebito =
      tipo === 'CER' || tipo === 'V' || tipo === 'F'
        ? undefined
        : await creaAddebito(owner, az.tenantId, { tipo })
    const r = await creaRiga(owner, az.tenantId, elencoId, {
      tipo,
      codiceIvaId: az.listino.iva22Id,
      prezzo,
      addebitoId: addebito?.id,
      unitaMisura,
      altro,
    })
    return r.id
  }

  interface OpzLegame {
    data?: string
    stato?:
      | 'CONFERMATO'
      | 'PROPOSTO'
      | 'DA_COLLEGARE'
      | 'ESCLUSO'
      | 'FATTURATO'
      | 'IMPORTATO_FATTURATO'
    quantita?: string
    prezzo?: string
    rigaId?: string
    conContratto?: boolean
  }

  async function legame(az: Azienda, c: ContrattoDiTest, o: OpzLegame = {}) {
    const m = await creaMovimentoDiTest(owner, az.tenantId, {
      movementDate: o.data ?? '2026-03-10',
      quantity: o.quantita ?? '100',
    })
    const stato = o.stato ?? 'CONFERMATO'
    const conContratto = o.conContratto ?? stato !== 'DA_COLLEGARE'
    const l = await creaLegameDiTest(owner, az.tenantId, {
      movimentoOriginaleId: m.movimentoId,
      registroId: m.registroId,
      verso: m.type,
      stato,
      ...(conContratto
        ? { clienteId: c.clienteId, contrattoId: c.contrattoId, elencoId: c.elencoId }
        : {}),
      dataMovimento: o.data ?? '2026-03-10',
      righe: conContratto
        ? [
            {
              rigaAddebitoId: o.rigaId ?? c.rigaCerId,
              codiceIvaId: az.listino.iva22Id,
              quantita: o.quantita ?? '100',
              prezzo: o.prezzo ?? '1',
            },
          ]
        : [],
    })
    return { ...l, movimentoId: m.movimentoId, registroId: m.registroId }
  }

  /** Una rettifica sposta la testa della catena: il legame resta sul movimento di prima. */
  async function rettifica(az: Azienda, movimentoId: string, progressivo = 9_000): Promise<void> {
    const origine = await owner.wasteMovement.findUniqueOrThrow({ where: { id: movimentoId } })
    await owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: origine.registroId,
        progressiveYear: 2026,
        progressiveNumber: progressivo,
        type: origine.type,
        movementDate: origine.movementDate,
        causale: origine.causale,
        cerCode: origine.cerCode,
        quantity: '90',
        unit: 'KG',
        tipoAnnotazione: 'RETTIFICA',
        movimentoRettificatoId: origine.id,
        movimentoOriginaleId: origine.id,
        motivoAnnotazione: 'prova',
      },
    })
  }

  const doc = (s: SelezioneElaborazione, contrattoId: string): DocumentoSelezionato | undefined =>
    s.documenti.find(d => d.contrattoId === contrattoId)

  const codiciErrori = (d: DocumentoSelezionato) =>
    calcolaDocumento(d.input).errori.map(e => e.codice)

  /** Conta le query (`$queryRaw*`, `$executeRaw*`) lanciate sulla transazione. */
  function contaQuery(tx: Tx): {
    tx: Tx
    n: () => number
    durate: () => { ms: number; sql: string }[]
  } {
    let n = 0
    const durate: { ms: number; sql: string }[] = []
    const proxy = new Proxy(tx, {
      get(t, prop) {
        const v = (t as unknown as Record<string | symbol, unknown>)[prop]
        if (
          typeof v === 'function' &&
          ['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].includes(
            String(prop)
          )
        ) {
          return async (...a: unknown[]) => {
            n++
            const t0 = Date.now()
            try {
              return await (v as (...x: unknown[]) => unknown).apply(t, a)
            } finally {
              const q = a[0] as { strings?: string[]; sql?: string } | string[] | string
              const testo = Array.isArray(q)
                ? q.join('?')
                : typeof q === 'string'
                  ? q
                  : (q.sql ?? q.strings?.join('?') ?? '')
              durate.push({ ms: Date.now() - t0, sql: testo.replace(/\s+/g, ' ').slice(0, 90) })
            }
          }
        }
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v
      },
    })
    return { tx: proxy, n: () => n, durate: () => durate }
  }

  // Ripulisce le aziende di volume rimaste da un giro interrotto (id scritti su file).
  const idVolumeSuFile = (): string[] => {
    try {
      const v: unknown = JSON.parse(readFileSync(FILE_VOLUME, 'utf8'))
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  beforeAll(async () => {
    const rimasti = idVolumeSuFile()
    if (rimasti.length > 0) {
      await pulisciTenantDiTest(owner, rimasti)
      writeFileSync(FILE_VOLUME, '[]')
    }
  }, 300_000)

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    // Toglie solo i propri id: un altro processo puo' avere un'azienda di volume in corso.
    writeFileSync(
      FILE_VOLUME,
      JSON.stringify(idVolumeSuFile().filter(id => !tenantCreati.includes(id)))
    )
    await owner.$disconnect()
    await app.$disconnect()
  }, 300_000)

  // -------------------------------------------------------------------------------------------
  // Stati e legami
  // -------------------------------------------------------------------------------------------

  describe('legami e stati del contratto', () => {
    it('contratto ATTIVO con 3 legami CONFERMATO nel periodo: un documento con 3 righe', async () => {
      const az = await azienda()
      const c = await contratto(az)
      for (const g of ['2026-03-05', '2026-03-10', '2026-03-20']) {
        await legame(az, c, { data: g })
      }
      const s = await seleziona(az)
      expect(s.erroriGenerali).toEqual([])
      expect(s.documenti).toHaveLength(1)
      const d = s.documenti[0]
      expect(d.chiave).toBe(c.contrattoId)
      expect(d.input.legami).toHaveLength(3)
      expect(d.input.legami.map(l => l.dataMovimento)).toEqual([
        '2026-03-05',
        '2026-03-10',
        '2026-03-20',
      ])
      expect(d.input.legami[0]).toMatchObject({
        quantitaMovimento: '100.00',
        unitaMovimento: 'KG',
        elencoId: c.elencoId,
        rigaAddebitoId: c.rigaCerId,
        prezzo: '1.000000',
      })
      const calcolato = calcolaDocumento(d.input)
      expect(calcolato.errori).toEqual([])
      expect(calcolato.righe.filter(r => r.tipoRiga === 'MOVIMENTO')).toHaveLength(3)
      expect(d.registroIvaId).toBe(az.tab.registroId)
      expect(d.periodo).toEqual({ dal: '2026-03-01', al: '2026-03-31' })
      expect(d.fotografia.cedente.denominazione).toBe('Cedente di prova SRL')
      expect(d.fotografia.cessionario.sede.cap).toBe('00100')
    })

    it('legame gia fatturato, ESCLUSO o IMPORTATO_FATTURATO: non selezionato', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c) // l'unico che conta
      for (const stato of ['FATTURATO', 'ESCLUSO', 'IMPORTATO_FATTURATO'] as const) {
        await legame(az, c, { stato })
      }
      const s = await seleziona(az)
      expect(s.documenti).toHaveLength(1)
      expect(s.documenti[0].input.legami).toHaveLength(1)
      expect(s.erroriPeriodo).toEqual([])
    })

    it('legame DA_RIALLINEARE (vigente diverso dalla testa): negli errori del periodo, non nel documento', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      const l = await legame(az, c)
      await rettifica(az, l.movimentoId)
      const s = await seleziona(az)
      expect(s.documenti).toHaveLength(1)
      expect(s.documenti[0].input.legami).toHaveLength(1)
      expect(s.documenti[0].input.legamiDaCollegareEsclusi).toBe(1)
      expect(s.erroriPeriodo).toEqual([
        { motivo: 'DA_RIALLINEARE', quanti: 1, contrattoId: c.contrattoId },
      ])
    })

    it('FATTURATO, IMPORTATO_FATTURATO o ESCLUSO con la testa spostata: scostamento o scelta dell’utente, non un legame da riallineare', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      let progressivo = 9_100
      for (const stato of ['FATTURATO', 'IMPORTATO_FATTURATO', 'ESCLUSO'] as const) {
        const l = await legame(az, c, { stato })
        await rettifica(az, l.movimentoId, (progressivo += 1_000))
      }
      const s = await seleziona(az)
      expect(s.documenti).toHaveLength(1)
      expect(s.documenti[0].input.legami).toHaveLength(1)
      expect(s.documenti[0].input.legamiDaCollegareEsclusi).toBe(0)
      expect(s.erroriPeriodo).toEqual([])
      expect(s.erroriGenerali).toEqual([])
    })

    it('legame PROPOSTO con contratto: avviso sul documento; movimento senza contratto: LEGAMI_SENZA_CONTRATTO, in nessun documento', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      await legame(az, c, { stato: 'PROPOSTO' })
      // Senza contratto: un legame DA_COLLEGARE e un movimento senza nessun legame (MANCANTE).
      await legame(az, c, { stato: 'DA_COLLEGARE' })
      await creaMovimentoDiTest(owner, az.tenantId, { movementDate: '2026-03-12' })
      const s = await seleziona(az)
      expect(s.documenti).toHaveLength(1)
      const d = s.documenti[0]
      expect(d.input.legami).toHaveLength(1)
      expect(d.input.legamiDaCollegareEsclusi).toBe(1)
      expect(calcolaDocumento(d.input).avvisi.map(a => a.codice)).toContain(
        'MOVIMENTI_DA_COLLEGARE_ESCLUSI'
      )
      expect(s.erroriGenerali).toEqual([{ codice: 'LEGAMI_SENZA_CONTRATTO', dettaglio: '2' }])
      expect(s.erroriPeriodo).toEqual(
        expect.arrayContaining([
          { motivo: 'PROPOSTO', quanti: 1, contrattoId: c.contrattoId },
          { motivo: 'DA_COLLEGARE', quanti: 1, contrattoId: null },
          { motivo: 'MANCANTE', quanti: 1, contrattoId: null },
        ])
      )
    })

    it('SOSPESO: documento con CONTRATTO_SOSPESO; BOZZA e ANNULLATO: nessun documento', async () => {
      const az = await azienda()
      const sospeso = await contratto(az, { stato: 'SOSPESO' })
      await legame(az, sospeso)
      const bozza = await contratto(az, { stato: 'BOZZA' })
      const annullato = await contratto(az, { stato: 'ANNULLATO' })
      for (const c of [bozza, annullato]) await legame(az, c)
      const s = await seleziona(az)
      expect(s.documenti.map(d => d.contrattoId)).toEqual([sospeso.contrattoId])
      expect(codiciErrori(s.documenti[0])).toContain('CONTRATTO_SOSPESO')
    })

    it('SOSPESO_MOVIMENTI: nessun documento senza fissi; con un canone, solo il canone (avviso MOVIMENTI_SOSPESI)', async () => {
      const az = await azienda()
      const c = await contratto(az, { stato: 'SOSPESO_MOVIMENTI' })
      await legame(az, c)
      expect((await seleziona(az)).documenti).toHaveLength(0)
      await riga(az, c.elencoId, 'F', '25')
      const s = await seleziona(az)
      expect(s.documenti).toHaveLength(1)
      const r = calcolaDocumento(s.documenti[0].input)
      expect(r.righe.map(x => x.tipoRiga)).toEqual(['FISSO'])
      expect(r.avvisi.map(a => a.codice)).toContain('MOVIMENTI_SOSPESI')
    })

    it('arretrati spenti: ARRETRATI_PRESENTI con il conteggio; accesi: legami precedenti inclusi fino a «fatturazione da»', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c, { data: '2026-03-10' })
      await legame(az, c, { data: '2026-02-10' })
      const prima = await seleziona(az)
      expect(prima.documenti[0].input.legami).toHaveLength(1)
      expect(prima.documenti[0].input.arretrati).toBe(1)
      expect(calcolaDocumento(prima.documenti[0].input).avvisi).toContainEqual({
        codice: 'ARRETRATI_PRESENTI',
        dettaglio: '1',
      })
      const dopo = await seleziona(az, { includiArretrati: true })
      expect(dopo.documenti[0].input.legami.map(l => l.dataMovimento)).toEqual([
        '2026-02-10',
        '2026-03-10',
      ])
      // «fatturazione da» sposta il limite: un legame di dicembre 2025 non entra mai.
      await legame(az, c, { data: '2025-12-20' })
      const ancora = await seleziona(az, { includiArretrati: true })
      expect(ancora.documenti[0].input.legami).toHaveLength(2)
    })

    it('legame dopo la fine del periodo: non entra', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c, { data: '2026-03-31' })
      await legame(az, c, { data: '2026-04-01' })
      const s = await seleziona(az)
      expect(s.documenti[0].input.legami).toHaveLength(1)
    })

    it('«fatturazione da» spenta: nessun documento, nessun errore sui legami', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      await impostaFatturazioneDaDiTest(owner, az.tenantId, null)
      const s = await seleziona(az)
      expect(s.documenti).toEqual([])
      expect(s.erroriPeriodo).toEqual([])
    })
  })

  // -------------------------------------------------------------------------------------------
  // Periodo effettivo e raggruppamento
  // -------------------------------------------------------------------------------------------

  describe('periodo effettivo e raggruppamento', () => {
    it('periodi mensili e intervallo 01/10-15/10: nessun documento (nessuna fine nell’intervallo)', async () => {
      const az = await azienda()
      const c = await contratto(az, { periodi: MENSILI })
      await legame(az, c, { data: '2026-10-10' })
      const s = await seleziona(az, { periodoDal: '2026-10-01', periodoAl: '2026-10-15' })
      expect(s.documenti).toEqual([])
      expect(s.erroriPeriodo).toEqual([])
    })

    it('intervallo 01/10-31/10: il periodo effettivo e quello del contratto', async () => {
      const az = await azienda()
      const c = await contratto(az, { periodi: MENSILI })
      await legame(az, c, { data: '2026-10-10' })
      const s = await seleziona(az, { periodoDal: '2026-10-01', periodoAl: '2026-10-31' })
      expect(s.documenti).toHaveLength(1)
      expect(s.documenti[0].periodo).toEqual({ dal: '2026-10-01', al: '2026-10-31' })
    })

    it('periodi ambigui nell’intervallo: errore del periodo con il messaggio, nessun documento', async () => {
      const az = await azienda()
      const c = await contratto(az, { periodi: MENSILI })
      await legame(az, c, { data: '2026-10-10' })
      const s = await seleziona(az, { periodoDal: '2026-10-01', periodoAl: '2026-12-31' })
      expect(s.documenti).toEqual([])
      expect(s.erroriPeriodo).toEqual([
        {
          motivo: "Nell'intervallo terminano più periodi del contratto: restringi le date.",
          quanti: 1,
          contrattoId: c.contrattoId,
        },
      ])
    })

    it('contratto non valido nel periodo (iniziato dopo o terminato prima): nessun documento', async () => {
      const az = await azienda()
      const finito = await contratto(az)
      await legame(az, finito)
      await owner.contrattoCliente.update({
        where: { id: finito.contrattoId },
        data: { dataFine: new Date('2026-02-28T00:00:00Z') },
      })
      const s = await seleziona(az)
      expect(s.documenti).toEqual([])
    })

    it('PER_ELENCO: un documento per elenco, chiavi distinte', async () => {
      const az = await azienda()
      const c = await contratto(az, { codiceElenco: 'A' })
      const elencoB = await owner.elencoAddebiti.create({
        data: { tenantId: az.tenantId, contrattoId: c.contrattoId, codice: 'B', descrizione: 'B' },
      })
      const rigaB = await riga(az, elencoB.id, 'CER', '2')
      await legame(az, c)
      await legame(az, { ...c, elencoId: elencoB.id, rigaCerId: rigaB })
      const s = await seleziona(az, { raggruppamento: 'PER_ELENCO' })
      expect(s.documenti.map(d => d.elencoId)).toEqual([c.elencoId, elencoB.id])
      expect(new Set(s.documenti.map(d => d.chiave)).size).toBe(2)
      expect(s.documenti.map(d => d.input.legami.length)).toEqual([1, 1])
      // Con PER_CONTRATTO un documento solo, con entrambi i listini.
      const unico = await seleziona(az)
      expect(unico.documenti).toHaveLength(1)
      expect(unico.documenti[0].input.legami).toHaveLength(2)
      expect(unico.documenti[0].input.listino.size).toBe(2)
    })

    it('PER_ELENCO, principale con due elenchi (A e B), allegato con una F a 50.00 e un MW a 100.00: F e minimo dell’allegato solo nel documento di A, marcatori distinti', async () => {
      const az = await azienda()
      const c = await contratto(az, { codiceElenco: 'A' })
      const elencoB = await owner.elencoAddebiti.create({
        data: { tenantId: az.tenantId, contrattoId: c.contrattoId, codice: 'B', descrizione: 'B' },
      })
      const fA = await riga(az, c.elencoId, 'F', '10')
      const fB = await riga(az, elencoB.id, 'F', '20')
      const cerB = await riga(az, elencoB.id, 'CER', '2')
      await legame(az, c)
      await legame(az, { ...c, elencoId: elencoB.id, rigaCerId: cerB })
      const all = await contratto(az, { principaleId: c.contrattoId, rigaCer: false })
      const fAll = await riga(az, all.elencoId, 'F', '50.00')
      const mwAll = await riga(az, all.elencoId, 'MW', '100.00')
      const s = await seleziona(az, { raggruppamento: 'PER_ELENCO' })
      expect(s.documenti).toHaveLength(2)
      const [docA, docB] = s.documenti
      expect(docA.elencoId).toBe(c.elencoId)
      expect(docA.input.righeFisse.map(r => r.id).sort()).toEqual([fA, fAll].sort())
      expect(docA.input.minimi.map(r => r.id)).toEqual([mwAll])
      expect(docB.input.righeFisse.map(r => r.id)).toEqual([fB])
      expect(docB.input.minimi).toEqual([])
      expect(docB.input.listino.has(fAll)).toBe(false)
      expect(docB.input.listino.has(mwAll)).toBe(false)
      const marcatori = (d: DocumentoSelezionato) =>
        calcolaDocumento(d.input)
          .righe.filter(r => r.marcatore)
          .map(r => `${r.rigaAddebitoId}|${r.marcatore?.chiaveCompetenza}`)
      const mA = marcatori(docA)
      const mB = marcatori(docB)
      expect(mA).toHaveLength(2)
      expect(mB).toHaveLength(1)
      expect(mA.filter(x => mB.includes(x))).toEqual([])
    })
  })

  // -------------------------------------------------------------------------------------------
  // Allegati: valori del principale, righe T
  // -------------------------------------------------------------------------------------------

  describe('ordine del listino e arretrati su elenchi scaduti', () => {
    it('le righe seguono l’ordine dell’elenco (tipo, codice dell’addebito), non l’ordine degli id', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      // Cinque TT con addebiti in ordine inverso rispetto alla creazione.
      const creati: { id: string; codice: string }[] = []
      for (const codice of ['00050', '00040', '00030', '00020', '00010']) {
        const a = await creaAddebito(owner, az.tenantId, { tipo: 'TT', codice })
        const r = await creaRiga(owner, az.tenantId, c.elencoId, {
          tipo: 'TT',
          codiceIvaId: az.listino.iva22Id,
          prezzo: '0.01',
          addebitoId: a.id,
        })
        creati.push({ id: r.id, codice })
      }
      const s = await seleziona(az)
      const ordine = [...s.documenti[0].input.listino.keys()]
      expect(ordine).toEqual([
        c.rigaCerId,
        ...[...creati].sort((a, b) => (a.codice < b.codice ? -1 : 1)).map(x => x.id),
      ])
    })

    it('arretrato su un elenco non piu valido (arretrati accesi): la riga citata entra in coda, nessun errore, e niente canoni di quell’elenco', async () => {
      const az = await azienda()
      const c = await contratto(az)
      // L'elenco di prima scade a febbraio; da marzo ne vale uno nuovo.
      await owner.elencoAddebiti.update({
        where: { id: c.elencoId },
        data: {
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-02-28T00:00:00Z'),
        },
      })
      const vecchiaF = await riga(az, c.elencoId, 'F', '99')
      const nuovo = await owner.elencoAddebiti.create({
        data: {
          tenantId: az.tenantId,
          contrattoId: c.contrattoId,
          codice: '002',
          descrizione: 'Nuovo',
          validoDal: new Date('2026-03-01T00:00:00Z'),
          validoAl: new Date('2026-12-31T00:00:00Z'),
        },
      })
      const cerNuova = await riga(az, nuovo.id, 'CER', '2')
      await legame(az, c, { data: '2026-02-10' }) // arretrato sulla riga dell'elenco scaduto
      await legame(
        az,
        { ...c, elencoId: nuovo.id, rigaCerId: cerNuova },
        { data: '2026-03-10', prezzo: '2' }
      )
      for (const raggruppamento of ['PER_CONTRATTO', 'PER_ELENCO'] as const) {
        const s = await seleziona(az, { includiArretrati: true, raggruppamento })
        const d = s.documenti[0]
        expect(d.input.legami).toHaveLength(2)
        const ids = [...d.input.listino.keys()]
        expect(ids).toContain(c.rigaCerId)
        expect(ids[ids.length - 1]).toBe(c.rigaCerId)
        // Il canone dell'elenco scaduto non si fattura: la F non e fra le fisse e non e nel listino.
        expect(d.input.righeFisse.map(r => r.id)).not.toContain(vecchiaF)
        expect(ids).not.toContain(vecchiaF)
        expect(calcolaDocumento(d.input).errori).toEqual([])
      }
    })
  })

  describe('elenco unico scaduto senza rinnovo', () => {
    it('con arretrati accesi la riga citata dal legame c’e comunque (la query delle righe parte)', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await owner.elencoAddebiti.update({
        where: { id: c.elencoId },
        data: {
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-02-28T00:00:00Z'),
        },
      })
      await legame(az, c, { data: '2026-02-10' })
      const s = await seleziona(az, { includiArretrati: true })
      expect(s.documenti).toHaveLength(1)
      expect([...s.documenti[0].input.listino.keys()]).toEqual([c.rigaCerId])
      expect(calcolaDocumento(s.documenti[0].input).errori).toEqual([])
    })
  })

  describe('dettaglio «riga p dell’elenco X (contratto N)» con elenco scaduto', () => {
    it('la posizione e quella nell’elenco intero, anche se nel listino entra solo la riga citata', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await owner.elencoAddebiti.update({
        where: { id: c.elencoId },
        data: {
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-02-28T00:00:00Z'),
        },
      })
      await riga(az, c.elencoId, 'F', '99')
      // Ordine dell'elenco: CER, F, NM. La NM e la terza dell'elenco, ma l'unica citata.
      const nm = await riga(az, c.elencoId, 'NM', '5')
      await legame(az, c, { data: '2026-02-10', rigaId: nm })
      const s = await seleziona(az, { includiArretrati: true })
      const d = s.documenti[0]
      expect([...d.input.listino.keys()]).toEqual([nm])
      expect(calcolaDocumento(d.input).errori).toContainEqual({
        codice: 'FAMIGLIA_NON_CALCOLATA',
        dettaglio: `NM riga 3 dell'elenco 001 (contratto ${d.contrattoNumero})`,
      })
    })
  })

  describe('conteggi per documento e filtri con periodi ambigui', () => {
    it('PER_ELENCO: arretrati e movimenti da collegare stanno nel documento giusto; con arretrati accesi nessun conteggio', async () => {
      const az = await azienda()
      const c = await contratto(az, { codiceElenco: 'A' })
      const elencoB = await owner.elencoAddebiti.create({
        data: { tenantId: az.tenantId, contrattoId: c.contrattoId, codice: 'B', descrizione: 'B' },
      })
      const cerB = await riga(az, elencoB.id, 'CER', '2')
      const b = { ...c, elencoId: elencoB.id, rigaCerId: cerB }
      await legame(az, c, { data: '2026-03-10' })
      await legame(az, b, { data: '2026-03-11' })
      await legame(az, b, { data: '2026-02-10' }) // arretrato dell'elenco B
      await legame(az, c, { data: '2026-03-12', stato: 'PROPOSTO' })
      const s = await seleziona(az, { raggruppamento: 'PER_ELENCO' })
      const [docA, docB] = s.documenti
      expect(docA.input.arretrati).toBe(0)
      expect(docB.input.arretrati).toBe(1)
      expect(docA.input.legamiDaCollegareEsclusi).toBe(1)
      expect(docB.input.legamiDaCollegareEsclusi).toBe(0)
      const accesi = await seleziona(az, { raggruppamento: 'PER_ELENCO', includiArretrati: true })
      expect(accesi.documenti.map(d => d.input.arretrati)).toEqual([0, 0])
      expect(accesi.documenti[1].input.legami).toHaveLength(2)
    })

    it('periodi ambigui con un filtro per categoria: l’errore compare solo se il contratto sarebbe entrato', async () => {
      const az = await azienda()
      const x = await contratto(az, { periodi: MENSILI })
      await riga(az, x.elencoId, 'V', '3', { categoriaId: az.listino.categoriaId })
      const y = await contratto(az, { periodi: MENSILI })
      const s = await seleziona(az, {
        periodoDal: '2026-10-01',
        periodoAl: '2026-12-31',
        filtri: { categoriaIds: [az.listino.categoriaId] },
      })
      expect(s.documenti).toEqual([])
      expect(s.erroriPeriodo.map(e => e.contrattoId)).toEqual([x.contrattoId])
      expect(s.erroriPeriodo.map(e => e.contrattoId)).not.toContain(y.contrattoId)
    })
  })

  describe('contratto allegato (Review Focus 4, decisione 17)', () => {
    async function scenarioAllegato(tipoRigaAllegato: 'TT' | 'TS') {
      const az = await azienda()
      const c = await contratto(az, { prezzoCer: '0.10' })
      // L'ordine delle righe MOVIMENTO e' del calcolo (data, poi id): date diverse lo fissano.
      for (const [q, data] of [
        ['500', '2026-03-05'],
        ['700', '2026-03-10'],
        ['300', '2026-03-20'],
      ]) {
        await legame(az, c, { quantita: q, prezzo: '0.10', data })
      }
      const all = await contratto(az, {
        principaleId: c.contrattoId,
        rigaCer: false,
        // Registro, condizione ed esigibilita' diversi: il documento non li usa.
        registroIvaId: az.tab.registroSplitId,
      })
      await owner.contrattoCliente.update({
        where: { id: all.contrattoId },
        data: { esigibilitaIva: 'SCISSIONE' },
      })
      const altraCondizione = await owner.condizionePagamento.create({
        data: {
          tenantId: az.tenantId,
          codice: 'RD',
          descrizione: 'Rimessa diretta',
          modalita: 'MP01',
          giorniRate: [0],
        },
      })
      await owner.contrattoCliente.update({
        where: { id: all.contrattoId },
        data: { condizionePagamentoId: altraCondizione.id },
      })
      const rigaT = await riga(az, all.elencoId, tipoRigaAllegato, '0.02')
      return { az, c, all, rigaT }
    }

    it('un documento coi valori del principale: tre righe MOVIMENTO, una QUANTITA_MOVIMENTI da 1500 KG, un solo riepilogo, nessun errore', async () => {
      const { az, c } = await scenarioAllegato('TT')
      const s = await seleziona(az)
      expect(s.documenti).toHaveLength(1)
      const d = s.documenti[0]
      expect(d.contrattoId).toBe(c.contrattoId)
      expect(d.registroIvaId).toBe(az.tab.registroId)
      expect(d.input.contratto.esigibilita).toBe('I')
      expect(d.input.contratto.condizione).toMatchObject({ modalita: 'MP05', giorniRate: [30] })
      expect(d.input.listino.size).toBe(2)
      expect([...d.input.listino.values()].filter(r => r.daAllegato)).toHaveLength(1)
      const r = calcolaDocumento(d.input)
      expect(r.errori).toEqual([])
      expect(r.righe.filter(x => x.tipoRiga === 'MOVIMENTO').map(x => x.prezzoTotale)).toEqual([
        '50.00',
        '70.00',
        '30.00',
      ])
      const qta = r.righe.filter(x => x.tipoRiga === 'QUANTITA_MOVIMENTI')
      expect(qta).toHaveLength(1)
      expect(qta[0]).toMatchObject({ unitaMisura: 'KG', prezzoTotale: '30.00' })
      expect(Number(qta[0].quantita)).toBe(1500)
      expect(r.riepiloghi).toHaveLength(1)
      expect(r.riepiloghi[0]).toMatchObject({
        aliquota: '22.00',
        imponibile: '180.00',
        imposta: '39.60',
      })
    })

    it('stesso scenario con la riga dell’allegato TS: FAMIGLIA_NON_CALCOLATA con la posizione nel listino', async () => {
      const { az, all } = await scenarioAllegato('TS')
      const numeroAllegato = (
        await owner.contrattoCliente.findUniqueOrThrow({ where: { id: all.contrattoId } })
      ).numero
      const s = await seleziona(az)
      const errori = calcolaDocumento(s.documenti[0].input).errori
      // Il listino va dal principale agli allegati; il dettaglio dice la posizione nell'elenco
      // dell'allegato (la TS e la sua prima riga), non quella nel listino unito.
      expect(errori).toContainEqual({
        codice: 'FAMIGLIA_NON_CALCOLATA',
        dettaglio: `TS riga 1 dell'elenco 001 (contratto ${numeroAllegato})`,
      })
    })

    it('riga NM dell’elenco principale mai citata dai legami: FAMIGLIA_NON_CALCOLATA', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      await riga(az, c.elencoId, 'NM', '5')
      const s = await seleziona(az)
      expect(s.documenti[0].input.listino.size).toBe(2)
      expect(calcolaDocumento(s.documenti[0].input).errori).toContainEqual({
        codice: 'FAMIGLIA_NON_CALCOLATA',
        dettaglio: `NM riga 2 dell'elenco 001 (contratto ${s.documenti[0].contrattoNumero})`,
      })
    })

    it('allegato SOSPESO o con elenco scaduto: le sue righe non entrano', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      const all = await contratto(az, {
        principaleId: c.contrattoId,
        rigaCer: false,
        stato: 'SOSPESO',
      })
      await riga(az, all.elencoId, 'TT', '0.02')
      expect((await seleziona(az)).documenti[0].input.listino.size).toBe(1)
      const scaduto = await contratto(az, { principaleId: c.contrattoId, rigaCer: false })
      await riga(az, scaduto.elencoId, 'TT', '0.02')
      await owner.elencoAddebiti.update({
        where: { id: scaduto.elencoId },
        data: {
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-02-28T00:00:00Z'),
        },
      })
      expect((await seleziona(az)).documenti[0].input.listino.size).toBe(1)
    })
  })

  // -------------------------------------------------------------------------------------------
  // Registro, cedente, destinatario, cliente di fatturazione
  // -------------------------------------------------------------------------------------------

  describe('registro IVA, cedente e cliente', () => {
    it('registro IVA disattivato: SENZA_REGISTRO_IVA e registroIvaId null', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      await owner.registroIva.update({ where: { id: az.tab.registroId }, data: { attivo: false } })
      const s = await seleziona(az)
      expect(s.documenti[0].registroIvaId).toBeNull()
      expect(codiciErrori(s.documenti[0])).toContain('SENZA_REGISTRO_IVA')
    })

    it('contratto senza registro e cedente senza predefinito: registroIvaId null, SENZA_REGISTRO_IVA', async () => {
      const az = await azienda({ predefinito: false })
      const c = await contratto(az, { registroIvaId: null })
      await legame(az, c)
      const s = await seleziona(az)
      expect(s.documenti[0].registroIvaId).toBeNull()
      expect(codiciErrori(s.documenti[0])).toContain('SENZA_REGISTRO_IVA')
    })

    it('registro: contratto, poi cliente, poi predefinito del cedente', async () => {
      const az = await azienda()
      const c = await contratto(az, { registroIvaId: null })
      await legame(az, c)
      expect((await seleziona(az)).documenti[0].registroIvaId).toBe(az.tab.registroId) // cedente
      await owner.cliente.update({
        where: { id: c.clienteId },
        data: { registroIvaId: az.tab.registroSplitId },
      })
      expect((await seleziona(az)).documenti[0].registroIvaId).toBe(az.tab.registroSplitId) // cliente
      await owner.contrattoCliente.update({
        where: { id: c.contrattoId },
        data: { registroIvaId: az.tab.registroId },
      })
      expect((await seleziona(az)).documenti[0].registroIvaId).toBe(az.tab.registroId) // contratto
    })

    it('cedente senza indirizzo: CEDENTE_INCOMPLETO', async () => {
      const az = await azienda({ cedente: false })
      const c = await contratto(az)
      await legame(az, c)
      const s = await seleziona(az)
      expect(s.erroriGenerali.map(e => e.codice)).toContain('CEDENTE_INCOMPLETO')
    })

    it('data documento prima di ultima_data del registro: DATA_ANTERIORE_ULTIMA_FATTURA', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      await owner.$executeRaw`
        INSERT INTO numerazioni_fattura
          (tenant_id, registro_iva_id, anno, ultimo_numero, ultima_data, numero_partenza, updated_at)
        VALUES (${az.tenantId}::uuid, ${az.tab.registroId}::uuid, 2026, 7, '2026-04-20'::date, 7, now())`
      const s = await seleziona(az)
      expect(s.erroriGenerali.map(e => e.codice)).toEqual(['DATA_ANTERIORE_ULTIMA_FATTURA'])
      const ok = await seleziona(az, { dataDocumento: '2026-04-20' })
      expect(ok.erroriGenerali).toEqual([])
    })

    it('ERRORI_GENERALI_BLOCCANTI: cedente, data anteriore e data futura; non i legami senza contratto', () => {
      expect([...ERRORI_GENERALI_BLOCCANTI]).toEqual([
        'CEDENTE_INCOMPLETO',
        'DATA_ANTERIORE_ULTIMA_FATTURA',
        'DATA_FUTURA',
      ])
    })

    it('cliente di fatturazione diverso dal cliente del contratto: cessionario = cliente di fatturazione', async () => {
      const az = await azienda()
      const altro = await creaContrattoConElenco(owner, az.tenantId)
      await owner.ditta.update({
        where: {
          id: (await owner.cliente.findUniqueOrThrow({ where: { id: altro.clienteId } })).dittaId,
        },
        data: { ragioneSociale: 'Pagatore SPA' },
      })
      const c = await contratto(az, { clienteFatturazioneId: altro.clienteId })
      await legame(az, c)
      const s = await seleziona(az)
      const d = doc(s, c.contrattoId) as DocumentoSelezionato
      expect(d.clienteId).toBe(c.clienteId)
      expect(d.clienteFatturazioneId).toBe(altro.clienteId)
      expect(d.fotografia.cessionario.denominazione).toBe('Pagatore SPA')
      expect(d.denominazione).toBe('Pagatore SPA')
    })

    it('dati del cliente non emettibili nell’XML diventano errori del documento', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      const cl = await owner.cliente.findUniqueOrThrow({ where: { id: c.clienteId } })
      // Il database vieta una ditta senza identificativo: restano il CAP e un nome che l'XML
      // non puo' scrivere (nessun carattere dell'insieme Latin-1 dopo la normalizzazione).
      await owner.sedeDitta.update({ where: { id: cl.sedeId }, data: { cap: 'ABC' } })
      await owner.ditta.update({ where: { id: cl.dittaId }, data: { ragioneSociale: '中文' } })
      const errori = codiciErrori((await seleziona(az)).documenti[0])
      expect(errori).toEqual(
        expect.arrayContaining(['CLIENTE_SENZA_DATI_FISCALI', 'SEDE_CLIENTE_INCOMPLETA'])
      )
    })

    it('destinatario: codice del contratto, altrimenti del cliente; PEC del cliente', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      await owner.cliente.update({
        where: { id: c.clienteId },
        data: { codiceDestinatario: 'ABC1234', pecFatturazione: 'pec@example.test' },
      })
      const d1 = (await seleziona(az)).documenti[0]
      expect(d1.input.contratto.codiceDestinatario).toBe('ABC1234')
      expect(d1.input.contratto.pec).toBe('pec@example.test')
      await owner.contrattoCliente.update({
        where: { id: c.contrattoId },
        data: { codiceDestinatario: 'XYZ9876' },
      })
      expect((await seleziona(az)).documenti[0].input.contratto.codiceDestinatario).toBe('XYZ9876')
    })
  })

  // -------------------------------------------------------------------------------------------
  // Filtri (decisione 25)
  // -------------------------------------------------------------------------------------------

  describe('filtri', () => {
    it('filtri per cliente, contratto e registro', async () => {
      const az = await azienda()
      const a = await contratto(az)
      const b = await contratto(az, { registroIvaId: az.tab.registroSplitId })
      const c = await contratto(az)
      for (const x of [a, b, c]) await legame(az, x)
      const ids = async (filtri: ParametriElaborazione['filtri']) =>
        (await seleziona(az, { filtri })).documenti.map(d => d.contrattoId).sort()
      expect(await ids({})).toEqual([a.contrattoId, b.contrattoId, c.contrattoId].sort())
      expect(await ids({ clienteIds: [b.clienteId] })).toEqual([b.contrattoId])
      expect(await ids({ contrattoIds: [a.contrattoId, c.contrattoId] })).toEqual(
        [a.contrattoId, c.contrattoId].sort()
      )
      expect(await ids({ registroIvaIds: [az.tab.registroSplitId] })).toEqual([b.contrattoId])
      // AND fra filtri diversi, OR dentro lo stesso filtro.
      expect(
        await ids({ clienteIds: [a.clienteId, b.clienteId], registroIvaIds: [az.tab.registroId] })
      ).toEqual([a.contrattoId])
      expect(await ids({ clienteIds: [], contrattoIds: [] })).toHaveLength(3)
    })

    it('categoriaIds: entra il contratto con una riga V della categoria, con TUTTE le sue righe e tutti i legami; l’altro resta fuori', async () => {
      const az = await azienda()
      const x = await contratto(az)
      const v = await riga(az, x.elencoId, 'V', '3', { categoriaId: az.listino.categoriaId })
      const f = await riga(az, x.elencoId, 'F', '10')
      await legame(az, x)
      await legame(az, x)
      const y = await contratto(az)
      await legame(az, y)
      const s = await seleziona(az, { filtri: { categoriaIds: [az.listino.categoriaId] } })
      expect(s.documenti.map(d => d.contrattoId)).toEqual([x.contrattoId])
      const d = s.documenti[0]
      expect([...d.input.listino.keys()].sort()).toEqual([x.rigaCerId, v, f].sort())
      expect(d.input.legami).toHaveLength(2)
      expect(d.input.listino.get(v)?.categoriaCodice).toBe('001')
    })

    it('tipiAddebito [F]: entra il contratto con una F; il documento ha anche i MOVIMENTO e i minimi; un contratto con sole righe CER resta fuori', async () => {
      const az = await azienda()
      const x = await contratto(az)
      await riga(az, x.elencoId, 'F', '10')
      const mw = await riga(az, x.elencoId, 'MW', '500')
      await legame(az, x)
      const y = await contratto(az)
      await legame(az, y)
      const s = await seleziona(az, { filtri: { tipiAddebito: ['F'] } })
      expect(s.documenti.map(d => d.contrattoId)).toEqual([x.contrattoId])
      const d = s.documenti[0]
      expect(d.input.legami).toHaveLength(1)
      expect(d.input.minimi.map(r => r.id)).toEqual([mw])
      expect(calcolaDocumento(d.input).righe.map(r => r.tipoRiga)).toEqual(
        expect.arrayContaining(['MOVIMENTO', 'FISSO', 'MINIMO'])
      )
    })

    it('riga della categoria solo in un allegato: il principale entra', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      const all = await contratto(az, { principaleId: c.contrattoId, rigaCer: false })
      await riga(az, all.elencoId, 'TT', '0.02', { categoriaId: az.listino.categoriaId })
      const s = await seleziona(az, { filtri: { categoriaIds: [az.listino.categoriaId] } })
      expect(s.documenti.map(d => d.contrattoId)).toEqual([c.contrattoId])
    })

    it('riga della categoria in un elenco non valido nel periodo: il contratto resta fuori', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      await riga(az, c.elencoId, 'V', '3', { categoriaId: az.listino.categoriaId })
      await owner.elencoAddebiti.update({
        where: { id: c.elencoId },
        data: {
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-02-28T00:00:00Z'),
        },
      })
      const s = await seleziona(az, { filtri: { categoriaIds: [az.listino.categoriaId] } })
      expect(s.documenti).toEqual([])
    })

    it('categoriaIds e tipiAddebito insieme: AND, serve una riga di ciascuno anche diverse', async () => {
      const az = await azienda()
      const x = await contratto(az) // categoria in una riga V, F in un'altra
      await riga(az, x.elencoId, 'V', '3', { categoriaId: az.listino.categoriaId })
      await riga(az, x.elencoId, 'F', '10')
      await legame(az, x)
      const y = await contratto(az) // solo la categoria
      await riga(az, y.elencoId, 'V', '3', { categoriaId: az.listino.categoriaId })
      await legame(az, y)
      const z = await contratto(az) // solo la F
      await riga(az, z.elencoId, 'F', '10')
      await legame(az, z)
      const s = await seleziona(az, {
        filtri: { categoriaIds: [az.listino.categoriaId], tipiAddebito: ['F'] },
      })
      expect(s.documenti.map(d => d.contrattoId)).toEqual([x.contrattoId])
    })
  })

  // -------------------------------------------------------------------------------------------
  // Impronta e marcatori (Q4)
  // -------------------------------------------------------------------------------------------

  describe('versioni per l’impronta', () => {
    it('le versioni contengono i dati letti; il marcatore scritto su un canone del documento compare', async () => {
      const az = await azienda()
      const c = await contratto(az)
      const f = await riga(az, c.elencoId, 'F', '10')
      await legame(az, c)
      const prima = await seleziona(az)
      expect(prima.versioni.marcatori).toEqual([])
      expect(prima.versioni.legami).toHaveLength(1)
      expect(prima.versioni.contratti.map(v => v.id)).toEqual([c.contrattoId])
      expect(prima.versioni.elenchi.map(v => v.id)).toEqual([c.elencoId])
      expect(prima.versioni.righeAddebito.map(v => v.id).sort()).toEqual([c.rigaCerId, f].sort())
      expect(prima.versioni.codiciIva.map(v => v.id)).toEqual([az.listino.iva22Id])
      expect(prima.versioni.clienti.map(v => v.id)).toEqual([c.clienteId])
      expect(prima.versioni.condizioniPagamento.map(v => v.id)).toEqual([az.tab.condizioneId])
      expect(prima.versioni.contiCorrenti.map(v => v.id)).toEqual([az.tab.contoId])
      expect(prima.versioni.cedente).toMatchObject({ id: az.tenantId })
      const impronta = improntaElaborazione(prima.versioni)

      // Un canone fatturato da un'altra elaborazione: un marcatore sulla riga F.
      const { documentoId } = await creaDocumentoDiTest(owner, az.tenantId, {
        stato: 'BOZZA',
        registroIvaId: az.tab.registroId,
        anno: 2026,
      })
      const rigaDoc = await owner.$queryRaw<{ id: string }[]>`
        INSERT INTO righe_documento_fattura
          (tenant_id, documento_id, numero_linea, tipo_riga, descrizione, quantita, prezzo_unitario,
           importo_lordo, importo_sconto, prezzo_totale, codice_iva_id, aliquota_iva, updated_at)
        VALUES (${az.tenantId}::uuid, ${documentoId}::uuid, 1, 'FISSO', 'canone', 1, 10, 10, 0, 10,
                ${az.listino.iva22Id}::uuid, 22, now())
        RETURNING id::text AS id`
      await owner.$executeRaw`
        INSERT INTO marcatori_addebiti_fatturati
          (tenant_id, riga_addebito_id, tipo, chiave_competenza, documento_id, riga_documento_id)
        VALUES (${az.tenantId}::uuid, ${f}::uuid, 'PERIODO_CANONE', '2026-02-01/2026-02-28',
                ${documentoId}::uuid, ${rigaDoc[0].id}::uuid)`
      const dopo = await seleziona(az)
      expect(dopo.versioni.marcatori).toEqual([
        { rigaAddebitoId: f, tipo: 'PERIODO_CANONE', chiaveCompetenza: '2026-02-01/2026-02-28' },
      ])
      expect(improntaElaborazione(dopo.versioni)).not.toBe(impronta)
    })

    it('stessa selezione, stessa impronta; una versione cambiata (cliente, condizione, conto, cedente) la cambia', async () => {
      const az = await azienda()
      const c = await contratto(az)
      await legame(az, c)
      const imp = async () => improntaElaborazione((await seleziona(az)).versioni)
      const base = await imp()
      expect(await imp()).toBe(base)
      await owner.cliente.update({
        where: { id: c.clienteId },
        data: { versione: { increment: 1 } },
      })
      const dopoCliente = await imp()
      expect(dopoCliente).not.toBe(base)
      await owner.condizionePagamento.update({
        where: { id: az.tab.condizioneId },
        data: { versione: { increment: 1 } },
      })
      const dopoCondizione = await imp()
      expect(dopoCondizione).not.toBe(dopoCliente)
      await owner.contoCorrente.update({
        where: { id: az.tab.contoId },
        data: { versione: { increment: 1 } },
      })
      const dopoConto = await imp()
      expect(dopoConto).not.toBe(dopoCondizione)
      await owner.cedenteFatturazione.update({
        where: { tenantId: az.tenantId },
        data: { versione: { increment: 1 } },
      })
      const dopoCedente = await imp()
      expect(dopoCedente).not.toBe(dopoConto)
      // Ditta e sede non hanno `versione`: contano per contenuto.
      const cl = await owner.cliente.findUniqueOrThrow({ where: { id: c.clienteId } })
      await owner.ditta.update({
        where: { id: cl.dittaId },
        data: { ragioneSociale: 'Altro nome' },
      })
      const dopoDitta = await imp()
      expect(dopoDitta).not.toBe(dopoCedente)
      await owner.sedeDitta.update({ where: { id: cl.sedeId }, data: { comune: 'Napoli' } })
      const dopoSede = await imp()
      expect(dopoSede).not.toBe(dopoDitta)
      // Un registro disattivato cambia l'errore SENZA_REGISTRO_IVA: cambia anche l'impronta.
      await owner.registroIva.update({ where: { id: az.tab.registroId }, data: { attivo: false } })
      expect(await imp()).not.toBe(dopoSede)
    })
  })

  // -------------------------------------------------------------------------------------------
  // Fixture
  // -------------------------------------------------------------------------------------------

  describe('fixture', () => {
    it('creaDocumentoDiTest con legamiIds: riga_legame_id NULL, movimento_fatturato_id valorizzato', async () => {
      const t = await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Fixture SRL', country: 'IT' },
      })
      tenantCreati.push(t.id)
      const az = { tenantId: t.id }
      const s = await creaScenarioFatturazione(owner, az.tenantId, { legami: 2 })
      const { documentoId } = await creaDocumentoDiTest(owner, az.tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: s.registroIvaId,
        anno: 2026,
        legamiIds: s.legamiIds,
      })
      const righe = await owner.$queryRaw<
        { riga_legame_id: string | null; movimento_fatturato_id: string | null }[]
      >`SELECT riga_legame_id::text, movimento_fatturato_id::text FROM righe_documento_fattura
        WHERE documento_id = ${documentoId}::uuid`
      expect(righe).toHaveLength(2)
      for (const r of righe) {
        expect(r.riga_legame_id).toBeNull()
        expect(r.movimento_fatturato_id).not.toBeNull()
      }
    })
  })

  // -------------------------------------------------------------------------------------------
  // Lock della definitiva
  // -------------------------------------------------------------------------------------------

  describe('lock della definitiva', () => {
    async function inAttesaDiLock(): Promise<number> {
      const r = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
          AND wait_event_type = 'Lock'`
      return r[0].n
    }
    async function attendiLock(n: number, finita: () => boolean = () => false): Promise<void> {
      const scadenza = Date.now() + 30_000
      for (;;) {
        if ((await inAttesaDiLock()) >= n) return
        if (finita()) throw new Error('la transazione e` finita senza attendere il lock')
        if (Date.now() > scadenza)
          throw new Error(`nessuna sessione in attesa di lock (attese ${n})`)
        await new Promise(r => setTimeout(r, 20))
      }
    }

    /** Un'azienda con un contratto, un legame e una bozza che li cita. */
    async function conBozza() {
      const az = await azienda()
      const c = await contratto(az)
      const l = await legame(az, c)
      const { documentoId } = await creaDocumentoDiTest(owner, az.tenantId, {
        stato: 'BOZZA',
        registroIvaId: az.tab.registroId,
        anno: 2026,
        legamiIds: [l.legameId],
      })
      await owner.$executeRaw`
        UPDATE documenti_fattura SET periodo_dal = '2026-03-01', periodo_al = '2026-03-31'
        WHERE id = ${documentoId}::uuid`
      return { az, c, l, documentoId }
    }

    it('insiemiPerDefinitiva: contratto, elenchi validi, righe di listino e legami della bozza', async () => {
      const { az, c, l, documentoId } = await conBozza()
      const scaduto = await owner.elencoAddebiti.create({
        data: {
          tenantId: az.tenantId,
          contrattoId: c.contrattoId,
          codice: '002',
          descrizione: 'scaduto',
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-02-01T00:00:00Z'),
        },
      })
      await riga(az, scaduto.id, 'CER', '9')
      const all = await contratto(az, { principaleId: c.contrattoId })
      const s = await nel(az.tenantId, tx => insiemiPerDefinitiva(tx, az.tenantId, [documentoId]))
      expect(s.contrattoIds).toEqual([c.contrattoId, all.contrattoId].sort())
      expect(s.elencoIds).toEqual([c.elencoId, all.elencoId].sort())
      expect(s.elencoIds).not.toContain(scaduto.id)
      expect(s.rigaIds).toEqual([c.rigaCerId, all.rigaCerId].sort())
      expect(s.legameIds).toEqual([l.legameId])
      const vuoto = await nel(az.tenantId, tx => insiemiPerDefinitiva(tx, az.tenantId, []))
      expect(vuoto).toEqual({ contrattoIds: [], elencoIds: [], rigaIds: [], legameIds: [] })
    })

    it('bloccaElaborazione: stato e versione; 404 se manca', async () => {
      const az = await azienda()
      const [e] = await owner.$queryRaw<{ id: string }[]>`
        INSERT INTO elaborazioni_fatturazione
          (tenant_id, stato, periodo_dal, periodo_al, data_documento, raggruppamento, updated_at)
        VALUES (${az.tenantId}::uuid, 'ANTEPRIMA_PRONTA', '2026-03-01', '2026-03-31', '2026-04-05',
                'PER_CONTRATTO', now())
        RETURNING id::text AS id`
      const r = await nel(az.tenantId, tx => bloccaElaborazione(tx, az.tenantId, e.id))
      expect(r).toEqual({ stato: 'ANTEPRIMA_PRONTA', versione: 1 })
      await expect(
        nel(az.tenantId, tx => bloccaElaborazione(tx, az.tenantId, randomUUID()))
      ).rejects.toMatchObject({ status: 404 })
    })

    it('un FOR UPDATE del listino tiene in attesa la definitiva (barriera), poi questa procede', async () => {
      const { az, documentoId } = await conBozza()
      let rilascia!: () => void
      const barriera = new Promise<void>(r => (rilascia = r))
      let pronto!: () => void
      const tenuto = new Promise<void>(r => (pronto = r))
      // Chi scrive il listino: contratto FOR SHARE, elenchi FOR UPDATE, righe FOR NO KEY UPDATE.
      const scrittore = owner.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM contratti_cliente WHERE tenant_id = ${az.tenantId}::uuid FOR SHARE`
        await tx.$queryRaw`SELECT id FROM elenchi_addebiti WHERE tenant_id = ${az.tenantId}::uuid FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM righe_addebito WHERE tenant_id = ${az.tenantId}::uuid FOR NO KEY UPDATE`
        pronto()
        await barriera
      }, OPZ)
      await tenuto
      let finita = false
      const definitiva = nel(az.tenantId, async tx => {
        const i = await insiemiPerDefinitiva(tx, az.tenantId, [documentoId])
        await bloccaPerDefinitiva(tx, az.tenantId, i)
      }).finally(() => (finita = true))
      await attendiLock(1, () => finita)
      expect(finita).toBe(false)
      rilascia()
      await scrittore
      await definitiva
      expect(finita).toBe(true)
    })

    it('20 coppie parallele listino e definitiva: nessun deadlock', async () => {
      const { az, documentoId } = await conBozza()
      const coppie = Array.from({ length: 20 }, (_, i) => i)
      const lavori = coppie.flatMap(() => [
        owner.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '20s'`)
          await tx.$queryRaw`SELECT id FROM contratti_cliente WHERE tenant_id = ${az.tenantId}::uuid FOR SHARE`
          await tx.$queryRaw`SELECT id FROM elenchi_addebiti WHERE tenant_id = ${az.tenantId}::uuid ORDER BY id FOR UPDATE`
          await tx.$queryRaw`SELECT id FROM righe_addebito WHERE tenant_id = ${az.tenantId}::uuid ORDER BY id FOR NO KEY UPDATE`
        }, OPZ),
        nel(az.tenantId, async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '20s'`)
          const i = await insiemiPerDefinitiva(tx, az.tenantId, [documentoId])
          await bloccaPerDefinitiva(tx, az.tenantId, i)
        }),
      ])
      const esiti = await Promise.allSettled(lavori)
      expect(esiti.filter(e => e.status === 'rejected')).toEqual([])
    }, 120_000)

    it('con un id di contratto cancellato: nessun errore, le altre righe bloccate', async () => {
      const { az, c, l, documentoId } = await conBozza()
      const i = await nel(az.tenantId, tx => insiemiPerDefinitiva(tx, az.tenantId, [documentoId]))
      await nel(az.tenantId, async tx => {
        await bloccaPerDefinitiva(tx, az.tenantId, {
          ...i,
          contrattoIds: [...i.contrattoIds, randomUUID()],
          legameIds: [...i.legameIds, randomUUID()],
        })
        // Un'altra sessione non ottiene FOR UPDATE ne' sul contratto (FOR SHARE) ne' sul legame.
        for (const sql of [
          Prisma.sql`SELECT id FROM contratti_cliente WHERE id = ${c.contrattoId}::uuid FOR UPDATE NOWAIT`,
          Prisma.sql`SELECT id FROM legami_movimento WHERE id = ${l.legameId}::uuid FOR UPDATE NOWAIT`,
          Prisma.sql`SELECT id FROM righe_addebito WHERE id = ${c.rigaCerId}::uuid FOR UPDATE NOWAIT`,
        ]) {
          await expect(owner.$queryRaw(sql)).rejects.toThrow(/lock|55P03/i)
        }
      })
    })

    it('dopo bloccaPerDefinitiva enable_nestloop ha il valore di prima', async () => {
      const { az, documentoId } = await conBozza()
      for (const prima of ['on', 'off']) {
        const dopo = await nel(az.tenantId, async tx => {
          await tx.$queryRaw`SELECT set_config('enable_nestloop', ${prima}, true)`
          const i = await insiemiPerDefinitiva(tx, az.tenantId, [documentoId])
          await bloccaPerDefinitiva(tx, az.tenantId, i)
          return (
            await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('enable_nestloop') AS v`
          )[0].v
        })
        expect(dopo).toBe(prima)
      }
    })
  })

  // -------------------------------------------------------------------------------------------
  // Volume
  // -------------------------------------------------------------------------------------------

  describe('volume: 10.000 legami su 500 contratti', () => {
    let volume: Awaited<ReturnType<typeof creaScenarioVolume>>
    let tenantVolume = ''
    const tempi: Record<string, number> = {}

    beforeAll(async () => {
      const t = await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Volume SRL', country: 'IT' },
      })
      tenantVolume = t.id
      tenantCreati.push(t.id)
      writeFileSync(FILE_VOLUME, JSON.stringify([...idVolumeSuFile(), t.id]))
      const t0 = Date.now()
      volume = await creaScenarioVolume(owner, t.id)
      tempi.caricamento = Date.now() - t0
      // Statistiche vere come in produzione, poi si forza il peggio con il piano generico.
      for (const tabella of [
        'waste_movements',
        'legami_movimento',
        'righe_legame_movimento',
        'contratti_cliente',
        'elenchi_addebiti',
        'righe_addebito',
        'clienti',
        'ditte',
        'sedi_ditte',
      ]) {
        await owner.$executeRawUnsafe(`ANALYZE ${tabella}`)
      }
    }, 300_000)

    it('selezione sotto 5 s, con 500 documenti e 10.000 legami', async () => {
      const t0 = Date.now()
      const s = await seleziona({ tenantId: tenantVolume })
      tempi.selezione = Date.now() - t0
      expect(s.erroriGenerali).toEqual([])
      expect(s.documenti).toHaveLength(500)
      expect(
        s.documenti.reduce((n, d) => n + new Set(d.input.legami.map(l => l.legameId)).size, 0)
      ).toBe(10_000)
      expect(tempi.selezione).toBeLessThan(5_000)
      const r = calcolaDocumento(s.documenti[0].input)
      expect(r.errori).toEqual([])
      expect(r.righe.filter(x => x.tipoRiga === 'MOVIMENTO')).toHaveLength(20)
    })

    it('numero di query costante: 5 contratti e 500 contratti fanno le stesse query', async () => {
      const conta = async (p: ParametriElaborazione) => {
        let n = 0
        let documenti = 0
        await nel(tenantVolume, async tx => {
          const x = contaQuery(tx)
          documenti = (await selezionaElaborazione(x.tx, tenantVolume, p)).documenti.length
          n = x.n()
        })
        return { n, documenti }
      }
      const cinque = await conta({
        ...P,
        filtri: { contrattoIds: volume.contrattoIds.slice(0, 5) },
      })
      const tutti = await conta(P)
      tempi.queryCinque = cinque.n
      tempi.queryTutti = tutti.n
      expect(cinque.documenti).toBe(5)
      expect(tutti.documenti).toBe(500)
      expect(tutti.n).toBe(cinque.n)
      expect(tutti.n).toBeLessThanOrEqual(40)
    })

    it('piano generico forzato (plan_cache_mode nella transazione, statistiche vere): selezione sotto 5 s', async () => {
      const t0 = Date.now()
      const s = await nel(tenantVolume, async tx => {
        await tx.$queryRaw`SELECT set_config('plan_cache_mode', 'force_generic_plan', true)`
        await tx.$queryRaw`SELECT set_config('statement_timeout', '5s', true)`
        return selezionaElaborazione(tx, tenantVolume, P)
      })
      tempi.selezioneGenerico = Date.now() - t0
      expect(s.documenti).toHaveLength(500)
      expect(tempi.selezioneGenerico).toBeLessThan(5_000)
    })

    it('insiemiPerDefinitiva su 500 documenti: una query per insieme, e bloccaPerDefinitiva lineare', async () => {
      // 500 bozze minime, una per contratto (testate soltanto: servono contratto e periodo).
      const ids: string[] = []
      for (let da = 0; da < volume.contrattoIds.length; da += 100) {
        const blocco = volume.contrattoIds.slice(da, da + 100)
        const nuovi = await owner.$queryRaw<{ id: string }[]>`
          INSERT INTO documenti_fattura
            (tenant_id, stato, tipo_documento, registro_iva_id, anno, data_documento, cliente_id,
             cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al, formato_trasmissione,
             esigibilita_iva, totale_imponibile, totale_iva, totale_documento, netto_a_pagare,
             fotografia, updated_at)
          SELECT ${tenantVolume}::uuid, 'BOZZA', 'TD01', ${volume.registroIvaId}::uuid, 2026,
                 '2026-04-05'::date, c.cliente_id, c.cliente_id, c.id, '2026-03-01', '2026-03-31',
                 'FPR12', 'IMMEDIATA', 0, 0, 0, 0, '{}'::jsonb, now()
          FROM contratti_cliente c
          WHERE c.tenant_id = ${tenantVolume}::uuid AND c.id = ANY(${blocco}::uuid[])
          RETURNING id::text AS id`
        ids.push(...nuovi.map(n => n.id))
      }
      expect(ids).toHaveLength(500)
      let query = 0
      let insiemi!: Awaited<ReturnType<typeof insiemiPerDefinitiva>>
      await nel(tenantVolume, async tx => {
        const x = contaQuery(tx)
        insiemi = await insiemiPerDefinitiva(x.tx, tenantVolume, ids)
        query = x.n()
      })
      // 5 query dell'insieme + 3 del wrapper `conJoinLineari` (lettura, SET e ripristino di enable_nestloop).
      expect(query).toBeLessThanOrEqual(5 + 3)
      expect(insiemi.contrattoIds).toHaveLength(500)
      expect(insiemi.elencoIds).toHaveLength(500)
      expect(insiemi.rigaIds).toHaveLength(500)
      const t0 = Date.now()
      await nel(tenantVolume, tx => bloccaPerDefinitiva(tx, tenantVolume, insiemi))
      tempi.blocco = Date.now() - t0
      expect(tempi.blocco).toBeLessThan(5_000)
    }, 120_000)

    afterAll(() => {
      // Con TEMPI_VOLUME=1 i tempi si stampano (rapporto del task); di norma la suite e' muta.
      if (process.env.TEMPI_VOLUME === '1') {
        // eslint-disable-next-line no-console
        console.info(`TEMPI VOLUME (ms): ${JSON.stringify(tempi)}`)
      }
    })
  })
})
