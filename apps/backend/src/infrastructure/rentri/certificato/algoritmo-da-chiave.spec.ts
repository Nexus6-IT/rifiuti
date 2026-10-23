import * as fs from 'fs'
import * as path from 'path'
import * as forge from 'node-forge'
import {
  algoritmoDaChiave,
  algoritmoEffettivo,
  TipoChiaveNonSupportatoError,
} from './algoritmo-da-chiave'

const dir = path.resolve(__dirname, '../../../../../../tools/rentri-fake/test/fixture/ec')
const leggi = (nome: string): string => fs.readFileSync(path.join(dir, nome), 'utf8')

describe('algoritmoEffettivo', () => {
  const ec = leggi('operatore-test-ec.key')
  const rsa = forge.pki.privateKeyToPem(forge.pki.rsa.generateKeyPair(2048).privateKey)

  it("l'algoritmo e' sempre quello della chiave; discordante solo se la colonna differisce", () => {
    expect(algoritmoEffettivo(ec, 'ES256')).toEqual({ algoritmo: 'ES256', discordante: false })
    expect(algoritmoEffettivo(rsa, 'ES256')).toEqual({ algoritmo: 'RS256', discordante: true })
    expect(algoritmoEffettivo(ec, 'RS256')).toEqual({ algoritmo: 'ES256', discordante: true })
  })

  it('chiave non ricavabile: ripiega sul valore dichiarato (la firma fallira con messaggio esplicito)', () => {
    expect(algoritmoEffettivo('NON-UNA-CHIAVE', 'ES256')).toEqual({
      algoritmo: 'ES256',
      discordante: false,
    })
  })
})

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
