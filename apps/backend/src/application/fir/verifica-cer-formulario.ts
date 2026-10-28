/**
 * Verifica del codice CER per un formulario NUOVO (o per una bozza che lo diventera').
 * Condivisa da creazione e modifica: stessa normalizzazione, stessi controlli, stessi messaggi.
 */

import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import { Result } from '../../core/application/result'
import { cerCanonico } from '../../domain/waste-movement/cer-registro'

/**
 * Normalizza un codice CER al formato canonico del catalogo "NN NN NN"
 * (con "*" finale per i pericolosi). Accetta input senza spazi ("200301")
 * o con spaziatura irregolare; se il formato non e' 6 cifre lascia invariato
 * (la validazione successiva fallira' con messaggio chiaro).
 */
export function normalizzaCerCode(raw: string): string {
  if (!raw) return raw
  return cerCanonico(raw.toUpperCase())
}

/**
 * Normalizza il CER e verifica che esista e sia utilizzabile per un formulario nuovo.
 * In caso di successo restituisce il codice normalizzato.
 */
export async function verificaCerPerFormulario(
  cerRepository: ICERRepository,
  cerGrezzo: string
): Promise<Result<string>> {
  const cerCode = normalizzaCerCode(cerGrezzo)
  const cerExists = await cerRepository.exists(cerCode)
  if (!cerExists) {
    return Result.fail<string>(`CER code not found: ${cerGrezzo}`)
  }
  // Il codice esiste per riferimento storico (sopra), ma un FIR NUOVO deve
  // usare la verifica piu' stringente: un codice che RENTRI ha smesso di
  // confermare resta leggibile/stampabile per i FIR gia' emessi, ma qui non e'
  // piu' selezionabile (v. piano R4 Task 4, CERCatalogService).
  const cerUtilizzabile = await cerRepository.isUtilizzabilePerNuovoFormulario(cerCode)
  if (!cerUtilizzabile) {
    return Result.fail<string>(
      "Questo codice CER non è più valido secondo il registro dell'ente: verificane la sostituzione"
    )
  }
  return Result.ok<string>(cerCode)
}
