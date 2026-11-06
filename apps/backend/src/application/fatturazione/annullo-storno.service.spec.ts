import { HttpException } from '@nestjs/common'
import { AnnulloStornoService } from './annullo-storno.service'
import { DocumentiFatturaService } from './documenti-fattura.service'

describe('AnnulloStornoService (validazioni, senza database)', () => {
  const transaction = jest.fn()
  const prisma = { $transaction: transaction } as never
  const service = new AnnulloStornoService(prisma, new DocumentiFatturaService(prisma))
  service.orologio = () => new Date('2026-05-01T10:00:00Z')
  const ID = '11111111-1111-4111-8111-111111111111'

  const codice = async (p: Promise<unknown>) => {
    try {
      await p
      return 'ok'
    } catch (e) {
      if (e instanceof HttpException) {
        return `${e.getStatus()} ${(e.getResponse() as { error: string }).error}`
      }
      throw e
    }
  }
  const storno = (o: Record<string, unknown> = {}) => ({
    motivo: 'reso',
    dataDocumento: '2026-04-20',
    rifatturabile: true,
    versione: 1,
    ...o,
  })

  afterEach(() => expect(transaction).not.toHaveBeenCalled())

  it.each([
    ['', 'MOTIVO_NON_VALIDO'],
    ['   ', 'MOTIVO_NON_VALIDO'],
    ['x'.repeat(201), 'MOTIVO_NON_VALIDO'],
  ])('annullo con motivo %j: 400 prima di aprire la transazione', async (motivo, atteso) => {
    expect(await codice(service.annulla('t', 'u', ID, { motivo, versione: 1 }))).toBe(
      `400 ${atteso}`
    )
  })

  it.each([0, -1, 1.5, Number.NaN])('annullo con versione %s: 400', async versione => {
    expect(await codice(service.annulla('t', 'u', ID, { motivo: 'm', versione }))).toBe(
      '400 VERSIONE_NON_VALIDA'
    )
  })

  it('annullo con id non UUID: 404', async () => {
    expect(await codice(service.annulla('t', 'u', 'abc', { motivo: 'm', versione: 1 }))).toBe(
      '404 DOCUMENTO_NON_TROVATO'
    )
  })

  it.each([
    [{ motivo: '' }, '400 MOTIVO_NON_VALIDO'],
    [{ versione: 0 }, '400 VERSIONE_NON_VALIDA'],
    [{ dataDocumento: '2026-02-30' }, '400 DATA_NON_VALIDA'],
    [{ dataDocumento: '2026-05-02' }, '400 DATA_FUTURA'],
    [{ rifatturabile: 'si' }, '400 RIFATTURABILE_NON_VALIDO'],
  ])('storno con %j: %s', async (variante, atteso) => {
    expect(await codice(service.storna('t', 'u', ID, storno(variante) as never))).toBe(atteso)
  })

  it('storno: a cavallo di mezzanotte il giorno è quello italiano', async () => {
    // 23:30 UTC del 30/04 sono già le 01:30 del 01/05 in Italia: il 1° maggio non è futuro.
    service.orologio = () => new Date('2026-04-30T23:30:00Z')
    transaction.mockRejectedValueOnce(new Error('apertura'))
    await expect(
      service.storna('t', 'u', ID, storno({ dataDocumento: '2026-05-01' }))
    ).rejects.toThrow('apertura')
    expect(
      await codice(service.storna('t', 'u', ID, storno({ dataDocumento: '2026-05-02' })))
    ).toBe('400 DATA_FUTURA')
    service.orologio = () => new Date('2026-05-01T10:00:00Z')
    transaction.mockClear()
  })
})
