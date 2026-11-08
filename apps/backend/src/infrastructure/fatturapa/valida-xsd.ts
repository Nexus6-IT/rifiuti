import { readFileSync } from 'fs'
import { join } from 'path'
import { validateXML, XMLFileInfo, XMLValidationError } from 'xmllint-wasm'

/** Esito della validazione contro l'XSD FatturaPA. */
export interface EsitoValidazioneXsd {
  valido: boolean
  /** Messaggi dell'XSD senza il contenuto dei campi: solo nome dell'elemento e tipo di violazione. */
  errori: string[]
  /**
   * Solo nell'esito a lotto: `true` se l'invalidità dipende da almeno un errore proprio di
   * QUESTO file (la sua posizione nella selezione è significativa); assente o `false` se il file
   * è invalido solo per errori generali del lotto (es. XML non ben formato).
   */
  attribuibile?: boolean
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

/** Toglie la riga riassuntiva «<file> fails to validate», che non è un errore dell'XSD. */
function erroriUtili(errori: ReadonlyArray<XMLValidationError>): XMLValidationError[] {
  return errori.filter(e => e.loc !== null || !/ fails to validate\s*$/.test(e.rawMessage))
}

function opzioniXmllint(xml: Array<{ fileName: string; contents: string }>) {
  const { schema, preload } = caricaSchemi()
  return {
    xml,
    schema: [schema],
    preload,
    // Una fattura da molte righe (o un lotto) supera la memoria predefinita (16 MiB).
    initialMemoryPages: 256,
    maxMemoryPages: 2048,
  }
}

/**
 * Valida più XML FatturaPA in una sola chiamata a xmllint-wasm (che per ogni chiamata crea un
 * Worker e ricompila il wasm): l'esito è nello stesso ordine dell'ingresso. Un errore senza
 * posizione attribuibile a un file rende non valido l'intero lotto (si fallisce chiusi).
 */
export async function validaFatturePA(xml: string[]): Promise<EsitoValidazioneXsd[]> {
  if (xml.length === 0) return []
  const r = await validateXML(
    opzioniXmllint(xml.map((contents, i) => ({ fileName: `fattura-${i}.xml`, contents })))
  )
  if (r.valid) return xml.map(() => ({ valido: true, errori: [] }))
  const perFile = new Map<string, string[]>()
  const generali: string[] = []
  for (const e of erroriUtili(r.errors)) {
    const nome = e.loc?.fileName
    const msg = messaggioSenzaValori(e.message)
    if (nome === undefined) generali.push(msg)
    else perFile.set(nome, [...(perFile.get(nome) ?? []), msg])
  }
  return xml.map((_, i) => {
    const errori = [...(perFile.get(`fattura-${i}.xml`) ?? []), ...generali].slice(0, MAX_ERRORI)
    return errori.length === 0
      ? { valido: true, errori }
      : { valido: false, errori, attribuibile: perFile.has(`fattura-${i}.xml`) }
  })
}

/**
 * Valida un XML FatturaPA contro l'XSD ufficiale (v1.2.3). Non fa accessi alla rete: gli schemi
 * sono letti da `xsd/` e xmllint-wasm gira in memoria.
 */
export async function validaFatturaPA(xml: string): Promise<EsitoValidazioneXsd> {
  const r = await validateXML(opzioniXmllint([{ fileName: 'fattura.xml', contents: xml }]))
  if (r.valid) return { valido: true, errori: [] }
  const errori = erroriUtili(r.errors)
    .slice(0, MAX_ERRORI)
    .map(e => messaggioSenzaValori(e.message))
  if (errori.length === 0) errori.push('Elemento documento: non conforme allo schema')
  return { valido: false, errori }
}
