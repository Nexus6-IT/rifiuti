/**
 * Pezzo I2, T4: `caricaAmbito` contro Postgres reale COME `wasteflow_app`, con due fasi finte
 * (due insiemi di ditte) sullo stesso lotto.
 */
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55447/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica, partitaIvaValida } from '../../../test-support/anagrafiche-di-test'
import {
  inserisciDitteImportate,
  type RigaDittaImportata,
} from '../../../test-support/migrazione/inserisci-ditte-importate'
import { chiaveDitta } from '../../../domain/migrazione/chiavi-legacy'
import { caricaAmbito, FaseCaricamentoFallitaError } from './carica-ambito'
import { LottiImportService } from './lotti-import.service'

describe('Pezzo I2 T4: caricaAmbito — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let lotti: LottiImportService
  const logger: any = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  const tenantCreati: string[] = []
  const seme = 8_000_000 + (Date.now() % 900_000)
  const dip = () => ({ prisma: app, lotti, logger })

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Carica ambito SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }
  const righe = (quante: number, da: number): RigaDittaImportata[] =>
    Array.from({ length: quante }, (_, i) => {
      const piva = partitaIvaValida(seme * 1000 + da + i)
      return {
        legacyKey: chiaveDitta('0001', piva),
        ragioneSociale: `PROVA ${da + i}`,
        partitaIva: piva,
      }
    })
  const lottoDa = () => ({
    importSource: 'WINWASTE',
    archivio: 'WW00012026',
    ambito: 'ANAGRAFICHE' as const,
    formatoStaging: 'wasteflow-pacchetto/1',
    hashStaging: 'c'.repeat(64),
  })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    lotti = new LottiImportService(app, logger)
  })
  afterAll(async () => {
    await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('due fasi in ordine sullo stesso lotto: COMPLETATO alla fine, conteggi cumulati', async () => {
    const t = await azienda()
    const ordine: string[] = []
    const esito = await caricaAmbito(dip(), t, lottoDa(), [
      {
        nome: 'uno',
        righe: async () => (ordine.push('uno'), righe(4, 0)),
        opzioni: { inserisciBlocco: inserisciDitteImportate, dimensioneBlocco: 3 },
      },
      {
        nome: 'due',
        righe: async () => (ordine.push('due'), righe(2, 100)),
        opzioni: { inserisciBlocco: inserisciDitteImportate },
      },
    ])
    expect(ordine).toEqual(['uno', 'due'])
    expect(esito.fasi.map(f => f.nome)).toEqual(['uno', 'due'])
    expect(esito.conteggi).toEqual({ lette: 6, inserite: 6, saltate: 0, scartate: 0, blocchi: 3 })
    const l = await lotti.leggi(t, esito.lottoId)
    expect(l!.stato).toBe('COMPLETATO')
    expect(await owner.ditta.count({ where: { tenantId: t, lottoImportId: esito.lottoId } })).toBe(
      6
    )
  })

  it('prima fase fallita: lotto FALLITO, la seconda fase non viene nemmeno letta', async () => {
    const t = await azienda()
    const pivaOccupata = partitaIvaValida(seme * 1000 + 500)
    await owner.ditta.create({
      data: { tenantId: t, ragioneSociale: 'ESISTENTE', partitaIva: pivaOccupata },
    })
    const seconda = jest.fn(async () => righe(1, 600))
    const prova = caricaAmbito(dip(), t, lottoDa(), [
      {
        nome: 'uno',
        righe: async () => [
          {
            legacyKey: chiaveDitta('0001', pivaOccupata),
            ragioneSociale: 'X',
            partitaIva: pivaOccupata,
          },
        ],
        opzioni: { inserisciBlocco: inserisciDitteImportate },
      },
      { nome: 'due', righe: seconda, opzioni: { inserisciBlocco: inserisciDitteImportate } },
    ])
    await expect(prova).rejects.toMatchObject({ fase: 'uno' })
    expect(seconda).not.toHaveBeenCalled()
    const dopo = await owner.lottoImport.findFirst({ where: { tenantId: t } })
    expect(dopo!.stato).toBe('FALLITO')
    expect(dopo!.errore).toContain('Blocco 1')
    expect(dopo!.errore).not.toContain(pivaOccupata)
  })

  it('un errore che non e di blocco (lettura della fase) porta comunque il lotto a FALLITO', async () => {
    const t = await azienda()
    await expect(
      caricaAmbito(dip(), t, lottoDa(), [
        {
          nome: 'uno',
          righe: async () => {
            throw new Error('dato personale Mario Rossi')
          },
          opzioni: { inserisciBlocco: inserisciDitteImportate },
        },
      ])
    ).rejects.toBeInstanceOf(FaseCaricamentoFallitaError)
    const l = await owner.lottoImport.findFirst({ where: { tenantId: t } })
    expect(l!.stato).toBe('FALLITO')
    expect(l!.errore).not.toContain('Mario')
  })
})
