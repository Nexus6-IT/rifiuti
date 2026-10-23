import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { formattaDataItaliana, formattaDataOraItaliana } from '../../core/time/anno-italiano'
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

    // Initialize pdfmake with fonts
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

    this.printer = new PdfPrinter(fonts)
  }

  /**
   * Generate FIR PDF
   */
  async generateFIRPDF(fir: any, qrCodeDataUrl?: string): Promise<Buffer> {
    this.logger.info(`Generating FIR PDF: ${fir.firNumber}`)

    const docDefinition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],

      header: {
        text: 'FORMULARIO IDENTIFICAZIONE RIFIUTI (FIR)',
        style: 'header',
        alignment: 'center',
        margin: [0, 20, 0, 0],
      },

      footer: (currentPage: number, pageCount: number) => ({
        text: `Pagina ${currentPage} di ${pageCount} - Generato il ${formattaDataItaliana(new Date())}`,
        alignment: 'center',
        fontSize: 8,
        margin: [0, 0, 0, 20],
      }),

      content: this.buildFIRContent(fir, qrCodeDataUrl),

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
        label: {
          fontSize: 9,
          color: '#7f8c8d',
          margin: [0, 2, 0, 0],
        },
        value: {
          fontSize: 11,
          margin: [0, 0, 0, 8],
        },
        signature: {
          fontSize: 10,
          color: '#27ae60',
          margin: [0, 4, 0, 4],
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
   * Build FIR PDF content
   */
  private buildFIRContent(fir: any, qrCodeDataUrl?: string): Content[] {
    const content: Content[] = []

    // FIR Number and Status
    content.push({
      columns: [
        {
          width: '*',
          stack: [
            { text: 'Numero FIR', style: 'label' },
            // Il numero del formulario è quello RENTRI, se c'è; il riferimento interno
            // (FIR-AAAA-NNNNNN) resta visibile in un campo a parte.
            {
              text: fir.rentriNumeroFir || fir.firNumber,
              style: 'value',
              fontSize: 16,
              bold: true,
            },
            ...(fir.rentriNumeroFir
              ? [
                  { text: 'Riferimento interno', style: 'label' },
                  { text: fir.firNumber, style: 'value' },
                ]
              : []),
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: 'Stato', style: 'label' },
            { text: fir.status, style: 'value', color: this.getStatusColor(fir.status) },
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: 'Data Creazione', style: 'label' },
            { text: formattaDataItaliana(new Date(fir.createdAt)), style: 'value' },
          ],
        },
      ],
    })

    // Producer Section
    content.push({ text: 'PRODUTTORE', style: 'sectionHeader' })
    content.push(this.buildCompanyInfo(fir.producer))

    // Carrier Section
    content.push({ text: 'TRASPORTATORE', style: 'sectionHeader' })
    content.push(this.buildCompanyInfo(fir.carrier))

    // Receiver Section
    content.push({ text: 'DESTINATARIO', style: 'sectionHeader' })
    content.push(this.buildCompanyInfo(fir.receiver))

    // Campo 2 — Dettagli rifiuto (DM 59/2023)
    content.push({ text: 'CAMPO 2 — DETTAGLI RIFIUTO', style: 'sectionHeader' })
    content.push({
      columns: [
        {
          width: '50%',
          stack: [
            { text: 'Codice CER', style: 'label' },
            { text: fir.rifiuto?.cerCode || fir.cerCode || 'N/D', style: 'value', bold: true },
            { text: 'Quantità', style: 'label' },
            {
              text: fir.rifiuto
                ? `${fir.rifiuto.quantita} ${fir.rifiuto.unitaMisura}`
                : `${fir.quantity} ${fir.unitOfMeasure}`,
              style: 'value',
            },
            { text: 'Stato fisico', style: 'label' },
            { text: fir.rifiuto?.statoFisico || fir.wastePhysicalState || 'N/D', style: 'value' },
            { text: 'Numero colli', style: 'label' },
            {
              text: (fir.rifiuto?.numeroColli ?? fir.wastePackageCount ?? 'N/D').toString(),
              style: 'value',
            },
          ],
        },
        {
          width: '50%',
          stack: [
            { text: 'Caratteristiche pericolo HP', style: 'label' },
            {
              text:
                fir.rifiuto?.caratteristichePericolo || fir.wasteHazardClasses || 'Non pericoloso',
              style: 'value',
            },
            { text: 'Campo 3 — Operazione', style: 'label' },
            {
              text: this.buildOperazioneLabel(
                fir.rifiuto?.codiceOperazione || fir.wasteOperationCode,
                fir.rifiuto?.tipoOperazione || fir.wasteOperationType
              ),
              style: 'value',
            },
            { text: 'Descrizione rifiuto', style: 'label' },
            { text: fir.rifiuto?.descrizione || fir.wasteDescription || 'N/A', style: 'value' },
          ],
        },
      ],
    })

    // Campo 17 — Annotazioni (DM 59/2023)
    const annotazioni = fir.annotazioni || fir.wasteNotes
    if (annotazioni) {
      content.push({ text: 'CAMPO 17 — ANNOTAZIONI', style: 'sectionHeader' })
      content.push({ text: annotazioni, style: 'value', margin: [0, 0, 0, 8] })
    }

    // 4ª copia — Esito destinatario
    if (fir.fourthCopyReturnedAt || fir.pesoEffettivo) {
      content.push({ text: '4ª COPIA — ESITO DESTINATARIO', style: 'sectionHeader' })
      content.push({
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Peso effettivo ricevuto', style: 'label' },
              { text: fir.pesoEffettivo ? `${fir.pesoEffettivo} kg` : 'N/D', style: 'value' },
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'Data restituzione 4ª copia', style: 'label' },
              {
                text: fir.fourthCopyReturnedAt
                  ? formattaDataItaliana(new Date(fir.fourthCopyReturnedAt))
                  : 'N/D',
                style: 'value',
              },
            ],
          },
        ],
      })
      if (fir.fourthCopyNotes) {
        content.push({ text: 'Note destinatario', style: 'label' })
        content.push({ text: fir.fourthCopyNotes, style: 'value' })
      }
    }

    // Signatures Section
    content.push({ text: 'FIRME DIGITALI', style: 'sectionHeader' })
    if (fir.signatures && fir.signatures.length > 0) {
      fir.signatures.forEach((sig: any) => {
        content.push({
          text: `✓ ${sig.role}: ${sig.signerName} - ${formattaDataOraItaliana(new Date(sig.signedAt))}`,
          style: 'signature',
        })
      })
    } else {
      content.push({ text: 'Nessuna firma presente', style: 'value', color: '#e74c3c' })
    }

    // QR Code
    if (qrCodeDataUrl) {
      content.push({ text: 'CODICE QR VERIFICA', style: 'sectionHeader' })
      content.push({
        image: qrCodeDataUrl,
        width: 100,
        alignment: 'center',
      })
    }

    return content
  }

  /**
   * Build company info block
   */
  private buildCompanyInfo(company: any): Content {
    if (!company) {
      return { text: 'Informazioni non disponibili', style: 'value', color: '#95a5a6' }
    }

    return {
      columns: [
        {
          width: '50%',
          stack: [
            { text: 'Ragione Sociale', style: 'label' },
            { text: company.companyName, style: 'value' },
            { text: 'Indirizzo', style: 'label' },
            { text: company.address || 'N/A', style: 'value' },
          ],
        },
        {
          width: '50%',
          stack: [
            { text: 'P.IVA / Codice Fiscale', style: 'label' },
            { text: company.vatNumber || company.fiscalCode || 'N/A', style: 'value' },
            { text: 'Città', style: 'label' },
            {
              text:
                `${company.city || ''} ${company.province ? `(${company.province})` : ''}`.trim() ||
                'N/A',
              style: 'value',
            },
          ],
        },
      ],
    }
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

  /**
   * Costruisce la label leggibile per il tipo/codice di operazione R/D.
   * Campo 3 FIR (DM 59/2023, Allegati B e C D.Lgs 152/2006).
   */
  private buildOperazioneLabel(codice?: string, tipo?: string): string {
    if (codice) {
      const prefix = codice.startsWith('R')
        ? 'Recupero'
        : codice.startsWith('D')
          ? 'Smaltimento'
          : ''
      return prefix ? `${prefix} (${codice})` : codice
    }
    if (tipo === 'RECOVERY') return 'Recupero (R)'
    if (tipo === 'DISPOSAL') return 'Smaltimento (D)'
    return 'N/D'
  }

  /**
   * Get status color
   */
  private getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      DRAFT: '#95a5a6',
      SIGNED_BY_PRODUCER: '#3498db',
      IN_TRANSIT: '#f39c12',
      SIGNED_BY_CARRIER: '#9b59b6',
      COMPLETED: '#27ae60',
      CANCELLED: '#e74c3c',
    }
    return colors[status] || '#34495e'
  }
}
