import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import {
  SCHEMA_NUOVO_FORMULARIO,
  DEFINIZIONI_NUOVO_FORMULARIO,
} from '../src/dominio/schema-nuovo-formulario'

/**
 * Guardia contro la deriva fra il finto e il contratto ufficiale.
 *
 * Un validatore scritto a mano e' di nuovo «la nostra idea del contratto»:
 * e' esattamente il modo in cui il segnaposto del backend e' passato per
 * mesi. Questo test impone che le regole applicate dal finto siano una copia
 * verificabile di `NuovoFormularioModel`, cosi' che l'aggiornamento del
 * contratto (`scripts/scarica-contratti.sh`) faccia diventare rosso il finto
 * invece di lasciarlo silenziosamente indietro.
 *
 * Lo schema vive come modulo TypeScript e non viene letto dallo YAML a
 * runtime perche' il contesto di build dell'immagine e' `tools/rentri-fake`:
 * `docs/contracts/` non e' raggiungibile da li'. Il test copre quel salto.
 */

const PERCORSO_CONTRATTO = join(__dirname, '..', '..', '..', 'docs', 'contracts', 'rentri', 'formulari.yaml')

function modelloDalContratto(): unknown {
  const contratto = load(readFileSync(PERCORSO_CONTRATTO, 'utf8')) as {
    components: { schemas: Record<string, unknown> }
  }
  return contratto.components.schemas.NuovoFormularioModel
}

function schemiDalContratto(): Record<string, unknown> {
  const contratto = load(readFileSync(PERCORSO_CONTRATTO, 'utf8')) as {
    components: { schemas: Record<string, unknown> }
  }
  return contratto.components.schemas
}

describe('Schema di scrittura allineato al contratto', () => {
  it('lo schema usato dal finto e identico a NuovoFormularioModel del contratto ufficiale', () => {
    expect(SCHEMA_NUOVO_FORMULARIO).toEqual(modelloDalContratto())
  })

  it('ogni definizione annidata e identica a quella del contratto', () => {
    const contratto = schemiDalContratto()
    const generate = DEFINIZIONI_NUOVO_FORMULARIO as unknown as Record<string, unknown>

    expect(Object.keys(generate).length).toBeGreaterThan(0)
    for (const [nome, schema] of Object.entries(generate)) {
      expect({ nome, schema }).toEqual({ nome, schema: contratto[nome] })
    }
  })

  it('non restano $ref pendenti: la chiusura transitiva e completa', () => {
    const generate = DEFINIZIONI_NUOVO_FORMULARIO as unknown as Record<string, unknown>
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
    raccogli(SCHEMA_NUOVO_FORMULARIO)
    raccogli(generate)

    expect([...riferiti].filter(nome => !noti.has(nome))).toEqual([])
  })
})
