/**
 * Lista, dettaglio e mappatura dei documenti (Task 17b) contro un Postgres reale, collegato COME
 * `wasteflow_app` dentro il `TenantContext`. Il proprietario prepara le fixture. Pulizia solo per
 * id esatti (`pulisciTenantDiTest`).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL += `&application_name=fatt-t17b-${process.pid}&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import { MESSAGGI_ERRORE } from '../../domain/fatturazione/codici'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaDocumentoDiTest,
  creaScenarioFatturazione,
} from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { assicuraCatalogoCer, creaContrattoConElenco } from '../../test-support/listino-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'

const CHIAVI_RIGA = [
  'annullabile',
  'avvisi',
  'cliente',
  'contratto',
  'dataDocumento',
  'emessoIl',
  'errori',
  'esclusoDaDefinitiva',
  'id',
  'motivoNonAnnullabile',
  'numeroTesto',
  'registro',
  'stato',
  'stornabile',
  'tipoDocumento',
  'totaleDocumento',
  'totaleImponibile',
  'totaleIva',
]
const CHIAVI_DETTAGLIO = [
  ...CHIAVI_RIGA,
  'bolloDovuto',
  'documentoOrigineId',
  'importoBollo',
  'nettoAPagare',
  'rate',
  'riepiloghi',
  'righe',
  'stornoId',
  'versione',
  'xmlGenerato',
].sort()
const CHIAVI_RIGA_VISTA = [
  'aliquotaIva',
  'cerCode',
  'dataMovimento',
  'descrizione',
  'importoLordo',
  'importoSconto',
  'legameId',
  'naturaIva',
  'numeroFir',
  'numeroLinea',
  'prezzoTotale',
  'prezzoUnitario',
  'quantita',
  'rigaAddebitoId',
  'sconto',
  'tipoRiga',
  'unitaMisura',
]

describe('DocumentiFatturaService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: DocumentiFatturaService
  const tenantCreati: string[] = []
  const cerCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    servizio = new DocumentiFatturaService(app)
    cerCreati.push(...(await assicuraCatalogoCer(owner, ['20 03 01'])))
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda(opz: { legami?: number; registri?: number } = {}) {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Documenti SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const scenario = await creaScenarioFatturazione(owner, t.id, {
      legami: opz.legami ?? 2,
      registri: opz.registri ?? 1,
    })
    return { tenantId: t.id, scenario }
  }

  const segnaUltimo = (tenantId: string, registroIvaId: string, anno: number, ultimo: number) =>
    owner.$executeRawUnsafe(
      `INSERT INTO numerazioni_fattura (tenant_id, registro_iva_id, anno, ultimo_numero, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::int, $4::int, now())
       ON CONFLICT (tenant_id, registro_iva_id, anno) DO UPDATE SET ultimo_numero = $4::int`,
      tenantId,
      registroIvaId,
      anno,
      ultimo
    )

  const promuovi = (id: string, numero: number, testo: string) =>
    owner.$executeRawUnsafe(
      `UPDATE documenti_fattura SET stato = 'DEFINITIVO', numero = $2::int, numero_testo = $3,
         definito_il = now(), updated_at = now() WHERE id = $1::uuid`,
      id,
      numero,
      testo
    )

  // -------------------------------------------------------------------------------------------
  describe('lista', () => {
    it('filtra per registro, anno, stato, cliente, date, elaborazione ed errori', async () => {
      const { tenantId, scenario } = await azienda({ legami: 2, registri: 2 })
      const reg1 = scenario.registroIvaId
      const [reg2] = (
        await owner.registroIva.findMany({
          where: { tenantId, id: { not: reg1 } },
          select: { id: true },
        })
      ).map(r => r.id)
      const [elab] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO elaborazioni_fatturazione
           (tenant_id, periodo_dal, periodo_al, data_documento, raggruppamento, updated_at)
         VALUES ($1::uuid, '2025-01-01', '2025-12-31', '2025-06-01', 'PER_CONTRATTO', now())
         RETURNING id::text AS id`,
        tenantId
      )
      const d1 = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: reg1,
        anno: 2026,
        legamiIds: [scenario.legamiIds[0]],
      })
      const d2 = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: reg1,
        anno: 2026,
        dataDocumento: '2026-04-10',
        legamiIds: [scenario.legamiIds[1]],
      })
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura SET errori = ARRAY['FAMIGLIA_NON_CALCOLATA']::text[]
         WHERE id = $1::uuid`,
        d2.documentoId
      )
      // Secondo cliente, registro e anno diversi, dentro un'elaborazione.
      const altro = await creaContrattoConElenco(owner, tenantId)
      const d3 = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: reg2,
        anno: 2025,
        dataDocumento: '2025-06-01',
        elaborazioneId: elab.id,
      })
      const d4 = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'ANNULLATO',
        registroIvaId: reg1,
        anno: 2026,
        dataDocumento: '2026-05-20',
      })
      expect(altro.clienteId).toBeDefined()

      const q = (f: object = {}) =>
        nel(tenantId, () => servizio.lista(tenantId, { pagina: 1, dimensione: 100, ...f }))
      const ids = async (f: object) => (await q(f)).elementi.map(e => e.id).sort()
      const tutti = [d1, d2, d3, d4].map(d => d.documentoId).sort()

      expect(await ids({})).toEqual(tutti)
      expect(await ids({ registroIvaId: reg2 })).toEqual([d3.documentoId])
      expect(await ids({ anno: 2025 })).toEqual([d3.documentoId])
      expect(await ids({ stato: 'BOZZA' })).toEqual([d2.documentoId])
      expect(await ids({ stato: 'ANNULLATO' })).toEqual([d4.documentoId])
      expect(await ids({ clienteId: scenario.clienteId })).toEqual(
        [d1.documentoId, d2.documentoId].sort()
      )
      expect(await ids({ dataDa: '2026-04-01', dataA: '2026-04-30' })).toEqual([d2.documentoId])
      expect(await ids({ dataA: '2025-12-31' })).toEqual([d3.documentoId])
      expect(await ids({ elaborazioneId: elab.id })).toEqual([d3.documentoId])
      expect(await ids({ conErrori: true })).toEqual([d2.documentoId])
      expect(await ids({ conErrori: false })).toEqual(
        [d1.documentoId, d3.documentoId, d4.documentoId].sort()
      )

      // Ordine: data decrescente; paginazione e totale.
      const pagina = await q({ dimensione: 2, pagina: 2 })
      expect(pagina.totale).toBe(4)
      expect(pagina.pagina).toBe(2)
      expect(pagina.dimensione).toBe(2)
      const tuttiOrdinati = (await q()).elementi.map(e => e.dataDocumento)
      expect(tuttiOrdinati).toEqual([...tuttiOrdinati].sort().reverse())
      expect(pagina.elementi.map(e => e.id)).toEqual(
        (await q()).elementi.slice(2, 4).map(e => e.id)
      )
    })

    it('numeroTesto: «15/A» col suffisso, null per la bozza', async () => {
      const { tenantId, scenario } = await azienda({ legami: 2 })
      const bozza = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: scenario.registroIvaId,
        anno: 2026,
        legamiIds: [scenario.legamiIds[0]],
      })
      const con = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: scenario.registroIvaId,
        anno: 2026,
        legamiIds: [scenario.legamiIds[1]],
      })
      await promuovi(con.documentoId, 15, '15/A')
      const r = await nel(tenantId, () => servizio.lista(tenantId, { pagina: 1, dimensione: 10 }))
      const perId = new Map(r.elementi.map(e => [e.id, e]))
      expect(perId.get(con.documentoId)?.numeroTesto).toBe('15/A')
      expect(perId.get(bozza.documentoId)?.numeroTesto).toBeNull()
      expect(perId.get(bozza.documentoId)?.cliente.denominazione).toBeTruthy()
      expect(perId.get(bozza.documentoId)?.registro.codice).toBe('01')
    })

    it('numero di query costante con 1 e con 100 documenti (contato)', async () => {
      const { tenantId, scenario } = await azienda({ legami: 1 })
      const primo = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: scenario.registroIvaId,
        anno: 2026,
        legamiIds: [scenario.legamiIds[0]],
      })
      await owner.$executeRawUnsafe(
        `INSERT INTO documenti_fattura
           (tenant_id, stato, tipo_documento, registro_iva_id, anno, data_documento, cliente_id,
            cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al, formato_trasmissione,
            esigibilita_iva, totale_imponibile, totale_iva, totale_documento, netto_a_pagare,
            fotografia, updated_at)
         SELECT tenant_id, 'BOZZA', tipo_documento, registro_iva_id, anno, data_documento, cliente_id,
            cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al, formato_trasmissione,
            esigibilita_iva, totale_imponibile, totale_iva, totale_documento, netto_a_pagare,
            '{}'::jsonb, now()
         FROM documenti_fattura d, generate_series(1, 99) g
         WHERE d.id = $1::uuid`,
        primo.documentoId
      )
      const tutti = (
        await owner.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id::text AS id FROM documenti_fattura WHERE tenant_id = $1::uuid`,
          tenantId
        )
      ).map(r => r.id)
      expect(tutti).toHaveLength(100)

      const conta = (ids: string[]) =>
        nel(tenantId, () =>
          app.$transaction(async tx => {
            let n = 0
            const contato = new Proxy(tx, {
              get(bersaglio, prop, ricevente) {
                const v = Reflect.get(bersaglio, prop, ricevente)
                if (prop === '$queryRaw' || prop === '$executeRaw') {
                  return (...a: unknown[]) => {
                    n++
                    return (v as (...x: unknown[]) => unknown).apply(bersaglio, a)
                  }
                }
                return v
              },
            })
            const righe = await servizio.righeInTx(contato, tenantId, ids)
            return { n, righe: righe.length }
          })
        )
      const uno = await conta([tutti[0]])
      const cento = await conta(tutti)
      expect(uno.righe).toBe(1)
      expect(cento.righe).toBe(100)
      expect(cento.n).toBe(uno.n)
      expect(uno.n).toBeLessThanOrEqual(7)

      const pagina = await nel(tenantId, () =>
        servizio.lista(tenantId, { pagina: 1, dimensione: 100 })
      )
      expect(pagina.totale).toBe(100)
      expect(pagina.elementi).toHaveLength(100)
    })

    it('RLS: la lista di un altro tenant non vede i documenti', async () => {
      const a = await azienda({ legami: 1 })
      const b = await azienda({ legami: 1 })
      await creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'BOZZA',
        registroIvaId: a.scenario.registroIvaId,
        anno: 2026,
        legamiIds: [a.scenario.legamiIds[0]],
      })
      const r = await nel(b.tenantId, () =>
        servizio.lista(b.tenantId, { pagina: 1, dimensione: 10 })
      )
      expect(r.totale).toBe(0)
      expect(r.elementi).toEqual([])
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('dettaglio', () => {
    it('righe, riepiloghi e rate nell’ordine di numero_linea e ordine; forma esatta del mapper', async () => {
      const { tenantId, scenario } = await azienda({ legami: 2 })
      const d = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: scenario.registroIvaId,
        anno: 2026,
        legamiIds: scenario.legamiIds,
        conRateERiepilogo: true,
      })
      // Figlie inserite in ordine inverso: l'ordinamento deve essere quello delle colonne.
      await owner.$executeRawUnsafe(
        `INSERT INTO rate_documento_fattura (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, updated_at)
         VALUES ($1::uuid, $2::uuid, 3, 'MP05', '2026-06-30', 3, now()),
                ($1::uuid, $2::uuid, 2, 'MP05', '2026-05-31', 2, now())`,
        tenantId,
        d.documentoId
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO riepiloghi_iva_documento (tenant_id, documento_id, aliquota, natura, imponibile, imposta, esigibilita, updated_at)
         VALUES ($1::uuid, $2::uuid, 0, 'N2.2', 10, 0, 'SCISSIONE', now())`,
        tenantId,
        d.documentoId
      )
      const v = await nel(tenantId, () => servizio.dettaglio(tenantId, d.documentoId))

      expect(Object.keys(v).sort()).toEqual(CHIAVI_DETTAGLIO)
      expect(v.righe).toHaveLength(2)
      expect(v.righe.map(r => r.numeroLinea)).toEqual([1, 2])
      for (const r of v.righe) expect(Object.keys(r).sort()).toEqual(CHIAVI_RIGA_VISTA)
      expect(v.righe[0].quantita).toBe('100.000')
      expect(v.rate.map(r => r.ordine)).toEqual([1, 2, 3])
      expect(Object.keys(v.rate[0]).sort()).toEqual(
        [
          'abi',
          'bic',
          'cab',
          'dataScadenza',
          'iban',
          'importo',
          'istituto',
          'modalita',
          'ordine',
        ].sort()
      )
      expect(v.riepiloghi).toHaveLength(2)
      expect(v.riepiloghi[0].aliquota).toBe('22.00')
      expect(v.riepiloghi[1]).toMatchObject({ aliquota: '0.00', natura: 'N2.2', esigibilita: 'S' })
      expect(Object.keys(v.riepiloghi[0]).sort()).toEqual(
        [
          'aliquota',
          'esigibilita',
          'imponibile',
          'imposta',
          'natura',
          'riferimentoNormativo',
        ].sort()
      )
      expect(v.esclusoDaDefinitiva).toBe(false)
      expect(v.stornoId).toBeNull()
      expect(v.documentoOrigineId).toBeNull()
      expect(v.xmlGenerato).toBe(false)
      expect(v.versione).toBe(1)
      expect(v.nettoAPagare).toBe(v.totaleDocumento)
    })

    it('forma della lista: chiavi esatte di DocumentoRiga, nessun id interno né tenantId', async () => {
      const { tenantId, scenario } = await azienda({ legami: 1 })
      await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: scenario.registroIvaId,
        anno: 2026,
        legamiIds: scenario.legamiIds,
      })
      const r = await nel(tenantId, () => servizio.lista(tenantId, { pagina: 1, dimensione: 5 }))
      const e = r.elementi[0]
      expect(Object.keys(e).sort()).toEqual(CHIAVI_RIGA)
      expect(Object.keys(e.cliente).sort()).toEqual(['denominazione', 'id'])
      expect(Object.keys(e.contratto).sort()).toEqual(['id', 'numero'])
      expect(Object.keys(e.registro).sort()).toEqual(['codice', 'id'])
      expect(JSON.stringify(e)).not.toContain(tenantId)
    })

    it('bozza con FAMIGLIA_NON_CALCOLATA: dettaglio «TS riga 1» nella risposta (Q16)', async () => {
      const { tenantId, scenario } = await azienda({ legami: 1 })
      const d = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: scenario.registroIvaId,
        anno: 2026,
        legamiIds: scenario.legamiIds,
      })
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura
           SET errori = ARRAY['FAMIGLIA_NON_CALCOLATA']::text[],
               avvisi = ARRAY['DESTINATARIO_ASSENTE']::text[],
               fotografia = $2::jsonb
         WHERE id = $1::uuid`,
        d.documentoId,
        JSON.stringify({
          segnalazioni: {
            errori: [{ codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio: 'TS riga 1' }],
            avvisi: [{ codice: 'DESTINATARIO_ASSENTE' }],
          },
        })
      )
      const v = await nel(tenantId, () => servizio.dettaglio(tenantId, d.documentoId))
      expect(v.errori).toEqual([
        {
          codice: 'FAMIGLIA_NON_CALCOLATA',
          messaggio: MESSAGGI_ERRORE.FAMIGLIA_NON_CALCOLATA,
          dettaglio: 'TS riga 1',
        },
      ])
      expect(v.avvisi).toHaveLength(1)
      expect(v.avvisi[0].codice).toBe('DESTINATARIO_ASSENTE')
      expect('dettaglio' in v.avvisi[0]).toBe(false)
      expect(v.annullabile).toBe(false)
      expect(v.motivoNonAnnullabile).toBe('NON_DEFINITIVO')
      expect(v.stornabile).toBe(false)
    })

    it('fotografia senza segnalazioni: ripiega sulle colonne errori e avvisi', async () => {
      const { tenantId, scenario } = await azienda({ legami: 1 })
      const d = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: scenario.registroIvaId,
        anno: 2026,
        legamiIds: scenario.legamiIds,
      })
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura SET errori = ARRAY['SENZA_REGISTRO_IVA']::text[] WHERE id = $1::uuid`,
        d.documentoId
      )
      const v = await nel(tenantId, () => servizio.dettaglio(tenantId, d.documentoId))
      expect(v.errori).toEqual([
        { codice: 'SENZA_REGISTRO_IVA', messaggio: MESSAGGI_ERRORE.SENZA_REGISTRO_IVA },
      ])
    })

    it('documento stornato: stornabile false, stornoId valorizzato, motivo STORNATO', async () => {
      const { tenantId, scenario } = await azienda({ legami: 2 })
      const reg = scenario.registroIvaId
      const orig = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: reg,
        anno: 2026,
        legamiIds: [scenario.legamiIds[0]],
      })
      const storno = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: reg,
        anno: 2026,
        legamiIds: [scenario.legamiIds[1]],
      })
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura SET tipo_documento = 'TD04', documento_origine_id = $2::uuid
         WHERE id = $1::uuid`,
        storno.documentoId,
        orig.documentoId
      )
      await promuovi(storno.documentoId, 2, '2')
      await segnaUltimo(tenantId, reg, 2026, 2)

      const o = await nel(tenantId, () => servizio.dettaglio(tenantId, orig.documentoId))
      expect(o.stornabile).toBe(false)
      expect(o.stornoId).toBe(storno.documentoId)
      expect(o.annullabile).toBe(false)
      expect(o.motivoNonAnnullabile).toBe('STORNATO')
      const s = await nel(tenantId, () => servizio.dettaglio(tenantId, storno.documentoId))
      expect(s.tipoDocumento).toBe('TD04')
      expect(s.documentoOrigineId).toBe(orig.documentoId)
      expect(s.stornabile).toBe(false)
      expect(s.motivoNonAnnullabile).toBe('NOTA_DI_CREDITO')
    })

    it('annullabile/stornabile dal database: ultimo, intermedio, emesso', async () => {
      const { tenantId, scenario } = await azienda({ legami: 2 })
      const reg = scenario.registroIvaId
      const a = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: reg,
        anno: 2026,
        legamiIds: [scenario.legamiIds[0]],
      })
      const b = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: reg,
        anno: 2026,
        legamiIds: [scenario.legamiIds[1]],
      })
      await segnaUltimo(tenantId, reg, 2026, 2)
      const leggi = (id: string) => nel(tenantId, () => servizio.dettaglio(tenantId, id))
      let va = await leggi(a.documentoId)
      const vb = await leggi(b.documentoId)
      expect(va.motivoNonAnnullabile).toBe('NON_ULTIMO')
      expect(va.stornabile).toBe(true)
      expect(vb.annullabile).toBe(true)
      expect(vb.motivoNonAnnullabile).toBeNull()
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura SET emesso_il = '2026-03-20T10:30:15.250' WHERE id = $1::uuid`,
        b.documentoId
      )
      const emesso = await leggi(b.documentoId)
      expect(emesso.annullabile).toBe(false)
      expect(emesso.motivoNonAnnullabile).toBe('EMESSO')
      expect(emesso.emessoIl).toBe('2026-03-20T10:30:15.250Z')
      va = await leggi(a.documentoId)
      expect(va.emessoIl).toBeNull()
    })

    it('RLS: documento di un altro tenant → 404; id inesistente → 404', async () => {
      const a = await azienda({ legami: 1 })
      const b = await azienda({ legami: 1 })
      const d = await creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'BOZZA',
        registroIvaId: a.scenario.registroIvaId,
        anno: 2026,
        legamiIds: a.scenario.legamiIds,
      })
      const e = await nel(b.tenantId, () => servizio.dettaglio(b.tenantId, d.documentoId)).catch(
        (x: unknown) => x
      )
      expect(e).toMatchObject({ status: 404 })
      const e2 = await nel(a.tenantId, () =>
        servizio.dettaglio(a.tenantId, '00000000-0000-4000-8000-000000000000')
      ).catch((x: unknown) => x)
      expect(e2).toMatchObject({ status: 404 })
      expect((e as any).getResponse().error).toBe('DOCUMENTO_NON_TROVATO')
    })
  })
})
