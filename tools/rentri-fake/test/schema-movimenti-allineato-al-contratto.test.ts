import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import { SCHEMA_MOVIMENTO, DEFINIZIONI_MOVIMENTO } from '../src/dominio/schema-movimento'
import {
  SCHEMA_ANNULLAMENTO_MOVIMENTO,
  DEFINIZIONI_ANNULLAMENTO_MOVIMENTO,
} from '../src/dominio/schema-annullamento-movimento'
import {
  SCHEMA_VALIDA_REGISTRO,
  DEFINIZIONI_VALIDA_REGISTRO,
} from '../src/dominio/schema-valida-registro'

/**
 * Guardia contro la deriva fra il finto e il contratto ufficiale
 * `dati-registri.yaml`, per `MovimentoModel`, `AnnullamentoMovimentoModel` e
 * `ValidaRegistroRequest` — stesso principio di
 * `schema-trasmissione-allineato-al-contratto.test.ts` (`formulari.yaml`).
 * Rigenerare: `npm run genera-schema:movimento` / `:annullamento-movimento` /
 * `:valida-registro`.
 */

const PERCORSO_CONTRATTO = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'contracts',
  'rentri',
  'dati-registri.yaml'
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

describe('Schema di dati-registri allineato al contratto', () => {
  it('MovimentoModel e la sua chiusura transitiva sono identici al contratto ufficiale', () => {
    verificaAllineamento('MovimentoModel', SCHEMA_MOVIMENTO, DEFINIZIONI_MOVIMENTO)
  })

  it('AnnullamentoMovimentoModel e la sua chiusura transitiva sono identici al contratto ufficiale', () => {
    verificaAllineamento(
      'AnnullamentoMovimentoModel',
      SCHEMA_ANNULLAMENTO_MOVIMENTO,
      DEFINIZIONI_ANNULLAMENTO_MOVIMENTO
    )
  })

  it('ValidaRegistroRequest e la sua chiusura transitiva sono identici al contratto ufficiale', () => {
    verificaAllineamento(
      'ValidaRegistroRequest',
      SCHEMA_VALIDA_REGISTRO,
      DEFINIZIONI_VALIDA_REGISTRO
    )
  })
})
