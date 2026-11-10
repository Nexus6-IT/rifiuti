/**
 * Stampa dei ritiri (4.7, T16) contro un Postgres reale, collegato COME `wasteflow_app` (RLS
 * attiva): distinta del giorno e PDF dei FIR, isolamento fra aziende, scelta del modello. Il
 * proprietario prepara aziende, anagrafiche e ritiri. La pulizia cancella SOLO le aziende create
 * qui, per id esatto.
 *
 * Eseguire con `npm run test:postgres` (o jest con `jest.postgres.config.js`).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APP = 'ritiri-stampa-t16'
// I servizi dell'applicazione leggono queste variabili, come in produzione. L'application_name
// permette alla barriera di riconoscere le sessioni del servizio in pg_stat_activity.
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APP}`
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { ProduttorePrismaRepository } from '../../infrastructure/persistence/produttore-prisma.repository'
import { TrasportatorePrismaRepository } from '../../infrastructure/persistence/trasportatore-prisma.repository'
import { DestinatarioPrismaRepository } from '../../infrastructure/persistence/destinatario-prisma.repository'
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { CreateFIRUseCase } from '../fir/use-cases/create-fir.use-case'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { ModelliStampaService } from '../modelli-stampa/modelli-stampa.service'
import {
  AutomezzoNonTrovatoError,
  ModelloAmbitoNonValidoError,
  NessunFirDaStampareError,
} from './errori-ritiri'
import { StampaRitiriService } from './stampa-ritiri.service'
import { GeneraFirDaRitiriService } from './genera-fir-da-ritiri.service'

const CER_NON_VALIDO = '99 99 99'

describe('Stampa dei ritiri — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let genera: GeneraFirDaRitiriService
  let stampa: StampaRitiriService
  let pdf: PDFService
  let modelli: ModelliStampaService
  const tenantCreati: string[] = []
  const cerFinto = {
    exists: async (c: string) => c !== CER_NON_VALIDO,
    isUtilizzabilePerNuovoFormulario: async () => true,
  } as unknown as ICERRepository

  interface Azienda {
    t: string
    utente: string
    produttore: { ruoloId: string; sedeId: string }
    trasportatore: { ruoloId: string; sedeId: string }
    destinatario: { ruoloId: string; sedeId: string }
  }

  async function azienda(): Promise<Azienda> {
    const t = (
      await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Genera SRL', country: 'IT' },
      })
    ).id
    tenantCreati.push(t)
    const sigla = partitaIvaUnica()
    const utente = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-gen-${sigla}`,
          fiscalCode: `GEN${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Genera',
          email: `gen-${sigla}@example.test`,
          role: 'ADMIN',
        },
      })
    ).id
    return {
      t,
      utente,
      produttore: await creaDittaConRuolo(owner, t, 'PRODUTTORE'),
      trasportatore: await creaDittaConRuolo(owner, t, 'TRASPORTATORE'),
      destinatario: await creaDittaConRuolo(owner, t, 'DESTINATARIO'),
    }
  }

  interface Extra {
    cerCode?: string
    automezzoId?: string
    fascia?: 'MATTINA' | 'POMERIGGIO'
    stato?: 'PROGRAMMATO' | 'ANNULLATO'
    provenienza?: 'URBANO' | 'SPECIALE' | null
    tipoTratta?: 'TERRESTRE' | null
    dataPrevista?: string
    ordineGiro?: number | null
  }

  async function creaRitiri(a: Azienda, n: number, extra: Extra | ((i: number) => Extra) = {}) {
    const dati = Array.from({ length: n }, (_, i) => {
      const e = typeof extra === 'function' ? extra(i) : extra
      return {
        id: crypto.randomUUID(),
        tenantId: a.t,
        dataPrevista: new Date(e.dataPrevista ?? '2026-12-01'),
        ordineGiro: e.ordineGiro === undefined ? i + 1 : e.ordineGiro,
        produttoreId: a.produttore.ruoloId,
        produttoreSedeId: a.produttore.sedeId,
        trasportatoreId: a.trasportatore.ruoloId,
        destinatarioId: a.destinatario.ruoloId,
        destinatarioSedeId: a.destinatario.sedeId,
        cerCode: e.cerCode ?? '15 01 01',
        automezzoId: e.automezzoId ?? null,
        fascia: e.fascia ?? null,
        descrizione: 'Imballaggi',
        quantitaPresunta: '100.00',
        tipoOperazione: 'RECOVERY' as const,
        codiceOperazione: 'R13',
        provenienza: e.provenienza === undefined ? ('SPECIALE' as const) : e.provenienza,
        tipoTratta: e.tipoTratta === undefined ? ('TERRESTRE' as const) : e.tipoTratta,
        creatoDa: a.utente,
        ...(e.stato === 'ANNULLATO' ? { stato: 'ANNULLATO' as const, motivo: 'annullato' } : {}),
      }
    })
    await owner.ritiro.createMany({ data: dati })
    return dati.map(d => d.id)
  }

  const lancia = (a: Azienda, ids: string[]) => genera.genera(a.t, a.utente, ids)
  const pagine = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    const repoFir = new FIRPrismaRepository(app, sistema)
    const creaFir = new CreateFIRUseCase(
      repoFir,
      cerFinto,
      new ProduttorePrismaRepository(app),
      new TrasportatorePrismaRepository(app),
      new DestinatarioPrismaRepository(app)
    )
    const repo = new RitiriRepository()
    genera = new GeneraFirDaRitiriService(app, repo, creaFir)
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    pdf = new PDFService(logger)
    modelli = new ModelliStampaService(app)
    stampa = new StampaRitiriService(app, repo, pdf, modelli)
  })

  afterEach(() => jest.restoreAllMocks())

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
      await owner.activityLog.deleteMany({ where })
      await owner.fIR.deleteMany({ where })
      await owner.ritiro.deleteMany({ where })
      await owner.companyTemplate.deleteMany({ where })
      await owner.automezzo.deleteMany({ where })
      await owner.produttore.deleteMany({ where })
      await owner.trasportatore.deleteMany({ where })
      await owner.destinatario.deleteMany({ where })
      await owner.sedeDitta.deleteMany({ where })
      await owner.ditta.deleteMany({ where })
      await owner.user.deleteMany({ where })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await Promise.all([owner.$disconnect(), app?.onModuleDestroy(), sistema?.onModuleDestroy()])
  })

  describe('distinta', () => {
    it('solo i ritiri PROGRAMMATI del giorno dell azienda, in ordine di giro, con il FIR se c e`', async () => {
      const a = await azienda()
      const b = await azienda()
      const [r1] = await creaRitiri(a, 2, i => ({
        dataPrevista: '2026-12-10',
        ordineGiro: 2 - i,
        fascia: 'MATTINA',
      }))
      await creaRitiri(a, 1, { dataPrevista: '2026-12-10', stato: 'ANNULLATO' })
      await creaRitiri(a, 1, { dataPrevista: '2026-12-11' })
      await creaRitiri(b, 1, { dataPrevista: '2026-12-10' })
      await lancia(a, [r1])
      const spia = jest.spyOn(pdf, 'generateDistintaPDF')

      const { buffer, nomeFile } = await stampa.distinta(a.t, '2026-12-10')

      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
      expect(nomeFile).toBe('distinta-ritiri-2026-12-10.pdf')
      const dati = spia.mock.calls[0][0]
      // ordine_giro: il secondo creato ha 1, r1 ha 2 e ha il FIR (bozza senza numero).
      expect(dati.righe).toHaveLength(2)
      expect(dati.righe[0]).toMatchObject({ ordineGiro: 1, fascia: 'MATTINA', numeroFir: null })
      expect(dati.righe[1]).toMatchObject({ ordineGiro: 2 })
      expect(dati.automezzo).toBeNull()
      // r2 non ha FIR, r1 si`: la bozza non ha ancora numero, ma il FIR esiste.
      const fir = await owner.fIR.count({ where: { ritiroId: r1 } })
      expect(fir).toBe(1)
    })

    it('con un mezzo filtra per mezzo; un mezzo di un altra azienda e` 404', async () => {
      const a = await azienda()
      const b = await azienda()
      const m = await owner.automezzo.create({
        data: { tenantId: a.t, targa: 'AA111AA', creatoDa: a.utente },
      })
      const mAltrui = await owner.automezzo.create({
        data: { tenantId: b.t, targa: 'BB222BB', creatoDa: b.utente },
      })
      await creaRitiri(a, 1, { dataPrevista: '2026-12-12', automezzoId: m.id })
      await creaRitiri(a, 1, { dataPrevista: '2026-12-12' })
      const spia = jest.spyOn(pdf, 'generateDistintaPDF')

      const { nomeFile } = await stampa.distinta(a.t, '2026-12-12', m.id)
      expect(nomeFile).toBe('distinta-ritiri-2026-12-12-AA111AA.pdf')
      expect(spia.mock.calls[0][0].righe).toHaveLength(1)
      expect(spia.mock.calls[0][0].automezzo).toEqual({ targa: 'AA111AA', descrizione: null })

      await expect(stampa.distinta(a.t, '2026-12-12', mAltrui.id)).rejects.toBeInstanceOf(
        AutomezzoNonTrovatoError
      )
    })

    it('un giorno senza ritiri produce comunque una distinta (vuota)', async () => {
      const a = await azienda()
      const { buffer } = await stampa.distinta(a.t, '2026-12-30')
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    })

    it('modello: predefinito DISTINTA_RITIRI, altrimenti GENERALE; di un altra azienda 404; ambito FIR 400', async () => {
      const a = await azienda()
      const b = await azienda()
      const spia = jest.spyOn(pdf, 'generateDistintaPDF')
      await owner.companyTemplate.create({
        data: {
          tenantId: a.t,
          name: 'Generale',
          ambito: 'GENERALE',
          isDefault: true,
          headerText: 'GEN',
        },
      })
      await stampa.distinta(a.t, '2026-12-13')
      expect(spia.mock.calls[0][1]).toMatchObject({ ambito: 'GENERALE', headerText: 'GEN' })
      await owner.companyTemplate.create({
        data: {
          tenantId: a.t,
          name: 'Distinta',
          ambito: 'DISTINTA_RITIRI',
          isDefault: true,
          headerText: 'DIS',
        },
      })
      await stampa.distinta(a.t, '2026-12-13')
      expect(spia.mock.calls[1][1]).toMatchObject({ ambito: 'DISTINTA_RITIRI', headerText: 'DIS' })

      const altrui = await owner.companyTemplate.create({
        data: { tenantId: b.t, name: 'B', ambito: 'DISTINTA_RITIRI' },
      })
      await expect(stampa.distinta(a.t, '2026-12-13', undefined, altrui.id)).rejects.toMatchObject({
        status: 404,
      })
      const fir = await owner.companyTemplate.create({
        data: { tenantId: a.t, name: 'Fir', ambito: 'FIR' },
      })
      await expect(stampa.distinta(a.t, '2026-12-13', undefined, fir.id)).rejects.toBeInstanceOf(
        ModelloAmbitoNonValidoError
      )
    })

    it('data non valida: errore di validazione, nessuna lettura', async () => {
      const a = await azienda()
      await expect(stampa.distinta(a.t, '13/12/2026')).rejects.toThrow('data non è valida')
    })
  })

  describe('stampa dei FIR', () => {
    it('un solo PDF dei FIR attivi, nell ordine dei ritiri e non in quello richiesto; i senza FIR sono contati', async () => {
      const a = await azienda()
      const [primo, secondo, senzaFir] = await creaRitiri(a, 3, i => ({
        dataPrevista: '2026-12-14',
        ordineGiro: i + 1,
      }))
      await lancia(a, [primo, secondo])
      const spia = jest.spyOn(pdf, 'generateFIRSeriePDF')

      const r = await stampa.stampaFir(a.t, [senzaFir, secondo, primo])

      expect(r.buffer.subarray(0, 5).toString()).toBe('%PDF-')
      expect(r.saltati).toBe(1)
      const firAttesi = await owner.fIR.findMany({
        where: { ritiroId: { in: [primo, secondo] } },
        select: { id: true, ritiroId: true },
      })
      const idDi = (rid: string) => firAttesi.find(f => f.ritiroId === rid)!.id
      expect(spia.mock.calls[0][0].map(e => e.fir.id)).toEqual([idDi(primo), idDi(secondo)])
    })

    it('il modello FIR predefinito si applica (copie 2 = piu pagine)', async () => {
      const a = await azienda()
      const [r1] = await creaRitiri(a, 1, { dataPrevista: '2026-12-14' })
      await lancia(a, [r1])
      const una = await stampa.stampaFir(a.t, [r1])
      await owner.companyTemplate.create({
        data: { tenantId: a.t, name: 'FIR x2', ambito: 'FIR', copie: 2, isDefault: true },
      })
      const due = await stampa.stampaFir(a.t, [r1])
      expect(pagine(due.buffer)).toBe(pagine(una.buffer) * 2)
    })

    it('ritiri di un altra azienda: non si stampano e non si distinguono dai senza FIR', async () => {
      const a = await azienda()
      const b = await azienda()
      const [mio] = await creaRitiri(a, 1, { dataPrevista: '2026-12-15' })
      const [altrui] = await creaRitiri(b, 1, { dataPrevista: '2026-12-15' })
      await lancia(a, [mio])
      await lancia(b, [altrui])
      const spia = jest.spyOn(pdf, 'generateFIRSeriePDF')

      const r = await stampa.stampaFir(a.t, [altrui, mio])
      expect(r.saltati).toBe(1)
      const stampati = spia.mock.calls[0][0].map(e => e.fir.tenantId)
      expect(stampati).toEqual([a.t])

      await expect(stampa.stampaFir(a.t, [altrui])).rejects.toBeInstanceOf(NessunFirDaStampareError)
    })

    it('nessun FIR attivo (bozze da generare o FIR annullato): NessunFirDaStampare', async () => {
      const a = await azienda()
      const [r1, r2] = await creaRitiri(a, 2, { dataPrevista: '2026-12-16' })
      await lancia(a, [r2])
      await owner.fIR.updateMany({ where: { ritiroId: r2 }, data: { status: 'CANCELLED' } })
      await expect(stampa.stampaFir(a.t, [r1, r2])).rejects.toBeInstanceOf(NessunFirDaStampareError)
    })

    it('modello della distinta usato per il FIR: errore di ambito', async () => {
      const a = await azienda()
      const [r1] = await creaRitiri(a, 1, { dataPrevista: '2026-12-17' })
      await lancia(a, [r1])
      const m = await owner.companyTemplate.create({
        data: { tenantId: a.t, name: 'Dis', ambito: 'DISTINTA_RITIRI' },
      })
      await expect(stampa.stampaFir(a.t, [r1], m.id)).rejects.toBeInstanceOf(
        ModelloAmbitoNonValidoError
      )
    })
  })
})
