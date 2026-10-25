/**
 * Privacy della verifica firme (GDPR).
 *
 * `GET /fir/:id/verify` è pubblico ed enumerabile per id: la risposta deve
 * essere ANONIMA. Codice fiscale e nome dei firmatari sono dati personali e
 * vanno esposti solo sull'endpoint autenticato, previa verifica del tenant.
 * Stesso principio del servizio pubblico RENTRI `GET /verifica/{numero_fir}`,
 * che restituisce esistenza e validità, non l'anagrafica delle parti.
 */

import { VerifySignaturesUseCase } from './verify-signatures.use-case'
import { TenantContext } from '../../core/context/tenant-context'

const TENANT = 'tenant-1'
const ALTRO_TENANT = 'tenant-2'
const FIR_ID = '22222222-2222-4222-8222-222222222222'

function fakeSignature() {
  return {
    getVerificationInfo: () => ({
      role: 'PRODUCER' as const,
      signerFiscalCode: 'MNZGZN78A01F839X',
      signerName: 'Graziano Manzo',
      signedAt: new Date('2026-03-01T10:00:00Z'),
      signatureMethod: 'ECDSA-SHA256',
      certificateHash: 'c'.repeat(64),
      documentHash: 'd'.repeat(64),
      hasTimestamp: false,
    }),
    getDocumentHash: () => 'd'.repeat(64),
    getSignatureValue: () => 'c2ln',
    getPublicKey: () => 'pk',
  }
}

function buildUseCase(tenantIdDelFir = TENANT) {
  const fir = {
    getId: () => FIR_ID,
    getFirNumber: () => 'FIR-2026-0001',
    getTenantId: () => tenantIdDelFir,
    toSignableDocument: () => ({ id: FIR_ID }),
    getSignatures: () => [fakeSignature()],
    isImmutable: () => false,
  }
  const contestiVisti: Array<string | null> = []
  const firRepository = {
    findByIdPublic: jest.fn().mockResolvedValue(fir),
    findById: jest.fn().mockImplementation(async () => {
      contestiVisti.push(TenantContext.getStoreTenantId())
      return fir
    }),
  }
  const signatureService = {
    hashDocument: jest.fn().mockReturnValue('d'.repeat(64)),
    verify: jest.fn().mockResolvedValue(true),
  }
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  const useCase = new VerifySignaturesUseCase(
    firRepository as any,
    signatureService as any,
    logger as any
  )
  return Object.assign(useCase, { doppi: firRepository, contestiVisti })
}

describe('VerifySignaturesUseCase — privacy', () => {
  it('la verifica pubblica NON espone codice fiscale e nome', async () => {
    const useCase = buildUseCase()

    const result = await useCase.execute({ firId: FIR_ID })

    expect(result.signatures).toHaveLength(1)
    expect(result.signatures[0].signerFiscalCode).toBeUndefined()
    expect(result.signatures[0].signerName).toBeUndefined()

    // Nessun dato personale deve comparire nemmeno serializzando l'intera risposta.
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('MNZGZN78A01F839X')
    expect(serialized).not.toContain('Graziano Manzo')
  })

  it('la verifica pubblica restituisce comunque esito e integrità', async () => {
    const useCase = buildUseCase()

    const result = await useCase.execute({ firId: FIR_ID })

    expect(result.allValid).toBe(true)
    expect(result.signatureCount).toBe(1)
    expect(result.signatures[0].role).toBe('PRODUCER')
    expect(result.signatures[0].isValid).toBe(true)
  })

  it('espone i dati personali solo al tenant proprietario', async () => {
    const useCase = buildUseCase()

    const result = await useCase.execute({
      firId: FIR_ID,
      tenantId: TENANT,
      disclosePersonalData: true,
    })

    expect(result.signatures[0].signerFiscalCode).toBe('MNZGZN78A01F839X')
    expect(result.signatures[0].signerName).toBe('Graziano Manzo')
  })

  it('risponde NOT_FOUND se il FIR appartiene a un altro tenant', async () => {
    const useCase = buildUseCase(ALTRO_TENANT)

    // NOT_FOUND e non FORBIDDEN: un 403 confermerebbe l'esistenza dell'id altrui.
    await expect(
      useCase.execute({ firId: FIR_ID, tenantId: TENANT, disclosePersonalData: true })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it("verify/dettaglio con azienda: lettura dal client normale nel contesto dell'azienda", async () => {
    const useCase = buildUseCase()

    await useCase.execute({ firId: FIR_ID, tenantId: TENANT, disclosePersonalData: true })

    expect(useCase.doppi.findById).toHaveBeenCalledWith(FIR_ID)
    expect(useCase.doppi.findByIdPublic).not.toHaveBeenCalled()
    expect(useCase.contestiVisti).toEqual([TENANT])
  })

  it('verify pubblica senza azienda: client di sistema', async () => {
    const useCase = buildUseCase()

    await useCase.execute({ firId: FIR_ID })

    expect(useCase.doppi.findByIdPublic).toHaveBeenCalledWith(FIR_ID)
    expect(useCase.doppi.findById).not.toHaveBeenCalled()
  })

  it('rifiuta la disclosure senza contesto tenant', async () => {
    const useCase = buildUseCase()

    await expect(useCase.execute({ firId: FIR_ID, disclosePersonalData: true })).rejects.toThrow(
      /tenantId/
    )
  })
})
