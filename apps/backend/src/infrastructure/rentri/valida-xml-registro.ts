import { readFileSync } from 'fs'
import { join } from 'path'
import { validateXML, XMLFileInfo } from 'xmllint-wasm'
import {
  EsitoValidazioneXsd,
  MAX_ERRORI,
  erroriUtili,
  messaggioSenzaValori,
} from '../fatturapa/valida-xsd'

/**
 * Validazione locale di un XML del registro RENTRI (`reg:Registro`) contro gli XSD ufficiali in
 * `xsd/` (vedi `xsd/VERSIONI.md`). Nessun accesso alla rete: l'import di xmldsig, che nell'XSD
 * punta a un URL del W3C, e' riscritto in memoria sul file locale precaricato in xmllint.
 */
const DIR_XSD = join(__dirname, 'xsd')
const NOME_REGISTRI = 'rentri-registri-1.0.xsd'
const NOME_DSIG = 'xmldsig-core-schema.xsd'
const PRELOAD = ['rentri-movimenti-1.0.xsd', 'rentri-common-1.0.xsd', 'rentri-enum-1.0.xsd']

interface SchemiCaricati {
  schema: XMLFileInfo
  preload: XMLFileInfo[]
}

let schemi: SchemiCaricati | null = null

function leggi(nome: string): string {
  const t = readFileSync(join(DIR_XSD, nome), 'utf8')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}

function caricaSchemi(): SchemiCaricati {
  if (schemi) return schemi
  const registri = leggi(NOME_REGISTRI).replace(
    /schemaLocation="[^"]*xmldsig-core-schema\.xsd"/,
    `schemaLocation="${NOME_DSIG}"`
  )
  schemi = {
    schema: { fileName: NOME_REGISTRI, contents: registri },
    preload: [NOME_DSIG, ...PRELOAD].map(n => ({ fileName: n, contents: leggi(n) })),
  }
  return schemi
}

/**
 * Valida un `reg:Registro` (firmato o no). Gli errori non riportano mai il contenuto dei campi
 * (possono contenere dati dell'operatore): solo elemento e categoria della violazione.
 */
export async function validaXmlRegistro(xml: string): Promise<EsitoValidazioneXsd> {
  const { schema, preload } = caricaSchemi()
  const r = await validateXML({
    xml: [{ fileName: 'registro.xml', contents: xml }],
    schema: [schema],
    preload,
    // Un anno di registro e' di qualche MB: oltre i 16 MiB predefiniti di xmllint.
    initialMemoryPages: 256,
    maxMemoryPages: 4096,
  })
  if (r.valid) return { valido: true, errori: [] }
  const errori = erroriUtili(r.errors)
    .slice(0, MAX_ERRORI)
    .map(e => messaggioSenzaValori(e.message))
  if (errori.length === 0) errori.push('Elemento documento: non conforme allo schema')
  return { valido: false, errori }
}
