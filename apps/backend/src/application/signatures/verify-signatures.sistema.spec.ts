/**
 * Verifica pubblica (senza token, senza tenant): use case + repository reale.
 * La lettura passa dal client di sistema; quello applicativo non e' ammesso.
 */
import { VerifySignaturesUseCase } from './verify-signatures.use-case'
import { SignatureFIRRepository } from '../../infrastructure/signatures/signature-fir.repository'

const FIR_ID = '22222222-2222-4222-8222-222222222222'

describe('VerifySignaturesUseCase — accesso pubblico dal client di sistema', () => {
  it('verifica pubblica senza tenantId: trova il FIR dal client di sistema', async () => {
    const prisma: any = {
      fIR: {
        findUnique: jest.fn(() => {
          throw new Error('client applicativo: lettura pubblica non ammessa')
        }),
      },
    }
    const sistema: any = {
      fIR: { findUnique: jest.fn().mockResolvedValue({ id: FIR_ID, signatures: [] }) },
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const repo = new SignatureFIRRepository(prisma, sistema, logger)
    jest.spyOn(repo as any, 'toDomain').mockReturnValue({
      getId: () => FIR_ID,
      getFirNumber: () => 'FIR-1',
      getTenantId: () => 'tenant-qualsiasi',
      toSignableDocument: () => ({ id: FIR_ID }),
      getSignatures: () => [],
      isImmutable: () => false,
    })
    const signatureService: any = { hashDocument: jest.fn().mockReturnValue('d'.repeat(64)) }
    const useCase = new VerifySignaturesUseCase(repo as any, signatureService, logger)

    const result = await useCase.execute({ firId: FIR_ID })

    expect(sistema.fIR.findUnique).toHaveBeenCalledTimes(1)
    expect(prisma.fIR.findUnique).not.toHaveBeenCalled()
    expect(result.signatureCount).toBe(0)
  })
})
