/**
 * Firma QES con lock della riga e controllo di versione (Fase 2 pezzo 4, Task 2b, piano D8)
 * contro un Postgres reale, collegato COME `wasteflow_app` (RLS attiva) e dentro il
 * `TenantContext` dell'azienda. Il proprietario (`wasteflow`) prepara l'azienda e legge cio' che e'
 * stato scritto; la pulizia toglie solo le righe create qui.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { createHash } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { ArgumentsHost } from '@nestjs/common'
import { urlComeRuolo } from '../database/client-come-ruolo'

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
import { PrismaService, creaPrismaServiceApplicativo } from '../persistence/prisma.service'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { FIRPrismaRepository } from '../persistence/fir-prisma.repository'
import { SignatureFIRRepository } from './signature-fir.repository'
import { FIR as FirLifecycle } from '../../domain/fir/aggregates/fir.aggregate'
import { FIR as FirCrittografico } from '../../domain/fir/fir.aggregate'
import { DigitalSignature, SignatureRole } from '../../domain/fir/digital-signature.vo'
import { FirModificatoNelFrattempoError } from '../../core/domain/errors'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'

const CF_FIRMATARIO = 'RSSMRA80A01H501U'

describe('Firma QES: lock della riga e versione (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repoFir: FIRPrismaRepository
  let repoFirme: SignatureFIRRepository
  let tenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-8)
  const logger: any = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  const nelTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    repoFir = new FIRPrismaRepository(app, sistema)
    repoFirme = new SignatureFIRRepository(app, sistema, logger)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')

    tenantId = (
      await owner.tenant.create({
        data: { partitaIva: `FQ${sfx}`.slice(0, 11), ragioneSociale: `Firma versione ${sfx}` },
      })
    ).id
    userId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-firma-versione-${sfx}`,
          fiscalCode: CF_FIRMATARIO,
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `firma-versione-${sfx}@example.it`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  afterAll(async () => {
    // Senza id (beforeAll fallito) Prisma toglierebbe il filtro: non si cancella nulla.
    if (tenantId) {
      await owner.fIR.deleteMany({ where: { tenantId } }) // le firme seguono in cascata
      await owner.user.deleteMany({ where: { tenantId } })
      await owner.tenant.deleteMany({ where: { id: tenantId } })
    }
    await Promise.all([owner.$disconnect(), app.onModuleDestroy(), sistema.onModuleDestroy()])
  })

  async function firSalvato(): Promise<string> {
    const fir = FirLifecycle.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId: userId,
    })
    await nelTenant(() => repoFir.save(fir))
    return fir.id
  }

  const carica = async (id: string): Promise<FirCrittografico> =>
    (await nelTenant(() => repoFirme.findById(id)))!

  const riga = (id: string) => owner.fIR.findUniqueOrThrow({ where: { id } })
  const firmeSul = (id: string) => owner.fIRSignature.findMany({ where: { firId: id } })

  /** Applica una firma all'aggregate come farebbe ApplySignatureUseCase (prima del save). */
  function firma(
    fir: FirCrittografico,
    role: SignatureRole = 'PRODUCER',
    cf = CF_FIRMATARIO
  ): void {
    const documentHash = createHash('sha256').update(fir.toSignableDocument(), 'utf8').digest('hex')
    fir.applySignature(
      DigitalSignature.create({
        signerFiscalCode: cf,
        signerName: 'Mario Rossi',
        role,
        signatureValue: 'valore-firma',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'a'.repeat(64),
        documentHash,
        publicKey: 'chiave-pubblica',
      }),
      cf,
      2
    )
  }

  it('toDomain porta la versione della riga', async () => {
    const id = await firSalvato()
    expect((await carica(id)).getVersione()).toBe((await riga(id)).versione)
  })

  it('firma riuscita: una riga in fir_signatures, versione +1 anche sull aggregate', async () => {
    const id = await firSalvato()
    const rigaPrima = await riga(id)
    const prima = rigaPrima.versione
    const fir = await carica(id)
    firma(fir)

    await nelTenant(() => repoFirme.save(fir))

    expect(await firmeSul(id)).toHaveLength(1)
    expect((await riga(id)).versione).toBe(prima + 1)
    expect(fir.getVersione()).toBe(prima + 1)
    // L'UPDATE raw della versione aggiorna anche updated_at (Prisma non lo fa per le query raw).
    expect((await riga(id)).updatedAt.getTime()).toBeGreaterThan(rigaPrima.updatedAt.getTime())
  })

  it('firma su una copia letta prima del save di un altra copia: conflitto 409, nessuna firma', async () => {
    const id = await firSalvato()
    const copiaFirma = await carica(id)
    // Un'altra scrittura (qui un save del lifecycle, che incrementa la versione) arriva dopo la lettura.
    const lifecycle = (await nelTenant(() => repoFir.findById(id)))!
    await nelTenant(() => repoFir.save(lifecycle, { verificaVersione: true }))
    const versioneDb = (await riga(id)).versione

    firma(copiaFirma)
    const esito = await nelTenant(() => repoFirme.save(copiaFirma)).catch(e => e)

    expect(esito).toBeInstanceOf(FirModificatoNelFrattempoError)
    expect(await firmeSul(id)).toHaveLength(0)
    expect((await riga(id)).versione).toBe(versioneDb)

    // Il filtro reale lo trasforma in 409 FIR_MODIFICATO_NEL_FRATTEMPO (non 400, non 500).
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: `/api/v1/fir/${id}/sign`, user: { id: userId } }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost
    new HttpExceptionFilter(logger).catch(esito, host)
    expect(response.status).toHaveBeenCalledWith(409)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, error: 'FIR_MODIFICATO_NEL_FRATTEMPO' })
    )
  })

  it('idempotenza: due save concorrenti della stessa firma, una riga sola e un solo incremento', async () => {
    const id = await firSalvato()
    const prima = (await riga(id)).versione
    const a = await carica(id)
    const b = await carica(id)
    firma(a)
    firma(b)

    // Hold-and-release: il proprietario tiene il lock della riga (FOR NO KEY UPDATE, senza
    // scrivere) finche' entrambi i save sono partiti. Cosi' la sovrapposizione e' certa e non
    // dipende dalla velocita' della macchina: il lock e' l'unica difesa contro le firme doppie per
    // ruolo (non esiste un unique (fir_id, role)).
    let rilascia!: () => void
    const via = new Promise<void>(r => (rilascia = r))
    let lockPreso!: () => void
    const lockPronto = new Promise<void>(r => (lockPreso = r))
    const transazioneA = owner.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT versione FROM firs WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR NO KEY UPDATE`
        lockPreso()
        await via
      },
      { timeout: 20_000 }
    )
    await lockPronto

    const esiti: string[] = []
    const tracciato = (p: Promise<unknown>, nome: string): Promise<void> =>
      p.then(
        () => void esiti.push(`${nome}:riuscito`),
        () => void esiti.push(`${nome}:fallito`)
      )
    const saveA = tracciato(
      nelTenant(() => repoFirme.save(a)),
      'a'
    )
    const saveB = tracciato(
      nelTenant(() => repoFirme.save(b)),
      'b'
    )
    await new Promise(r => setTimeout(r, 500))
    expect(esiti).toEqual([]) // entrambi in attesa del lock del proprietario
    expect(await firmeSul(id)).toHaveLength(0)

    rilascia()
    await transazioneA
    await Promise.all([saveA, saveB])

    // Il perdente trova la firma gia' presente DOPO il lock: no-op, non un conflitto.
    expect([...esiti].sort()).toEqual(['a:riuscito', 'b:riuscito'])
    expect(await firmeSul(id)).toHaveLength(1)
    expect((await riga(id)).versione).toBe(prima + 1)
  })

  it('un nuovo save della firma gia presente e un no-op: nessuna scrittura, nessun incremento', async () => {
    const id = await firSalvato()
    const fir = await carica(id)
    firma(fir)
    await nelTenant(() => repoFirme.save(fir))
    const dopo = (await riga(id)).versione

    await nelTenant(() => repoFirme.save(fir))

    expect(await firmeSul(id)).toHaveLength(1)
    expect((await riga(id)).versione).toBe(dopo)
  })

  it('firmatario non presente nel tenant: SIGNER_NOT_PROVISIONED, nessuna firma, versione invariata', async () => {
    const id = await firSalvato()
    const prima = (await riga(id)).versione
    const fir = await carica(id)
    firma(fir, 'PRODUCER', 'VRDLGI85M01F205X')

    await expect(nelTenant(() => repoFirme.save(fir))).rejects.toMatchObject({
      message: expect.stringContaining('SIGNER_NOT_PROVISIONED'),
    })
    expect(await firmeSul(id)).toHaveLength(0)
    expect((await riga(id)).versione).toBe(prima)
  })
})
