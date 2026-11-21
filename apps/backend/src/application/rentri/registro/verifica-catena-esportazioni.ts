/**
 * Verifica della catena delle esportazioni del registro (eREGI E6) dai SOLI dati salvati: eREGI del
 * registro e righe di `esportazioni_registro_rentri` (con l'XML gia' decompresso), in ordine di
 * catena. Non usa la rete. Controlla, per ogni esportazione:
 *  - SHA-256 del file e firma XMLDSig valida, con il `DigestValue` uguale a quello salvato;
 *  - l'eREGI incorporato identico (byte per byte) a quello del registro;
 *  - i `Ref`: il primo e' il digest dell'eREGI + `DataRichiesta`, i successivi sono digest e
 *    `DataCreazione` delle esportazioni precedenti, in ordine e senza buchi;
 *  - una sola `Registrazioni` con anno, intervallo, numero e `DataCreazione` uguali alla riga;
 *  - continuita' dei progressivi (stesso anno: dal successivo; anno nuovo: anno maggiore) e date
 *    crescenti.
 * Gli errori sono frasi senza dati del registro.
 */
import { createHash } from 'crypto'
import { DOMParser } from '@xmldom/xmldom'
import { leggiEregi } from '../../../infrastructure/rentri/eregi/leggi-eregi'
import { verificaFirmaXmlRegistro } from '../../../infrastructure/rentri/firma-xml-registro'
import { eregiVerbatim } from './serializza-registro-xml'

const NS_REG = 'urn:it:rentri:registri:1.0'

export interface EsportazioneDaVerificare {
  anno: number
  progressivoDa: number
  progressivoA: number
  numeroRegistrazioni: number
  dataCreazione: Date
  digestValue: string | null
  sha256File: string
  /** XML firmato, gia' decompresso. */
  xml: string
}

export interface EsitoVerificaCatena {
  valida: boolean
  errori: string[]
}

function figli(padre: Element, nomeLocale: string): Element[] {
  const r: Element[] = []
  for (let n = padre.firstChild; n; n = n.nextSibling) {
    if (
      n.nodeType === 1 &&
      (n as Element).localName === nomeLocale &&
      (n as Element).namespaceURI === NS_REG
    ) {
      r.push(n as Element)
    }
  }
  return r
}

export async function verificaCatenaEsportazioni(
  eregXml: string,
  esportazioni: EsportazioneDaVerificare[]
): Promise<EsitoVerificaCatena> {
  const errori: string[] = []
  let ereg
  try {
    ereg = leggiEregi(eregXml)
  } catch {
    return { valida: false, errori: ["l'eREGI del registro non e' leggibile"] }
  }
  const eregVerbatim = eregiVerbatim(eregXml)

  esportazioni.forEach((e, i) => {
    const n = i + 1
    const errore = (m: string) => errori.push(`esportazione ${n}: ${m}`)

    if (createHash('sha256').update(e.xml, 'utf8').digest('hex') !== e.sha256File) {
      errore('lo SHA-256 del file non corrisponde')
    }
    const firma = verificaFirmaXmlRegistro(e.xml)
    if (!firma.valida) errore('la firma non e valida')
    else if (firma.digestValue !== e.digestValue)
      errore('il digest salvato non e quello della firma')
    if (!e.xml.includes(eregVerbatim)) errore("l'eREGI incorporato non e quello del registro")

    let radice: Element | null = null
    try {
      radice = new DOMParser({
        onError: l => {
          if (l !== 'warning') throw new Error('xml')
        },
      }).parseFromString(e.xml, 'text/xml').documentElement as unknown as Element
    } catch {
      errore('XML non ben formato')
      return
    }
    const contenitore = figli(radice, 'RiferimentiPrecedenti')[0]
    const refs = contenitore ? figli(contenitore, 'Ref') : []
    const attesi = [
      { digest: ereg.digest, data: ereg.dataRichiesta },
      ...esportazioni.slice(0, i).map(p => ({
        digest: p.digestValue,
        data: p.dataCreazione.toISOString(),
      })),
    ]
    if (refs.length !== attesi.length) {
      errore('la catena dei riferimenti non ha il numero atteso di anelli')
    } else {
      refs.forEach((r, j) => {
        if (
          r.getAttribute('DigestValue') !== attesi[j].digest ||
          r.getAttribute('DataCreazione') !== attesi[j].data
        ) {
          errore(`l'anello ${j + 1} della catena non corrisponde`)
        }
      })
    }

    const gruppi = figli(radice, 'Registrazioni')
    if (gruppi.length !== 1) {
      errore('deve contenere una sola serie di registrazioni')
    } else {
      const g = gruppi[0]
      const coincide =
        g.getAttribute('Anno') === String(e.anno) &&
        g.getAttribute('ProgressivoDa') === String(e.progressivoDa) &&
        g.getAttribute('ProgressivoA') === String(e.progressivoA) &&
        g.getAttribute('NumeroRegistrazioni') === String(e.numeroRegistrazioni) &&
        g.getAttribute('DataCreazione') === e.dataCreazione.toISOString()
      if (!coincide) errore("l'intervallo o la data nel file non corrispondono alla riga salvata")
    }

    const p = esportazioni[i - 1]
    if (p) {
      const continua = e.anno === p.anno ? e.progressivoDa === p.progressivoA + 1 : e.anno > p.anno
      if (!continua) errore('i progressivi non proseguono quelli della precedente')
      if (e.dataCreazione.getTime() <= p.dataCreazione.getTime()) {
        errore('la data di creazione non e successiva a quella della precedente')
      }
    }
  })

  return { valida: errori.length === 0, errori }
}
