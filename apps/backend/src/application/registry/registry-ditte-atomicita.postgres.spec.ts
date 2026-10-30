/**
 * Modifica di una controparte tutta o niente (F2-10, Task 3a, giro di correzione 1) contro un
 * Postgres reale, collegato COME `wasteflow_app`. Se la richiesta fallisce dopo la correzione della
 * partita IVA (comune non valido, sede non valida, indirizzo gia' di un'altra sede: 409), la ditta,
 * l'audit e la colonna vecchia del ruolo devono restare come prima.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { SedeNonModificabileError, SedeNonValidaPerRuoloError } from '../../core/domain/errors'
import { DittaPrismaRepository } from '../../infrastructure/persistence/ditta-prisma.repository'
import { ProduttorePrismaRepository } from '../../infrastructure/persistence/produttore-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  PIVA_CHECKSUM_ERRATO,
  creaDittaConRuolo,
  partitaIvaValida,
} from '../../test-support/anagrafiche-di-test'
import { DitteService, AZIONE_PARTITA_IVA_CORRETTA } from './ditte/ditte.service'
import { UpdateProduttoreUseCase } from './use-cases/update-produttore.use-case'

const SEDE_MILANO = {
  via: 'Via Milano',
  civico: '9',
  cap: '20100',
  citta: 'Milano',
  provincia: 'MI',
}

describe('Modifica delle controparti tutta o niente — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let produttori: ProduttorePrismaRepository
  let ditte: DitteService
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<string> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `AT${suffisso}`, ragioneSociale: 'Atomicita test SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  /** Produttore la cui P.IVA registrata non passa il controllo (D2.8: si puo' correggere). */
  async function produttoreDaCorreggere(tenantId: string) {
    return creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', { partitaIva: PIVA_CHECKSUM_ERRATO })
  }

  async function stato(tenantId: string, ids: { dittaId: string; ruoloId: string }) {
    const ditta = await owner.ditta.findUniqueOrThrow({ where: { id: ids.dittaId } })
    const ruolo = await owner.produttore.findUniqueOrThrow({ where: { id: ids.ruoloId } })
    const audit = await owner.activityLog.count({
      where: { tenantId, action: AZIONE_PARTITA_IVA_CORRETTA },
    })
    return { dittaPiva: ditta.partitaIva, colonnaVecchia: ruolo.partitaIVA, audit }
  }

  const useCase = (referenceData?: { validateLocalita: jest.Mock }) =>
    new UpdateProduttoreUseCase(produttori, ditte, referenceData as never)

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    ditte = new DitteService(app, new DittaPrismaRepository())
    produttori = new ProduttorePrismaRepository(app)
  })

  afterAll(async () => {
    for (const tenantId of tenantCreati) {
      await owner.produttore.deleteMany({ where: { tenantId } })
      await owner.activityLog.deleteMany({ where: { tenantId } })
      await owner.sedeDitta.deleteMany({ where: { tenantId } })
      await owner.ditta.deleteMany({ where: { tenantId } })
    }
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('controllo: la correzione riuscita aggiorna ditta, audit e colonna vecchia insieme', async () => {
    const t = await azienda()
    const ids = await produttoreDaCorreggere(t)
    const nuova = partitaIvaValida(Date.now() + 1)

    const r = await nelTenant(t, () => useCase().execute({ id: ids.ruoloId, partitaIVA: nuova }))

    expect(r.isSuccess).toBe(true)
    expect(await stato(t, ids)).toEqual({ dittaPiva: nuova, colonnaVecchia: nuova, audit: 1 })
  })

  it('P.IVA corretta + comune non valido (ISTAT): 400, ditta invariata, nessun audit, colonna vecchia invariata', async () => {
    const t = await azienda()
    const ids = await produttoreDaCorreggere(t)
    const referenceData = {
      validateLocalita: jest.fn().mockResolvedValue({ ok: false, error: 'Comune non valido' }),
    }

    const r = await nelTenant(t, () =>
      useCase(referenceData).execute({
        id: ids.ruoloId,
        partitaIVA: partitaIvaValida(Date.now() + 2),
        sedeLegale: SEDE_MILANO,
      })
    )

    expect(r.isFailure).toBe(true)
    expect(r.error).toBe('Comune non valido')
    expect(await stato(t, ids)).toEqual({
      dittaPiva: PIVA_CHECKSUM_ERRATO,
      colonnaVecchia: PIVA_CHECKSUM_ERRATO,
      audit: 0,
    })
  })

  it('P.IVA corretta + sedeId non valida: SedeNonValidaPerRuoloError, ditta invariata, nessun audit', async () => {
    const t = await azienda()
    const ids = await produttoreDaCorreggere(t)
    const altra = await creaDittaConRuolo(owner, t, 'PRODUTTORE')

    await expect(
      nelTenant(t, () =>
        useCase().execute({
          id: ids.ruoloId,
          partitaIVA: partitaIvaValida(Date.now() + 3),
          sedeId: altra.sedeId, // sede di un'altra ditta
        })
      )
    ).rejects.toBeInstanceOf(SedeNonValidaPerRuoloError)

    expect(await stato(t, ids)).toEqual({
      dittaPiva: PIVA_CHECKSUM_ERRATO,
      colonnaVecchia: PIVA_CHECKSUM_ERRATO,
      audit: 0,
    })
  })

  it('P.IVA corretta + indirizzo gia di un altra sede (409 nel save): ditta invariata, nessun audit', async () => {
    const t = await azienda()
    const ids = await produttoreDaCorreggere(t)
    await owner.sedeDitta.create({
      data: {
        tenantId: t,
        dittaId: ids.dittaId,
        via: SEDE_MILANO.via,
        civico: SEDE_MILANO.civico,
        cap: SEDE_MILANO.cap,
        comune: SEDE_MILANO.citta,
        provincia: SEDE_MILANO.provincia,
        principale: false,
      },
    })

    await expect(
      nelTenant(t, () =>
        useCase().execute({
          id: ids.ruoloId,
          ragioneSociale: 'Nuova ragione sociale',
          partitaIVA: partitaIvaValida(Date.now() + 4),
          sedeLegale: SEDE_MILANO,
        })
      )
    ).rejects.toBeInstanceOf(SedeNonModificabileError)

    expect(await stato(t, ids)).toEqual({
      dittaPiva: PIVA_CHECKSUM_ERRATO,
      colonnaVecchia: PIVA_CHECKSUM_ERRATO,
      audit: 0,
    })
    const ditta = await owner.ditta.findUniqueOrThrow({ where: { id: ids.dittaId } })
    expect(ditta.ragioneSociale).not.toBe('Nuova ragione sociale')
  })
})
