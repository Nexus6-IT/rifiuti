import { Injectable } from '@angular/core'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { format } from 'date-fns'
import { annotazioneExport, statoExport } from '../../features/registro/registro-correzioni'
import { conColonnaSede, filtriRegistroExport, sedeDelMovimento } from './registro-export-sede'
import { Movimento } from '../../features/registro/registro.service'

/**
 * Metadati di intestazione per l'export del registro cronologico C/S.
 * Riflettono l'azienda/tenant attivo, i filtri applicati e l'operatore.
 */
export interface RegistroExportMeta {
  /** Ragione sociale dell'azienda/tenant attivo (se disponibile). */
  companyName?: string | null
  /** Operatore che ha generato l'export (nome o email). */
  operatore?: string | null
  /** Filtro tipo movimento attivo (CARICO/SCARICO) o null per "tutti". */
  filtroTipo?: string | null
  /** Filtro CER attivo. */
  filtroCer?: string | null
  /** Sede filtrata (etichetta del registro): va nell'intestazione del documento. */
  sede?: string | null
  /**
   * Con più registri e nessun filtro di sede: etichetta della sede di ogni movimento, per la
   * colonna "Sede". Assente con un solo registro (export identico a prima).
   */
  etichettaSede?: (m: Movimento) => string
}

@Injectable({
  providedIn: 'root',
})
export class ExportService {
  /**
   * Esporta lista FIR in PDF
   */
  exportFIRListToPDF(firList: FIR[], filename = 'fir-list.pdf'): void {
    const doc = new jsPDF()

    // Header
    doc.setFontSize(18)
    doc.text('Lista FIR', 14, 22)

    doc.setFontSize(11)
    doc.setTextColor(100)
    doc.text(`Generato il: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 30)

    // Table data
    const tableData = firList.map(fir => [
      fir.numeroProgressivo || 'N/A',
      fir.anno.toString(),
      fir.rifiuto.cerCode,
      `${fir.rifiuto.quantita} ${fir.rifiuto.unitaMisura}`,
      this.getStatoLabel(fir.stato),
      format(new Date(fir.createdAt), 'dd/MM/yyyy'),
    ])

    autoTable(doc, {
      head: [['Numero', 'Anno', 'CER', 'Quantità', 'Stato', 'Data']],
      body: tableData,
      startY: 35,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [13, 110, 253] },
    })

    doc.save(filename)
  }

  /**
   * Esporta singolo FIR in PDF con dettagli completi
   */
  exportFIRDetailToPDF(fir: FIR, filename?: string): void {
    const doc = new jsPDF()
    const fileName = filename || `FIR-${fir.numeroProgressivo || fir.id}.pdf`

    // Header
    doc.setFontSize(20)
    doc.text('Formulario Identificazione Rifiuti', 14, 22)

    // Numero FIR
    doc.setFontSize(14)
    doc.setTextColor(13, 110, 253)
    doc.text(`FIR N. ${fir.numeroProgressivo || 'BOZZA'}/${fir.anno}`, 14, 35)

    // Stato
    doc.setFontSize(12)
    doc.setTextColor(0)
    doc.text(`Stato: ${this.getStatoLabel(fir.stato)}`, 14, 45)

    // Dati Rifiuto
    doc.setFontSize(14)
    doc.setTextColor(0)
    doc.text('Dati Rifiuto', 14, 60)
    doc.setFontSize(11)

    const rifiutoData = [
      ['Codice CER', fir.rifiuto.cerCode],
      ['Quantità Dichiarata', `${fir.rifiuto.quantita} ${fir.rifiuto.unitaMisura}`],
      ['Stato Fisico', fir.rifiuto.statoFisico || 'N/D'],
      ['Peso Effettivo', fir.pesoEffettivo ? `${fir.pesoEffettivo} kg` : 'N/D'],
    ]

    autoTable(doc, {
      body: rifiutoData,
      startY: 65,
      theme: 'plain',
      styles: { fontSize: 10 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 },
      },
    })

    // Soggetti coinvolti
    let currentY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(14)
    doc.text('Soggetti Coinvolti', 14, currentY)

    const soggettiData = [
      ['Produttore ID', fir.produttoreId],
      ['Trasportatore ID', fir.trasportatoreId],
      ['Destinatario ID', fir.destinatarioId],
    ]

    autoTable(doc, {
      body: soggettiData,
      startY: currentY + 5,
      theme: 'plain',
      styles: { fontSize: 10 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 },
      },
    })

    // Date
    currentY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(14)
    doc.text('Date', 14, currentY)

    const dateData = [
      ['Data Creazione', format(new Date(fir.createdAt), 'dd/MM/yyyy HH:mm')],
      [
        'Data Presa in Carico',
        fir.dataPresaCarico ? format(new Date(fir.dataPresaCarico), 'dd/MM/yyyy HH:mm') : 'N/D',
      ],
      [
        'Data Consegna',
        fir.dataConsegna ? format(new Date(fir.dataConsegna), 'dd/MM/yyyy HH:mm') : 'N/D',
      ],
    ]

    autoTable(doc, {
      body: dateData,
      startY: currentY + 5,
      theme: 'plain',
      styles: { fontSize: 10 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 },
      },
    })

    // Footer
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text('Generato da WasteFlow', 14, 280)
    doc.text(format(new Date(), 'dd/MM/yyyy HH:mm'), 14, 285)

    doc.save(fileName)
  }

  /**
   * Esporta lista FIR in Excel
   */
  exportFIRListToExcel(firList: FIR[], filename = 'fir-list.xlsx'): void {
    const excelData = firList.map(fir => ({
      'Numero Progressivo': fir.numeroProgressivo || 'N/A',
      Anno: fir.anno,
      Stato: this.getStatoLabel(fir.stato),
      'Codice CER': fir.rifiuto.cerCode,
      'Quantità Dichiarata': fir.rifiuto.quantita,
      'Unità di Misura': fir.rifiuto.unitaMisura,
      'Stato Fisico': fir.rifiuto.statoFisico || 'N/D',
      'Peso Effettivo': fir.pesoEffettivo || 'N/D',
      'Produttore ID': fir.produttoreId,
      'Trasportatore ID': fir.trasportatoreId,
      'Destinatario ID': fir.destinatarioId,
      'Data Creazione': format(new Date(fir.createdAt), 'dd/MM/yyyy HH:mm'),
      'Data Presa in Carico': fir.dataPresaCarico
        ? format(new Date(fir.dataPresaCarico), 'dd/MM/yyyy HH:mm')
        : 'N/D',
      'Data Consegna': fir.dataConsegna
        ? format(new Date(fir.dataConsegna), 'dd/MM/yyyy HH:mm')
        : 'N/D',
    }))

    const ws = XLSX.utils.json_to_sheet(excelData)

    // Set column widths
    ws['!cols'] = [
      { wch: 15 }, // Numero Progressivo
      { wch: 8 }, // Anno
      { wch: 12 }, // Stato
      { wch: 12 }, // Codice CER
      { wch: 12 }, // Quantità
      { wch: 12 }, // Unità
      { wch: 12 }, // Stato Fisico
      { wch: 12 }, // Peso Effettivo
      { wch: 30 }, // Produttore ID
      { wch: 30 }, // Trasportatore ID
      { wch: 30 }, // Destinatario ID
      { wch: 18 }, // Data Creazione
      { wch: 18 }, // Data Presa in Carico
      { wch: 18 }, // Data Consegna
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'FIR')

    XLSX.writeFile(wb, filename)
  }

  /**
   * Esporta dati generici in Excel
   */
  exportToExcel<T>(data: T[], filename = 'export.xlsx', sheetName = 'Data'): void {
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    XLSX.writeFile(wb, filename)
  }

  /**
   * Esporta il registro cronologico di carico/scarico in PDF.
   *
   * Intestazione a norma (azienda attiva, periodo coperto, riferimento
   * art. 190 D.Lgs 152/2006 · DM 59/2023) + tabella dei movimenti filtrati.
   * Orientamento orizzontale per garantire leggibilità di tutte le colonne.
   */
  exportRegistroToPDF(
    movimenti: Movimento[],
    meta: RegistroExportMeta = {},
    filename = `registro-cs-${format(new Date(), 'yyyyMMdd')}.pdf`
  ): void {
    const doc = new jsPDF({ orientation: 'landscape' })
    const teal: [number, number, number] = [13, 148, 136]

    // Titolo
    doc.setFontSize(16)
    doc.setTextColor(15, 118, 110)
    doc.text('Registro cronologico di carico e scarico', 14, 16)

    // Riferimento normativo
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text('art. 190 D.Lgs 152/2006 · DM 59/2023', 14, 22)

    // Azienda / operatore
    doc.setFontSize(10)
    doc.setTextColor(40)
    let y = 30
    if (meta.companyName) {
      doc.text(`Azienda: ${meta.companyName}`, 14, y)
      y += 6
    }

    // Periodo coperto (dal min/max delle date operazione dei movimenti esportati)
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text(`Periodo: ${this.periodoRegistro(movimenti)}`, 14, y)

    // Filtri attivi + metadati di generazione
    const filtri = filtriRegistroExport(meta)
    const filtriLabel = filtri.length ? filtri.join('  ·  ') : 'Nessun filtro'
    doc.text(`Filtri: ${filtriLabel}`, 14, y + 5)
    doc.text(
      `Movimenti: ${movimenti.length}  ·  Generato il ${format(new Date(), 'dd/MM/yyyy HH:mm')}` +
        (meta.operatore ? `  ·  ${meta.operatore}` : ''),
      14,
      y + 10
    )

    const conSede = conColonnaSede(meta)
    const { head, body } = this.tabellaRegistroPdf(movimenti, meta)

    autoTable(doc, {
      head: [head],
      body,
      startY: y + 15,
      styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 253, 250] },
      columnStyles: {
        [conSede ? 9 : 8]: { halign: 'right' },
      },
    })

    doc.save(filename)
  }

  /**
   * Esporta il registro cronologico di carico/scarico in Excel.
   */
  exportRegistroToExcel(
    movimenti: Movimento[],
    meta: RegistroExportMeta = {},
    filename = `registro-cs-${format(new Date(), 'yyyyMMdd')}.xlsx`
  ): void {
    const conSede = conColonnaSede(meta)
    const excelData = this.righeRegistroExcel(movimenti, meta)

    // Con la sede filtrata la si scrive sopra la tabella (riga 1), che parte dalla riga 3.
    const ws = meta.sede
      ? XLSX.utils.aoa_to_sheet([[`Sede: ${meta.sede}`], []])
      : XLSX.utils.json_to_sheet(excelData)
    if (meta.sede) XLSX.utils.sheet_add_json(ws, excelData, { origin: 'A3' })
    ws['!cols'] = [
      { wch: 12 }, // Progressivo
      ...(conSede ? [{ wch: 30 }] : []), // Sede
      { wch: 6 }, // Anno
      { wch: 8 }, // Numero
      { wch: 18 }, // Data registrazione
      { wch: 16 }, // Data operazione
      { wch: 10 }, // Tipo
      { wch: 26 }, // Annotazione
      { wch: 12 }, // Stato
      { wch: 26 }, // Causale
      { wch: 12 }, // CER
      { wch: 28 }, // Descrizione rifiuto
      { wch: 12 }, // Quantità
      { wch: 8 }, // Unità
      { wch: 14 }, // Stato fisico
      { wch: 12 }, // Classi HP
      { wch: 14 }, // Operazione R/D
      { wch: 28 }, // Controparte
      { wch: 32 }, // Indirizzo controparte
      { wch: 36 }, // Rif. FIR
      { wch: 30 }, // Note
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Registro C-S')
    XLSX.writeFile(wb, filename)
  }

  /** Intestazione e righe della tabella PDF del registro (comprese Annotazione e Stato). */
  tabellaRegistroPdf(
    movimenti: Movimento[],
    meta: RegistroExportMeta = {}
  ): { head: string[]; body: string[][] } {
    const conSede = conColonnaSede(meta)
    const head = [
      'Progr.',
      ...(conSede ? ['Sede'] : []),
      'Data reg.',
      'Data op.',
      'Tipo',
      'Annotazione',
      'Stato',
      'Causale',
      'CER',
      'Quantità',
      'Stato fisico',
      'Controparte',
      'FIR',
    ]
    const body = movimenti.map(m => [
      `${m.progressiveYear}/${m.progressiveNumber}`,
      ...(conSede ? [sedeDelMovimento(meta, m) || '—'] : []),
      this.formatDate(m.registrationDate),
      this.formatDate(m.movementDate),
      m.type,
      annotazioneExport(m),
      statoExport(m),
      this.causaleLabel(m),
      m.cerCode,
      `${this.formatQuantita(m.quantity)} ${m.unit}`,
      m.wastePhysicalState || '—',
      m.counterpartName || '—',
      m.firId ? 'Sì' : '—',
    ])
    return { head, body }
  }

  /** Righe del foglio Excel del registro (comprese Annotazione e Stato). */
  righeRegistroExcel(
    movimenti: Movimento[],
    meta: RegistroExportMeta = {}
  ): Record<string, string | number>[] {
    const conSede = conColonnaSede(meta)
    return movimenti.map(m => ({
      Progressivo: `${m.progressiveYear}/${m.progressiveNumber}`,
      ...(conSede ? { Sede: sedeDelMovimento(meta, m) } : {}),
      Anno: m.progressiveYear,
      Numero: m.progressiveNumber,
      'Data registrazione': this.formatDate(m.registrationDate),
      'Data operazione': this.formatDate(m.movementDate),
      Tipo: m.type,
      Annotazione: annotazioneExport(m),
      Stato: statoExport(m),
      Causale: this.causaleLabel(m),
      CER: m.cerCode,
      'Descrizione rifiuto': m.wasteDescription || '',
      Quantità: m.quantity,
      Unità: m.unit,
      'Stato fisico': m.wastePhysicalState || '',
      'Classi HP': m.wasteHazardClasses || '',
      'Operazione R/D': m.operationCode || '',
      Controparte: m.counterpartName || '',
      'Indirizzo controparte': m.counterpartAddress || '',
      'Rif. FIR': m.firId || '',
      Note: m.notes || '',
    }))
  }

  /** Formatta una data ISO (YYYY-MM-DD o ISO datetime) in dd/MM/yyyy. */
  private formatDate(value?: string): string {
    if (!value) return '—'
    const d = new Date(value)
    return isNaN(d.getTime()) ? value : format(d, 'dd/MM/yyyy')
  }

  /** Formatta una quantità numerica secondo la locale italiana. */
  private formatQuantita(value: number): string {
    return new Intl.NumberFormat('it-IT', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)
  }

  /** Etichetta della causale: la descrizione che l'API calcola alla data del movimento, o il codice. */
  private causaleLabel(m: Pick<Movimento, 'causale' | 'causaleDescrizione'>): string {
    return m.causaleDescrizione || m.causale
  }

  /** Calcola l'intervallo temporale coperto dai movimenti esportati. */
  private periodoRegistro(movimenti: Movimento[]): string {
    if (!movimenti.length) return 'nessun movimento'
    const dates = movimenti.map(m => new Date(m.movementDate).getTime()).filter(t => !isNaN(t))
    if (!dates.length) return 'n/d'
    const min = format(new Date(Math.min(...dates)), 'dd/MM/yyyy')
    const max = format(new Date(Math.max(...dates)), 'dd/MM/yyyy')
    return min === max ? min : `${min} — ${max}`
  }

  /**
   * Ottiene label leggibile per lo stato FIR
   */
  private getStatoLabel(stato: FIRStato): string {
    const labels: Record<FIRStato, string> = {
      [FIRStato.BOZZA]: 'Bozza',
      [FIRStato.EMESSO]: 'Emesso',
      [FIRStato.IN_TRANSITO]: 'In Transito',
      [FIRStato.CONSEGNATO]: 'Consegnato',
      [FIRStato.ANNULLATO]: 'Annullato',
    }
    return labels[stato]
  }
}
