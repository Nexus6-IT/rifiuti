/**
 * Gara persa dall'invio contro l'annullo (4.5d, M1): il trigger rifiuta l'INSERT della trasmissione di un
 * documento annullato; `accodaUno` lo traduce in un documento «saltato» (NON_DEFINITIVO), non in un 500.
 * Prova con una transazione finta: il test Postgres della gara sta in `annullo-scartato.postgres.spec.ts`.
 */
import { InvioSdiService } from './invio-sdi.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const D = 'bbbbbbbb-0000-4000-8000-000000000002'
const U = 'cccccccc-0000-4000-8000-000000000003'

function servizio(errore: Error): InvioSdiService {
  const prisma = { $transaction: jest.fn().mockRejectedValue(errore) }
  const xml = {
    xml: jest.fn().mockResolvedValue({ nomeFile: 'IT1_00001.xml', sha256: 'a'.repeat(64) }),
  }
  return new InvioSdiService(prisma as never, {} as never, {} as never, xml as never)
}

const chiama = (s: InvioSdiService) =>
  (
    s as unknown as {
      accodaUno: (...a: unknown[]) => Promise<unknown>
    }
  ).accodaUno(
    T,
    U,
    D,
    { provider: 'fake', ambiente: 'SANDBOX' },
    { tipoDocumento: 'TD01', dataDocumento: '2026-03-15' },
    '2026-03-20'
  )

describe('InvioSdiService.accodaUno: gara persa contro l annullo', () => {
  it('errore del trigger «documento annullato»: saltato con NON_DEFINITIVO', async () => {
    const s = servizio(
      new Error(
        'Raw query failed. Code: `23000`. Message: `ERROR: un documento annullato non si invia allo SDI (documento x)`'
      )
    )
    await expect(chiama(s)).resolves.toEqual({ motivo: 'NON_DEFINITIVO' })
  })

  it('un altro errore non viene inghiottito', async () => {
    const s = servizio(new Error('connessione persa'))
    await expect(chiama(s)).rejects.toThrow('connessione persa')
  })
})
