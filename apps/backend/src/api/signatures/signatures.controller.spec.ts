import { BadRequestException, NotFoundException } from '@nestjs/common'
import { SignaturesController } from './signatures.controller'
import { ApplySignatureUseCase } from '../../application/signatures/apply-signature.use-case'
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * SignaturesController — test dell'endpoint pubblico GET /fir/:firId/verify.
 *
 * Copre la rifinitura: un id inesistente/non valido deve tradursi in 404/400
 * (non 500). Il use-case lancia una DomainException NOT_FOUND che il filtro
 * globale mapperebbe a 500 senza il mapping esplicito del controller.
 *
 * Il controller è istanziato direttamente con dei mock per evitare che il
 * TestingModule provi a risolvere i guard (JwtAuthGuard/SpidLevelGuard) e le
 * loro dipendenze — irrilevanti per l'endpoint pubblico di verifica.
 */
describe('SignaturesController — verify', () => {
  let controller: SignaturesController
  let verifyUseCase: { execute: jest.Mock }

  const VALID_UUID = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    verifyUseCase = { execute: jest.fn() }
    controller = new SignaturesController(
      { execute: jest.fn() } as unknown as ApplySignatureUseCase,
      verifyUseCase as unknown as VerifySignaturesUseCase
    )
  })

  it('restituisce il report se il FIR esiste', async () => {
    const report = { firId: VALID_UUID, allValid: true } as any
    verifyUseCase.execute.mockResolvedValue(report)

    await expect(controller.verifySignatures(VALID_UUID)).resolves.toBe(report)
    expect(verifyUseCase.execute).toHaveBeenCalledWith({ firId: VALID_UUID })
  })

  it('lancia 400 BadRequest se l’id è malformato (non UUID)', async () => {
    await expect(controller.verifySignatures('non-un-uuid')).rejects.toBeInstanceOf(
      BadRequestException
    )
    // Non deve nemmeno interrogare il use-case / il DB.
    expect(verifyUseCase.execute).not.toHaveBeenCalled()
  })

  it('lancia 404 NotFound se il FIR non esiste (DomainException NOT_FOUND → 404, non 500)', async () => {
    verifyUseCase.execute.mockRejectedValue(DomainException.notFound('FIR', VALID_UUID))

    await expect(controller.verifySignatures(VALID_UUID)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('ripropaga gli errori non-NOT_FOUND senza mascherarli', async () => {
    const boom = new Error('errore inatteso')
    verifyUseCase.execute.mockRejectedValue(boom)

    await expect(controller.verifySignatures(VALID_UUID)).rejects.toBe(boom)
  })
})
