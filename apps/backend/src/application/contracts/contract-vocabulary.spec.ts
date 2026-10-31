import { readFileSync } from 'fs'
import { resolve } from 'path'
import { CAMPI_MODIFICABILI } from '../../domain/contracts/regole-contratto'
import { PAYMENT_TERMS, BILLING_FREQUENCIES } from './contract-vocabulary'

/**
 * I codici ammessi vivono in due file: qui (validazione in scrittura) e nel
 * gemello frontend (etichette italiane mostrate all'operatore). Il repo non ha
 * ancora librerie condivise fra backend e frontend, quindi il disallineamento
 * — un codice validabile ma senza etichetta, o un'opzione offerta nella tendina
 * e poi rifiutata dall'API con un 400 — non lo intercetta il compilatore.
 *
 * Lo intercetta questo test, leggendo il file frontend come testo.
 */
describe('vocabolari del contratto — allineamento backend/frontend', () => {
  const sorgenteFrontend = readFileSync(
    resolve(__dirname, '../../../../frontend/src/app/features/contracts/contract-vocabulary.ts'),
    'utf8'
  )

  /** Estrae le chiavi di una mappa `export const NOME: Record<...> = { ... }`. */
  const chiaviDi = (nomeMappa: string): string[] => {
    const blocco = new RegExp(`export const ${nomeMappa}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(
      sorgenteFrontend
    )
    if (!blocco) throw new Error(`Mappa ${nomeMappa} non trovata nel file frontend`)
    return [...blocco[1].matchAll(/^\s{2}([a-z_0-9]+):/gm)].map(m => m[1])
  }

  it("ogni termine di pagamento accettato dall'API ha un'etichetta nel frontend", () => {
    expect(chiaviDi('PAYMENT_TERM_LABELS').sort()).toEqual([...PAYMENT_TERMS].sort())
  })

  it("ogni frequenza di fatturazione accettata dall'API ha un'etichetta nel frontend", () => {
    expect(chiaviDi('BILLING_FREQUENCY_LABELS').sort()).toEqual([...BILLING_FREQUENCIES].sort())
  })

  it('i campi modificabili del frontend (CAMPI_CONTRATTO) coincidono con quelli del dominio', () => {
    const servizio = readFileSync(
      resolve(__dirname, '../../../../frontend/src/app/features/contracts/contracts.service.ts'),
      'utf8'
    )
    const blocco = /export const CAMPI_CONTRATTO = \[([\s\S]*?)\] as const/.exec(servizio)
    if (!blocco) throw new Error('CAMPI_CONTRATTO non trovato nel file frontend')
    const campiFrontend = [...blocco[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1])
    expect([...campiFrontend].sort()).toEqual([...CAMPI_MODIFICABILI.DRAFT].sort())
  })
})
