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
const PATTERN_DATA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/
const DIGEST_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const BYTE_DIGEST_SHA256 = 32

/**
 * Tetto di lunghezza dell'input (caratteri). Un eREGI pesa pochi KB: il tetto
 * esiste contro l'input patologico (parsing e ricerche con costo non lineare),
 * non come limite di dominio.
 */
export const LUNGHEZZA_MASSIMA_EREGI = 5 * 1024 * 1024
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
/** `true` se `testo` è una data/ora ISO 8601 esistente (31 febbraio e ora 25 non passano il rollover di `Date`). */
function dataIsoEsistente(testo: string): boolean {
  const m = PATTERN_DATA.exec(testo)
  if (!m) return false
  const [anno, mese, giorno, ora, minuti, secondi] = m.slice(1, 7).map(Number)
  if (ora > 23 || minuti > 59 || secondi > 59) return false
  const d = new Date(Date.UTC(anno, mese - 1, giorno))
  return d.getUTCFullYear() === anno && d.getUTCMonth() === mese - 1 && d.getUTCDate() === giorno
}

/** SHA-256 in base64 canonico: 32 byte che ricodificati danno lo stesso testo. */
function digestSha256Valido(testo: string): boolean {
  if (!PATTERN_BASE64.test(testo) || testo.length % 4 !== 0) return false
  const byte = Buffer.from(testo, 'base64')
  return byte.length === BYTE_DIGEST_SHA256 && byte.toString('base64') === testo
}

export function leggiEregi(xml: string): DatiEregi {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new EregiNonValidoError('XML vuoto')
  }
  // Un solo BOM UTF-8 iniziale e' legittimo (la vidimazione dell'ente puo' averlo, e il
  // client lo conserva byte per byte) ma xmldom 0.9 lo rifiuta: lo si toglie PRIMA di
  // tetto, DOCTYPE e parse. Un secondo BOM resta e fa fallire il parse.
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1)
  if (xml.trim() === '') throw new EregiNonValidoError('XML vuoto')
  if (xml.length > LUNGHEZZA_MASSIMA_EREGI) {
    throw new EregiNonValidoError('lunghezza oltre il tetto ammesso')
  }
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml)) {
    throw new EregiNonValidoError('DOCTYPE o definizione di entità non ammessi')
  }

  // Fail-closed su QUALUNQUE segnalazione del parser (warning, error, fatalError):
  // con xmldom 0.9 `onError` le riceve tutte, e i fatali lanciano anche `ParseError`.
  let problemi = 0
  let documento: ReturnType<DOMParser['parseFromString']>
  try {
    documento = new DOMParser({
      onError: () => {
        problemi++
      },
    }).parseFromString(xml, 'text/xml')
  } catch {
    throw new EregiNonValidoError('XML non ben formato')
  }

  const radice = documento?.documentElement
  if (problemi > 0 || !radice) {
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
  if (!dataIsoEsistente(dataRichiesta)) {
    throw new EregiNonValidoError('DataRichiesta non è una data ISO 8601')
  }
  const numIscrSito = testoUnico('NumIscrSito')

  // Un solo elemento con Id="eREGI-CS-0" in tutto il documento: la radice. Un secondo
  // (signature wrapping) renderebbe ambiguo a chi punta il Reference.
  if (nodi(`//*[@Id="${ID_EREGI}"]`).length !== 1) {
    throw new EregiNonValidoError(`attesa esattamente un elemento con Id="${ID_EREGI}"`)
  }

  // Struttura univoca, ricerca RELATIVA da ogni nodo trovato: una firma, una SignedInfo,
  // un Reference. XMLDSig considera la prima SignedInfo: con due, il digest potrebbe
  // venire da una che non è quella firmata.
  const relativi = (da: Element, espressione: string): Element[] =>
    select(espressione, da as unknown as Node) as unknown as Element[]
  const unico = (elementi: Element[], descrizione: string): Element => {
    if (elementi.length !== 1) throw new EregiNonValidoError(`attesa esattamente ${descrizione}`)
    return elementi[0]
  }

  const firma = unico(nodi('./ds:Signature'), 'una ds:Signature figlia della radice')
  const signedInfo = unico(relativi(firma, './ds:SignedInfo'), 'una ds:SignedInfo nella firma')
  const riferimento = unico(relativi(signedInfo, './ds:Reference'), 'un ds:Reference nella firma')
  if (riferimento.getAttribute('URI') !== `#${ID_EREGI}`) {
    throw new EregiNonValidoError(`ds:Reference diverso da URI="#${ID_EREGI}"`)
  }
  const metodo = unico(relativi(riferimento, './ds:DigestMethod'), 'un ds:DigestMethod')
  if (metodo.getAttribute('Algorithm') !== DIGEST_SHA256) {
    throw new EregiNonValidoError('ds:DigestMethod diverso da SHA-256')
  }
  const digestNodo = unico(relativi(riferimento, './ds:DigestValue'), 'un ds:DigestValue')
  const digest = (digestNodo.textContent ?? '').trim()
  if (!digestSha256Valido(digest)) {
    throw new EregiNonValidoError('DigestValue assente o non è un SHA-256 in base64')
  }

  return { digest, dataRichiesta, identificativo, numIscrSito }
}
