import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import { SCHEMA_CREA_REGISTRO, DEFINIZIONI_CREA_REGISTRO } from '../src/dominio/schema-crea-registro'
import {
  SCHEMA_MODIFICA_REGISTRO,
  DEFINIZIONI_MODIFICA_REGISTRO,
} from '../src/dominio/schema-modifica-registro'

/**
 * Guardia contro la deriva fra il finto e il contratto ufficiale
 * `anagrafiche.yaml`, per `CreateRegistroRequest` e
 * `UpdateRegistroOperatoreRequest` (registri dell'operatore, pezzo E1 del
 * registro eREGI). Rigenerare: `npm run genera-schema:crea-registro` /
 * `:modifica-registro`.
 */

const PERCORSO_CONTRATTO = join(__dirname, '..', '..', '..', 'docs', 'contracts', 'rentri', 'anagrafiche.yaml')

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

describe('Schema di anagrafiche (registri) allineato al contratto', () => {
  it('CreateRegistroRequest e la sua chiusura transitiva sono identici al contratto ufficiale', () => {
    verificaAllineamento('CreateRegistroRequest', SCHEMA_CREA_REGISTRO, DEFINIZIONI_CREA_REGISTRO)
  })

  it('UpdateRegistroOperatoreRequest e la sua chiusura transitiva sono identici al contratto ufficiale', () => {
    verificaAllineamento(
      'UpdateRegistroOperatoreRequest',
      SCHEMA_MODIFICA_REGISTRO,
      DEFINIZIONI_MODIFICA_REGISTRO
    )
  })
})
