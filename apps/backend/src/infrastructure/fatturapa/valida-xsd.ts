import { readFileSync } from 'fs'
import { join } from 'path'
import { validateXML, XMLFileInfo } from 'xmllint-wasm'

/** Esito della validazione contro l'XSD FatturaPA. */
export interface EsitoValidazioneXsd {
  valido: boolean
  /** Messaggi dell'XSD senza il contenuto dei campi: solo nome dell'elemento e tipo di violazione. */
  errori: string[]
}

const NOME_XSD_FATTURA = 'Schema_VFPR12_v1.2.3.xsd'
const NOME_XSD_DSIG = 'xmldsig-core-schema.xsd'
const DIR_XSD = join(__dirname, 'xsd')

/** Massimo di messaggi restituiti: una fattura rotta può generarne migliaia. */
const MAX_ERRORI = 50

interface SchemiCaricati {
  schema: XMLFileInfo
  preload: XMLFileInfo[]
}

let schemi: SchemiCaricati | null = null

/**
 * Carica gli XSD una sola volta. L'import di xmldsig punta a un URL del W3C: lo si riscrive sul
 * nome del file locale (precaricato nel filesystem in memoria di xmllint), così non serve la rete.
 */
function caricaSchemi(): SchemiCaricati {
  if (schemi) return schemi
  const fattura = readFileSync(join(DIR_XSD, NOME_XSD_FATTURA), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/schemaLocation="[^"]*xmldsig-core-schema\.xsd"/, `schemaLocation="${NOME_XSD_DSIG}"`)
  const dsig = readFileSync(join(DIR_XSD, NOME_XSD_DSIG), 'utf8').replace(/^\uFEFF/, '')
  schemi = {
    schema: { fileName: 'fattura.xsd', contents: fattura },
    preload: [{ fileName: NOME_XSD_DSIG, contents: dsig }],
  }
  return schemi
}

/**
 * Riduce un messaggio di libxml2 a «Elemento X: categoria». Il messaggio originale cita il valore
 * del campo (`The value '...' is not accepted`): qui contiene dati del cliente e non deve finire
 * nei log né nelle risposte. Si usa una lista di categorie, non una sostituzione dei valori.
 */
function messaggioSenzaValori(messaggio: string): string {
  const nome = /Element '(?:\{[^}]*\})?([A-Za-z0-9_.:-]+)'/.exec(messaggio)?.[1] ?? 'documento'
  let categoria = 'non conforme allo schema'
  const facet = /\[facet '([A-Za-z]+)'\]/.exec(messaggio)?.[1]
  if (facet) categoria = `valore non ammesso (${facet})`
  else if (/This element is not expected/.test(messaggio))
    categoria = 'elemento non atteso o fuori ordine'
  else if (/Missing child element/.test(messaggio)) categoria = 'elemento obbligatorio mancante'
  else if (/not a valid value of the atomic type/.test(messaggio))
    categoria = 'valore di tipo non valido'
  else if (/Character content is not allowed/.test(messaggio))
    categoria = 'contenuto testuale non ammesso'
  else if (/Duplicate key|identity constraint/.test(messaggio))
    categoria = 'vincolo di unicità violato'
  return `Elemento ${nome}: ${categoria}`
}

/**
 * Valida un XML FatturaPA contro l'XSD ufficiale (v1.2.3). Non fa accessi alla rete: gli schemi
 * sono letti da `xsd/` e xmllint-wasm gira in memoria.
 */
export async function validaFatturaPA(xml: string): Promise<EsitoValidazioneXsd> {
  const { schema, preload } = caricaSchemi()
  const r = await validateXML({
    xml: [{ fileName: 'fattura.xml', contents: xml }],
    schema: [schema],
    preload,
    // Una fattura da molte righe supera la memoria predefinita (16 MiB).
    initialMemoryPages: 256,
    maxMemoryPages: 1024,
  })
  if (r.valid) return { valido: true, errori: [] }
  const errori = r.errors.slice(0, MAX_ERRORI).map(e => messaggioSenzaValori(e.message))
  if (errori.length === 0) errori.push('Elemento documento: non conforme allo schema')
  return { valido: false, errori }
}
