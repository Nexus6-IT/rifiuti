import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { readFile, stat } from 'fs/promises'
import { basename, join, resolve } from 'path'
import { createInterface } from 'readline'
import { PacchettoError } from './errori-pacchetto'
import {
  AmbitoPacchetto,
  FilePacchetto,
  ManifestPacchetto,
  NOME_MANIFEST,
  NOME_MAPPA,
  validaManifestPacchetto,
} from './manifest-pacchetto'
import { improntaMappa, MappaImport, validaMappa } from './mappa-import'

export interface PacchettoAperto {
  readonly cartella: string
  readonly manifest: ManifestPacchetto
  readonly mappa: MappaImport
  /** SHA-256 dei byte di `manifest.json`. */
  readonly hashManifest: string
  fasi(ambito: AmbitoPacchetto): readonly FilePacchetto[]
  /** Legge i record di una fase in streaming (memoria costante). */
  leggi(
    ambito: AmbitoPacchetto,
    fase: string
  ): AsyncGenerator<{ numeroRiga: number; record: unknown }>
}

export interface OpzioniApertura {
  /** Impronta della mappa che l'operatore si aspetta (es. quella data a `--mappa`): se diversa, si rifiuta. */
  readonly hashMappaAttesa?: string
}

async function verificaFile(percorso: string): Promise<{ sha256: string; righe: number }> {
  const hash = createHash('sha256')
  const stream = createReadStream(percorso)
  stream.on('data', c => hash.update(c))
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let righe = 0
  for await (const l of rl) if (l.trim().length > 0) righe++
  return { sha256: hash.digest('hex'), righe }
}

/**
 * Apre un pacchetto verificandolo TUTTO prima di restituire qualcosa: formato, ogni file (esistenza,
 * SHA-256, righe dichiarate) e mappa (valida, e con l'impronta dichiarata dal manifest). Un pacchetto
 * manomesso o troncato non arriva mai al caricamento.
 */
export async function apriPacchetto(
  cartella: string,
  opzioni: OpzioniApertura = {}
): Promise<PacchettoAperto> {
  const radice = resolve(cartella)
  try {
    if (!(await stat(radice)).isDirectory()) throw new Error()
  } catch {
    throw new PacchettoError('CARTELLA_NON_VALIDA', 'la cartella non esiste o non e una cartella')
  }
  let grezzo: Buffer
  try {
    grezzo = await readFile(join(radice, NOME_MANIFEST))
  } catch {
    throw new PacchettoError('MANIFEST_ASSENTE', `${NOME_MANIFEST} non trovato`)
  }
  let json: unknown
  try {
    json = JSON.parse(grezzo.toString('utf8'))
  } catch {
    throw new PacchettoError('MANIFEST_NON_VALIDO', `${NOME_MANIFEST} non e JSON valido`)
  }
  const manifest = validaManifestPacchetto(json)
  if (basename(radice) !== manifest.archivio) {
    throw new PacchettoError(
      'MANIFEST_NON_VALIDO',
      `la cartella si chiama ${basename(radice)}, il manifest dichiara ${manifest.archivio}`
    )
  }

  let mappaGrezza: Buffer
  try {
    mappaGrezza = await readFile(join(radice, NOME_MAPPA))
  } catch {
    throw new PacchettoError('MAPPA_ASSENTE', `${NOME_MAPPA} non trovata nel pacchetto`)
  }
  let mappaJson: unknown
  try {
    mappaJson = JSON.parse(mappaGrezza.toString('utf8'))
  } catch {
    throw new PacchettoError('MAPPA_NON_VALIDA', `${NOME_MAPPA} non e JSON valido`)
  }
  const mappa = validaMappa(mappaJson)
  const impronta = improntaMappa(mappa)
  if (impronta !== manifest.hashMappa) {
    throw new PacchettoError(
      'MAPPA_DIVERSA',
      'la mappa del pacchetto non e quella dichiarata dal manifest'
    )
  }
  if (opzioni.hashMappaAttesa !== undefined && opzioni.hashMappaAttesa !== impronta) {
    throw new PacchettoError('MAPPA_DIVERSA', 'la mappa del pacchetto non e quella attesa')
  }
  if (`WW${mappa.ditta}${mappa.anno}` !== manifest.archivio) {
    throw new PacchettoError(
      'MAPPA_DIVERSA',
      'ditta e anno della mappa non coincidono con quelli del pacchetto'
    )
  }

  for (const f of manifest.file) {
    try {
      await stat(join(radice, f.file))
    } catch {
      throw new PacchettoError('FILE_ASSENTE', f.file)
    }
    const v = await verificaFile(join(radice, f.file))
    if (v.sha256 !== f.sha256) throw new PacchettoError('HASH_NON_CORRISPONDE', f.file)
    if (v.righe !== f.righe) {
      throw new PacchettoError(
        'RIGHE_NON_CORRISPONDENTI',
        `${f.file}: dichiarate ${f.righe}, lette ${v.righe}`
      )
    }
  }

  async function* leggi(ambito: AmbitoPacchetto, fase: string) {
    const f = manifest.file.find(x => x.ambito === ambito && x.fase === fase)
    if (!f) throw new PacchettoError('FILE_ASSENTE', `fase ${ambito}/${fase} non presente`)
    const rl = createInterface({
      input: createReadStream(join(radice, f.file)),
      crlfDelay: Infinity,
    })
    let numeroRiga = 0
    for await (const linea of rl) {
      numeroRiga++
      if (linea.trim().length === 0) continue
      let record: unknown
      try {
        record = JSON.parse(linea)
      } catch {
        throw new PacchettoError('RIGA_NON_VALIDA', `${f.file} riga ${numeroRiga}: JSON non valido`)
      }
      yield { numeroRiga, record }
    }
  }

  return {
    cartella: radice,
    manifest,
    mappa,
    hashManifest: createHash('sha256').update(grezzo).digest('hex'),
    fasi: ambito => manifest.file.filter(f => f.ambito === ambito),
    leggi,
  }
}
