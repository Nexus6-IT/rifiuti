/**
 * Validazioni delle azioni sul registro che scattano PRIMA di toccare il database: il prisma finto
 * lancia se viene usato, quindi un test verde prova che nulla e' stato letto o scritto.
 */
import { AccodaTrasmissioneRentriUseCase } from './accoda-trasmissione-rentri.use-case'
import {
  IdentificativoRegistroNonValidoError,
  RichiestaTrasmissioneNonValidaError,
  RuoloNonAutorizzatoRentriError,
} from './errori-azioni-rentri-registro'
import { ImpostazioniRentriRegistroService } from './impostazioni-rentri-registro.service'

const logger: any = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn() }
const prismaChePrende: any = new Proxy(
  {},
  {
    get() {
      throw new Error('il database non doveva essere toccato')
    },
  }
)
const T = '00000000-0000-4000-8000-000000000001'
const U = '00000000-0000-4000-8000-000000000002'
const R = '00000000-0000-4000-8000-000000000003'

describe('AccodaTrasmissioneRentriUseCase — controlli preliminari', () => {
  const uc = new AccodaTrasmissioneRentriUseCase(prismaChePrende, logger)

  it("accoda: nessun id o piu' di 1000: 400", async () => {
    await expect(uc.accoda(T, U, R, [])).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
    const troppi = Array.from({ length: 1001 }, (_, i) => `id-${i}`)
    await expect(uc.accoda(T, U, R, troppi)).rejects.toBeInstanceOf(
      RichiestaTrasmissioneNonValidaError
    )
  })

  it('accodaStorico: senza conferma o con anno assurdo: 400', async () => {
    await expect(uc.accodaStorico(T, U, R, 2026, false)).rejects.toBeInstanceOf(
      RichiestaTrasmissioneNonValidaError
    )
    await expect(uc.accodaStorico(T, U, R, 26, true)).rejects.toBeInstanceOf(
      RichiestaTrasmissioneNonValidaError
    )
  })

  it('dichiaraGiaSuRentri: ruolo, intervallo e motivo', async () => {
    await expect(uc.dichiaraGiaSuRentri(T, U, 'VIEWER', R, 2026, 1, 2, 'm')).rejects.toBeInstanceOf(
      RuoloNonAutorizzatoRentriError
    )
    await expect(uc.dichiaraGiaSuRentri(T, U, 'ADMIN', R, 2026, 5, 2, 'm')).rejects.toBeInstanceOf(
      RichiestaTrasmissioneNonValidaError
    )
    await expect(
      uc.dichiaraGiaSuRentri(T, U, 'ADMIN', R, 2026, 1, 10_001, 'm')
    ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
    await expect(
      uc.dichiaraGiaSuRentri(T, U, 'ADMIN', R, 2026, 1, 10_000, '')
    ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
  })
})

describe('ImpostazioniRentriRegistroService — controlli preliminari', () => {
  const s = new ImpostazioniRentriRegistroService(prismaChePrende, {} as any, logger)

  it('formato errato: 400, in qualunque forma', async () => {
    for (const x of ['abc', 'R123', 'X0123456789', 'RABCDE1234!', 'RABCDE123456']) {
      await expect(s.imposta(T, U, 'ADMIN', R, { identificativoRentri: x })).rejects.toBeInstanceOf(
        IdentificativoRegistroNonValidoError
      )
    }
  })

  it('operatore e consultazione non configurano nulla', async () => {
    for (const ruolo of ['OPERATOR', 'VIEWER', 'CONSULTANT', '']) {
      await expect(
        s.imposta(T, U, ruolo, R, { identificativoRentri: 'RABCDE12345' })
      ).rejects.toBeInstanceOf(RuoloNonAutorizzatoRentriError)
    }
  })

  it('allineamento: anno non valido: 400', async () => {
    await expect(s.allineamento(T, R, 1)).rejects.toBeInstanceOf(
      RichiestaTrasmissioneNonValidaError
    )
  })
})
