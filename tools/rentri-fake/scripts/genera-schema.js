#!/usr/bin/env node
/**
 * Estrae `NuovoFormularioModel` dal contratto ufficiale e lo scrive come
 * modulo TypeScript dentro il finto.
 *
 * Serve perche' il contesto di build dell'immagine e' `tools/rentri-fake`:
 * `docs/contracts/` non e' raggiungibile da li', quindi lo schema va
 * materializzato nel sorgente. `test/schema-allineato-al-contratto.test.ts`
 * diventa rosso se qualcuno aggiorna il contratto senza rieseguire questo
 * script.
 *
 *   node scripts/genera-schema.js
 */
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')
const { load } = require('js-yaml')

const CONTRATTO = join(__dirname, '..', '..', '..', 'docs', 'contracts', 'rentri', 'formulari.yaml')
const USCITA = join(__dirname, '..', 'src', 'dominio', 'schema-nuovo-formulario.ts')

const contratto = load(readFileSync(CONTRATTO, 'utf8'))
const modello = contratto.components.schemas.NuovoFormularioModel
if (!modello) {
  console.error('NuovoFormularioModel non trovato nel contratto')
  process.exit(1)
}

const intestazione = `/**
 * GENERATO da \`scripts/genera-schema.js\` — NON modificare a mano.
 *
 * Copia di \`NuovoFormularioModel\` dal contratto ufficiale
 * \`docs/contracts/rentri/formulari.yaml\`. L'allineamento e' imposto da
 * \`test/schema-allineato-al-contratto.test.ts\`.
 */
export const SCHEMA_NUOVO_FORMULARIO = ${JSON.stringify(modello, null, 2)} as const
`

writeFileSync(USCITA, intestazione, 'utf8')
console.log(`Schema scritto in ${USCITA}`)
