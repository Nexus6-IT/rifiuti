import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { FIR, FIRStato } from '../../shared/models/fir.model';
import { format } from 'date-fns';

@Injectable({
  providedIn: 'root'
})
export class ExportService {

  /**
   * Esporta lista FIR in PDF
   */
  exportFIRListToPDF(firList: FIR[], filename = 'fir-list.pdf'): void {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(18);
    doc.text('Lista FIR', 14, 22);

    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generato il: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 30);

    // Table data
    const tableData = firList.map(fir => [
      fir.numeroProgressivo || 'N/A',
      fir.anno.toString(),
      fir.rifiuto.cerCode,
      `${fir.rifiuto.quantitaDichiarata} ${fir.rifiuto.unitaMisura}`,
      this.getStatoLabel(fir.stato),
      format(new Date(fir.createdAt), 'dd/MM/yyyy')
    ]);

    autoTable(doc, {
      head: [['Numero', 'Anno', 'CER', 'Quantità', 'Stato', 'Data']],
      body: tableData,
      startY: 35,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [13, 110, 253] }
    });

    doc.save(filename);
  }

  /**
   * Esporta singolo FIR in PDF con dettagli completi
   */
  exportFIRDetailToPDF(fir: FIR, filename?: string): void {
    const doc = new jsPDF();
    const fileName = filename || `FIR-${fir.numeroProgressivo || fir.id}.pdf`;

    // Header
    doc.setFontSize(20);
    doc.text('Formulario Identificazione Rifiuti', 14, 22);

    // Numero FIR
    doc.setFontSize(14);
    doc.setTextColor(13, 110, 253);
    doc.text(`FIR N. ${fir.numeroProgressivo || 'BOZZA'}/${fir.anno}`, 14, 35);

    // Stato
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Stato: ${this.getStatoLabel(fir.stato)}`, 14, 45);

    // Dati Rifiuto
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text('Dati Rifiuto', 14, 60);
    doc.setFontSize(11);

    const rifiutoData = [
      ['Codice CER', fir.rifiuto.cerCode],
      ['Quantità Dichiarata', `${fir.rifiuto.quantitaDichiarata} ${fir.rifiuto.unitaMisura}`],
      ['Stato Fisico', fir.rifiuto.statoFisico || 'N/D'],
      ['Peso Effettivo', fir.pesoEffettivo ? `${fir.pesoEffettivo} kg` : 'N/D']
    ];

    autoTable(doc, {
      body: rifiutoData,
      startY: 65,
      theme: 'plain',
      styles: { fontSize: 10 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 }
      }
    });

    // Soggetti coinvolti
    let currentY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(14);
    doc.text('Soggetti Coinvolti', 14, currentY);

    const soggettiData = [
      ['Produttore ID', fir.produttoreId],
      ['Trasportatore ID', fir.trasportatoreId],
      ['Destinatario ID', fir.destinatarioId]
    ];

    autoTable(doc, {
      body: soggettiData,
      startY: currentY + 5,
      theme: 'plain',
      styles: { fontSize: 10 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 }
      }
    });

    // Date
    currentY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(14);
    doc.text('Date', 14, currentY);

    const dateData = [
      ['Data Creazione', format(new Date(fir.createdAt), 'dd/MM/yyyy HH:mm')],
      ['Data Presa in Carico', fir.dataPresaCarico ? format(new Date(fir.dataPresaCarico), 'dd/MM/yyyy HH:mm') : 'N/D'],
      ['Data Consegna', fir.dataConsegna ? format(new Date(fir.dataConsegna), 'dd/MM/yyyy HH:mm') : 'N/D']
    ];

    autoTable(doc, {
      body: dateData,
      startY: currentY + 5,
      theme: 'plain',
      styles: { fontSize: 10 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 }
      }
    });

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Generato da WasteFlow', 14, 280);
    doc.text(format(new Date(), 'dd/MM/yyyy HH:mm'), 14, 285);

    doc.save(fileName);
  }

  /**
   * Esporta lista FIR in Excel
   */
  exportFIRListToExcel(firList: FIR[], filename = 'fir-list.xlsx'): void {
    const excelData = firList.map(fir => ({
      'Numero Progressivo': fir.numeroProgressivo || 'N/A',
      'Anno': fir.anno,
      'Stato': this.getStatoLabel(fir.stato),
      'Codice CER': fir.rifiuto.cerCode,
      'Quantità Dichiarata': fir.rifiuto.quantitaDichiarata,
      'Unità di Misura': fir.rifiuto.unitaMisura,
      'Stato Fisico': fir.rifiuto.statoFisico || 'N/D',
      'Peso Effettivo': fir.pesoEffettivo || 'N/D',
      'Produttore ID': fir.produttoreId,
      'Trasportatore ID': fir.trasportatoreId,
      'Destinatario ID': fir.destinatarioId,
      'Data Creazione': format(new Date(fir.createdAt), 'dd/MM/yyyy HH:mm'),
      'Data Presa in Carico': fir.dataPresaCarico ? format(new Date(fir.dataPresaCarico), 'dd/MM/yyyy HH:mm') : 'N/D',
      'Data Consegna': fir.dataConsegna ? format(new Date(fir.dataConsegna), 'dd/MM/yyyy HH:mm') : 'N/D'
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
      { wch: 15 }, // Numero Progressivo
      { wch: 8 },  // Anno
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
      { wch: 18 }  // Data Consegna
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FIR');

    XLSX.writeFile(wb, filename);
  }

  /**
   * Esporta dati generici in Excel
   */
  exportToExcel<T>(data: T[], filename = 'export.xlsx', sheetName = 'Data'): void {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
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
      [FIRStato.ANNULLATO]: 'Annullato'
    };
    return labels[stato];
  }
}
