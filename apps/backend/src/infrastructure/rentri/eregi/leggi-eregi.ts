import { DOMParser } from '@xmldom/xmldom'
import * as xpath from 'xpath'

/** Dati dell'eREGI (vidimazione virtuale RENTRI) che servono a costruire la catena delle esportazioni. */
export interface DatiEregi {
  /** `DigestValue` (base64) del `Reference URI="#eREGI-CS-0"` della firma dell'ente. */
  digest: string
  /** `DataRichiesta` così com'è nell'XML (data ISO 8601). */
  dataRichiesta: string
  /** Identificativo del registro (`R` + 10 caratteri). */
  identificativo: string
  /** `NumIscrSito` così com'è nell'XML (nessun pattern: lo emette l'ente). */
  numIscrSito: string
}

/**
 * L'XML non è un eREGI affidabile. Il messaggio non riporta mai contenuto
 * dell'XML (può contenere dati dell'operatore): solo il motivo.
 */
export class EregiNonValidoError extends Error {
  constructor(motivo: string) {
    super(`eREGI non valido: ${motivo}`)
    this.name = 'EregiNonValidoError'
  }
}

const NS_REG = 'urn:it:rentri:registri:1.0'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
const ID_EREGI = 'eREGI-CS-0'
const PATTERN_IDENTIFICATIVO = /^R[0-9A-Z]{10}$/
const PATTERN_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const PATTERN_DATA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
const select = xpath.useNamespaces({ reg: NS_REG, ds: NS_DS })

/**
 * Legge dall'eREGI i quattro dati usati dalla catena dei digest delle
 * esportazioni (E6): funzione pura, nessuna I/O.
 *
 * **Fail-closed.** Qualunque scostamento dalla forma attesa è un
 * {@link EregiNonValidoError}, mai un valore di ripiego: radice `reg:eREGI`
 * con `Id="eREGI-CS-0"`; esattamente UNA `ds:Signature` figlia diretta con
 * esattamente UN `ds:Reference` e con `URI="#eREGI-CS-0"`; `DigestValue` base64
 * non vuoto; identificativo, `DataRichiesta` e `NumIscrSito` presenti e (per i
 * primi due) ben formati.
 *
 * **XXE.** Qualunque `<!DOCTYPE` (e quindi qualunque `<!ENTITY`) è rifiutato
 * PRIMA di passare l'XML al parser: l'eREGI dell'ente non ne ha bisogno e una
 * definizione di entità esterna o ricorsiva è un vettore di lettura di file o di
 * esaurimento di memoria. Il controllo è sul testo, non sul risultato del parser.
 *
 * Non verifica la firma (è dell'ente e si usa VERBATIM): ne estrae solo il digest.
 */
export function leggiEregi(xml: string): DatiEregi {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new EregiNonValidoError('XML vuoto')
  }
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml)) {
    throw new EregiNonValidoError('DOCTYPE o definizione di entità non ammessi')
  }

  const problemi: string[] = []
  const segnala = (): void => {
    problemi.push('XML non ben formato')
  }
  const documento = new DOMParser({
    errorHandler: { warning: segnala, error: segnala, fatalError: segnala },
  }).parseFromString(xml, 'text/xml')

  const radice = documento?.documentElement
  if (problemi.length > 0 || !radice) {
    throw new EregiNonValidoError('XML non ben formato')
  }
  if (radice.localName !== 'eREGI' || radice.namespaceURI !== NS_REG) {
    throw new EregiNonValidoError('radice diversa da reg:eREGI')
  }
  if (radice.getAttribute('Id') !== ID_EREGI) {
    throw new EregiNonValidoError(`attributo Id diverso da ${ID_EREGI}`)
  }

  const nodi = (espressione: string): Element[] =>
    select(espressione, radice as unknown as Node) as unknown as Element[]
  const testoUnico = (nome: string): string => {
    const trovati = nodi(`./reg:${nome}`)
    const valore = trovati.length === 1 ? (trovati[0].textContent ?? '').trim() : ''
    if (valore === '') throw new EregiNonValidoError(`${nome} assente, vuoto o ripetuto`)
    return valore
  }

  const identificativo = testoUnico('Identificativo')
  if (!PATTERN_IDENTIFICATIVO.test(identificativo)) {
    throw new EregiNonValidoError('Identificativo malformato')
  }
  const dataRichiesta = testoUnico('DataRichiesta')
  if (!PATTERN_DATA.test(dataRichiesta) || Number.isNaN(Date.parse(dataRichiesta))) {
    throw new EregiNonValidoError('DataRichiesta non è una data ISO 8601')
  }
  const numIscrSito = testoUnico('NumIscrSito')

  if (nodi('./ds:Signature').length !== 1) {
    throw new EregiNonValidoError('attesa esattamente una ds:Signature figlia della radice')
  }
  const riferimenti = nodi('./ds:Signature/ds:SignedInfo/ds:Reference')
  if (riferimenti.length !== 1) {
    throw new EregiNonValidoError('attesa esattamente un ds:Reference nella firma')
  }
  if (riferimenti[0].getAttribute('URI') !== `#${ID_EREGI}`) {
    throw new EregiNonValidoError(`ds:Reference diverso da URI="#${ID_EREGI}"`)
  }
  const digestNodi = nodi('./ds:Signature/ds:SignedInfo/ds:Reference/ds:DigestValue')
  const digest = digestNodi.length === 1 ? (digestNodi[0].textContent ?? '').trim() : ''
  if (!PATTERN_BASE64.test(digest)) {
    throw new EregiNonValidoError('DigestValue assente o non base64')
  }

  return { digest, dataRichiesta, identificativo, numIscrSito }
}
