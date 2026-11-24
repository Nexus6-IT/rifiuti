/**
 * FIR in viaggio P2 (review-finale C1): un FIR EMESSO e FIRMATO dal produttore, poi `/quantita` e
 * `/trasporto` (use case reale, repository reale, ente finto): il documento firmato
 * (`toSignableDocument()`) e il suo hash restano identici e la verifica delle firme da' ancora valida la
 * firma del produttore. Piu': la fusione del JSON dichiarato e' atomica (due invii concorrenti, nessuna
 * chiave persa).
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
import { DatiViaggioFirRepository } from '../../infrastructure/persistence/dati-viaggio-fir.repository'
import { SignatureFIRRepository } from '../../infrastructure/signatures/signature-fir.repository'
import { FIR, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { DigitalSignatureService } from '../signatures/digital-signature.service'
import { VerifySignaturesUseCase } from '../signatures/verify-signatures.use-case'
import { EmettiFIRUseCase } from '../fir/use-cases/emetti-fir.use-case'
import { EmettiFIRCommand } from '../fir/commands/emetti-fir.command'
import { InviaDatiViaggioFirRentriUseCase } from './invia-dati-viaggio-fir-rentri.use-case'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'

describe('FIR in viaggio P2 — le firme locali restano valide dopo quantita e trasporto (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let dati: DatiViaggioFirRepository
  let cripto: SignatureFIRRepository
  let firma: DigitalSignatureService
  let emetti: EmettiFIRUseCase
  let verifica: VerifySignaturesUseCase
  let tenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-8)
  const NUMERO_FIR = 'BCDFGH00060ZD'

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
    dati = new DatiViaggioFirRepository(app)
    cripto = new SignatureFIRRepository(app, sistema, logger())
    firma = new DigitalSignatureService(logger())
    const rentri = { eseguiSeAutomatica: jest.fn().mockResolvedValue(undefined) } as any
    emetti = new EmettiFIRUseCase(repo, cripto, firma, rentri, logger())
    verifica = new VerifySignaturesUseCase(cripto, firma, logger())

    tenantId = (
      await owner.tenant.create({
        data: { partitaIva: `VF${sfx}`.slice(0, 11), ragioneSociale: `Viaggio firma ${sfx}` },
      })
    ).id
    userId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-viaggio-firma-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `viaggio-firma-${sfx}@example.it`,
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

  async function firEmessoELegato(numeroFir: string): Promise<string> {
    const fir = FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '150101', quantita: 1.2 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId: userId,
      tipoTrattaPrincipale: TipoTratta.TERRESTRE,
    })
    await nelTenant(() => repo.save(fir))
    const r = await nelTenant(() =>
      emetti.execute(new EmettiFIRCommand(fir.id, userId, 'Mario Rossi'))
    )
    if (!r.isSuccess) throw new Error(`emissione fallita: ${String(r.error)}`)
    await owner.fIR.update({ where: { id: fir.id }, data: { rentriNumeroFir: numeroFir } })
    return fir.id
  }

  function useCaseViaggio(sessioni = new SessioniFirmaRentriInMemoria()) {
    const client = {
      inviaQuantita: jest.fn().mockResolvedValue({ errore: false, validazione: [] }),
      inviaTrasporto: jest.fn().mockResolvedValue({ errore: false, validazione: [] }),
      leggiStato: jest.fn().mockResolvedValue({
        versione: 2,
        stato_formulario: 'FirmaProduttoreTrasportatoreIniziale',
      }),
    }
    const getAzioni = {
      execute: jest.fn().mockResolvedValue({
        azioni: ['DatiQuantitaUpdate', 'TrasportoUpdate'].map(operazione => ({ operazione })),
      }),
    }
    return new InviaDatiViaggioFirRentriUseCase(
      repo,
      getAzioni as any,
      client as any,
      dati,
      new EventiFirRentriInMemoria(),
      logger(),
      sessioni
    )
  }

  const documentoFirmabile = async (firId: string) => {
    const c = await nelTenant(() => cripto.findById(firId))
    const doc = c!.toSignableDocument()
    return { doc, hash: firma.hashDocument(doc) }
  }

  it('dopo /quantita e /trasporto il documento firmato e il suo hash sono identici e la firma del produttore resta valida', async () => {
    const firId = await firEmessoELegato(NUMERO_FIR)
    const prima = await documentoFirmabile(firId)
    const rPrima = await nelTenant(() => verifica.execute({ firId, tenantId }))
    expect(rPrima.signatureCount).toBeGreaterThanOrEqual(1)
    expect(rPrima.allValid).toBe(true)

    const uc = useCaseViaggio()
    // valori diversi su tutto cio' che potrebbe finire nel documento: unita', colli, targa
    await nelTenant(() =>
      uc.inviaQuantita({
        firId,
        tenantId,
        quantita: 1500,
        unitaMisura: 'kg',
        numeroColli: 9,
        utenteId: userId,
      })
    )
    await nelTenant(() =>
      uc.inviaTrasporto({
        firId,
        tenantId,
        conducenteNome: 'Luigi',
        conducenteCognome: 'Verdi',
        targaAutomezzo: 'ZZ999ZZ',
        targaRimorchio: 'XY987ZW',
        percorso: 'A1',
        utenteId: userId,
      })
    )

    const dopo = await documentoFirmabile(firId)
    expect(dopo.doc).toEqual(prima.doc)
    expect(dopo.hash).toBe(prima.hash)
    const rDopo = await nelTenant(() => verifica.execute({ firId, tenantId }))
    expect(rDopo.allValid).toBe(true)
    expect(rDopo.signatures.every(s => s.isValid)).toBe(true)
    // il dichiarato c'e', accanto al firmato
    const d = await nelTenant(() => dati.leggi(tenantId, firId))
    expect(d?.dichiarato).toEqual({
      quantita: { valore: 1500, unitaMisura: 'kg', numeroColli: 9 },
      trasporto: { targaAutomezzo: 'ZZ999ZZ' },
    })
  })

  it('M10: due invii concorrenti (quantita e trasporto) non si perdono a vicenda', async () => {
    const firId = await firEmessoELegato('BCDFGH00061ZD')
    await Promise.all([
      nelTenant(() =>
        dati.aggiornaQuantitaDopoEnte(tenantId, firId, {
          valore: 5,
          unitaMisura: 'kg',
          numeroColli: 1,
          rinfusa: false,
          verificatoInPartenza: null,
        })
      ),
      nelTenant(() =>
        dati.aggiornaTrasportoDopoEnte(tenantId, firId, {
          targaAutomezzo: 'AB123CD',
          conducenteNome: 'Mario',
          conducenteCognome: 'Rossi',
          targaRimorchio: null,
          percorso: null,
        })
      ),
    ])
    const d = await nelTenant(() => dati.leggi(tenantId, firId))
    expect(d?.dichiarato?.quantita?.valore).toBe(5)
    expect(d?.dichiarato?.trasporto?.targaAutomezzo).toBe('AB123CD')
  })
})
