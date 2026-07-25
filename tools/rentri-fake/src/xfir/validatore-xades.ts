import { DOMParser } from '@xmldom/xmldom'
import xpath from 'xpath'

export interface FirmaXades {
  nomeFile: string
  riferimenti: string[]
}

const NS = { ds: 'http://www.w3.org/2000/09/xmldsig#' }

/**
 * Estrae gli URI dei Reference di una firma XAdES detached.
 */
export function estraiRiferimenti(nomeFile: string, xml: string): FirmaXades {
  const documento = new DOMParser().parseFromString(xml, 'text/xml')
  const seleziona = xpath.useNamespaces(NS)
  const nodi = seleziona('//ds:Reference/@URI', documento as unknown as Node) as Attr[]

  return { nomeFile, riferimenti: nodi.map((nodo) => nodo.value) }
}

/**
 * Regola di copertura RENTRI: ogni firma deve referenziare TUTTI gli XML gia'
 * presenti nel container. Una firma che ne salta uno rende l'xFIR invalido.
 */
export function verificaCopertura(
  firme: FirmaXades[],
  xmlPresenti: string[]
): { valido: true } | { valido: false; motivo: string } {
  for (const firma of firme) {
    const mancanti = xmlPresenti.filter((xml) => !firma.riferimenti.includes(xml))

    if (mancanti.length > 0) {
      return {
        valido: false,
        motivo: `la firma ${firma.nomeFile} non copre: ${mancanti.join(', ')}`,
      }
    }
  }

  return { valido: true }
}
