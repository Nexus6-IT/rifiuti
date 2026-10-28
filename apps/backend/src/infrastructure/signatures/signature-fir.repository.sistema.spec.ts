/**
 * Verifica pubblica FIR (QR code): la lettura avviene prima di conoscere
 * l'azienda del FIR, quindi passa dal client di sistema.
 */
import { SignatureFIRRepository } from './signature-fir.repository'

describe('SignatureFIRRepository.findByIdPublic', () => {
  it('verifica pubblica FIR: lettura dal client di sistema', async () => {
    const prisma: any = {
      fIR: {
        findUnique: jest.fn(() => {
          throw new Error('client applicativo: lettura pubblica non ammessa')
        }),
      },
    }
    const sistema: any = { fIR: { findUnique: jest.fn().mockResolvedValue(null) } }
    const logger: any = { setContext: jest.fn() }
    const repo = new SignatureFIRRepository(prisma, sistema, logger)

    const risultato = await repo.findByIdPublic('fir-1')

    expect(risultato).toBeNull()
    expect(sistema.fIR.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fir-1' } })
    )
    expect(prisma.fIR.findUnique).not.toHaveBeenCalled()
  })
})
