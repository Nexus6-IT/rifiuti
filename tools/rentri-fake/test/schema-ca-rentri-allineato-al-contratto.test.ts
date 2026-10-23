import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import {
  SCHEMA_CA_RENTRI_AUTHORIZE,
  DEFINIZIONI_CA_RENTRI_AUTHORIZE,
} from '../src/dominio/schema-ca-rentri-authorize'
import {
  SCHEMA_CA_RENTRI_SIGN_HASH,
  DEFINIZIONI_CA_RENTRI_SIGN_HASH,
} from '../src/dominio/schema-ca-rentri-sign-hash'

/**
 * Guardia contro la deriva fra il finto e `ca-rentri.yaml`: gli schemi di
 * `authorize` e `sign-hash` sono copie generate (`npm run
 * genera-schema:ca-rentri-authorize` / `...-sign-hash`), mai scritte a mano.
 * Stesso principio di `schema-allineato-al-contratto.test.ts`.
 */
const PERCORSO_CONTRATTO = join(__dirname, '..', '..', '..', 'docs', 'contracts', 'rentri', 'ca-rentri.yaml')

const schemi = (
  load(readFileSync(PERCORSO_CONTRATTO, 'utf8')) as { components: { schemas: Record<string, unknown> } }
).components.schemas

describe('Schemi ca-rentri allineati al contratto', () => {
  it('gli schemi ca-rentri del finto coincidono con il contratto', () => {
    expect(SCHEMA_CA_RENTRI_AUTHORIZE).toEqual(schemi.CredentialsAuthorizeRequest)
    expect(SCHEMA_CA_RENTRI_SIGN_HASH).toEqual(schemi.SignatureRequest)

    // AuthObjectData e' raggiunto da CredentialsAuthorizeRequest tramite $ref.
    const definizioni = {
      ...DEFINIZIONI_CA_RENTRI_AUTHORIZE,
      ...DEFINIZIONI_CA_RENTRI_SIGN_HASH,
    } as Record<string, unknown>
    expect(Object.keys(definizioni)).toContain('AuthObjectData')
    for (const [nome, schema] of Object.entries(definizioni)) {
      expect({ nome, schema }).toEqual({ nome, schema: schemi[nome] })
    }
  })
})
