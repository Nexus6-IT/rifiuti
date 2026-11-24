/**
 * Foto dal campo (P5): limiti e validazione della forma, senza database. Il telefono comprime la
 * foto (lato lungo 1600 px, JPEG ~0,7: 200-400 kB); il server impone comunque i suoi tetti.
 */
import { createHash } from 'crypto'
import { riconosciTipoFile } from '../../domain/pese/allegato-pesa'
import {
  FotoCampoNonValidaError,
  FotoCampoTipoNonAmmessoError,
  FotoCampoTroppoGrandeError,
} from './errori-campo'

/** Tetto per foto, dopo la compressione. Deve restare <= al CHECK della migration. */
export const MAX_BYTE_FOTO_CAMPO = 1024 * 1024
/** Tetto per evento (esito): al massimo 3 MiB di foto per ritiro. */
export const MAX_FOTO_PER_EVENTO = 3

export const MESSAGGIO_FOTO_TROPPO_GRANDE = 'La foto supera 1 MB anche dopo la compressione.'

export type TipoFotoCampo = 'image/jpeg' | 'image/png'

export interface FotoCampoInput {
  /** UUID generato dal telefono: chiave di idempotenza. */
  id: string
  /** Impronta SHA-256 (esadecimale) calcolata dal telefono sui byte inviati. */
  sha256: string
  contenuto: Buffer
}

export interface FotoCampoValida {
  id: string
  sha256: string
  contenuto: Buffer
  mimeType: TipoFotoCampo
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/i

/**
 * Controlli che non toccano il database. Ordine: forma (400), dimensione (413), tipo dai magic
 * bytes (415). L'impronta si confronta dopo, in `verificaImpronta` (422): un file danneggiato in
 * viaggio e' un errore diverso da un file sbagliato.
 */
export function validaFotoCampo(grezzo: Partial<FotoCampoInput>): FotoCampoValida {
  const messaggi: string[] = []
  const id = typeof grezzo.id === 'string' && UUID.test(grezzo.id) ? grezzo.id.toLowerCase() : null
  if (id === null) messaggi.push("L'identificativo della foto non è valido.")
  const sha256 =
    typeof grezzo.sha256 === 'string' && SHA256.test(grezzo.sha256)
      ? grezzo.sha256.toLowerCase()
      : null
  if (sha256 === null) messaggi.push("L'impronta della foto non è valida.")
  const contenuto = grezzo.contenuto
  if (!Buffer.isBuffer(contenuto) || contenuto.length === 0) messaggi.push('La foto è vuota.')
  if (messaggi.length > 0 || id === null || sha256 === null || !contenuto) {
    throw new FotoCampoNonValidaError(messaggi)
  }
  if (contenuto.length > MAX_BYTE_FOTO_CAMPO) {
    throw new FotoCampoTroppoGrandeError(MESSAGGIO_FOTO_TROPPO_GRANDE)
  }
  const tipo = riconosciTipoFile(contenuto)
  if (tipo !== 'image/jpeg' && tipo !== 'image/png') throw new FotoCampoTipoNonAmmessoError()
  return { id, sha256, contenuto, mimeType: tipo }
}

/** SHA-256 esadecimale minuscolo dei byte. */
export function impronta(contenuto: Buffer): string {
  return createHash('sha256').update(contenuto).digest('hex')
}
