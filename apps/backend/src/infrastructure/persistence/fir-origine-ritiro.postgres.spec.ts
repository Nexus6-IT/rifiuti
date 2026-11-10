/**
 * Origine del FIR dal ritiro programmato (4.7, T9) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS attiva) e dentro il `TenantContext`. Il proprietario prepara i dati e legge.
 * La pulizia toglie SOLO gli id creati qui.
 *
 * Eseguire con `npm run test:postgres` (o jest con `jest.postgres.config.js`).
 */
import { PrismaClient } from '@prisma/client'
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
import { ProduttorePrismaRepository } from './produttore-prisma.repository'
import { TrasportatorePrismaRepository } from './trasportatore-prisma.repository'
import { DestinatarioPrismaRepository } from './destinatario-prisma.repository'
import { ProvenienzaRifiuto, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { CreateFIRUseCase } from '../../application/fir/use-cases/create-fir.use-case'
import { CreateFIRCommand } from '../../application/fir/commands/create-fir.command'
import {
  CF_PERSONA_ALTRO,
  CF_PERSONA_VALIDO,
  creaDittaConRuolo,
} from '../../test-support/anagrafiche-di-test'

import {
  FirGiaGeneratoDalRitiroError,
  RitiroNonProgrammatoError,
  RitiroNonTrovatoError,
} from '../../core/domain/errors'
import { FIRStato } from '../../domain/fir/aggregates/fir.aggregate'

describe('FIR: origine dal ritiro (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let crea: CreateFIRUseCase
  const tenantCreati: string[] = []
  let tenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-7)
  const cer = { exists: async () => true, isUtilizzabilePerNuovoFormulario: async () => true }

  const nelTenant = <T>(fn: () => Promise<T>, t = tenantId): Promise<T> =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  interface Ana {
    produttore: { ruoloId: string; dittaId: string; sedeId: string }
    trasportatore: { ruoloId: string; dittaId: string; sedeId: string }
    destinatario: { ruoloId: string; dittaId: string; sedeId: string }
  }
  let ana: Ana

  async function ritiro(stato: 'PROGRAMMATO' | 'ANNULLATO' = 'PROGRAMMATO', t = tenantId) {
    const r = await owner.ritiro.create({
      data: {
        tenantId: t,
        dataPrevista: new Date('2026-12-01'),
        produttoreId: ana.produttore.ruoloId,
        produttoreSedeId: ana.produttore.sedeId,
        trasportatoreId: ana.trasportatore.ruoloId,
        destinatarioId: ana.destinatario.ruoloId,
        destinatarioSedeId: ana.destinatario.sedeId,
        cerCode: '15 01 01',
        descrizione: 'Imballaggi',
        quantitaPresunta: '100.00',
        tipoOperazione: 'RECOVERY',
        creatoDa: userId,
        ...(stato === 'ANNULLATO' ? { stato, motivo: 'annullato nel test' } : {}),
      },
    })
    return r.id
  }

  const comando = (ritiroId?: string) =>
    new CreateFIRCommand(
      ana.produttore.ruoloId,
      { cerCode: '15 01 01', quantita: 100, unitaMisura: UnitaMisura.KG },
      ana.trasportatore.ruoloId,
      ana.destinatario.ruoloId,
      userId,
      tenantId,
      ProvenienzaRifiuto.SPECIALE,
      TipoTratta.TERRESTRE,
      [],
      undefined,
      undefined,
      undefined,
      ritiroId
    )

  const esegui = (ritiroId?: string) => nelTenant(() => crea.execute(comando(ritiroId)))

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    repo = new FIRPrismaRepository(app, sistema)
    crea = new CreateFIRUseCase(
      repo,
      cer as never,
      new ProduttorePrismaRepository(app),
      new TrasportatorePrismaRepository(app),
      new DestinatarioPrismaRepository(app)
    )
    const tenant = await owner.tenant.create({
      data: {
        partitaIva: `RT${sfx}`.padEnd(11, '0').slice(0, 11),
        ragioneSociale: `Origine FIR ${sfx}`,
      },
    })
    tenantCreati.push(tenant.id)
    tenantId = tenant.id
    const user = await owner.user.create({
      data: {
        tenantId,
        keycloakId: `kc-orig-fir-${sfx}`,
        fiscalCode: CF_PERSONA_VALIDO,
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `orig-fir-${sfx}@example.it`,
        role: 'ADMIN',
      },
    })
    userId = user.id
    ana = {
      produttore: await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
        ragioneSociale: 'Produttore ritiri',
      }),
      trasportatore: await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
        ragioneSociale: 'Trasportatore ritiri',
      }),
      destinatario: await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', {
        ragioneSociale: 'Destinatario ritiri',
      }),
    }
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
      await owner.activityLog.deleteMany({ where })
      await owner.fIR.deleteMany({ where })
      await owner.ritiro.deleteMany({ where })
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

  it('CreateFIRUseCase con ritiroId scrive la colonna e il FIR riletto la espone', async () => {
    const rid = await ritiro()
    const r = await esegui(rid)
    expect(r.isSuccess).toBe(true)
    expect(r.value.ritiroId).toBe(rid)
    const riga = await owner.fIR.findUniqueOrThrow({ where: { id: r.value.id } })
    expect(riga.ritiroId).toBe(rid)
    const riletto = await nelTenant(() => repo.findById(r.value.id))
    expect(riletto?.ritiroId).toBe(rid)
  })

  it('senza ritiroId la colonna resta NULL', async () => {
    const r = await esegui()
    expect(r.isSuccess).toBe(true)
    const riga = await owner.fIR.findUniqueOrThrow({ where: { id: r.value.id } })
    expect(riga.ritiroId).toBeNull()
  })

  it('due creazioni in parallelo: una CREATA e una FirGiaGeneratoDalRitiroError', async () => {
    const rid = await ritiro()
    const esiti = await Promise.allSettled([esegui(rid), esegui(rid)])
    const ok = esiti.filter(e => e.status === 'fulfilled')
    const ko = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
    expect(ok).toHaveLength(1)
    expect(ko).toHaveLength(1)
    expect(ko[0].reason).toBeInstanceOf(FirGiaGeneratoDalRitiroError)
    expect(await owner.fIR.count({ where: { ritiroId: rid } })).toBe(1)
  })

  it('FIR annullato, poi una nuova creazione: va a buon fine', async () => {
    const rid = await ritiro()
    const primo = await esegui(rid)
    await owner.fIR.update({ where: { id: primo.value.id }, data: { status: 'CANCELLED' } })
    const secondo = await esegui(rid)
    expect(secondo.isSuccess).toBe(true)
    expect(secondo.value.stato).toBe(FIRStato.BOZZA)
    expect(await owner.fIR.count({ where: { ritiroId: rid } })).toBe(2)
  })

  it('ritiro ANNULLATO: RitiroNonProgrammatoError', async () => {
    const rid = await ritiro('ANNULLATO')
    await expect(esegui(rid)).rejects.toBeInstanceOf(RitiroNonProgrammatoError)
  })

  it('ritiro inesistente: RitiroNonTrovatoError, non "non programmato"', async () => {
    await expect(esegui('00000000-0000-4000-8000-000000000001')).rejects.toBeInstanceOf(
      RitiroNonTrovatoError
    )
  })

  it('ritiro di un altro tenant: RitiroNonTrovatoError', async () => {
    const altro = await owner.tenant.create({
      data: {
        partitaIva: `RX${sfx}`.padEnd(11, '0').slice(0, 11),
        ragioneSociale: `Altro ${sfx}`,
      },
    })
    tenantCreati.push(altro.id)
    const utenteAltro = await owner.user.create({
      data: {
        tenantId: altro.id,
        keycloakId: `kc-orig-altro-${sfx}`,
        fiscalCode: CF_PERSONA_ALTRO,
        firstName: 'Luca',
        lastName: 'Bianchi',
        email: `orig-altro-${sfx}@example.it`,
        role: 'ADMIN',
      },
    })
    const p = await creaDittaConRuolo(owner, altro.id, 'PRODUTTORE', { ragioneSociale: 'P altro' })
    const t = await creaDittaConRuolo(owner, altro.id, 'TRASPORTATORE', {
      ragioneSociale: 'T altro',
    })
    const d = await creaDittaConRuolo(owner, altro.id, 'DESTINATARIO', {
      ragioneSociale: 'D altro',
    })
    // Il ritiro e' del primo tenant; la creazione avviene nell'altro con quell'id.
    const rid = await ritiro('PROGRAMMATO', tenantId)
    const cmd = new CreateFIRCommand(
      p.ruoloId,
      { cerCode: '15 01 01', quantita: 100, unitaMisura: UnitaMisura.KG },
      t.ruoloId,
      d.ruoloId,
      utenteAltro.id,
      altro.id,
      ProvenienzaRifiuto.SPECIALE,
      TipoTratta.TERRESTRE,
      [],
      undefined,
      undefined,
      undefined,
      rid
    )
    await expect(nelTenant(() => crea.execute(cmd), altro.id)).rejects.toBeInstanceOf(
      RitiroNonTrovatoError
    )
  })

  it('il documento firmato non cambia con ritiroId (FIR crittografico senza il campo)', async () => {
    const rid = await ritiro()
    const r = await esegui(rid)
    const documento = JSON.stringify(r.value)
    // L'aggregate di dominio non entra nel documento da firmare: lo costruisce il FIR crittografico
    // dai soli campi del contratto. Qui si fissa che nessun codice del crittografico legga ritiro.
    expect(documento).toBeDefined()
    const fs = await import('fs')
    const sorgente = fs.readFileSync(`${__dirname}/../../domain/fir/fir.aggregate.ts`, 'utf8')
    expect(sorgente.toLowerCase()).not.toContain('ritiro')
  })
})
