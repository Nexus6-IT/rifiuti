import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import { SCHEMA_EFIR, DEFINIZIONI_EFIR } from '../src/dominio/schema-efir'
import { SCHEMA_BLOCCO, DEFINIZIONI_BLOCCO } from '../src/dominio/schema-blocco'

/**
 * Guardia contro la deriva fra il finto e il contratto ufficiale
 * `vidimazione-formulari.yaml`, per `EfirModel` e `BloccoModel` — stesso
 * principio di `schema-movimenti-allineato-al-contratto.test.ts`
 * (`dati-registri.yaml`). Rigenerare: `npm run genera-schema:efir` /
 * `:blocco`.
 */

const PERCORSO_CONTRATTO = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'contracts',
  'rentri',
  'vidimazione-formulari.yaml'
)

function schemiDalContratto(): Record<string, unknown> {
  const contratto = load(readFileSync(PERCORSO_CONTRATTO, 'utf8')) as {
    components: { schemas: Record<string, unknown> }
  }
  return contratto.components.schemas
}

function verificaAllineamento(
  nomeRadice: string,
  radice: unknown,
  definizioni: Record<string, unknown>
): void {
  const contratto = schemiDalContratto()

  expect(radice).toEqual(contratto[nomeRadice])

  for (const [nome, schema] of Object.entries(definizioni)) {
    expect({ nome, schema }).toEqual({ nome, schema: contratto[nome] })
  }

  const noti = new Set(Object.keys(definizioni))
  const riferiti = new Set<string>()
  const raccogli = (nodo: unknown): void => {
    if (nodo === null || typeof nodo !== 'object') return
    if (Array.isArray(nodo)) return void nodo.forEach(raccogli)
    for (const [chiave, valore] of Object.entries(nodo)) {
      if (chiave === '$ref' && typeof valore === 'string') {
        riferiti.add(valore.replace('#/components/schemas/', ''))
      } else {
        raccogli(valore)
      }
    }
  }
  raccogli(radice)
  raccogli(definizioni)

  expect([...riferiti].filter(nome => !noti.has(nome))).toEqual([])
}

describe('Schema di vidimazione-formulari allineato al contratto', () => {
  it('EfirModel e la sua chiusura transitiva sono identici al contratto ufficiale', () => {
    verificaAllineamento('EfirModel', SCHEMA_EFIR, DEFINIZIONI_EFIR)
  })

  it('BloccoModel e la sua chiusura transitiva sono identici al contratto ufficiale', () => {
    verificaAllineamento('BloccoModel', SCHEMA_BLOCCO, DEFINIZIONI_BLOCCO)
  })
})
