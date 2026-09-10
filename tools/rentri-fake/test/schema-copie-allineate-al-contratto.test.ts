import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import {
  SCHEMA_COPIA_DIGITALE,
  DEFINIZIONI_COPIA_DIGITALE,
} from '../src/dominio/schema-copia-digitale'
import {
  SCHEMA_COPIA_CARTACEA,
  DEFINIZIONI_COPIA_CARTACEA,
} from '../src/dominio/schema-copia-cartacea'
import {
  SCHEMA_COPIA_CARTACEA_CONFERMA,
  DEFINIZIONI_COPIA_CARTACEA_CONFERMA,
} from '../src/dominio/schema-copia-cartacea-conferma'

/**
 * Guardia contro la deriva fra il finto e il contratto ufficiale, per i tre
 * modelli usati dalle rotte "Copia FIR cartaceo"/"Copia FIR digitale"
 * (`CopiaCartaceaModel`, `CopiaDigitaleModel`, `CopiaCartaceaConfermaModel`)
 * — stesso principio di `schema-trasmissione-allineato-al-contratto.test.ts`.
 *
 * Rigenerare: `npm run genera-schema:copia-cartacea` /
 * `:copia-cartacea-conferma` / `:copia-digitale`.
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

function verificaAllineamento(
  nomeModello: string,
  schemaGenerato: Record<string, unknown>,
  definizioniGenerate: Record<string, unknown>
): void {
  describe(`Schema di ${nomeModello} allineato al contratto`, () => {
    it(`lo schema usato dal finto e identico a ${nomeModello} del contratto ufficiale`, () => {
      expect(schemaGenerato).toEqual(schemiDalContratto()[nomeModello])
    })

    it('ogni definizione annidata e identica a quella del contratto', () => {
      const contratto = schemiDalContratto()
      for (const [nome, schema] of Object.entries(definizioniGenerate)) {
        expect({ nome, schema }).toEqual({ nome, schema: contratto[nome] })
      }
    })

    it('non restano $ref pendenti: la chiusura transitiva e completa', () => {
      const noti = new Set(Object.keys(definizioniGenerate))

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
      raccogli(schemaGenerato)
      raccogli(definizioniGenerate)

      expect([...riferiti].filter(nome => !noti.has(nome))).toEqual([])
    })
  })
}

verificaAllineamento(
  'CopiaDigitaleModel',
  SCHEMA_COPIA_DIGITALE as unknown as Record<string, unknown>,
  DEFINIZIONI_COPIA_DIGITALE as unknown as Record<string, unknown>
)
verificaAllineamento(
  'CopiaCartaceaModel',
  SCHEMA_COPIA_CARTACEA as unknown as Record<string, unknown>,
  DEFINIZIONI_COPIA_CARTACEA as unknown as Record<string, unknown>
)
verificaAllineamento(
  'CopiaCartaceaConfermaModel',
  SCHEMA_COPIA_CARTACEA_CONFERMA as unknown as Record<string, unknown>,
  DEFINIZIONI_COPIA_CARTACEA_CONFERMA as unknown as Record<string, unknown>
)
