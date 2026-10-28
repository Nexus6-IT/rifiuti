/**
 * Registry delle controparti su ditte e sedi (F2-10, Task 3a) contro un Postgres reale, collegato
 * COME `wasteflow_app` (RLS ENABLE+FORCE soggetta alle policy), dentro il `TenantContext`.
 *
 * Il proprietario (`wasteflow`, superuser) prepara le aziende e legge cio' che e' stato scritto; la
 * pulizia toglie solo le righe create qui, per `tenantId`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  DatiControparteNonValidiError,
  SedeNonModificabileError,
  SedeNonValidaPerRuoloError,
} from '../../core/domain/errors'
import { DittaPrismaRepository } from '../../infrastructure/persistence/ditta-prisma.repository'
import { DestinatarioPrismaRepository } from '../../infrastructure/persistence/destinatario-prisma.repository'
import { ProduttorePrismaRepository } from '../../infrastructure/persistence/produttore-prisma.repository'
import { TrasportatorePrismaRepository } from '../../infrastructure/persistence/trasportatore-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  CF_PERSONA_VALIDO,
  PIVA_VALIDA,
  partitaIvaValida,
} from '../../test-support/anagrafiche-di-test'
import { DitteService } from './ditte/ditte.service'
import { CreateDestinatarioUseCase } from './use-cases/create-destinatario.use-case'
import { CreateProduttoreUseCase } from './use-cases/create-produttore.use-case'
import { CreateTrasportatoreUseCase } from './use-cases/create-trasportatore.use-case'
import { UpdateDestinatarioUseCase } from './use-cases/update-destinatario.use-case'
import { UpdateProduttoreUseCase } from './use-cases/update-produttore.use-case'

const SEDE_ROMA = { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' }
const SEDE_MILANO = {
  via: 'Via Milano',
  civico: '9',
  cap: '20100',
  citta: 'Milano',
  provincia: 'MI',
}

function cablaggio(prisma: PrismaService) {
  const ditte = new DitteService(prisma, new DittaPrismaRepository())
  const produttori = new ProduttorePrismaRepository(prisma)
  const trasportatori = new TrasportatorePrismaRepository(prisma)
  const destinatari = new DestinatarioPrismaRepository(prisma)
  return {
    ditte,
    produttori,
    trasportatori,
    destinatari,
    creaProduttore: new CreateProduttoreUseCase(produttori, prisma, ditte),
    creaTrasportatore: new CreateTrasportatoreUseCase(trasportatori, prisma, ditte),
    creaDestinatario: new CreateDestinatarioUseCase(destinatari, prisma, ditte),
    aggiornaProduttore: new UpdateProduttoreUseCase(produttori, ditte),
    aggiornaDestinatario: new UpdateDestinatarioUseCase(destinatari, ditte),
  }
}

describe('Registry su ditte e sedi — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let app2: PrismaService
  let r1: ReturnType<typeof cablaggio>
  let r2: ReturnType<typeof cablaggio>
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<string> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `RG${suffisso}`, ragioneSociale: 'Registry test SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  const comandoProduttore = (over: object = {}) => ({
    ragioneSociale: 'Rossi S.r.l.',
    partitaIVA: PIVA_VALIDA,
    sedeLegale: SEDE_ROMA,
    email: 'rossi@example.it',
    ...over,
  })
  const comandoDestinatario = (over: object = {}) => ({
    ragioneSociale: 'ROSSI SPA',
    partitaIVA: PIVA_VALIDA,
    sede: SEDE_ROMA,
    numeroAutorizzazione: `AUT-${Date.now()}-${++n}`,
    ...over,
  })

  beforeAll(async () => {
    // Prima di toccare il database: mai su un database che non sia quello di test locale.
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    app2 = creaPrismaServiceApplicativo()
    r1 = cablaggio(app)
    r2 = cablaggio(app2)
  })

  afterAll(async () => {
    for (const tenantId of tenantCreati) {
      await owner.produttore.deleteMany({ where: { tenantId } })
      await owner.trasportatore.deleteMany({ where: { tenantId } })
      await owner.destinatario.deleteMany({ where: { tenantId } })
      await owner.activityLog.deleteMany({ where: { tenantId } })
      await owner.sedeDitta.deleteMany({ where: { tenantId } })
      await owner.ditta.deleteMany({ where: { tenantId } })
    }
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await owner.$disconnect()
    await app.$disconnect()
    await app2.$disconnect()
  })

  it('produttore e destinatario con la stessa P.IVA: una ditta, due ruoli, colonne vecchie valorizzate', async () => {
    const t = await azienda()
    const p = await nelTenant(t, () => r1.creaProduttore.execute(comandoProduttore()))
    const d = await nelTenant(t, () => r1.creaDestinatario.execute(comandoDestinatario()))

    expect(p.isSuccess).toBe(true)
    expect(d.isSuccess).toBe(true)
    expect(p.value.dittaEsistente).toBe(false)
    expect(d.value.dittaEsistente).toBe(true)
    // la ragione sociale della ditta vince, con l'avviso
    expect(d.value.ruolo.ragioneSociale).toBe('Rossi S.r.l.')
    expect(d.value.avvisi).toHaveLength(1)
    expect(d.value.ruolo.dittaId).toBe(p.value.ruolo.dittaId)
    expect(d.value.ruolo.sedeId).toBe(p.value.ruolo.sedeId)

    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(1)
    expect(await owner.sedeDitta.count({ where: { tenantId: t } })).toBe(1)
    const prodRiga = await owner.produttore.findUniqueOrThrow({ where: { id: p.value.ruolo.id } })
    const destRiga = await owner.destinatario.findUniqueOrThrow({ where: { id: d.value.ruolo.id } })
    for (const riga of [prodRiga, destRiga]) {
      // F2-10 Task 3a: doppia scrittura, le colonne vecchie restano valorizzate
      expect(riga).toMatchObject({
        ragioneSociale: 'Rossi S.r.l.',
        partitaIVA: PIVA_VALIDA,
        via: 'Via Roma',
        civico: '1',
        cap: '00100',
        comune: 'Roma',
        provincia: 'RM',
        dittaId: p.value.ruolo.dittaId,
        sedeId: p.value.ruolo.sedeId,
      })
    }
    expect(prodRiga.email).toBe('rossi@example.it')
    // lettura: ragione sociale e identificativi vengono dalla ditta
    const letto = await nelTenant(t, () => r1.destinatari.findById(d.value.ruolo.id))
    expect(letto?.ragioneSociale).toBe('Rossi S.r.l.')
    expect(letto?.partitaIVA?.getValue()).toBe(PIVA_VALIDA)
    expect(letto?.ruoliDitta?.sort()).toEqual(['DESTINATARIO', 'PRODUTTORE'])
  })

  it('due creazioni concorrenti dello stesso produttore: una riesce, l altra 400, una sola ditta', async () => {
    const t = await azienda()
    const piva = partitaIvaValida(Date.now() + 7)

    const [a, b] = await Promise.all([
      nelTenant(t, () => r1.creaProduttore.execute(comandoProduttore({ partitaIVA: piva }))),
      nelTenant(t, () => r2.creaProduttore.execute(comandoProduttore({ partitaIVA: piva }))),
    ])

    const riuscite = [a, b].filter(r => r.isSuccess)
    const respinte = [a, b].filter(r => r.isFailure)
    expect(riuscite).toHaveLength(1)
    expect(respinte).toHaveLength(1)
    expect(respinte[0].error).toBe('Esiste già un produttore per questa ditta')
    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(1)
    expect(await owner.produttore.count({ where: { tenantId: t } })).toBe(1)
  })

  it('un secondo produttore per la stessa ditta e rifiutato e non lascia sedi orfane', async () => {
    const t = await azienda()
    await nelTenant(t, () => r1.creaProduttore.execute(comandoProduttore()))

    const secondo = await nelTenant(t, () =>
      r1.creaProduttore.execute(comandoProduttore({ sedeLegale: SEDE_MILANO }))
    )

    expect(secondo.isFailure).toBe(true)
    expect(secondo.error).toBe('Esiste già un produttore per questa ditta')
    // la sede nuova creata durante la risoluzione e stata annullata con la transazione
    expect(await owner.sedeDitta.count({ where: { tenantId: t } })).toBe(1)
  })

  it('PUT della ragione sociale dal destinatario: la lista dei produttori e aggiornata', async () => {
    const t = await azienda()
    const p = await nelTenant(t, () => r1.creaProduttore.execute(comandoProduttore()))
    const d = await nelTenant(t, () => r1.creaDestinatario.execute(comandoDestinatario()))

    const esito = await nelTenant(t, () =>
      r1.aggiornaDestinatario.execute({ id: d.value.ruolo.id, ragioneSociale: 'Verdi S.p.A.' })
    )
    expect(esito.isSuccess).toBe(true)

    const lista = await nelTenant(t, () => r1.produttori.findByTenantId(t))
    expect(lista.map(x => x.ragioneSociale)).toEqual(['Verdi S.p.A.'])
    expect((await owner.ditta.findFirstOrThrow({ where: { tenantId: t } })).ragioneSociale).toBe(
      'Verdi S.p.A.'
    )
    // anche la colonna vecchia del destinatario segue
    const riga = await owner.destinatario.findUniqueOrThrow({ where: { id: d.value.ruolo.id } })
    expect(riga.ragioneSociale).toBe('Verdi S.p.A.')
    expect(p.isSuccess).toBe(true)
  })

  it('cambio di sede predefinita: indirizzo e colonne vecchie seguono, l altro ruolo no', async () => {
    const t = await azienda()
    const p = await nelTenant(t, () => r1.creaProduttore.execute(comandoProduttore()))
    const d = await nelTenant(t, () => r1.creaDestinatario.execute(comandoDestinatario()))
    const sedeMilano = await nelTenant(t, () =>
      r1.ditte.aggiungiSede(p.value.ruolo.dittaId, { indirizzo: SEDE_MILANO })
    )

    const esito = await nelTenant(t, () =>
      r1.aggiornaProduttore.execute({ id: p.value.ruolo.id, sedeId: sedeMilano.id })
    )

    expect(esito.isSuccess).toBe(true)
    expect(esito.value.sedeId).toBe(sedeMilano.id)
    expect(esito.value.sedeLegale.getCitta()).toBe('Milano')
    const prod = await owner.produttore.findUniqueOrThrow({ where: { id: p.value.ruolo.id } })
    expect(prod).toMatchObject({ sedeId: sedeMilano.id, comune: 'Milano', provincia: 'MI' })
    const dest = await owner.destinatario.findUniqueOrThrow({ where: { id: d.value.ruolo.id } })
    expect(dest).toMatchObject({ sedeId: p.value.ruolo.sedeId, comune: 'Roma' })
    // la sede di Roma non e stata toccata
    const roma = await owner.sedeDitta.findUniqueOrThrow({ where: { id: p.value.ruolo.sedeId } })
    expect(roma.comune).toBe('Roma')
  })

  it('findById con sedeId di un altra ditta (o disattivata): SedeNonValidaPerRuoloError', async () => {
    const t = await azienda()
    const p = await nelTenant(t, () => r1.creaProduttore.execute(comandoProduttore()))
    const altra = await nelTenant(t, () =>
      r1.creaDestinatario.execute(
        comandoDestinatario({ partitaIVA: partitaIvaValida(Date.now() + 11), sede: SEDE_MILANO })
      )
    )

    await expect(
      nelTenant(t, () =>
        r1.produttori.findById(p.value.ruolo.id, { sedeId: altra.value.ruolo.sedeId })
      )
    ).rejects.toBeInstanceOf(SedeNonValidaPerRuoloError)

    // sede disattivata della stessa ditta
    const extra = await nelTenant(t, () =>
      r1.ditte.aggiungiSede(p.value.ruolo.dittaId, { indirizzo: SEDE_MILANO })
    )
    await nelTenant(t, () =>
      r1.ditte.aggiornaSede(p.value.ruolo.dittaId, extra.id, { attiva: false })
    )
    await expect(
      nelTenant(t, () => r1.produttori.findById(p.value.ruolo.id, { sedeId: extra.id }))
    ).rejects.toBeInstanceOf(SedeNonValidaPerRuoloError)

    // la sede predefinita stessa si legge sempre
    const ok = await nelTenant(t, () =>
      r1.produttori.findById(p.value.ruolo.id, { sedeId: p.value.ruolo.sedeId })
    )
    expect(ok?.sedeId).toBe(p.value.ruolo.sedeId)
  })

  it('modifica dell indirizzo sull indirizzo di un altra sede attiva della ditta: 409', async () => {
    const t = await azienda()
    const p = await nelTenant(t, () => r1.creaProduttore.execute(comandoProduttore()))
    await nelTenant(t, () =>
      r1.ditte.aggiungiSede(p.value.ruolo.dittaId, { indirizzo: SEDE_MILANO })
    )

    await expect(
      nelTenant(t, () =>
        r1.aggiornaProduttore.execute({ id: p.value.ruolo.id, sedeLegale: SEDE_MILANO })
      )
    ).rejects.toBeInstanceOf(SedeNonModificabileError)
  })

  it('un privato (solo codice fiscale) non puo essere trasportatore: 400 tipizzato, nessuna ditta, nessun CF nel messaggio', async () => {
    const t = await azienda()

    const tentativo = nelTenant(t, () =>
      r1.creaTrasportatore.execute({
        ragioneSociale: 'Mario Rossi',
        partitaIVA: '',
        codiceFiscale: CF_PERSONA_VALIDO,
        sedeLegale: SEDE_ROMA,
        numeroIscrizione: `ALBO-${Date.now()}`,
      })
    )

    await expect(tentativo).rejects.toBeInstanceOf(DatiControparteNonValidiError)
    await tentativo.catch((e: Error) => {
      expect(e.message).not.toContain(CF_PERSONA_VALIDO)
    })
    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(0)
    expect(await owner.sedeDitta.count({ where: { tenantId: t } })).toBe(0)
  })

  it('isolamento: un altra azienda non vede ne riusa la ditta', async () => {
    const t1 = await azienda()
    const t2 = await azienda()
    const a = await nelTenant(t1, () => r1.creaProduttore.execute(comandoProduttore()))
    const b = await nelTenant(t2, () => r1.creaProduttore.execute(comandoProduttore()))

    expect(a.isSuccess).toBe(true)
    expect(b.isSuccess).toBe(true)
    expect(b.value.dittaEsistente).toBe(false)
    expect(b.value.ruolo.dittaId).not.toBe(a.value.ruolo.dittaId)
    expect(await nelTenant(t2, () => r1.produttori.findById(a.value.ruolo.id))).toBeNull()
  })
})
