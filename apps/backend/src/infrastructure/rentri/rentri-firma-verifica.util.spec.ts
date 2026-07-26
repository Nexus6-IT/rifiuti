import { createSign } from 'node:crypto'
import { verificaFirmaLocale } from './rentri-firma-verifica.util'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  emettiCertificatoAccreditato,
} = require('../../../../../tools/rentri-fake/src/auth/ca-test')

/**
 * R3 Task 3 — `verificaFirmaLocale`.
 *
 * Verifica CHE COSA la funzione sa fare davvero, non che "restituisce true":
 * una firma valida sul digest giusto passa, una firma valida su un digest
 * DIVERSO no. Quest'ultimo è il caso che conta: è la sostituzione del
 * documento firmato, l'unico attacco che questo controllo intercetterebbe.
 *
 * Il materiale crittografico è quello della CA di prova della fake — l'unica
 * fonte di certificati X.509 già presente nel progetto (nessuna dipendenza
 * nuova).
 *
 * NB: il limite dichiarato nel commento della funzione (verifica con
 * ri-hashing invece che prehash, quindi non equivalente all'operazione reale
 * dell'HSM RENTRI) resta: qui si firma con la stessa convenzione con cui si
 * verifica, quindi la corrispondenza dimostra che la funzione è corretta
 * rispetto a SE STESSA, non che coincida con l'algoritmo dell'ente.
 */
describe('verificaFirmaLocale', () => {
  const materiale = emettiCertificatoAccreditato('CREDENZIALE-FIRMA-REMOTA-TEST')
  const digest = Buffer.from('digest-del-formulario').toString('base64')

  function firma(digestBase64: string): string {
    const firmatore = createSign('sha256')
    firmatore.update(Buffer.from(digestBase64, 'base64'))
    firmatore.end()
    return firmatore.sign(materiale.chiavePrivataPem, 'base64')
  }

  it('accetta una firma valida apposta sul digest indicato', () => {
    expect(verificaFirmaLocale(materiale.certificatoBase64Der, digest, firma(digest))).toBe(true)
  })

  it('rifiuta una firma valida ma apposta su un digest DIVERSO (documento sostituito)', () => {
    const altroDigest = Buffer.from('digest-di-un-altro-formulario').toString('base64')

    expect(verificaFirmaLocale(materiale.certificatoBase64Der, digest, firma(altroDigest))).toBe(
      false
    )
  })

  it('rifiuta una firma apposta con la chiave di un’ALTRA credenziale', () => {
    const altroMateriale = emettiCertificatoAccreditato('ALTRA-CREDENZIALE')
    const firmatore = createSign('sha256')
    firmatore.update(Buffer.from(digest, 'base64'))
    firmatore.end()
    const firmaAltrui = firmatore.sign(altroMateriale.chiavePrivataPem, 'base64')

    expect(verificaFirmaLocale(materiale.certificatoBase64Der, digest, firmaAltrui)).toBe(false)
  })

  it('restituisce false (mai un’eccezione) su input illeggibili — non deve poter far fallire l’operazione', () => {
    expect(verificaFirmaLocale('non-un-certificato', digest, firma(digest))).toBe(false)
    expect(verificaFirmaLocale(materiale.certificatoBase64Der, digest, '')).toBe(false)
    expect(verificaFirmaLocale('', '', '')).toBe(false)
  })
})
