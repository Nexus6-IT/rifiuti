/**
 * Manutenzione della fatturazione (fase 4.4b1, Task 22) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS FORCE) dentro il `TenantContext`: pulizia delle bozze, recupero dei job
 * orfani e sonda della numerazione. Il proprietario prepara gli scenari; la pulizia e' solo per id
 * esatti (`pulisciTenantDiTest`).
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo, urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=fatt-t22-${process.pid}&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { FatturazioneManutenzioneJob } from '../../infrastructure/jobs/fatturazione-manutenzione.job'
import { EvidenzeDbService } from '../admin/system-health/evidenze-db.service'
import { creaDocumentoDiTest } from '../../test-support/fatturazione-di-test'
import {
  creaAziendaT18,
  inserisciElaborazioneT18,
  type AziendaT18,
} from '../../test-support/fatturazione-t18-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { ORFANA_DOPO_MINUTI } from './elaborazioni.service'
import {
  ORFANA_ATTIVA_DOPO_MINUTI,
  pulisciBozzeTenant,
  recuperaOrfaniTenant,
} from './manutenzione-fatturazione'

const ORA = new Date('2026-06-10T12:00:00.000Z')
const fa = (giorni: number, minuti = 0) =>
  new Date(ORA.getTime() - giorni * 86_400_000 - minuti * 60_000)

describe('Manutenzione della fatturazione — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
    urlProprietario
  )
  let app: PrismaService
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())
  const pulisci = (tenantId: string, ora = ORA) =>
    nel(tenantId, () => app.$transaction(tx => pulisciBozzeTenant(tx, tenantId, ora)))
  const recupera = (tenantId: string, vivi: string[] = [], ora = ORA) =>
    nel(tenantId, () =>
      app.$transaction(tx => recuperaOrfaniTenant(tx, tenantId, new Set(vivi), ora))
    )

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
  })
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await sistema.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  const azienda = () => creaAziendaT18(owner, tenantCreati)

  /** Elaborazione nello stato dato, con `updated_at` e `job_id` impostati dal proprietario. */
  async function elaborazione(
    az: AziendaT18,
    stato: string,
    aggiornataIl: Date,
    jobId: string | null = null
  ): Promise<string> {
    const id = await inserisciElaborazioneT18(owner, az.tenantId, stato)
    await owner.$executeRawUnsafe(
      `UPDATE elaborazioni_fatturazione SET updated_at = $1::timestamptz, job_id = $2
       WHERE id = $3::uuid AND tenant_id = $4::uuid`,
      aggiornataIl,
      jobId,
      id,
      az.tenantId
    )
    return id
  }
  const bozza = (az: AziendaT18, elaborazioneId: string) =>
    creaDocumentoDiTest(owner, az.tenantId, {
      stato: 'BOZZA',
      registroIvaId: az.tab.registroId,
      anno: 2026,
      elaborazioneId,
      conRateERiepilogo: true,
    }).then(d => d.documentoId)
  const esistono = async (ids: string[]) =>
    (
      await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text AS id FROM documenti_fattura WHERE id = ANY($1::uuid[])`,
        ids
      )
    )
      .map(r => r.id)
      .sort()
  const statoDi = async (id: string) =>
    (
      await owner.$queryRawUnsafe<
        {
          stato: string
          esito: { codice?: string } | null
          errore_tecnico: string | null
          versione: number
        }[]
      >(
        `SELECT stato::text AS stato, esito, errore_tecnico, versione
         FROM elaborazioni_fatturazione WHERE id = $1::uuid`,
        id
      )
    )[0]

  describe('pulisciBozzeTenant', () => {
    it('SCARTATA di 8 giorni: bozze cancellate (e le figlie); di 6: restano', async () => {
      const az = await azienda()
      const vecchia = await elaborazione(az, 'SCARTATA', fa(8))
      const recente = await elaborazione(az, 'SCARTATA', fa(6))
      const bVecchia = await bozza(az, vecchia)
      const bRecente = await bozza(az, recente)

      expect(await pulisci(az.tenantId)).toBe(1)

      expect(await esistono([bVecchia, bRecente])).toEqual([bRecente])
      const figlie = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM righe_documento_fattura WHERE documento_id = $1::uuid`,
        bVecchia
      )
      expect(figlie[0].n).toBe(0)
      expect((await statoDi(vecchia)).stato).toBe('SCARTATA')
    })

    it('FALLITA di 8 giorni: bozze cancellate, stato invariato', async () => {
      const az = await azienda()
      const e = await elaborazione(az, 'FALLITA', fa(8))
      const b = await bozza(az, e)
      await pulisci(az.tenantId)
      expect(await esistono([b])).toEqual([])
      expect((await statoDi(e)).stato).toBe('FALLITA')
    })

    it('ANTEPRIMA_PRONTA di 31 giorni: bozze cancellate, elaborazione SCARTATA; di 29: intatta', async () => {
      const az = await azienda()
      const vecchia = await elaborazione(az, 'ANTEPRIMA_PRONTA', fa(31))
      const bVecchia = await bozza(az, vecchia)
      const prima = (await statoDi(vecchia)).versione

      expect(await pulisci(az.tenantId)).toBe(1)
      expect(await esistono([bVecchia])).toEqual([])
      const dopo = await statoDi(vecchia)
      expect(dopo.stato).toBe('SCARTATA')
      expect(dopo.versione).toBe(prima + 1)

      const recente = await elaborazione(az, 'ANTEPRIMA_PRONTA', fa(29))
      const bRecente = await bozza(az, recente)
      expect(await pulisci(az.tenantId)).toBe(0)
      expect(await esistono([bRecente])).toEqual([bRecente])
      expect((await statoDi(recente)).stato).toBe('ANTEPRIMA_PRONTA')
    })

    it("un DEFINITIVO non si tocca mai, ne' le elaborazioni DEFINITIVA, IN_CORSO e IN_DEFINITIVA vecchie", async () => {
      const az = await azienda()
      const definitiva = await elaborazione(az, 'DEFINITIVA', fa(60))
      const doc = (
        await creaDocumentoDiTest(owner, az.tenantId, {
          stato: 'DEFINITIVO',
          registroIvaId: az.tab.registroId,
          anno: 2026,
          numero: 1,
          elaborazioneId: definitiva,
        })
      ).documentoId
      // Un DEFINITIVO agganciato anche a un'elaborazione scartata e vecchia resta (filtro sullo stato del documento).
      const scartata = await elaborazione(az, 'SCARTATA', fa(40))
      const docScartata = (
        await creaDocumentoDiTest(owner, az.tenantId, {
          stato: 'DEFINITIVO',
          registroIvaId: az.tab.registroId,
          anno: 2026,
          numero: 2,
          elaborazioneId: scartata,
        })
      ).documentoId
      const inDefinitiva = await elaborazione(az, 'IN_DEFINITIVA', fa(40))
      const bInDefinitiva = await bozza(az, inDefinitiva)

      expect(await pulisci(az.tenantId)).toBe(0)

      expect(await esistono([doc, docScartata, bInDefinitiva])).toEqual(
        [doc, docScartata, bInDefinitiva].sort()
      )
      expect((await statoDi(definitiva)).stato).toBe('DEFINITIVA')
      expect((await statoDi(inDefinitiva)).stato).toBe('IN_DEFINITIVA')
    })

    it('non tocca le elaborazioni di un altro tenant, nemmeno chiamata col suo id nel contesto sbagliato', async () => {
      const a = await azienda()
      const b = await azienda()
      const ea = await elaborazione(a, 'SCARTATA', fa(9))
      const eb = await elaborazione(b, 'SCARTATA', fa(9))
      const ep = await elaborazione(b, 'ANTEPRIMA_PRONTA', fa(45))
      const ba = await bozza(a, ea)
      const bb = await bozza(b, eb)
      const bp = await bozza(b, ep)

      // Contesto di A ma id di B: la RLS non mostra nulla.
      const incrociata = await nel(a.tenantId, () =>
        app.$transaction(tx => pulisciBozzeTenant(tx, b.tenantId, ORA))
      )
      expect(incrociata).toBe(0)
      expect(await esistono([bb, bp])).toEqual([bb, bp].sort())

      // Giro di A: solo A.
      expect(await pulisci(a.tenantId)).toBe(1)
      expect(await esistono([ba])).toEqual([])
      expect(await esistono([bb, bp])).toEqual([bb, bp].sort())
      expect((await statoDi(ep)).stato).toBe('ANTEPRIMA_PRONTA')
    })

    it("e' idempotente: un secondo giro non trova altro", async () => {
      const az = await azienda()
      const e = await elaborazione(az, 'ANTEPRIMA_PRONTA', fa(31))
      await bozza(az, e)
      expect(await pulisci(az.tenantId)).toBe(1)
      expect(await pulisci(az.tenantId)).toBe(0)
    })
  })

  describe('recuperaOrfaniTenant', () => {
    it("la soglia di IN_CODA e' quella esportata dal service (15), quella degli altri 5", () => {
      expect(ORFANA_DOPO_MINUTI).toBe(15)
      expect(ORFANA_ATTIVA_DOPO_MINUTI).toBe(5)
    })

    it('IN_DEFINITIVA da 6 minuti senza job vivo: ANTEPRIMA_PRONTA con esito ELABORAZIONE_INTERROTTA', async () => {
      const az = await azienda()
      const e = await elaborazione(az, 'IN_DEFINITIVA', fa(0, 6), 'definitiva-x-v2')
      const prima = (await statoDi(e)).versione
      expect(await recupera(az.tenantId)).toBe(1)
      const s = await statoDi(e)
      expect(s.stato).toBe('ANTEPRIMA_PRONTA')
      expect(s.esito).toEqual({ codice: 'ELABORAZIONE_INTERROTTA' })
      expect(s.versione).toBe(prima + 1)
    })

    it('IN_DEFINITIVA da 4 minuti senza job: invariata', async () => {
      const az = await azienda()
      const e = await elaborazione(az, 'IN_DEFINITIVA', fa(0, 4), 'definitiva-x-v2')
      expect(await recupera(az.tenantId)).toBe(0)
      expect((await statoDi(e)).stato).toBe('IN_DEFINITIVA')
    })

    it('IN_DEFINITIVA con il suo job_id fra i vivi (ritardati): invariata', async () => {
      const az = await azienda()
      const e = await elaborazione(az, 'IN_DEFINITIVA', fa(0, 30), 'definitiva-y-v3')
      expect(await recupera(az.tenantId, ['definitiva-y-v3'])).toBe(0)
      expect((await statoDi(e)).stato).toBe('IN_DEFINITIVA')
    })

    it('IN_DEFINITIVA senza job_id e vecchia: orfana', async () => {
      const az = await azienda()
      const e = await elaborazione(az, 'IN_DEFINITIVA', fa(0, 6), null)
      expect(await recupera(az.tenantId, ['altro'])).toBe(1)
      expect((await statoDi(e)).stato).toBe('ANTEPRIMA_PRONTA')
    })

    it('IN_CORSO da 6 minuti senza job vivo: FALLITA con errore_tecnico', async () => {
      const az = await azienda()
      const e = await elaborazione(az, 'IN_CORSO', fa(0, 6), 'anteprima-z-v1')
      expect(await recupera(az.tenantId)).toBe(1)
      const s = await statoDi(e)
      expect(s.stato).toBe('FALLITA')
      expect(s.errore_tecnico).toBe('Elaborazione interrotta')
    })

    it('IN_CODA: orfana solo oltre i 15 minuti del Task 18 (16 si, 6 no) e solo senza job vivo', async () => {
      const az = await azienda()
      const e16 = await elaborazione(az, 'IN_CODA', fa(0, 16), 'anteprima-a-v1')
      expect(await recupera(az.tenantId, ['anteprima-a-v1'])).toBe(0)
      expect((await statoDi(e16)).stato).toBe('IN_CODA')
      expect(await recupera(az.tenantId)).toBe(1)
      const s = await statoDi(e16)
      expect(s.stato).toBe('FALLITA')
      expect(s.errore_tecnico).toBe('Elaborazione interrotta')

      const e6 = await elaborazione(az, 'IN_CODA', fa(0, 6), 'anteprima-b-v1')
      expect(await recupera(az.tenantId)).toBe(0)
      expect((await statoDi(e6)).stato).toBe('IN_CODA')
    })

    it('non tocca le elaborazioni di un altro tenant', async () => {
      const a = await azienda()
      const b = await azienda()
      const ea = await elaborazione(a, 'IN_CORSO', fa(0, 30), 'x')
      const eb = await elaborazione(b, 'IN_CORSO', fa(0, 30), 'y')
      expect(await recupera(a.tenantId)).toBe(1)
      expect((await statoDi(ea)).stato).toBe('FALLITA')
      expect((await statoDi(eb)).stato).toBe('IN_CORSO')
      // Contesto di A con l'id di B: nulla.
      const incrociata = await nel(a.tenantId, () =>
        app.$transaction(tx => recuperaOrfaniTenant(tx, b.tenantId, new Set(), ORA))
      )
      expect(incrociata).toBe(0)
      expect((await statoDi(eb)).stato).toBe('IN_CORSO')
    })
  })

  describe('FatturazioneManutenzioneJob — isolamento fra tenant', () => {
    function creaJob(tenantIds: string[], erroreSuPrimo: boolean) {
      const sistemaFinto = {
        tenant: { findMany: jest.fn().mockResolvedValue(tenantIds.map(id => ({ id }))) },
      }
      let chiamate = 0
      const prismaConGuasto = {
        $transaction: (...argomenti: Parameters<PrismaService['$transaction']>) => {
          chiamate += 1
          if (erroreSuPrimo && chiamate === 1) return Promise.reject(new Error('guasto iniettato'))
          return app.$transaction(...argomenti)
        },
      }
      const coda = {
        getJobs: jest.fn().mockResolvedValue([]),
      }
      const job = new FatturazioneManutenzioneJob(
        prismaConGuasto as never,
        sistemaFinto as never,
        coda as never
      )
      job.orologio = () => ORA
      return job
    }

    it('pulizia: errore sul primo tenant, il secondo viene pulito', async () => {
      const a = await azienda()
      const b = await azienda()
      const ea = await elaborazione(a, 'SCARTATA', fa(9))
      const eb = await elaborazione(b, 'SCARTATA', fa(9))
      const ba = await bozza(a, ea)
      const bb = await bozza(b, eb)
      const esito = await creaJob([a.tenantId, b.tenantId], true).pulisciBozze()
      expect(esito).toEqual({ tenantTotali: 2, tenantConErrore: 1, bozzeCancellate: 1 })
      expect(await esistono([ba])).toEqual([ba])
      expect(await esistono([bb])).toEqual([])
    })

    it('orfani: errore sul primo tenant, il secondo viene recuperato', async () => {
      const a = await azienda()
      const b = await azienda()
      const ea = await elaborazione(a, 'IN_CORSO', fa(0, 30), 'q')
      const eb = await elaborazione(b, 'IN_CORSO', fa(0, 30), 'r')
      const esito = await creaJob([a.tenantId, b.tenantId], true).recuperaOrfani()
      expect(esito).toEqual({ tenantTotali: 2, tenantConErrore: 1, recuperate: 1 })
      expect((await statoDi(ea)).stato).toBe('IN_CORSO')
      expect((await statoDi(eb)).stato).toBe('FALLITA')
    })
  })

  describe('sonda della numerazione', () => {
    async function numerazione(az: AziendaT18, ultimo: number, partenza = 0) {
      await owner.$executeRawUnsafe(
        `INSERT INTO numerazioni_fattura (tenant_id, registro_iva_id, anno, ultimo_numero, numero_partenza, updated_at)
         VALUES ($1::uuid, $2::uuid, 2026, $3::int, $4::int, now())`,
        az.tenantId,
        az.tab.registroId,
        ultimo,
        partenza
      )
    }
    const definitivo = (az: AziendaT18, numero: number) =>
      creaDocumentoDiTest(owner, az.tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: az.tab.registroId,
        anno: 2026,
        numero,
      })

    it('un buco iniettato (numero 3 mancante) = 1 violazione per quel tenant, solo conteggi', async () => {
      const az = await azienda()
      const pulita = await azienda()
      await numerazione(az, 4)
      await definitivo(az, 1)
      await definitivo(az, 2)
      await definitivo(az, 4)
      await numerazione(pulita, 2)
      await definitivo(pulita, 1)
      await definitivo(pulita, 2)

      const servizio = new EvidenzeDbService(sistema as unknown as PrismaSistemaService)
      const tutte = await servizio.violazioniNumerazione()
      const sue = tutte.filter(r => r.tenantId === az.tenantId)
      expect(sue).toEqual([{ tenantId: az.tenantId, violazioni: 1 }])
      expect(tutte.some(r => r.tenantId === pulita.tenantId)).toBe(false)
      for (const riga of tutte) {
        expect(Object.keys(riga).sort()).toEqual(['tenantId', 'violazioni'])
      }
    })

    it("il ruolo applicativo non puo' chiamare la funzione", async () => {
      await expect(
        app.$queryRawUnsafe(`SELECT * FROM fatturazione_violazioni_numerazione()`)
      ).rejects.toThrow(/permission denied|permesso negato|42501/i)
    })
  })
})
