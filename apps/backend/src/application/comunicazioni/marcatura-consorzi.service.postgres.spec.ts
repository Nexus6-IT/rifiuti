/**
 * Marcatura per consorzio e estratto CSV (4.9b, T10-T11) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda. Il proprietario
 * prepara i dati; la pulizia toglie solo le righe create qui, per `tenantId`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'
import { EstrattoConsorziService } from './estratto-consorzi.service'
import {
  MarcaturaNonValidaError,
  MovimentoNonTrovatoError,
  RegolaConsorzioNonTrovataError,
} from './marcatura-consorzi.port'

describe('Marcatura per consorzio — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: MarcaturaConsorziService
  let estratto: EstrattoConsorziService
  const tenantCreati: string[] = []

  const nel = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  async function nuovaAzienda(sigla: string) {
    const az = await creaAziendaMud(owner, sigla, { province: 'MI' })
    tenantCreati.push(az.tenantId)
    return az
  }

  const carico = (az: AziendaMud, cerCode: string, giorno: string, extra = {}) =>
    creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode,
      quantita: 100,
      unita: 'KG',
      giorno,
      ...extra,
    })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    servizio = new MarcaturaConsorziService(app)
    estratto = new EstrattoConsorziService(app, servizio)
  })

  afterAll(async () => {
    // Le correzioni puntano ai movimenti (NO ACTION): prima loro, poi il resto.
    const where = { tenantId: { in: tenantCreati } }
    await owner.datiConsorzioMovimento.deleteMany({ where })
    await owner.regolaConsorzio.deleteMany({ where })
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  describe('regole', () => {
    it('crea, elenca (con quelle di sistema), modifica ed elimina; il CER si normalizza', async () => {
      const az = await nuovaAzienda('R1')
      const vuote = await nel(az, () => servizio.elencaRegole(az.tenantId))
      expect(vuote.every(r => r.sistema && r.inVigore)).toBe(true)
      expect(vuote.map(r => [r.consorzio, r.cer, r.cerEsatto])).toEqual([
        ['CONOU', '13', false],
        ['COBAT', '160601', true],
        ['COBAT', '200133', true],
      ])

      const creata = await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, {
          consorzio: 'CONOU',
          cer: '13 02',
          verso: 'CARICO',
        })
      )
      expect(creata).toMatchObject({
        consorzio: 'CONOU',
        cer: '1302',
        cerEsatto: false,
        verso: 'CARICO',
        attiva: true,
        sistema: false,
      })
      const dopo = await nel(az, () => servizio.elencaRegole(az.tenantId))
      // L'azienda ha una regola propria per CONOU: quella di sistema non vale piu'.
      expect(dopo.find(r => r.sistema && r.consorzio === 'CONOU')?.inVigore).toBe(false)
      expect(dopo.find(r => r.sistema && r.consorzio === 'COBAT')?.inVigore).toBe(true)

      const modificata = await nel(az, () =>
        servizio.modificaRegola(az.tenantId, creata.id as string, {
          consorzio: 'CONOU',
          cer: '130205',
          attiva: false,
        })
      )
      expect(modificata).toMatchObject({
        cer: '130205',
        cerEsatto: true,
        attiva: false,
        verso: null,
      })

      await nel(az, () => servizio.eliminaRegola(az.tenantId, creata.id as string))
      const finale = await nel(az, () => servizio.elencaRegole(az.tenantId))
      expect(finale.every(r => r.sistema)).toBe(true)
    })

    it('rifiuta consorzio, CER, verso, data e registro non validi', async () => {
      const az = await nuovaAzienda('R2')
      const altra = await nuovaAzienda('R2b')
      const prova = (input: Parameters<MarcaturaConsorziService['creaRegola']>[2]) =>
        nel(az, () => servizio.creaRegola(az.tenantId, az.utenteId, input))
      await expect(prova({ consorzio: 'ORSO', cer: '13' })).rejects.toBeInstanceOf(
        MarcaturaNonValidaError
      )
      await expect(prova({ consorzio: 'CONOU', cer: '131' })).rejects.toBeInstanceOf(
        MarcaturaNonValidaError
      )
      await expect(prova({ consorzio: 'CONOU', cer: '13', verso: 'X' })).rejects.toBeInstanceOf(
        MarcaturaNonValidaError
      )
      await expect(
        prova({ consorzio: 'CONOU', cer: '13', validaDal: '01/01/2026' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      // Registro di un'altra azienda.
      await expect(
        prova({ consorzio: 'CONOU', cer: '13', registroId: altra.registroId })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
    })

    it('RLS: un’azienda non vede, non modifica e non elimina le regole di un’altra', async () => {
      const a = await nuovaAzienda('R3a')
      const b = await nuovaAzienda('R3b')
      const regola = await nel(a, () =>
        servizio.creaRegola(a.tenantId, a.utenteId, { consorzio: 'COBAT', cer: '160601' })
      )
      const diB = await nel(b, () => servizio.elencaRegole(b.tenantId))
      expect(diB.some(r => r.id === regola.id)).toBe(false)
      await expect(
        nel(b, () =>
          servizio.modificaRegola(b.tenantId, regola.id as string, {
            consorzio: 'COBAT',
            cer: '16',
          })
        )
      ).rejects.toBeInstanceOf(RegolaConsorzioNonTrovataError)
      await expect(
        nel(b, () => servizio.eliminaRegola(b.tenantId, regola.id as string))
      ).rejects.toBeInstanceOf(RegolaConsorzioNonTrovataError)
      expect(
        (await nel(a, () => servizio.elencaRegole(a.tenantId))).some(r => r.id === regola.id)
      ).toBe(true)
    })
  })

  describe('classificazione e correzione sul singolo movimento', () => {
    it('le regole di sistema marcano CONOU (13 xx xx) e COBAT (16 06 01*, 20 01 33*), non altro', async () => {
      const az = await nuovaAzienda('C1')
      const olio = await carico(az, '13 02 05*', '2026-05-10')
      const batt = await carico(az, '16 06 01*', '2026-05-11')
      const portatili = await carico(az, '20 01 33*', '2026-05-12')
      const altro = await carico(az, '20 03 01', '2026-05-13')
      const r = await nel(az, () =>
        servizio.consorziDeiMovimenti(az.tenantId, [olio.id, batt.id, portatili.id, altro.id])
      )
      expect(r[olio.id].marcature).toEqual([{ consorzio: 'CONOU', origine: 'REGOLA' }])
      expect(r[batt.id].marcature.map(m => m.consorzio)).toEqual(['COBAT'])
      expect(r[portatili.id].marcature.map(m => m.consorzio)).toEqual(['COBAT'])
      expect(r[altro.id]).toEqual({ marcature: [], esclusi: [] })
    })

    it('marcatura ed esclusione manuali; una sola riga per movimento e consorzio; togliere la correzione torna alle regole', async () => {
      const az = await nuovaAzienda('C2')
      const olio = await carico(az, '13 02 05*', '2026-05-10')
      const urbano = await carico(az, '20 03 01', '2026-05-11')

      const escluso = await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, olio.id, 'CONOU', true)
      )
      expect(escluso).toEqual({ marcature: [], esclusi: ['CONOU'] })
      const manuale = await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, urbano.id, 'COREPLA', false)
      )
      expect(manuale.marcature).toEqual([{ consorzio: 'COREPLA', origine: 'MANUALE' }])

      // Impostare di nuovo lo stesso consorzio aggiorna la riga, non ne crea una seconda.
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, olio.id, 'CONOU', false)
      )
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, olio.id, 'CONOU', true)
      )
      const righe = await owner.datiConsorzioMovimento.findMany({
        where: { tenantId: az.tenantId, movimentoOriginaleId: olio.id },
      })
      expect(righe).toHaveLength(1)
      expect(righe[0].escluso).toBe(true)

      const tolto = await nel(az, () => servizio.rimuoviOverride(az.tenantId, olio.id, 'CONOU'))
      expect(tolto.marcature).toEqual([{ consorzio: 'CONOU', origine: 'REGOLA' }])
      // Idempotente.
      await nel(az, () => servizio.rimuoviOverride(az.tenantId, olio.id, 'CONOU'))
    })

    it('la correzione sta sulla radice: segue la rettifica (anche col CER corretto) e sopravvive all’annullamento', async () => {
      const az = await nuovaAzienda('C3')
      const radice = await carico(az, '20 03 01', '2026-05-10')
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, radice.id, 'COREPLA', false)
      )
      const rettifica = await creaMovimento(owner, az, {
        tipo: 'RETTIFICA',
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '20 03 01',
        quantita: 80,
        giorno: '2026-05-10',
        rettificatoId: radice.id,
        originaleId: radice.id,
      })
      // Impostata sulla rettifica, la correzione finisce comunque sulla radice (stessa riga).
      const daRettifica = await nel(az, () =>
        servizio.consorziDeiMovimenti(az.tenantId, [rettifica.id])
      )
      expect(daRettifica[rettifica.id].marcature).toEqual([
        { consorzio: 'COREPLA', origine: 'MANUALE' },
      ])
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, rettifica.id, 'COREPLA', true)
      )
      expect(await owner.datiConsorzioMovimento.count({ where: { tenantId: az.tenantId } })).toBe(1)
      const dopo = await nel(az, () =>
        servizio.consorziDeiMovimenti(az.tenantId, [radice.id, rettifica.id])
      )
      expect(dopo[radice.id].esclusi).toEqual([])
      expect(dopo[radice.id].marcature).toEqual([])

      // Annullamento: la catena esce dai conteggi, la correzione resta sulla radice e non da' errori.
      await creaMovimento(owner, az, {
        tipo: 'ANNULLAMENTO',
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '20 03 01',
        quantita: 80,
        giorno: '2026-05-10',
        rettificatoId: rettifica.id,
        originaleId: radice.id,
      })
      const csv = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'COREPLA', da: '2026-05-01', a: '2026-05-31' })
      )
      expect(csv.righe).toBe(0)
      expect(await owner.datiConsorzioMovimento.count({ where: { tenantId: az.tenantId } })).toBe(1)
    })

    it('RLS: movimento di un’altra azienda -> non trovato; le correzioni non si vedono fra aziende', async () => {
      const a = await nuovaAzienda('C4a')
      const b = await nuovaAzienda('C4b')
      const mov = await carico(a, '13 02 05*', '2026-05-10')
      await expect(
        nel(b, () => servizio.impostaOverride(b.tenantId, b.utenteId, mov.id, 'CONOU', true))
      ).rejects.toBeInstanceOf(MovimentoNonTrovatoError)
      await expect(
        nel(b, () => servizio.impostaOverride(b.tenantId, b.utenteId, mov.id, 'ORSO', true))
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await nel(a, () => servizio.impostaOverride(a.tenantId, a.utenteId, mov.id, 'CONOU', true))
      // Dal contesto di B la riga di A non esiste.
      const viste = await nel(b, () => app.datiConsorzioMovimento.findMany({ where: {} }))
      expect(viste).toEqual([])
      expect(
        (await nel(b, () => servizio.consorziDeiMovimenti(b.tenantId, [mov.id])))[mov.id]
      ).toBeUndefined()
    })
  })

  describe('estratto CSV', () => {
    it('contiene solo i movimenti vigenti marcati per il consorzio nel periodo, con controparte, CER, kg e FIR', async () => {
      const az = await nuovaAzienda('E1')
      const altra = await nuovaAzienda('E1b')
      await carico(az, '13 02 05*', '2026-05-10', {
        counterpartName: 'Officina Rossi',
        counterpartAddress: 'Via Roma 1',
      })
      await carico(az, '13 02 05*', '2026-07-01') // fuori periodo
      await carico(az, '20 03 01', '2026-05-11') // non marcato
      await carico(altra, '13 02 05*', '2026-05-10') // altra azienda
      const manuale = await carico(az, '20 03 01', '2026-05-12', { counterpartName: '=CMD()' })
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, manuale.id, 'CONOU', false)
      )

      const r = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-05-01', a: '2026-05-31' })
      )
      expect(r.righe).toBe(2)
      expect(r.nomeFile).toBe('estratto-conou-2026-05-01_2026-05-31.csv')
      const linee = r.csv.split('\r\n')
      expect(linee[1]).toContain('"CONOU";"10/05/2026"')
      expect(linee[1]).toContain('"13 02 05*"')
      expect(linee[1]).toContain('"Officina Rossi"')
      expect(linee[1]).toContain('"100"')
      expect(linee[1].endsWith('"Regola"')).toBe(true)
      expect(linee[2]).toContain('"\'=CMD()"')
      expect(linee[2].endsWith('"Manuale"')).toBe(true)
    })

    it('periodo o consorzio non validi -> errore, sede di un’altra azienda -> errore', async () => {
      const az = await nuovaAzienda('E2')
      const altra = await nuovaAzienda('E2b')
      const chiama = (p: Parameters<EstrattoConsorziService['estratto']>[1]) =>
        nel(az, () => estratto.estratto(az.tenantId, p))
      await expect(
        chiama({ consorzio: 'ORSO', da: '2026-01-01', a: '2026-01-31' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        chiama({ consorzio: 'CONOU', da: '2026-02-01', a: '2026-01-31' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        chiama({ consorzio: 'CONOU', da: '2026-02-30', a: '2026-03-01' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        chiama({ consorzio: 'CONOU', da: '2000-01-01', a: '2026-01-31' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        chiama({
          consorzio: 'CONOU',
          da: '2026-01-01',
          a: '2026-01-31',
          unitaLocaleId: altra.unitaLocaleId,
        })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
    })
  })
})
