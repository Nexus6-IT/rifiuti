/**
 * PDF della ricevuta di ritiro (app campo, P6). Si genera sul SERVER dai dati del ritiro letti dal
 * database (mai dal telefono) piu' la firma, con la stessa libreria delle altre stampe (pdfmake,
 * `creaStampantePdf`). `definizioneRicevuta` e' pura (testabile senza rendering).
 *
 * La ricevuta e' una FIRMA ELETTRONICA SEMPLICE: l'immagine del tratto sul telefono, il nome di chi
 * firma e l'ora. Non e' una firma qualificata, non e' una firma avanzata e NON sostituisce il FIR:
 * le due diciture stanno su ogni ricevuta. Il PDF porta l'impronta SHA-256 del contenuto firmato
 * (dati + nome + ora + firma); l'impronta del file intero la calcola e conserva il servizio.
 */
import { createHash } from 'crypto'
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { creaStampantePdf } from '../../infrastructure/pdf/pdf.service'

export const DICITURA_NON_SOSTITUISCE_FIR =
  'Questa ricevuta non sostituisce il FIR (formulario di identificazione del rifiuto) né alcun altro documento previsto dalla legge.'
export const DICITURA_FIRMA_SEMPLICE =
  'Firma elettronica semplice: immagine del tratto acquisita su schermo. Non è una firma elettronica qualificata né avanzata; vale come prova commerciale del ritiro.'

/** Dati del ritiro stampati sulla ricevuta: fotografia presa dal server al momento della firma. */
export interface DatiRicevuta {
  versione: 1
  azienda: string
  trasportatore: string
  autista: string
  targa: string | null
  /** `AAAA-MM-GG` */
  dataRitiro: string
  cliente: string
  indirizzoCliente: string
  cerCode: string
  descrizione: string
  /** Decimale in stringa, come nel ritiro. E' una quantita PRESUNTA, non una pesata. */
  quantitaPresunta: string
  unita: string
}

export interface IngressoRicevuta {
  ricevutaUuid: string
  ritiroId: string
  dati: DatiRicevuta
  firmatarioNome: string
  /** Orologio del telefono. */
  firmatoIl: Date
  /** Ora del server. */
  ricevutoIl: Date
  firmaPng: Buffer
  firmaSha256: string
}

/**
 * Impronta SHA-256 del contenuto firmato: JSON a chiavi in ordine fisso, quindi uguale a ogni
 * calcolo. Cambia se cambia uno qualsiasi dei dati, il nome, l'ora o i byte della firma.
 */
export function calcolaContenutoSha256(i: IngressoRicevuta): string {
  const d = i.dati
  const canonico = JSON.stringify({
    v: 1,
    ricevuta: i.ricevutaUuid,
    ritiro: i.ritiroId,
    azienda: d.azienda,
    trasportatore: d.trasportatore,
    autista: d.autista,
    targa: d.targa,
    dataRitiro: d.dataRitiro,
    cliente: d.cliente,
    indirizzoCliente: d.indirizzoCliente,
    cerCode: d.cerCode,
    descrizione: d.descrizione,
    quantitaPresunta: d.quantitaPresunta,
    unita: d.unita,
    firmatario: i.firmatarioNome,
    firmatoIl: i.firmatoIl.toISOString(),
    firmaSha256: i.firmaSha256,
  })
  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

const dataOra = (d: Date): string =>
  new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)

const dataIt = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** `250.00` → `250,00` (solo la virgola: la quantita non passa da `number`). */
const quantitaIt = (q: string): string => q.replace('.', ',')

export function definizioneRicevuta(
  i: IngressoRicevuta,
  contenutoSha256: string
): TDocumentDefinitions {
  const d = i.dati
  const riga = (etichetta: string, valore: string): Content[] =>
    [{ text: etichetta, style: 'etichetta' }, { text: valore }] as Content[]
  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    info: { title: 'Ricevuta di ritiro', subject: 'Ricevuta di ritiro (non sostituisce il FIR)' },
    defaultStyle: { fontSize: 10 },
    styles: {
      titolo: { fontSize: 18, bold: true },
      etichetta: { fontSize: 8, color: '#555555', bold: true },
      piccolo: { fontSize: 8, color: '#444444' },
      impronta: { fontSize: 7, color: '#444444' },
    },
    content: [
      { text: 'Ricevuta di ritiro', style: 'titolo' },
      { text: d.azienda, margin: [0, 2, 0, 10] },
      {
        table: { widths: ['*'], body: [[{ text: DICITURA_NON_SOSTITUISCE_FIR, bold: true }]] },
        layout: {
          hLineWidth: () => 1.2,
          vLineWidth: () => 1.2,
          hLineColor: () => '#000000',
          vLineColor: () => '#000000',
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 12],
      } as Content,
      {
        table: {
          widths: [110, '*'],
          body: [
            riga('Data del ritiro', dataIt(d.dataRitiro)),
            riga('Cliente (produttore)', d.cliente),
            riga('Indirizzo', d.indirizzoCliente),
            riga('Rifiuto (CER)', `${d.cerCode} - ${d.descrizione}`),
            riga(
              'Quantità presunta',
              `${quantitaIt(d.quantitaPresunta)} ${d.unita} (indicativa, non è una pesata)`
            ),
            riga('Trasportatore', d.trasportatore),
            riga('Autista', d.autista),
            ...(d.targa ? [riga('Automezzo', d.targa)] : []),
          ],
        },
        layout: 'lightHorizontalLines',
      } as Content,
      { text: 'Firma di chi consegna il rifiuto', style: 'etichetta', margin: [0, 16, 0, 4] },
      {
        image: `data:image/png;base64,${i.firmaPng.toString('base64')}`,
        fit: [300, 120],
        margin: [0, 0, 0, 4],
      } as Content,
      { text: `Firmatario: ${i.firmatarioNome}`, bold: true },
      {
        text: `Firmata il ${dataOra(i.firmatoIl)} (ora indicata dal telefono dell'autista)`,
        style: 'piccolo',
      },
      {
        text: `Ricevuta dal sistema il ${dataOra(i.ricevutoIl)}`,
        style: 'piccolo',
      },
      { text: DICITURA_FIRMA_SEMPLICE, style: 'piccolo', margin: [0, 12, 0, 8] },
      { text: 'Impronta SHA-256 del contenuto firmato', style: 'etichetta' },
      { text: contenutoSha256, style: 'impronta' },
      {
        text: 'Impronta SHA-256 dell’immagine della firma',
        style: 'etichetta',
        margin: [0, 4, 0, 0],
      },
      { text: i.firmaSha256, style: 'impronta' },
    ],
  }
}

// Le font si decodificano una volta sola.
let stampante: ReturnType<typeof creaStampantePdf> | undefined

/** Rende la ricevuta in PDF e restituisce i byte. */
export async function generaPdfRicevuta(
  i: IngressoRicevuta,
  contenutoSha256: string
): Promise<Buffer> {
  stampante ??= creaStampantePdf()
  const doc = stampante.createPdfKitDocument(definizioneRicevuta(i, contenutoSha256))
  return new Promise<Buffer>((risolvi, rifiuta) => {
    const pezzi: Buffer[] = []
    doc.on('data', (c: Buffer) => pezzi.push(c))
    doc.on('end', () => risolvi(Buffer.concat(pezzi)))
    doc.on('error', rifiuta)
    doc.end()
  })
}
