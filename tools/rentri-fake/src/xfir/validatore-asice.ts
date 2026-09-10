import JSZip from 'jszip'
import {
  estraiRiferimenti,
  verificaCopertura,
  verificaDigest,
  verificaFirmaCrittografica,
  FirmaXades,
} from './validatore-xades'

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

  // Solo i file `META-INF/*signatures*.xml` sono firme, per la convenzione
  // ASiC (ETSI TS 102 918): dentro META-INF/ vive anche `manifest.xml`, che
  // NON e' una firma.
  //
  // Prima qui si prendeva OGNI xml sotto META-INF/, manifest compreso: un
  // contenitore conforme, che il manifest ce l'ha, veniva letto come se
  // contenesse una «firma» priva di riferimenti e quindi RIFIUTATO. La
  // conseguenza pratica l'abbiamo vista subito: chi ha costruito il
  // contenitore lato backend ha smesso di produrre il manifest per far
  // passare la validazione, cioe' l'oracolo infedele stava facendo produrre
  // un contenitore non conforme. E' esattamente il danno che questo
  // strumento esiste per evitare.
  const nomiFirme = nomi.filter(
    (n) => n.startsWith('META-INF/') && n.endsWith('.xml') && /signatures/i.test(n)
  )

  if (nomiFirme.length === 0) {
    return {
      valido: false,
      motivo: 'nessuna firma XAdES presente in META-INF/ (attesa META-INF/*signatures*.xml)',
    }
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

  // FEDELTA.md §5.2 punto 6: prima di questa correzione ne' il DigestValue
  // ne' la firma crittografica venivano mai verificati, cosi' un container
  // in cui nessun byte era realmente firmato risultava "valido".
  const contenutiPerUri = new Map<string, Buffer>()
  for (const nome of xmlPresenti) {
    contenutiPerUri.set(nome, Buffer.from(await zip.files[nome].async('nodebuffer')))
  }

  for (const firma of firme) {
    const esitoDigest = verificaDigest(firma, contenutiPerUri)
    if (!esitoDigest.valido) {
      return { valido: false, motivo: esitoDigest.motivo }
    }

    const esitoFirma = verificaFirmaCrittografica(firma)
    if (!esitoFirma.valido) {
      return { valido: false, motivo: esitoFirma.motivo }
    }
  }

  return { valido: true, xmlPresenti, firme: nomiFirme }
}
