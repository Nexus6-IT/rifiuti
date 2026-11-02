// Controllo dei riferimenti di un addebito del listino (4.2a, R8): codice IVA e codifiche di
// addebito (gruppo, categoria, centro di ricavo, categorie statistiche). Esistenza nell'azienda,
// stato attivo e genere della codifica: la FK composita dell'addebito non controlla il genere.
//
// Una query per tabella con `SELECT ... FOR SHARE` (R24 della 4.1b): le righe scelte restano
// bloccate fino al commit di chi le sceglie, cosi' una disattivazione concorrente aspetta invece
// di lasciare un addebito con un riferimento disattivato. Nessun messaggio riporta id o dati.
import { Prisma } from '@prisma/client'

export interface RiferimentiAddebito {
  gruppoId?: string | null
  codiceIvaId?: string | null
  categoriaId?: string | null
  centroRicavoId?: string | null
  categoriaStatistica1Id?: string | null
  categoriaStatistica2Id?: string | null
}

const MSG_IVA = 'Il codice IVA scelto non esiste o è disattivato.'

/** Campo -> genere atteso e messaggio, nell'ordine di `DatiAddebito`. */
const CODIFICHE: ReadonlyArray<{
  campo: keyof RiferimentiAddebito
  genere: string
  messaggio: string
}> = [
  {
    campo: 'gruppoId',
    genere: 'GRUPPO',
    messaggio: 'Il gruppo scelto non esiste, è disattivato o non è un gruppo.',
  },
  {
    campo: 'categoriaId',
    genere: 'CATEGORIA',
    messaggio: 'La categoria scelta non esiste, è disattivata o non è una categoria.',
  },
  {
    campo: 'centroRicavoId',
    genere: 'CENTRO_RICAVO',
    messaggio: 'Il centro di ricavo scelto non esiste, è disattivato o non è un centro di ricavo.',
  },
  {
    campo: 'categoriaStatistica1Id',
    genere: 'CATEGORIA_STATISTICA_1',
    messaggio:
      'La categoria statistica 1 scelta non esiste, è disattivata o non è una categoria statistica 1.',
  },
  {
    campo: 'categoriaStatistica2Id',
    genere: 'CATEGORIA_STATISTICA_2',
    messaggio:
      'La categoria statistica 2 scelta non esiste, è disattivata o non è una categoria statistica 2.',
  },
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const presente = (v: string | null | undefined): v is string => typeof v === 'string' && v !== ''

/**
 * Messaggi dei riferimenti non validi (vuoto = tutti validi). Si passano solo i campi cambiati e
 * non null: gli altri non si leggono. Va chiamata nella transazione che poi scrive l'addebito,
 * perche' i lock `FOR SHARE` durano fino al suo commit.
 */
export async function controllaRiferimentiListino(
  tx: Prisma.TransactionClient,
  tenantId: string,
  r: RiferimentiAddebito
): Promise<string[]> {
  const validi = (...v: Array<string | null | undefined>) =>
    [...new Set(v.filter(presente).map(x => x.toLowerCase()))].filter(x => UUID.test(x))

  const idIva = validi(r.codiceIvaId)
  const idCodifiche = validi(...CODIFICHE.map(c => r[c.campo]))

  const iva = idIva.length
    ? await tx.$queryRaw<Array<{ id: string; attivo: boolean }>>`
        SELECT id::text AS id, attivo FROM "codici_iva"
        WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idIva}::uuid[]) FOR SHARE`
    : []
  const codifiche = idCodifiche.length
    ? await tx.$queryRaw<Array<{ id: string; attivo: boolean; genere: string }>>`
        SELECT id::text AS id, attiva AS attivo, genere::text AS genere FROM "codifiche_addebito"
        WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idCodifiche}::uuid[]) FOR SHARE`
    : []
  const perId = <R extends { id: string }>(righe: R[]) =>
    new Map(righe.map(x => [x.id.toLowerCase(), x]))
  const mIva = perId(iva)
  const mCodifiche = perId(codifiche)

  const errori: string[] = []
  const codifica = (c: (typeof CODIFICHE)[number]) => {
    const id = r[c.campo]
    if (!presente(id)) return
    const riga = mCodifiche.get(id.toLowerCase())
    if (!riga?.attivo || riga.genere !== c.genere) errori.push(c.messaggio)
  }
  codifica(CODIFICHE[0])
  if (presente(r.codiceIvaId) && !mIva.get(r.codiceIvaId.toLowerCase())?.attivo) {
    errori.push(MSG_IVA)
  }
  CODIFICHE.slice(1).forEach(codifica)
  return errori
}
