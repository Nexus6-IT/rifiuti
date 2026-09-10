import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import {
  SCHEMA_TRASMISSIONE_DATI,
  DEFINIZIONI_TRASMISSIONE_DATI,
} from '../src/dominio/schema-trasmissione-dati'

/**
 * Guardia contro la deriva fra il finto e il contratto ufficiale, per
 * `DatiTrasmissioneFormularioModel` — stesso principio di
 * `schema-allineato-al-contratto.test.ts` (`NuovoFormularioModel`): un
 * validatore scritto a mano e' di nuovo «la nostra idea del contratto».
 * Rigenerare: `npm run genera-schema:trasmissione-dati`.
 */

const PERCORSO_CONTRATTO = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'contracts',
  'rentri',
  'formulari.yaml'
)

function schemiDalContratto(): Record<string, unknown> {
  const contratto = load(readFileSync(PERCORSO_CONTRATTO, 'utf8')) as {
    components: { schemas: Record<string, unknown> }
  }
  return contratto.components.schemas
}

describe('Schema di trasmissione dati allineato al contratto', () => {
  it('lo schema usato dal finto e identico a DatiTrasmissioneFormularioModel del contratto ufficiale', () => {
    expect(SCHEMA_TRASMISSIONE_DATI).toEqual(schemiDalContratto().DatiTrasmissioneFormularioModel)
  })

  it('ogni definizione annidata e identica a quella del contratto', () => {
    const contratto = schemiDalContratto()
    const generate = DEFINIZIONI_TRASMISSIONE_DATI as unknown as Record<string, unknown>

    expect(Object.keys(generate).length).toBeGreaterThan(0)
    for (const [nome, schema] of Object.entries(generate)) {
      expect({ nome, schema }).toEqual({ nome, schema: contratto[nome] })
    }
  })

  it('non restano $ref pendenti: la chiusura transitiva e completa', () => {
    const generate = DEFINIZIONI_TRASMISSIONE_DATI as unknown as Record<string, unknown>
    const noti = new Set(Object.keys(generate))

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
    raccogli(SCHEMA_TRASMISSIONE_DATI)
    raccogli(generate)

    expect([...riferiti].filter(nome => !noti.has(nome))).toEqual([])
  })
})
