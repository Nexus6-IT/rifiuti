import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import { SCHEMA_QUANTITA, DEFINIZIONI_QUANTITA } from '../src/dominio/schema-quantita'
import {
  SCHEMA_TRASPORTO_TERRESTRE,
  DEFINIZIONI_TRASPORTO_TERRESTRE,
} from '../src/dominio/schema-trasporto-terrestre'
import { SCHEMA_ANNOTAZIONE, DEFINIZIONI_ANNOTAZIONE } from '../src/dominio/schema-annotazione'
import {
  SCHEMA_SOSTA_TECNICA,
  DEFINIZIONI_SOSTA_TECNICA,
} from '../src/dominio/schema-sosta-tecnica'
import {
  SCHEMA_TRASBORDO_TOTALE,
  DEFINIZIONI_TRASBORDO_TOTALE,
} from '../src/dominio/schema-trasbordo-totale'
import {
  SCHEMA_TRASBORDO_PARZIALE,
  DEFINIZIONI_TRASBORDO_PARZIALE,
} from '../src/dominio/schema-trasbordo-parziale'
import { SCHEMA_DESTINATARIO, DEFINIZIONI_DESTINATARIO } from '../src/dominio/schema-destinatario'
import {
  SCHEMA_DESTINATARIO_SITO,
  DEFINIZIONI_DESTINATARIO_SITO,
} from '../src/dominio/schema-destinatario-sito'

/**
 * Guardia contro la deriva fra il finto e il contratto ufficiale per i modelli
 * delle operazioni del FIR in viaggio (quantita, trasporto terrestre,
 * annotazione, sosta tecnica, trasbordo totale/parziale, nuovo destinatario).
 * Stesso principio di `schema-copie-allineate-al-contratto.test.ts`.
 *
 * Rigenerare: `npm run genera-schema:<nome>` (v. `package.json`).
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
  'QuantitaRifiutoModel',
  SCHEMA_QUANTITA as unknown as Record<string, unknown>,
  DEFINIZIONI_QUANTITA as unknown as Record<string, unknown>
)
verificaAllineamento(
  'DatiTrasportoTerrestreModel',
  SCHEMA_TRASPORTO_TERRESTRE as unknown as Record<string, unknown>,
  DEFINIZIONI_TRASPORTO_TERRESTRE as unknown as Record<string, unknown>
)
verificaAllineamento(
  'DatiAnnotazioneModel',
  SCHEMA_ANNOTAZIONE as unknown as Record<string, unknown>,
  DEFINIZIONI_ANNOTAZIONE as unknown as Record<string, unknown>
)
verificaAllineamento(
  'DatiSostaTecnicaModel',
  SCHEMA_SOSTA_TECNICA as unknown as Record<string, unknown>,
  DEFINIZIONI_SOSTA_TECNICA as unknown as Record<string, unknown>
)
verificaAllineamento(
  'DatiTrasbordoTotaleModel',
  SCHEMA_TRASBORDO_TOTALE as unknown as Record<string, unknown>,
  DEFINIZIONI_TRASBORDO_TOTALE as unknown as Record<string, unknown>
)
verificaAllineamento(
  'DatiTrasbordoParzialeModel',
  SCHEMA_TRASBORDO_PARZIALE as unknown as Record<string, unknown>,
  DEFINIZIONI_TRASBORDO_PARZIALE as unknown as Record<string, unknown>
)
verificaAllineamento(
  'DatiDestinatarioFormularioModel',
  SCHEMA_DESTINATARIO as unknown as Record<string, unknown>,
  DEFINIZIONI_DESTINATARIO as unknown as Record<string, unknown>
)
verificaAllineamento(
  'DatiDestinatarioFormularioSitoModel',
  SCHEMA_DESTINATARIO_SITO as unknown as Record<string, unknown>,
  DEFINIZIONI_DESTINATARIO_SITO as unknown as Record<string, unknown>
)
