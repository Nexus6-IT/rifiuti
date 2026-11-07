/**
 * Copia di cortesia in PDF di un documento di fattura (4.4c, Task 28).
 *
 * Legge solo i dati SALVATI del documento (dettaglio e fotografia): non rigenera l'XML, non
 * calcola nulla, non scrive nulla (`emesso_il` resta com'e'). L'originale e` il file XML: il PDF
 * lo dichiara in intestazione. Le bozze hanno la filigrana «ANTEPRIMA».
 * `definizionePdf` e` pura (testabile senza rendering); `generaPdf` rende con pdfmake.
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { FotografiaDocumento, SedeFotografia } from '../../domain/fatturazione/tipi'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { creaStampantePdf } from '../../infrastructure/pdf/pdf.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { DocumentiFatturaService, type DocumentoDettaglio } from './documenti-fattura.service'

export const INTESTAZIONE_CORTESIA = "Copia di cortesia: l'originale è il file XML"

/** Importo o quantita` decimale in stringa → `1.234,50` (it-IT), senza passare da `number`. */
export function formattaImportoIt(valore: string, minimoDecimali = 2): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valore.trim())
  if (!m) return valore
  const intero = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const decimali = (m[3] ?? '').padEnd(minimoDecimali, '0')
  const segno = m[1] === '-' && /[1-9]/.test(m[2] + decimali) ? '-' : ''
  return `${segno}${intero}${decimali ? ',' + decimali : ''}`
}

/** `AAAA-MM-GG` → `gg/mm/aaaa` (date gia` di calendario: nessun fuso). */
function dataIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

const TITOLI: Record<string, string> = {
  TD01: 'Fattura',
  TD04: 'Nota di credito',
  TD24: 'Fattura differita',
}

function sede(s: SedeFotografia): string {
  const localita = [s.cap, s.comune, s.provincia ? `(${s.provincia})` : null]
    .filter(Boolean)
    .join(' ')
  return [s.indirizzo, localita].filter(Boolean).join(' - ')
}

function bloccoParte(titolo: string, nome: string, s: SedeFotografia, fiscali: string[]): Content {
  return {
    width: '50%',
    stack: [
      { text: titolo, style: 'etichetta' },
      { text: nome, bold: true },
      { text: sede(s), fontSize: 9 },
      ...fiscali.map(t => ({ text: t, fontSize: 9 }) as Content),
    ],
  } as unknown as Content
}

/** Nome del file: solo registro, numero e anno, mai dati personali. */
export function nomeFilePdf(doc: DocumentoDettaglio): string {
  const pulito = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-')
  if (doc.stato === 'ANNULLATO') {
    return `annullato-${pulito(doc.registro.codice)}-${pulito(doc.numeroTesto ?? 'senza-numero')}-${doc.dataDocumento.slice(0, 4)}.pdf`
  }
  if (doc.stato === 'BOZZA' || !doc.numeroTesto) {
    return `anteprima-${pulito(doc.registro.codice)}-${doc.dataDocumento}.pdf`
  }
  return `${pulito(doc.registro.codice)}-${pulito(doc.numeroTesto)}-${doc.dataDocumento.slice(0, 4)}.pdf`
}

export function definizionePdf(
  doc: DocumentoDettaglio,
  fotografia: FotografiaDocumento,
  bozza: boolean,
  origine: { numeroTesto: string; dataDocumento: string } | null = null
): TDocumentDefinitions {
  const filigrana = bozza ? 'ANTEPRIMA' : doc.stato === 'ANNULLATO' ? 'ANNULLATO' : null
  const { cedente, cessionario } = fotografia
  const nomeCessionario =
    cessionario.denominazione ?? [cessionario.nome, cessionario.cognome].filter(Boolean).join(' ')
  const intestazione = (testo: string): Content => ({
    text: testo,
    style: 'etichetta',
    margin: [0, 12, 0, 4],
  })

  const righe: Content[][] = doc.righe.map(r => [
    {
      stack: [
        { text: r.descrizione },
        ...(r.dataMovimento || r.cerCode || r.numeroFir
          ? [
              {
                text: [
                  r.dataMovimento ? `Mov. ${dataIt(r.dataMovimento)}` : null,
                  r.cerCode ? `CER ${r.cerCode}` : null,
                  r.numeroFir ? `FIR ${r.numeroFir}` : null,
                ]
                  .filter(Boolean)
                  .join(' - '),
                fontSize: 7,
                color: '#666666',
              } as Content,
            ]
          : []),
      ],
    },
    { text: r.unitaMisura ?? '', alignment: 'center' as const },
    { text: r.quantita ? formattaImportoIt(r.quantita, 0) : '', alignment: 'right' as const },
    { text: formattaImportoIt(r.prezzoUnitario), alignment: 'right' as const },
    { text: r.sconto ? `${formattaImportoIt(r.sconto)}%` : '', alignment: 'right' as const },
    { text: formattaImportoIt(r.prezzoTotale), alignment: 'right' as const },
    {
      text: r.naturaIva ? r.naturaIva : `${formattaImportoIt(r.aliquotaIva)}%`,
      alignment: 'right' as const,
    },
  ])

  const contenuto: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: TITOLI[doc.tipoDocumento] ?? 'Documento', fontSize: 16, bold: true },
            bozza || !doc.numeroTesto
              ? { text: 'Anteprima, numero non assegnato', fontSize: 10 }
              : { text: `N. ${doc.numeroTesto}`, fontSize: 12, bold: true },
            ...(origine
              ? [
                  {
                    text: `Storno della fattura N. ${origine.numeroTesto} del ${dataIt(origine.dataDocumento)}`,
                    fontSize: 9,
                  } as Content,
                ]
              : []),
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: 'Data documento', style: 'etichetta' },
            { text: dataIt(doc.dataDocumento), bold: true },
          ],
        },
      ],
    },
    {
      columns: [
        bloccoParte('Cedente', cedente.denominazione, cedente.sede, [
          `P. IVA ${cedente.partitaIva}`,
          ...(cedente.codiceFiscale ? [`C.F. ${cedente.codiceFiscale}`] : []),
          ...(cedente.rea
            ? [
                `REA ${cedente.rea.ufficio}-${cedente.rea.numero}` +
                  (cedente.rea.capitaleSociale
                    ? `, capitale sociale € ${formattaImportoIt(cedente.rea.capitaleSociale)}`
                    : '') +
                  (cedente.rea.statoLiquidazione === 'LS' ? ', in liquidazione' : ''),
              ]
            : []),
        ]),
        bloccoParte('Cessionario', nomeCessionario, cessionario.sede, [
          ...(cessionario.partitaIva ? [`P. IVA ${cessionario.partitaIva}`] : []),
          ...(cessionario.codiceFiscale ? [`C.F. ${cessionario.codiceFiscale}`] : []),
        ]),
      ],
      margin: [0, 14, 0, 0],
    },
    intestazione('Dettaglio'),
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ['*', 24, 48, 48, 36, 56, 34],
        body: [
          [
            { text: 'Descrizione', style: 'testata' },
            { text: 'UM', style: 'testata', alignment: 'center' as const },
            { text: 'Quantità', style: 'testata', alignment: 'right' as const },
            { text: 'Prezzo', style: 'testata', alignment: 'right' as const },
            { text: 'Sconto', style: 'testata', alignment: 'right' as const },
            { text: 'Importo', style: 'testata', alignment: 'right' as const },
            { text: 'IVA', style: 'testata', alignment: 'right' as const },
          ],
          ...righe,
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    },
    intestazione('Riepilogo IVA'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 70, 70, 70],
        body: [
          [
            { text: 'Aliquota / natura', style: 'testata' },
            { text: 'Imponibile', style: 'testata', alignment: 'right' as const },
            { text: 'Imposta', style: 'testata', alignment: 'right' as const },
            { text: 'Esigibilità', style: 'testata', alignment: 'right' as const },
          ],
          ...doc.riepiloghi.map(r => [
            {
              text: [
                r.natura ?? `${formattaImportoIt(r.aliquota)}%`,
                r.riferimentoNormativo ? ` - ${r.riferimentoNormativo}` : '',
              ].join(''),
            },
            { text: formattaImportoIt(r.imponibile), alignment: 'right' as const },
            { text: formattaImportoIt(r.imposta), alignment: 'right' as const },
            {
              text:
                r.esigibilita === 'I'
                  ? 'Immediata'
                  : r.esigibilita === 'D'
                    ? 'Differita'
                    : 'Scissione',
              alignment: 'right' as const,
            },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    },
  ]

  if (doc.rate.length > 0) {
    contenuto.push(intestazione('Scadenze'), {
      table: {
        headerRows: 1,
        widths: [30, '*', 70, 80],
        body: [
          [
            { text: 'Rata', style: 'testata' },
            { text: 'Condizioni', style: 'testata' },
            { text: 'Scadenza', style: 'testata' },
            { text: 'Importo', style: 'testata', alignment: 'right' as const },
          ],
          ...doc.rate.map(r => [
            String(r.ordine),
            fotografia.pagamento?.descrizione ?? r.modalita,
            dataIt(r.dataScadenza),
            { text: formattaImportoIt(r.importo), alignment: 'right' as const },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    })
  }

  const totali: Content[][] = [
    ['Totale imponibile', formattaImportoIt(doc.totaleImponibile)],
    ['Totale IVA', formattaImportoIt(doc.totaleIva)],
    ...(doc.bolloDovuto && doc.importoBollo
      ? [['Bollo assolto in modo virtuale', formattaImportoIt(doc.importoBollo)]]
      : []),
    ['Totale documento', formattaImportoIt(doc.totaleDocumento)],
    ['Netto a pagare', formattaImportoIt(doc.nettoAPagare)],
  ].map(([e, v], i, tutte) => {
    const ultimo = i === tutte.length - 1
    return [
      { text: e, alignment: 'right' as const, bold: ultimo },
      { text: v, alignment: 'right' as const, bold: ultimo },
    ] as Content[]
  })
  contenuto.push({
    columns: [
      { width: '*', text: '' },
      { width: 230, table: { widths: ['*', 80], body: totali }, layout: 'noBorders', fontSize: 9 },
    ],
    margin: [0, 14, 0, 0],
    unbreakable: true,
  })

  const note: string[] = [
    ...fotografia.testoFatturazione,
    ...(fotografia.cig ? [`CIG: ${fotografia.cig}`] : []),
    ...(fotografia.cup ? [`CUP: ${fotografia.cup}`] : []),
    ...(fotografia.idDocumento ? [`Rif. ordine: ${fotografia.idDocumento}`] : []),
    ...(fotografia.conto?.iban
      ? [
          `Coordinate bancarie: ${[fotografia.conto.istituto, fotografia.conto.iban]
            .filter(Boolean)
            .join(' - ')}`,
        ]
      : []),
  ]
  if (note.length > 0) {
    contenuto.push(intestazione('Note'), ...note.map(t => ({ text: t, fontSize: 8 }) as Content))
  }

  return {
    pageSize: 'A4',
    pageMargins: [36, 56, 36, 48],
    header: {
      text: INTESTAZIONE_CORTESIA,
      alignment: 'center' as const,
      fontSize: 9,
      italics: true,
      margin: [0, 24, 0, 0],
    },
    footer: (pagina: number, pagine: number) => ({
      text: `Pagina ${pagina} di ${pagine}`,
      alignment: 'center' as const,
      fontSize: 8,
      margin: [0, 0, 0, 20],
    }),
    ...(filigrana
      ? { watermark: { text: filigrana, color: '#999999', opacity: 0.15, bold: true } }
      : {}),
    content: contenuto,
    defaultStyle: { fontSize: 9 },
    styles: {
      etichetta: { fontSize: 8, color: '#666666', bold: true },
      testata: { fontSize: 8, bold: true },
    },
  }
}

let stampante: any
export function generaPdf(def: TDocumentDefinitions): Promise<Buffer> {
  stampante ??= creaStampantePdf()
  return new Promise((resolve, reject) => {
    const pdf = stampante.createPdfKitDocument(def)
    const pezzi: Buffer[] = []
    pdf.on('data', (p: Buffer) => pezzi.push(p))
    pdf.on('end', () => resolve(Buffer.concat(pezzi)))
    pdf.on('error', reject)
    pdf.end()
  })
}

export interface PdfDocumento {
  nomeFile: string
  contenuto: Buffer
}

@Injectable()
export class PdfCortesiaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documenti: DocumentiFatturaService
  ) {}

  /** Solo letture, in una transazione sola: dettaglio e fotografia sono dello stesso istante. */
  async pdf(tenantId: string, id: string): Promise<PdfDocumento> {
    const { doc, fotografia, origine } = await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const doc = await this.documenti.dettaglioInTx(tx, tenantId, id)
        const [riga] = await tx.$queryRaw<{ fotografia: FotografiaDocumento | null }[]>`
          SELECT fotografia FROM documenti_fattura
          WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
        // Numero e data dell'origine sono dati salvati: gli stessi che l'XML mette in
        // `DatiFattureCollegate`.
        let origine: { numeroTesto: string; dataDocumento: string } | null = null
        if (doc.documentoOrigineId) {
          const [o] = await tx.$queryRaw<{ numeroTesto: string | null; data: string }[]>`
            SELECT numero_testo AS "numeroTesto", data_documento::text AS data
            FROM documenti_fattura
            WHERE tenant_id = ${tenantId}::uuid AND id = ${doc.documentoOrigineId}::uuid`
          if (o?.numeroTesto) origine = { numeroTesto: o.numeroTesto, dataDocumento: o.data }
        }
        return { doc, fotografia: riga?.fotografia ?? null, origine }
      })
    )
    if (!fotografia?.cedente || !fotografia.cessionario) {
      throw new NotFoundException({
        error: 'PDF_NON_DISPONIBILE',
        message: 'Il documento non ha i dati fiscali salvati per la copia di cortesia.',
      })
    }
    const contenuto = await generaPdf(
      definizionePdf(doc, fotografia, doc.stato === 'BOZZA', origine)
    )
    return { nomeFile: nomeFilePdf(doc), contenuto }
  }
}
