/**
 * Firme del FIR lungo il ciclo di vita REALE contro un Postgres vero: emissione, presa in carico e
 * conferma di consegna con gli use case di produzione e i due repository (ciclo di vita e firme
 * crittografiche), poi verifica pubblica. Prima della correzione la presa in carico riscriveva
 * `transport_date`, che entra nel documento firmato: le firme di produttore e trasportatore
 * risultavano non valide, e i ruoli italiani del ciclo di vita impedivano `isCompleted`.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
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
import { LoggerService } from '../../core/logger/logger.service'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { SignatureFIRRepository } from '../../infrastructure/signatures/signature-fir.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { DigitalSignatureService } from './digital-signature.service'
import { VerifySignaturesUseCase } from './verify-signatures.use-case'
import { EmettiFIRUseCase } from '../fir/use-cases/emetti-fir.use-case'
import { PresaInCaricoFIRUseCase } from '../fir/use-cases/presa-in-carico-fir.use-case'
import { ConfermaConsegnaFIRUseCase } from '../fir/use-cases/conferma-consegna-fir.use-case'
import { EmettiFIRCommand } from '../fir/commands/emetti-fir.command'
import { PresaInCaricoFIRCommand } from '../fir/commands/presa-in-carico-fir.command'
import { ConfermaConsegnaFIRCommand } from '../fir/commands/conferma-consegna-fir.command'

describe('Firme FIR lungo il ciclo di vita (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let emetti: EmettiFIRUseCase
  let presaInCarico: PresaInCaricoFIRUseCase
  let conferma: ConfermaConsegnaFIRUseCase
  let verifica: VerifySignaturesUseCase
  let tenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-8)

  const logger = (): LoggerService =>
    ({
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }) as unknown as LoggerService

  const nelTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    repo = new FIRPrismaRepository(app, sistema)
    const cripto = new SignatureFIRRepository(app, sistema, logger())
    const firma = new DigitalSignatureService(logger())
    const rentri = { eseguiSeAutomatica: jest.fn().mockResolvedValue(undefined) } as any
    emetti = new EmettiFIRUseCase(repo, cripto, firma, rentri, logger())
    presaInCarico = new PresaInCaricoFIRUseCase(repo, cripto, firma)
    conferma = new ConfermaConsegnaFIRUseCase(repo, cripto, firma)
    verifica = new VerifySignaturesUseCase(cripto, firma, logger())

    tenantId = (
      await owner.tenant.create({
        data: { partitaIva: `FS${sfx}`.slice(0, 11), ragioneSociale: `Firme FIR ${sfx}` },
      })
    ).id
    userId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-firme-fir-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `firme-fir-${sfx}@example.it`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  afterAll(async () => {
    if (tenantId) {
      await owner.fIRSignature.deleteMany({ where: { fir: { tenantId } } })
      await owner.fIR.deleteMany({ where: { tenantId } })
      await owner.user.deleteMany({ where: { tenantId } })
      await owner.tenant.deleteMany({ where: { id: tenantId } })
    }
    await Promise.all([owner.$disconnect(), app.onModuleDestroy(), sistema.onModuleDestroy()])
  })

  async function nuovoFirInBozza(trasportoIlGiorno?: Date): Promise<string> {
    const fir = FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId: userId,
    })
    await nelTenant(() => repo.save(fir))
    if (trasportoIlGiorno) {
      await owner.fIR.update({ where: { id: fir.id }, data: { transportDate: trasportoIlGiorno } })
    }
    return fir.id
  }

  const ok = async <T>(p: Promise<{ isSuccess: boolean; error?: unknown }>): Promise<void> => {
    const r = await p
    if (!r.isSuccess) throw new Error(`use case fallito: ${String(r.error)}`)
  }

  async function percorriCiclo(firId: string): Promise<void> {
    await nelTenant(() => ok(emetti.execute(new EmettiFIRCommand(firId, userId, 'Mario Rossi'))))
    await nelTenant(() =>
      ok(presaInCarico.execute(new PresaInCaricoFIRCommand(firId, userId, 'Mario Rossi')))
    )
    await nelTenant(() =>
      ok(conferma.execute(new ConfermaConsegnaFIRCommand(firId, 98.5, userId, 'Mario Rossi')))
    )
  }

  it('emetti, presa in carico, consegna: la verifica pubblica ha 3 firme tutte valide e il FIR e completo', async () => {
    const firId = await nuovoFirInBozza()
    await percorriCiclo(firId)

    const esito = await verifica.execute({ firId })

    expect(esito.signatureCount).toBe(3)
    expect(esito.signatures.map(s => [s.role, s.isValid])).toEqual(
      expect.arrayContaining([
        ['PRODUCER', true],
        ['CARRIER', true],
        ['RECEIVER', true],
      ])
    )
    expect(esito.allValid).toBe(true)
    expect(esito.isCompleted).toBe(true)
  })

  it('presa in carico in un giorno diverso da transport_date: transport_date non cambia e la colonna dedicata registra il momento reale', async () => {
    const tregiorniFa = new Date(Date.now() - 3 * 24 * 3600 * 1000)
    const firId = await nuovoFirInBozza(tregiorniFa)
    const prima = Date.now()
    await percorriCiclo(firId)

    const riga = await owner.fIR.findUniqueOrThrow({ where: { id: firId } })
    expect(riga.transportDate.getTime()).toBe(tregiorniFa.getTime())
    expect(riga.presaInCaricoIl).not.toBeNull()
    expect(riga.presaInCaricoIl!.getTime()).toBeGreaterThanOrEqual(prima)

    const esito = await verifica.execute({ firId, tenantId })
    expect(esito.allValid).toBe(true)
    expect(esito.isCompleted).toBe(true)
  })

  it('dopo la sola presa in carico la firma del produttore resta valida', async () => {
    const firId = await nuovoFirInBozza()
    await nelTenant(() => ok(emetti.execute(new EmettiFIRCommand(firId, userId, 'Mario Rossi'))))
    await nelTenant(() =>
      ok(presaInCarico.execute(new PresaInCaricoFIRCommand(firId, userId, 'Mario Rossi')))
    )

    const esito = await verifica.execute({ firId })
    expect(esito.signatureCount).toBe(2)
    expect(esito.allValid).toBe(true)
    expect(esito.isCompleted).toBe(false)
  })
})
