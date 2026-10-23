import * as fs from 'fs'
import * as path from 'path'
import * as forge from 'node-forge'
import { loadRentriConfig } from './rentri-config'

const dirEc = path.resolve(__dirname, '../../../../../tools/rentri-fake/test/fixture/ec')
const chiaveEc = fs.readFileSync(path.join(dirEc, 'operatore-test-ec.key'), 'utf8')
const chiaveEc384 = fs.readFileSync(path.join(dirEc, 'operatore-test-ec384.key'), 'utf8')
const chiaveRsa = forge.pki.privateKeyToPem(forge.pki.rsa.generateKeyPair(2048).privateKey)

/** ConfigService minimale: legge da una mappa di variabili d'ambiente. */
const conEnv = (env: Record<string, string>) => ({ get: (k: string) => env[k] }) as any

describe('loadRentriConfig: algoritmo di firma', () => {
  it('RENTRI_JWT_ALG assente con chiave EC P-256: ricavato ES256 (non RS256 di ripiego)', () => {
    const cfg = loadRentriConfig(conEnv({ RENTRI_PRIVATE_KEY_PEM: chiaveEc }))

    expect(cfg.algorithm).toBe('ES256')
  })

  it('RENTRI_JWT_ALG assente con chiave RSA: RS256', () => {
    const cfg = loadRentriConfig(conEnv({ RENTRI_PRIVATE_KEY_PEM: chiaveRsa }))

    expect(cfg.algorithm).toBe('RS256')
  })

  it('RENTRI_JWT_ALG coerente con la chiave: accettata', () => {
    const cfg = loadRentriConfig(
      conEnv({ RENTRI_PRIVATE_KEY_PEM: chiaveEc, RENTRI_JWT_ALG: 'ES256' })
    )

    expect(cfg.algorithm).toBe('ES256')
  })

  it('RENTRI_JWT_ALG in contrasto con la chiave: errore esplicito alla configurazione', () => {
    expect(() =>
      loadRentriConfig(conEnv({ RENTRI_PRIVATE_KEY_PEM: chiaveRsa, RENTRI_JWT_ALG: 'ES256' }))
    ).toThrow(/RENTRI_JWT_ALG.*ES256.*RS256/)
  })

  it('chiave EC P-384: errore esplicito (tipo non supportato)', () => {
    expect(() => loadRentriConfig(conEnv({ RENTRI_PRIVATE_KEY_PEM: chiaveEc384 }))).toThrow(
      'Tipo di chiave non supportato da RENTRI: EC secp384r1'
    )
  })

  it('senza chiave privata: vale RENTRI_JWT_ALG, altrimenti RS256', () => {
    expect(loadRentriConfig(conEnv({ RENTRI_JWT_ALG: 'ES256' })).algorithm).toBe('ES256')
    expect(loadRentriConfig(conEnv({})).algorithm).toBe('RS256')
  })
})
