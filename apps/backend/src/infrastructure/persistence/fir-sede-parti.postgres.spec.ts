/**
 * Sede e codice fiscale delle parti del FIR (Fase 2 pezzo 10, Task 5a, D9) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS attiva) e dentro il `TenantContext` dell'azienda, con i
 * registri VERI (ditte, sedi, righe di ruolo). Il proprietario (`wasteflow`) prepara le aziende e le
 * anagrafiche, simula un FIR precedente alla migration e legge cio' che e' stato scritto. La
 * pulizia toglie SOLO gli id creati qui.
 *
 * Eseguire con `npm run test:postgres` (o jest con `jest.postgres.config.js`).
 */
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { urlComeRuolo } from '../database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono queste due variabili, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { SignatureFIRRepository } from '../signatures/signature-fir.repository'
import { ProduttorePrismaRepository } from './produttore-prisma.repository'
import { TrasportatorePrismaRepository } from './trasportatore-prisma.repository'
import { DestinatarioPrismaRepository } from './destinatario-prisma.repository'
import { ProvenienzaRifiuto, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { CreateFIRUseCase } from '../../application/fir/use-cases/create-fir.use-case'
import { CreateFIRCommand } from '../../application/fir/commands/create-fir.command'
import { ModificaFIRUseCase } from '../../application/fir/use-cases/modifica-fir.use-case'
import { ModificaFIRCommand } from '../../application/fir/commands/modifica-fir.command'
import { EmettiFIRUseCase } from '../../application/fir/use-cases/emetti-fir.use-case'
import { EmettiFIRCommand } from '../../application/fir/commands/emetti-fir.command'
import {
  CF_PERSONA_ALTRO,
  CF_PERSONA_VALIDO,
  creaDittaConRuolo,
} from '../../test-support/anagrafiche-di-test'

describe('FIR: sede e codice fiscale delle parti (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let repoFirme: SignatureFIRRepository
  let crea: CreateFIRUseCase
  let modifica: ModificaFIRUseCase
  // Solo gli id creati qui: la pulizia non cancella mai altro (incidente reale su questo ramo).
  const tenantCreati: string[] = []
  let tenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-7)
  const logger: any = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  const cer = { exists: async () => true, isUtilizzabilePerNuovoFormulario: async () => true }

  const nelTenant = <T>(fn: () => Promise<T>, t = tenantId): Promise<T> =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  interface Anagrafiche {
    produttore: { ruoloId: string; dittaId: string; sedeId: string }
    trasportatore: { ruoloId: string; dittaId: string; sedeId: string }
    destinatario: { ruoloId: string; dittaId: string; sedeId: string }
    /** Seconda sede attiva della ditta del produttore e del destinatario. */
    secondaProduttore: string
    secondaDestinatario: string
  }

  async function aggiungiSede(
    dittaId: string,
    opzioni: { via: string; attiva?: boolean; t?: string }
  ): Promise<string> {
    const s = await owner.sedeDitta.create({
      data: {
        tenantId: opzioni.t ?? tenantId,
        dittaId,
        via: opzioni.via,
        civico: '9',
        cap: '20100',
        comune: 'Milano',
        provincia: 'MI',
        principale: false,
        attiva: opzioni.attiva ?? true,
      },
    })
    return s.id
  }

  async function anagrafiche(
    over: { produttoreCf?: boolean; destinatarioCf?: boolean } = {}
  ): Promise<Anagrafiche> {
    const produttore = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Produttore sede test',
      ...(over.produttoreCf ? { partitaIva: null, codiceFiscale: CF_PERSONA_VALIDO } : {}),
    })
    const trasportatore = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ragioneSociale: 'Trasportatore sede test',
    })
    const destinatario = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', {
      ragioneSociale: 'Destinatario sede test',
      ...(over.destinatarioCf ? { codiceFiscale: CF_PERSONA_ALTRO } : {}),
    })
    return {
      produttore,
      trasportatore,
      destinatario,
      secondaProduttore: await aggiungiSede(produttore.dittaId, { via: 'Via Milano' }),
      secondaDestinatario: await aggiungiSede(destinatario.dittaId, { via: 'Via Torino' }),
    }
  }

  const comando = (a: Anagrafiche, sedi: { p?: string; d?: string } = {}) =>
    new CreateFIRCommand(
      a.produttore.ruoloId,
      { cerCode: '15 01 01', quantita: 100, unitaMisura: UnitaMisura.KG },
      a.trasportatore.ruoloId,
      a.destinatario.ruoloId,
      userId,
      tenantId,
      ProvenienzaRifiuto.SPECIALE,
      TipoTratta.TERRESTRE,
      [],
      undefined,
      sedi.p,
      sedi.d
    )

  const creaFir = async (a: Anagrafiche, sedi: { p?: string; d?: string } = {}) => {
    const r = await nelTenant(() => crea.execute(comando(a, sedi)))
    expect(r.isSuccess).toBe(true)
    return r.value
  }

  const riga = (id: string) => owner.fIR.findUniqueOrThrow({ where: { id } })
  const audit = (id: string) =>
    owner.activityLog.findMany({ where: { firId: id, action: 'FIR_BOZZA_MODIFICATA' } })

  /** Porta la riga allo stato di un FIR creato prima della migration: sede e CF NULL. */
  const rendiPrecedenteAllaMigration = (id: string) =>
    owner.fIR.update({
      where: { id },
      data: {
        producerSedeId: null,
        receiverSedeId: null,
        producerCodiceFiscale: null,
        carrierCodiceFiscale: null,
        receiverCodiceFiscale: null,
      },
    })

  const comandoModifica = (
    firId: string,
    versione: number,
    a: Anagrafiche,
    sedi: { p?: string; d?: string } = {}
  ): ModificaFIRCommand => ({
    firId,
    tenantId,
    userId,
    versione,
    produttoreId: a.produttore.ruoloId,
    produttoreSedeId: sedi.p,
    trasportatoreId: a.trasportatore.ruoloId,
    destinatarioId: a.destinatario.ruoloId,
    destinatarioSedeId: sedi.d,
    rifiuto: { cerCode: '15 01 01', quantita: 100, unitaMisura: UnitaMisura.KG },
    provenienza: ProvenienzaRifiuto.SPECIALE,
    tipoTrattaPrincipale: TipoTratta.TERRESTRE,
    trasportatoriAggiuntivi: [],
  })

  beforeAll(async () => {
    // Mai su un database che non sia quello di test locale.
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    repo = new FIRPrismaRepository(app, sistema)
    repoFirme = new SignatureFIRRepository(app, sistema, logger)
    const produttori = new ProduttorePrismaRepository(app)
    const trasportatori = new TrasportatorePrismaRepository(app)
    const destinatari = new DestinatarioPrismaRepository(app)
    crea = new CreateFIRUseCase(repo, cer as never, produttori, trasportatori, destinatari)
    modifica = new ModificaFIRUseCase(
      repo,
      cer as never,
      produttori,
      trasportatori,
      destinatari,
      logger
    )
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')

    const tenant = await owner.tenant.create({
      data: {
        partitaIva: `FS${sfx}`.padEnd(11, '0').slice(0, 11),
        ragioneSociale: `Sede FIR ${sfx}`,
      },
    })
    tenantCreati.push(tenant.id)
    tenantId = tenant.id
    const user = await owner.user.create({
      data: {
        tenantId,
        keycloakId: `kc-sede-fir-${sfx}`,
        fiscalCode: CF_PERSONA_VALIDO,
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `sede-fir-${sfx}@example.it`,
        role: 'ADMIN',
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    // Solo gli id creati qui; con la lista vuota (beforeAll fallito) non si cancella nulla.
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
      await owner.activityLog.deleteMany({ where })
      await owner.fIR.deleteMany({ where })
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

  it('FIR senza sede nel DTO: sede predefinita dei ruoli, indirizzo di quella sede', async () => {
    const a = await anagrafiche()
    const fir = await creaFir(a)
    const r = await riga(fir.id)

    expect(r.producerSedeId).toBe(a.produttore.sedeId)
    expect(r.receiverSedeId).toBe(a.destinatario.sedeId)
    expect(r.producerAddress).toContain('Via Roma')
    expect(r.receiverAddress).toContain('Via Roma')
    // Ditte con sola P.IVA: nessun codice fiscale.
    expect(r.producerCodiceFiscale).toBeNull()
    expect(r.carrierCodiceFiscale).toBeNull()
    expect(r.receiverCodiceFiscale).toBeNull()
    expect(r.producerPartitaIva).toHaveLength(11)
  })

  it('con produttoreSedeId e destinatarioSedeId della seconda sede: indirizzo della seconda', async () => {
    const a = await anagrafiche()
    const fir = await creaFir(a, { p: a.secondaProduttore, d: a.secondaDestinatario })
    const r = await riga(fir.id)

    expect(r.producerSedeId).toBe(a.secondaProduttore)
    expect(r.receiverSedeId).toBe(a.secondaDestinatario)
    expect(r.producerAddress).toContain('Via Milano')
    expect(r.receiverAddress).toContain('Via Torino')
  })

  it('sede di un altra ditta: 400 (Result.fail), nessun FIR scritto', async () => {
    const a = await anagrafiche()
    const altra = await anagrafiche()
    const prima = await owner.fIR.count({ where: { tenantId } })

    const r = await nelTenant(() => crea.execute(comando(a, { p: altra.secondaProduttore })))

    expect(r.isFailure).toBe(true)
    expect(r.error).toBe('La sede indicata non è una sede attiva del produttore scelto')
    const rd = await nelTenant(() => crea.execute(comando(a, { d: altra.secondaDestinatario })))
    expect(rd.isFailure).toBe(true)
    expect(rd.error).toBe('La sede indicata non è una sede attiva del destinatario scelto')
    expect(await owner.fIR.count({ where: { tenantId } })).toBe(prima)
  })

  it('sede disattivata: 400 (Result.fail), nessun FIR scritto', async () => {
    const a = await anagrafiche()
    const disattivata = await aggiungiSede(a.produttore.dittaId, {
      via: 'Via Chiusa',
      attiva: false,
    })
    const prima = await owner.fIR.count({ where: { tenantId } })

    const r = await nelTenant(() => crea.execute(comando(a, { p: disattivata })))

    expect(r.isFailure).toBe(true)
    expect(r.error).toBe('La sede indicata non è una sede attiva del produttore scelto')
    expect(await owner.fIR.count({ where: { tenantId } })).toBe(prima)
  })

  it('produttore privato: producer_partita_iva vuota e producer_codice_fiscale valorizzato', async () => {
    const a = await anagrafiche({ produttoreCf: true, destinatarioCf: true })
    const fir = await creaFir(a)
    const r = await riga(fir.id)

    expect(r.producerPartitaIva).toBe('')
    expect(r.producerCodiceFiscale).toBe(CF_PERSONA_VALIDO)
    // Una ditta con P.IVA e CF li conserva entrambi.
    expect(r.receiverPartitaIva).toHaveLength(11)
    expect(r.receiverCodiceFiscale).toBe(CF_PERSONA_ALTRO)
    expect(r.carrierCodiceFiscale).toBeNull()

    // Riletto dal database, il CF entra nel documento firmato.
    const riletto = await nelTenant(() => repoFirme.findById(fir.id))
    const doc = JSON.parse(riletto!.toSignableDocument())
    expect(doc.producerCodiceFiscale).toBe(CF_PERSONA_VALIDO)
    expect(doc.receiverCodiceFiscale).toBe(CF_PERSONA_ALTRO)
    expect(doc).not.toHaveProperty('carrierCodiceFiscale')
  })

  it('FIR precedente alla migration: PUT con la sede predefinita e 200, versione invariata, nessuna scrittura', async () => {
    const a = await anagrafiche()
    const fir = await creaFir(a)
    await rendiPrecedenteAllaMigration(fir.id)
    const prima = await riga(fir.id)

    const r = await nelTenant(() =>
      modifica.execute(
        comandoModifica(fir.id, prima.versione, a, {
          p: a.produttore.sedeId,
          d: a.destinatario.sedeId,
        })
      )
    )

    expect(r.isSuccess).toBe(true)
    const dopo = await riga(fir.id)
    expect(dopo.versione).toBe(prima.versione)
    expect(dopo.updatedAt.getTime()).toBe(prima.updatedAt.getTime())
    expect(dopo.producerSedeId).toBeNull()
    expect(dopo.receiverSedeId).toBeNull()
    expect(await audit(fir.id)).toHaveLength(0)
  })

  it('FIR precedente alla migration: PUT senza sede nel DTO conserva sede e snapshot (anche NULL)', async () => {
    const a = await anagrafiche()
    const fir = await creaFir(a)
    await rendiPrecedenteAllaMigration(fir.id)
    const prima = await riga(fir.id)

    const r = await nelTenant(() => modifica.execute(comandoModifica(fir.id, prima.versione, a)))

    expect(r.isSuccess).toBe(true)
    const dopo = await riga(fir.id)
    expect(dopo.versione).toBe(prima.versione)
    expect(dopo.producerSedeId).toBeNull()
    expect(dopo.producerAddress).toBe(prima.producerAddress)
    expect(await audit(fir.id)).toHaveLength(0)
  })

  it('stesso FIR con una sede diversa: nuovo snapshot, versione +1, audit sul produttore', async () => {
    const a = await anagrafiche()
    const fir = await creaFir(a)
    await rendiPrecedenteAllaMigration(fir.id)
    const prima = await riga(fir.id)

    const r = await nelTenant(() =>
      modifica.execute(comandoModifica(fir.id, prima.versione, a, { p: a.secondaProduttore }))
    )

    expect(r.isSuccess).toBe(true)
    const dopo = await riga(fir.id)
    expect(dopo.versione).toBe(prima.versione + 1)
    expect(dopo.producerSedeId).toBe(a.secondaProduttore)
    expect(dopo.producerAddress).toContain('Via Milano')
    // Il destinatario non e' stato toccato: resta come il FIR precedente.
    expect(dopo.receiverSedeId).toBeNull()
    expect(dopo.receiverAddress).toBe(prima.receiverAddress)
    const meta = (await audit(fir.id))[0].metadata as any
    expect(meta.partiRisnapshottate).toEqual(['produttore'])
  })

  it('PUT con una sede non valida: 400 (Result.fail), riga invariata', async () => {
    const a = await anagrafiche()
    const altra = await anagrafiche()
    const fir = await creaFir(a)
    const prima = await riga(fir.id)

    const r = await nelTenant(() =>
      modifica.execute(comandoModifica(fir.id, prima.versione, a, { p: altra.secondaProduttore }))
    )

    expect(r.isFailure).toBe(true)
    const dopo = await riga(fir.id)
    expect(dopo.versione).toBe(prima.versione)
    expect(dopo.producerSedeId).toBe(prima.producerSedeId)
  })

  it('emissione di un FIR precedente alla migration: lo snapshot non cambia', async () => {
    const a = await anagrafiche()
    const fir = await creaFir(a)
    await rendiPrecedenteAllaMigration(fir.id)
    const prima = await riga(fir.id)

    const firma = {
      createSignature: async (documento: string) => ({
        signatureValue: 'valore-firma',
        documentHash: createHash('sha256').update(documento, 'utf8').digest('hex'),
        certificateHash: 'a'.repeat(64),
        publicKey: 'chiave-pubblica',
        timestampToken: 'token',
        signatureMethod: 'ECDSA-SHA256',
        isQualified: false,
      }),
    }
    const rentri = { eseguiSeAutomatica: async () => undefined }
    const emissione = new EmettiFIRUseCase(repo, repoFirme, firma as never, rentri as never, logger)
    const e = await nelTenant(() =>
      emissione.execute(new EmettiFIRCommand(fir.id, userId, 'Mario Rossi'))
    )

    expect(e.isSuccess).toBe(true)
    const dopo = await riga(fir.id)
    expect(dopo.status).not.toBe('DRAFT')
    expect(dopo.producerSedeId).toBeNull()
    expect(dopo.receiverSedeId).toBeNull()
    expect(dopo.producerAddress).toBe(prima.producerAddress)
    expect(dopo.receiverAddress).toBe(prima.receiverAddress)
    expect(dopo.producerCodiceFiscale).toBeNull()
  })
})
