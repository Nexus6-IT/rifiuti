/**
 * Difesa dei servizi di lista (giro 1 del Task 25a, I1): una `pagina` oltre il limite esce con
 * l'errore di dominio 400 `PAGINAZIONE_NON_VALIDA`, mai con l'`integer out of range` di Postgres
 * (OFFSET fuori dall'int). Senza database: la transazione non deve nemmeno aprirsi.
 */
import { HttpException } from '@nestjs/common'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { ElaborazioniService } from './elaborazioni.service'
import { ScostamentiService } from './scostamenti.service'

const OLTRE = 100_001
const transaction = jest.fn()
const prisma = { $transaction: transaction, $queryRaw: jest.fn() } as never

async function codice(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof HttpException
      ? `${e.getStatus()} ${(e.getResponse() as { error: string }).error}`
      : `Error: ${(e as Error).message}`
  }
}

describe('pagina oltre il limite: errore di dominio, non di Postgres', () => {
  beforeEach(() => transaction.mockReset())
  afterEach(() => expect(transaction).not.toHaveBeenCalled())

  it('documenti', async () => {
    const s = new DocumentiFatturaService(prisma)
    expect(await codice(s.lista('t', { pagina: OLTRE, dimensione: 100 }))).toBe(
      '400 PAGINAZIONE_NON_VALIDA'
    )
  })

  it('elaborazioni', async () => {
    const s = new ElaborazioniService(prisma, new DocumentiFatturaService(prisma), {} as never)
    expect(await codice(s.lista('t', { pagina: OLTRE, dimensione: 100 }))).toBe(
      '400 PAGINAZIONE_NON_VALIDA'
    )
  })

  it('scostamenti', async () => {
    const s = new ScostamentiService(prisma)
    expect(await codice(s.lista('t', { pagina: OLTRE, dimensione: 100 }))).toBe(
      '400 PAGINAZIONE_NON_VALIDA'
    )
  })
})
