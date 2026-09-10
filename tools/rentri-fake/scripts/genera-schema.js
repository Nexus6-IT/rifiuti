#!/usr/bin/env node
/**
 * Estrae `NuovoFormularioModel` dal contratto ufficiale, insieme a TUTTI gli
 * schemi che raggiunge tramite `$ref`, e li scrive come modulo TypeScript
 * dentro il finto.
 *
 * Serve perche' il contesto di build dell'immagine e' `tools/rentri-fake`:
 * `docs/contracts/` non e' raggiungibile da li', quindi lo schema va
 * materializzato nel sorgente. `test/schema-allineato-al-contratto.test.ts`
 * diventa rosso se qualcuno aggiorna il contratto senza rieseguire questo
 * script.
 *
 * Gli schemi sono copiati VERBATIM dal contratto, senza conversioni: la
 * traduzione da OpenAPI a JSON Schema (`nullable`, riscrittura dei `$ref`)
 * avviene nel validatore. Cosi' il test di allineamento puo' confrontare
 * campo per campo col contratto, che e' la garanzia piu' forte contro la
 * deriva.
 *
 *   npm run genera-schema
 */
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')
const { load } = require('js-yaml')

const PREFISSO_REF = '#/components/schemas/'

// Argomenti opzionali (`npm run genera-schema -- <RadiceSchema> <percorso-uscita> <NOME_COSTANTE> <file-contratto>`):
// senza argomenti si rigenera lo schema storico di `NuovoFormularioModel`,
// invariato rispetto a prima che questo script accettasse parametri.
const [argRadice, argUscita, argNomeCostante, argContratto] = process.argv.slice(2)
const RADICE = argRadice || 'NuovoFormularioModel'
const USCITA = argUscita
  ? join(__dirname, '..', argUscita)
  : join(__dirname, '..', 'src', 'dominio', 'schema-nuovo-formulario.ts')
// Nome (senza prefisso `SCHEMA_`/`DEFINIZIONI_`) delle costanti esportate.
// Default invariato rispetto allo script originale (nessun argomento ->
// stesso output di sempre, `SCHEMA_NUOVO_FORMULARIO`/`DEFINIZIONI_NUOVO_FORMULARIO`).
const NOME_COSTANTE = argNomeCostante || 'NUOVO_FORMULARIO'
// Nome del file contratto sotto `docs/contracts/rentri/` (4° argomento
// opzionale): senza argomento resta `formulari.yaml`, invariato rispetto a
// prima che questo script sapesse leggere altri servizi (es. `dati-registri.yaml`).
const CONTRATTO = join(__dirname, '..', '..', '..', 'docs', 'contracts', 'rentri', argContratto || 'formulari.yaml')

/** Nomi degli schemi referenziati da un nodo, a qualunque profondita'. */
function riferimenti(nodo, trovati = new Set()) {
  if (nodo === null || typeof nodo !== 'object') return trovati

  if (Array.isArray(nodo)) {
    for (const voce of nodo) riferimenti(voce, trovati)
    return trovati
  }

  for (const [chiave, valore] of Object.entries(nodo)) {
    if (chiave === '$ref' && typeof valore === 'string' && valore.startsWith(PREFISSO_REF)) {
      trovati.add(valore.slice(PREFISSO_REF.length))
    } else {
      riferimenti(valore, trovati)
    }
  }
  return trovati
}

const contratto = load(readFileSync(CONTRATTO, 'utf8'))
const schemi = contratto.components.schemas
const modello = schemi[RADICE]
if (!modello) {
  console.error(`${RADICE} non trovato nel contratto`)
  process.exit(1)
}

// Chiusura transitiva: si parte dalla radice e si segue ogni $ref finche' non
// emergono nomi nuovi. Senza questo, un modello annidato resterebbe un $ref
// pendente e il validatore lo salterebbe in silenzio.
const definizioni = {}
const daVisitare = [...riferimenti(modello)]
while (daVisitare.length > 0) {
  const nome = daVisitare.pop()
  if (definizioni[nome]) continue

  const schema = schemi[nome]
  if (!schema) {
    console.error(`$ref pendente: '${nome}' non esiste in components.schemas`)
    process.exit(1)
  }

  definizioni[nome] = schema
  for (const riferito of riferimenti(schema)) {
    if (!definizioni[riferito]) daVisitare.push(riferito)
  }
}

const contenuto = `/**
 * GENERATO da \`scripts/genera-schema.js\` — NON modificare a mano.
 *
 * Copia verbatim di \`${RADICE}\` e della chiusura transitiva dei suoi
 * \`$ref\`, dal contratto ufficiale \`docs/contracts/rentri/formulari.yaml\`.
 * L'allineamento e' imposto da \`test/schema-allineato-al-contratto.test.ts\`.
 */
export const SCHEMA_${NOME_COSTANTE} = ${JSON.stringify(modello, null, 2)} as const

/** Schemi raggiunti da \`${RADICE}\` tramite \`$ref\`, verbatim dal contratto. */
export const DEFINIZIONI_${NOME_COSTANTE} = ${JSON.stringify(definizioni, null, 2)} as const
`

writeFileSync(USCITA, contenuto, 'utf8')
console.log(
  `Schema scritto in ${USCITA} (${Object.keys(definizioni).length} definizioni raggiunte)`
)
