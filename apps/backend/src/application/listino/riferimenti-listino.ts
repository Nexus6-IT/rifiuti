// Controllo dei riferimenti di un addebito del listino (4.2a, R8): codice IVA e codifiche di
// addebito (gruppo, categoria, centro di ricavo, categorie statistiche). Esistenza nell'azienda,
// stato attivo e genere della codifica: la FK composita dell'addebito non controlla il genere.
//
// Una query per tabella con `SELECT ... FOR SHARE` (R24 della 4.1b): le righe scelte restano
// bloccate fino al commit di chi le sceglie, cosi' una disattivazione concorrente aspetta invece
// di lasciare un addebito con un riferimento disattivato. Nessun messaggio riporta id o dati.
import { Prisma } from '@prisma/client'
import { normalizzaCodiceAddebito } from '../../domain/listino/addebito'
import { formaCerValida, type CampoRiga, type ErroreRiga } from '../../domain/listino/riga-addebito'
import { cerCanonico } from '../../domain/waste-movement/cer-registro'

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

// ---------------------------------------------------------------------------------------------
// Riferimenti di una riga di addebito (4.2b, R41)
// ---------------------------------------------------------------------------------------------

export interface RiferimentiRiga {
  addebitoId?: string | null
  codiceIvaId?: string | null
  categoriaId?: string | null
  centroRicavoId?: string | null
  /** Codice RENTRI (`external_id`) della tabella `stati-fisici`. */
  statoFisico?: string | null
  /** Codice RENTRI (`external_id`) della tabella `attivita-rs`. */
  operazione?: string | null
  /** Codici dell'archivio, anche non normalizzati a cinque cifre. */
  addebitiProposti?: readonly string[]
  /** `CER`, `CER/RIF`, `CER/*` o `CER/`: del CER si controlla l'esistenza nel catalogo. */
  cerProposta?: readonly string[]
}

const MSG_ADDEBITO = 'L’addebito scelto non esiste o è disattivato.'
const MSG_STATO_FISICO = 'Lo stato fisico scelto non è tra le codifiche RENTRI.'
const MSG_OPERAZIONE = 'L’operazione scelta non è tra le attività RENTRI.'
/** D10: il CER di una riga (e dei CER proposti) deve stare nel catalogo. */
export const MSG_CER_NON_NEL_CATALOGO = 'Il codice CER non è nel catalogo o indica un capitolo.'

/** Il campo della riga a cui appartiene ciascun messaggio di `controllaRiferimentiListino`. */
const CAMPO_DEL_MESSAGGIO = new Map<string, CampoRiga>([
  [MSG_IVA, 'codiceIvaId'],
  ...CODIFICHE.map(c => [c.messaggio, c.campo as CampoRiga] as [string, CampoRiga]),
])

/**
 * Errori dei riferimenti di una riga di addebito (vuoto = tutti validi), ciascuno col suo campo
 * (R36). Si passano solo i campi cambiati e non null: gli altri non si leggono. Va chiamata nella
 * transazione che poi scrive la riga:
 * - addebito d'archivio `FOR SHARE` (esiste, attivo, tipo diverso da `CER`), cosi' una variazione o
 *   una disattivazione concorrente aspetta (oltre 5 s diventa P2028 -> 409, R28);
 * - codice IVA, categoria e centro di ricavo come `controllaRiferimentiListino`;
 * - stato fisico e operazione contro `rentri_codifiche_semplici` per `external_id`, senza lock
 *   (catalogo globale);
 * - `addebitiProposti`: codici dell'archivio di tipo `V`, senza lock (sono proposte, non FK);
 * - `cerProposta`: ogni CER (la parte prima della barra) esiste nel catalogo.
 */
export async function controllaRiferimentiRiga(
  tx: Prisma.TransactionClient,
  tenantId: string,
  r: RiferimentiRiga
): Promise<ErroreRiga[]> {
  const errori: ErroreRiga[] = []
  const e = (campo: CampoRiga, messaggio: string) => errori.push({ campo, messaggio })

  if (presente(r.addebitoId)) {
    const id = r.addebitoId.toLowerCase()
    const trovati = UUID.test(id)
      ? await tx.$queryRaw<Array<{ attivo: boolean; tipo: string }>>`
          SELECT attivo, tipo FROM "addebiti"
          WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR SHARE`
      : []
    if (trovati.length === 0 || !trovati[0].attivo || trovati[0].tipo === 'CER') {
      e('addebitoId', MSG_ADDEBITO)
    }
  }

  const messaggi = await controllaRiferimentiListino(tx, tenantId, {
    codiceIvaId: r.codiceIvaId,
    categoriaId: r.categoriaId,
    centroRicavoId: r.centroRicavoId,
  })
  for (const m of messaggi) e(CAMPO_DEL_MESSAGGIO.get(m) ?? 'codiceIvaId', m)

  const codifica = async (
    campo: 'statoFisico' | 'operazione',
    tabella: string,
    codice: string | null | undefined,
    messaggio: string
  ) => {
    if (!presente(codice)) return
    const n = await tx.rentriCodificaSemplice.count({
      where: { tabella, externalId: codice, presenteInRentri: true },
    })
    if (n === 0) e(campo, messaggio)
  }
  await codifica('statoFisico', 'stati-fisici', r.statoFisico, MSG_STATO_FISICO)
  await codifica('operazione', 'attivita-rs', r.operazione, MSG_OPERAZIONE)

  if (r.addebitiProposti && r.addebitiProposti.length > 0) {
    const codici = r.addebitiProposti.map(c => normalizzaCodiceAddebito(c) ?? c)
    const esistenti = await tx.addebito.findMany({
      where: { tenantId, tipo: 'V', codice: { in: codici } },
      select: { codice: true },
    })
    const noti = new Set(esistenti.map(x => x.codice))
    codici.forEach((c, i) => {
      if (!noti.has(c)) {
        e(
          'addebitiProposti',
          `Addebito proposto ${i + 1}: il codice non è un addebito di tipo V dell’archivio.`
        )
      }
    })
  }

  if (r.cerProposta && r.cerProposta.length > 0) {
    const cer = r.cerProposta.map(el =>
      cerCanonico(el.includes('/') ? el.slice(0, el.indexOf('/')) : el)
    )
    const validi = cer.filter(formaCerValida)
    const candidati = [
      ...new Set(validi.flatMap(c => [c.replace(/\*$/, ''), `${c.replace(/\*$/, '')}*`])),
    ]
    const nelCatalogo = new Set(
      candidati.length === 0
        ? []
        : (
            await tx.cERCode.findMany({
              where: { code: { in: candidati } },
              select: { code: true },
            })
          ).map(x => x.code.replace(/\*$/, ''))
    )
    cer.forEach((c, i) => {
      // La forma sbagliata la segnala `validaRiga`: qui solo l'esistenza.
      if (formaCerValida(c) && !nelCatalogo.has(c.replace(/\*$/, ''))) {
        e('cerProposta', `CER proposto ${i + 1}: il codice CER non è nel catalogo.`)
      }
    })
  }
  return errori
}
