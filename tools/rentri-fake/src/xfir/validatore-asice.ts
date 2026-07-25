import JSZip from 'jszip'
import { estraiRiferimenti, verificaCopertura, FirmaXades } from './validatore-xades'

export type EsitoValidazione =
  | { valido: true; xmlPresenti: string[]; firme: string[] }
  | { valido: false; motivo: string }

const MIMETYPE_ATTESO = 'application/vnd.etsi.asic-e+zip'

/**
 * Valida un container xFIR: deve essere uno ZIP ASiC-E, contenere almeno una
 * firma XAdES in META-INF/, e rispettare la regola di copertura.
 */
export async function validaAsicE(contenuto: Buffer): Promise<EsitoValidazione> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(contenuto)
  } catch {
    return { valido: false, motivo: "il contenuto non e' un archivio ZIP valido" }
  }

  const fileMimetype = zip.file('mimetype')
  if (!fileMimetype) {
    return { valido: false, motivo: "file mimetype assente: non e' un container ASiC-E" }
  }

  const mimetype = (await fileMimetype.async('string')).trim()
  if (mimetype !== MIMETYPE_ATTESO) {
    return { valido: false, motivo: `mimetype inatteso: ${mimetype}` }
  }

  const nomi = Object.keys(zip.files)
  const xmlPresenti = nomi.filter((n) => n.endsWith('.xml') && !n.startsWith('META-INF/'))
  const nomiFirme = nomi.filter((n) => n.startsWith('META-INF/') && n.endsWith('.xml'))

  if (nomiFirme.length === 0) {
    return { valido: false, motivo: 'nessuna firma XAdES presente in META-INF/' }
  }

  const firme: FirmaXades[] = []
  for (const nome of nomiFirme) {
    const xml = await zip.files[nome].async('string')
    firme.push(estraiRiferimenti(nome, xml))
  }

  const copertura = verificaCopertura(firme, xmlPresenti)
  if (!copertura.valido) {
    return { valido: false, motivo: copertura.motivo }
  }

  return { valido: true, xmlPresenti, firme: nomiFirme }
}
