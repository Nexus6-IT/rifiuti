import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { formattaQuantita } from '../../core/format/formatta-quantita'
import { cerCanonico } from '../../domain/waste-movement/cer-registro'
import {
  haBloccanti,
  riepilogaAvvisi,
  type MudEsitoControllo,
  type RiepilogoAvvisi,
} from '../../application/mud/aggregazione/mud-controlli'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake/src/printer')
import { TDocumentDefinitions, Content } from 'pdfmake/interfaces'
import {
  contenutoFir,
  definizioneFir,
  definizioneFirInSerie,
  type FirConQr,
  type ModelloStampaFir,
} from './definizione-fir'
import {
  definizioneDistinta,
  type DatiDistinta,
  type ModelloStampaDistinta,
} from '../../application/ritiri/stampa/distinta-pdf'

/** Stampante pdfmake con i font Roboto incorporati: condivisa dai servizi che generano PDF. */
export function creaStampantePdf(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vfsFonts = require('pdfmake/build/vfs_fonts')
  const fonts = {
    Roboto: {
      normal: Buffer.from(vfsFonts['Roboto-Regular.ttf'], 'base64'),
      bold: Buffer.from(vfsFonts['Roboto-Medium.ttf'], 'base64'),
      italics: Buffer.from(vfsFonts['Roboto-Italic.ttf'], 'base64'),
      bolditalics: Buffer.from(vfsFonts['Roboto-MediumItalic.ttf'], 'base64'),
    },
  }
  return new PdfPrinter(fonts)
}

/**
 * PDF Service
 *
 * Generates PDF documents for FIRs and MUD reports using pdfmake.
 * Features:
 * - Professional formatting
 * - QR code embedding for verification
 * - Digital signature visualization
 * - Compliance with Italian standards
 */
@Injectable()
export class PDFService {
  private printer: any

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(PDFService.name)

    this.printer = creaStampantePdf()
  }

  /**
   * Generate FIR PDF. Il modello (opzionale) arriva gia' risolto: niente lettura dal database.
   */
  async generateFIRPDF(
    fir: any,
    qrCodeDataUrl?: string,
    modello?: ModelloStampaFir | null
  ): Promise<Buffer> {
    this.logger.info(`Generating FIR PDF: ${fir.firNumber}`)
    return this.rendiConFallbackLogo(modello, m => definizioneFir(fir, qrCodeDataUrl, m))
  }

  /** Un solo PDF per piu' FIR (serie), `copie` del modello per ciascuno. */
  async generateFIRSeriePDF(
    elementi: FirConQr[],
    modello?: ModelloStampaFir | null
  ): Promise<Buffer> {
    this.logger.info(`Generating FIR series PDF: ${elementi.length} FIR`)
    return this.rendiConFallbackLogo(modello, m => definizioneFirInSerie(elementi, m))
  }

  /** Distinta dei ritiri (T16): stesso motore e stesso ripiego senza logo dei FIR. */
  async generateDistintaPDF(
    dati: DatiDistinta,
    modello: ModelloStampaDistinta | null
  ): Promise<Buffer> {
    this.logger.info(`Generating distinta ritiri PDF: ${dati.righe.length} righe`)
    return this.rendiConFallbackLogo(modello, m => definizioneDistinta(dati, m ?? null))
  }

  /** Contenuto del FIR (usato dai test che ispezionano il documento). */
  private buildFIRContent(fir: any, qrCodeDataUrl?: string): Content[] {
    return contenutoFir(fir, qrCodeDataUrl)
  }

  /**
   * Un logo con i byte giusti ma non decodificabile (PNG corrotto) non deve bloccare la stampa
   * dei FIR dell'azienda: si rifa il documento senza logo e si segnala nel log (revisione I1).
   */
  private async rendiConFallbackLogo<M extends { logoBase64?: string | null }>(
    modello: M | null | undefined,
    costruisci: (m: M | null | undefined) => TDocumentDefinitions
  ): Promise<Buffer> {
    try {
      return await this.rendi(costruisci(modello))
    } catch (err) {
      if (!modello?.logoBase64) throw err
      this.logger.warn('Logo del modello di stampa non leggibile: PDF prodotto senza logo', {
        causa: err instanceof Error ? err.message : String(err),
      })
      return await this.rendi(costruisci({ ...modello, logoBase64: null }))
    }
  }

  private rendi(docDefinition: TDocumentDefinitions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const pdfDoc = this.printer.createPdfKitDocument(docDefinition)
      const chunks: Buffer[] = []

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk))
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)))
      pdfDoc.on('error', reject)

      pdfDoc.end()
    })
  }

  /**
   * Generate MUD Report PDF
   */
  async generateMUDPDF(report: any): Promise<Buffer> {
    this.logger.info(`Generating MUD PDF for year ${report.year}`)

    const docDefinition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],

      header: {
        text: `MUD - MODELLO UNICO DICHIARAZIONE ${report.year}`,
        style: 'header',
        alignment: 'center',
        margin: [0, 20, 0, 0],
      },

      footer: (currentPage: number, pageCount: number) => ({
        text: `Pagina ${currentPage} di ${pageCount}`,
        alignment: 'center',
        fontSize: 8,
        margin: [0, 0, 0, 20],
      }),

      content: this.buildMUDContent(report),

      styles: {
        header: {
          fontSize: 18,
          bold: true,
          color: '#2c3e50',
        },
        sectionHeader: {
          fontSize: 14,
          bold: true,
          color: '#34495e',
          margin: [0, 15, 0, 8],
        },
        summaryValue: {
          fontSize: 20,
          bold: true,
          color: '#27ae60',
        },
      },
    }

    return new Promise((resolve, reject) => {
      const pdfDoc = this.printer.createPdfKitDocument(docDefinition)
      const chunks: Buffer[] = []

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk))
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)))
      pdfDoc.on('error', reject)

      pdfDoc.end()
    })
  }

  /**
   * Contenuto del PDF MUD: lo stesso riepilogo della pagina (MUDGeneratorService), cioè le
   * righe, i controlli e gli avvisi dell'aggregazione da cui nasce il file telematico.
   */
  private buildMUDContent(report: any): Content[] {
    const content: Content[] = []
    const controlli: MudEsitoControllo[] = report.controlli ?? []

    if (report.mudNonDovuto) {
      content.push({
        text: "L'azienda è segnata come non tenuta alla presentazione del MUD.",
        bold: true,
        margin: [0, 0, 0, 8],
      })
    }
    if (haBloccanti(controlli)) {
      const bloccanti = controlli.filter(c => c.gravita === 'BLOCCANTE')
      content.push({
        text: `Riepilogo NON utilizzabile per la dichiarazione: ci sono errori da correggere (${bloccanti.length}).`,
        bold: true,
        color: '#c0392b',
        margin: [0, 0, 0, 8],
      })
      // i messaggi, come sulla pagina: senza, il PDF diceva quanti errori ma non quali
      content.push({ text: 'Errori da correggere', bold: true, margin: [0, 0, 0, 4] })
      for (const errore of bloccanti) {
        content.push({ text: errore.messaggio, fontSize: 9, margin: [0, 0, 0, 4] })
      }
    }

    const kg = (n: number) => `${formattaQuantita(n)} kg`

    // Summary
    content.push({ text: 'RIEPILOGO ANNUALE', style: 'sectionHeader' })
    content.push({
      columns: [
        {
          width: '25%',
          stack: [
            { text: 'Totale Prodotto', fontSize: 10, color: '#7f8c8d' },
            { text: kg(report.totals.produced), style: 'summaryValue' },
          ],
        },
        {
          width: '25%',
          stack: [
            { text: 'Recupero', fontSize: 10, color: '#7f8c8d' },
            { text: kg(report.totals.recovery), style: 'summaryValue', color: '#27ae60' },
          ],
        },
        {
          width: '25%',
          stack: [
            { text: 'Smaltimento', fontSize: 10, color: '#7f8c8d' },
            { text: kg(report.totals.disposal), style: 'summaryValue', color: '#e67e22' },
          ],
        },
        {
          width: '25%',
          stack: [
            { text: 'Tasso Riciclo', fontSize: 10, color: '#7f8c8d' },
            {
              text: `${formattaQuantita(Math.round(report.totals.recyclingRate * 1000) / 10)}%`,
              style: 'summaryValue',
              color: '#3498db',
            },
          ],
        },
      ],
    })

    // Waste breakdown table
    content.push({ text: 'DETTAGLIO PER CODICE CER', style: 'sectionHeader' })

    const tableBody: any[] = [
      [
        { text: 'Codice CER', bold: true },
        { text: 'Movimenti', bold: true, alignment: 'right' },
        { text: 'Prodotto (kg)', bold: true, alignment: 'right' },
      ],
    ]

    report.wasteProduced?.forEach((w: any) => {
      tableBody.push([
        cerCanonico(w.cerCode),
        { text: String(w.count), alignment: 'right' },
        { text: formattaQuantita(w.totalQuantity), alignment: 'right' },
      ])
    })

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto'],
        body: tableBody,
      },
      layout: 'lightHorizontalLines',
    })

    // Avvisi: il testo del riepilogo, poi un paragrafo per avviso nell'ordine delle voci
    const avvisi = controlli.filter(c => c.gravita === 'AVVISO')
    if (avvisi.length > 0) {
      content.push({ text: 'Avvisi', style: 'sectionHeader' })
      const riepilogo: RiepilogoAvvisi | undefined = report.riepilogoAvvisi
      if (riepilogo?.testo) content.push({ text: riepilogo.testo, margin: [0, 0, 0, 6] })
      const ordine = (riepilogo ?? riepilogaAvvisi(avvisi)).voci.map(v => v.codice)
      const posizione = (c: MudEsitoControllo) => {
        const i = ordine.indexOf(c.codice)
        return i === -1 ? ordine.length : i
      }
      // sort stabile: a parità di codice resta l'ordine dell'aggregazione
      for (const avviso of [...avvisi].sort((a, b) => posizione(a) - posizione(b))) {
        content.push({ text: avviso.messaggio, fontSize: 9, margin: [0, 0, 0, 4] })
      }
    }

    content.push({
      text: "I rifiuti prodotti fuori dall'unità locale (cantieri, manutenzioni: modulo RE) non sono distinti: il file li attribuisce all'unità locale.",
      fontSize: 9,
      italics: true,
      margin: [0, 12, 0, 0],
    })

    return content
  }
}
