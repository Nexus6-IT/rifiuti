import type { PrismaSistemaService } from '../../../infrastructure/persistence/prisma-sistema.service'
import { RisoluzioneAgenteService } from './risoluzione-agente.service'

describe('RisoluzioneAgenteService', () => {
  const findUnique = jest.fn()
  const servizio = new RisoluzioneAgenteService({
    agentePesa: { findUnique },
  } as unknown as PrismaSistemaService)

  beforeEach(() => findUnique.mockReset())

  it('daToken: una sola findUnique per hash, selezionando solo id, azienda e stato', async () => {
    findUnique.mockResolvedValue({ id: 'a', tenantId: 't', stato: 'ATTIVO' })
    await expect(servizio.daToken('h'.repeat(64))).resolves.toEqual({
      id: 'a',
      tenantId: 't',
      stato: 'ATTIVO',
    })
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(findUnique).toHaveBeenCalledWith({
      where: { tokenSha256: 'h'.repeat(64) },
      select: { id: true, tenantId: true, stato: true },
    })
  })

  it('daCodice: stesso schema sul codice', async () => {
    findUnique.mockResolvedValue(null)
    await expect(servizio.daCodice('c'.repeat(64))).resolves.toBeNull()
    expect(findUnique).toHaveBeenCalledWith({
      where: { codiceSha256: 'c'.repeat(64) },
      select: { id: true, tenantId: true, stato: true },
    })
  })

  it('un errore del database si propaga (la decisione e del guard)', async () => {
    findUnique.mockRejectedValue(new Error('giu'))
    await expect(servizio.daToken('h'.repeat(64))).rejects.toThrow('giu')
  })
})
