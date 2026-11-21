/**
 * Costruzione di UNA esportazione XML del registro (eREGI E6): funzione che compone i pezzi gia'
 * esistenti, senza database ne' rete. Serializza (eREGI verbatim + catena dei `Ref` + una
 * `Registrazioni`), valida contro gli XSD, firma (XMLDSig enveloped, E5), riverifica la firma e
 * rivalida il documento firmato. Qualunque anomalia e' un {@link EsportazioneRegistroNonValidaError}
 * e NESSUN file viene prodotto: il chiamante non salva nulla.
 *
 * La catena dei digest (ipotesi da WinWaste, R1 del piano, da provare sul demo RENTRI):
 *  - `Ref[0]` = `DigestValue` del `Reference URI="#eREGI-CS-0"` dell'eREGI + `DataRichiesta`, letti
 *    dall'eREGI stesso (testo verbatim, mai da una colonna ricostruita);
 *  - `Ref[i]` (i >= 1) = `DigestValue` del `Reference URI=""` della i-esima esportazione precedente
 *    e la sua `DataCreazione`, in ordine.
 */
import { createHash, X509Certificate } from 'crypto'
import { gzipSync } from 'zlib'
import { leggiEregi, EregiNonValidoError } from '../../../infrastructure/rentri/eregi/leggi-eregi'
import {
  FirmaXmlRegistroError,
  firmaXmlRegistro,
  verificaFirmaXmlRegistro,
  type MaterialeFirmaRegistro,
} from '../../../infrastructure/rentri/firma-xml-registro'
import { validaXmlRegistro } from '../../../infrastructure/rentri/valida-xml-registro'
import {
  XmlRegistroNonSerializzabileError,
  serializzaRegistro,
  type VoceRegistro,
} from './serializza-registro-xml'

/** Limite del file accettato da RENTRI (`/valida`): 10 MB. Si resta sotto, con margine per il base64. */
export const DIMENSIONE_MASSIMA_XML_ESPORTAZIONE = 7 * 1024 * 1024

/** L'esportazione non si puo' costruire. Il messaggio non riporta mai dati del registro. */
export class EsportazioneRegistroNonValidaError extends Error {
  constructor(
    motivo: string,
    readonly dettagli: string[] = []
  ) {
    super(`Esportazione del registro non valida: ${motivo}`)
    this.name = 'EsportazioneRegistroNonValidaError'
  }
}

export interface RiferimentoEsportazionePrecedente {
  /** `digest_value` dell'esportazione precedente. */
  digestValue: string
  dataCreazione: Date
}

export interface InputCostruisciEsportazione {
  /** eREGI scaricato da RENTRI, cosi' com'e' (verbatim). */
  eregXml: string
  /** Esportazioni precedenti DELLO STESSO registro, in ordine di catena (dalla prima). */
  precedenti: RiferimentoEsportazionePrecedente[]
  anno: number
  progressivoDa: number
  /** Una voce per progressivo, in ordine: `voci.length` = numero di registrazioni. */
  voci: VoceRegistro[]
  dataCreazione: Date
  materiale: MaterialeFirmaRegistro
}

export interface EsportazioneCostruita {
  /** XML firmato (UTF-8). */
  xml: string
  /** `DigestValue` della firma: il `Ref` della prossima esportazione. */
  digestValue: string
  /** SHA-256 (esadecimale) dei byte UTF-8 di `xml`. */
  sha256File: string
  /** Impronta SHA-256 (esadecimale) del certificato che ha firmato. */
  certificatoSha256: string
  progressivoA: number
  numeroRegistrazioni: number
}

/** Impronta SHA-256 del certificato, esadecimale minuscola senza due punti. */
export function impronta(certificatePem: string): string {
  return new X509Certificate(certificatePem).fingerprint256.replace(/:/g, '').toLowerCase()
}

/** XML -> byte compressi per la colonna `xml`. */
export const comprimiXml = (xml: string): Buffer => gzipSync(Buffer.from(xml, 'utf8'))

export async function costruisciEsportazioneRegistro(
  input: InputCostruisciEsportazione
): Promise<EsportazioneCostruita> {
  if (!Number.isInteger(input.progressivoDa) || input.progressivoDa < 1 || input.voci.length < 1) {
    throw new EsportazioneRegistroNonValidaError("l'intervallo di progressivi non e' valido")
  }
  const progressivoA = input.progressivoDa + input.voci.length - 1
  const dataCreazione = input.dataCreazione.toISOString()

  let ereg
  try {
    ereg = leggiEregi(input.eregXml)
  } catch (e) {
    if (e instanceof EregiNonValidoError) {
      throw new EsportazioneRegistroNonValidaError("l'eREGI del registro non e' leggibile")
    }
    throw e
  }

  let nonFirmato: string
  try {
    nonFirmato = serializzaRegistro({
      eregXml: input.eregXml,
      riferimenti: [
        { digestValue: ereg.digest, dataCreazione: ereg.dataRichiesta },
        ...input.precedenti.map(p => ({
          digestValue: p.digestValue,
          dataCreazione: p.dataCreazione.toISOString(),
        })),
      ],
      registrazioni: [
        {
          anno: input.anno,
          progressivoDa: input.progressivoDa,
          progressivoA,
          dataCreazione,
          voci: input.voci,
        },
      ],
    })
  } catch (e) {
    if (e instanceof XmlRegistroNonSerializzabileError) {
      throw new EsportazioneRegistroNonValidaError(
        'le annotazioni non si possono scrivere nell XML del registro',
        [e.message]
      )
    }
    throw e
  }
  if (nonFirmato.length > DIMENSIONE_MASSIMA_XML_ESPORTAZIONE) {
    throw new EsportazioneRegistroNonValidaError(
      'il file supera la dimensione massima accettata da RENTRI: esportare meno annotazioni per volta'
    )
  }

  const xsd = await validaXmlRegistro(nonFirmato)
  if (!xsd.valido) {
    throw new EsportazioneRegistroNonValidaError('il file non rispetta gli schemi XSD', xsd.errori)
  }

  let firmato
  try {
    firmato = firmaXmlRegistro(nonFirmato, input.materiale)
  } catch (e) {
    if (e instanceof FirmaXmlRegistroError) {
      throw new EsportazioneRegistroNonValidaError('firma non riuscita', [e.message])
    }
    throw e
  }
  const verifica = verificaFirmaXmlRegistro(firmato.xml)
  if (!verifica.valida || verifica.digestValue !== firmato.digestValue) {
    throw new EsportazioneRegistroNonValidaError('la firma appena prodotta non si verifica')
  }
  const xsdFirmato = await validaXmlRegistro(firmato.xml)
  if (!xsdFirmato.valido) {
    throw new EsportazioneRegistroNonValidaError(
      'il file firmato non rispetta gli schemi XSD',
      xsdFirmato.errori
    )
  }

  return {
    xml: firmato.xml,
    digestValue: firmato.digestValue,
    sha256File: createHash('sha256').update(firmato.xml, 'utf8').digest('hex'),
    certificatoSha256: impronta(input.materiale.certificatePem),
    progressivoA,
    numeroRegistrazioni: input.voci.length,
  }
}
