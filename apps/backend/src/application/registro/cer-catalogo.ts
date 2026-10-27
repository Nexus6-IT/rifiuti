import { cerCanonico } from '../../domain/waste-movement/cer-registro'

/** Lettore minimo del catalogo CER (basta `count`/`findMany` di `cERCode`). */
interface LettoreCatalogoCer {
  cERCode: {
    count(args: { where: { code: { in: string[] } } }): Promise<number>
    findMany(args: {
      where: { code: { in: string[] } }
      select: { code: true }
    }): Promise<Array<{ code: string }>>
  }
}

/**
 * Normalizza un codice CER al formato canonico del catalogo "NN NN NN"
 * (con "*" finale per i pericolosi). Accetta input senza spazi ("200301")
 * o con spaziatura irregolare; se il formato non è 6 cifre lascia invariato
 * (la validazione di esistenza fallirà con messaggio chiaro).
 */
export function normalizzaCerCode(raw: string): string {
  if (!raw) return raw
  return cerCanonico(raw.toUpperCase())
}

function candidatiCatalogo(cerCode: string): string[] {
  const senzaStella = cerCode.replace(/\*$/, '')
  return [senzaStella, `${senzaStella}*`]
}

/**
 * Verifica che il codice CER esista nel catalogo ufficiale. Il catalogo
 * memorizza i pericolosi con "*" finale: l'operatore potrebbe ometterlo,
 * quindi accetta il match sia con sia senza asterisco.
 */
export async function cerCodeExists(db: LettoreCatalogoCer, cerCode: string): Promise<boolean> {
  const count = await db.cERCode.count({ where: { code: { in: candidatiCatalogo(cerCode) } } })
  return count > 0
}

/**
 * Forma del CER nel catalogo (con "*" se il catalogo lo ha, anche se chi scrive l'ha omesso),
 * oppure null se il codice non esiste. Se il catalogo avesse entrambe le forme vince quella con
 * l'asterisco (il rifiuto pericoloso).
 */
export async function cerNelCatalogo(
  db: LettoreCatalogoCer,
  cerCode: string
): Promise<string | null> {
  const trovati = await db.cERCode.findMany({
    where: { code: { in: candidatiCatalogo(cerCode) } },
    select: { code: true },
  })
  if (trovati.length === 0) return null
  return trovati.find(t => t.code.endsWith('*'))?.code ?? trovati[0].code
}
