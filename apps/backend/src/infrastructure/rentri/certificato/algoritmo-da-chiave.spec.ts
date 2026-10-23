import * as fs from 'fs'
import * as path from 'path'
import * as forge from 'node-forge'
import { algoritmoDaChiave, TipoChiaveNonSupportatoError } from './algoritmo-da-chiave'

const dir = path.resolve(__dirname, '../../../../../../tools/rentri-fake/test/fixture/ec')
const leggi = (nome: string): string => fs.readFileSync(path.join(dir, nome), 'utf8')

describe('algoritmoDaChiave', () => {
  it('algoritmoDaChiave: EC P-256 → ES256, RSA → RS256, P-384 → TipoChiaveNonSupportatoError', () => {
    expect(algoritmoDaChiave(leggi('operatore-test-ec.key'))).toBe('ES256')

    const rsa = forge.pki.privateKeyToPem(forge.pki.rsa.generateKeyPair(2048).privateKey)
    expect(algoritmoDaChiave(rsa)).toBe('RS256')

    const p384 = leggi('operatore-test-ec384.key')
    expect(() => algoritmoDaChiave(p384)).toThrow(TipoChiaveNonSupportatoError)
    expect(() => algoritmoDaChiave(p384)).toThrow(
      'Tipo di chiave non supportato da RENTRI: EC secp384r1'
    )
  })
})
