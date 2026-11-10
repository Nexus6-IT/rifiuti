import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { esaminaLogo } from '../../domain/modelli-stampa/logo'
import { formattaDataItaliana, formattaDataOraItaliana } from '../../core/time/anno-italiano'

/** Ambiti di un modello di stampa (specchio dell'enum Prisma `AmbitoModelloStampa`). */
export type AmbitoModello = 'GENERALE' | 'FIR' | 'DISTINTA_RITIRI'

/**
 * Modello di stampa come arriva al PDF: forma di `CompanyTemplate` piu' `ambito` e `copie`.
 * Il servizio non lo legge dal database: lo riceve gia' risolto.
 */
export interface ModelloStampaFir {
  ambito?: AmbitoModello
  /** Numero di copie 1-4: ogni FIR si ripete `copie` volte, "Copia n di N". */
  copie?: number
  logoBase64?: string | null
  headerText?: string | null
  footerText?: string | null
  primaryColor?: string
  secondaryColor?: string
  /** Accettato per compatibilita' con `CompanyTemplate`; la stampante incorpora solo Roboto. */
  fontFamily?: string
}

export class ModelloStampaNonValidoError extends Error {
  constructor(motivo: string) {
    super(`Modello di stampa non valido: ${motivo}`)
    this.name = 'ModelloStampaNonValidoError'
  }
}

const COLORE_HEX = /^#[0-9A-F]{6}$/i
const COLORE_PRIMARIO_PREDEFINITO = '#2c3e50'
const COLORE_SECONDARIO_PREDEFINITO = '#34495e'
export const COPIE_MIN = 1
export const COPIE_MAX = 4
/** Massimo di FIR in un'unica serie (come la rotta `POST /pdf/fir/serie`). */
export const FIR_SERIE_MAX = 100

/**
 * Verifica il logo con il controllo unico di `domain/modelli-stampa/logo` (formato dai byte reali,
 * dimensione) e lancia se non va. Restituisce il data URL per pdfmake.
 */
export function verificaLogo(logo: string): string {
  const esito = esaminaLogo(logo)
  if (!esito.ok) throw new ModelloStampaNonValidoError(esito.motivo)
  return esito.dataUrl
}

/** Valida un modello e restituisce le copie effettive (default 1). */
export function validaModello(modello?: ModelloStampaFir | null): number {
  if (!modello) return 1
  const copie = modello.copie ?? 1
  if (!Number.isInteger(copie) || copie < COPIE_MIN || copie > COPIE_MAX) {
    throw new ModelloStampaNonValidoError(
      `copie deve essere un intero fra ${COPIE_MIN} e ${COPIE_MAX}`
    )
  }
  for (const c of [modello.primaryColor, modello.secondaryColor]) {
    if (c !== undefined && !COLORE_HEX.test(c)) {
      throw new ModelloStampaNonValidoError('i colori devono essere in formato #RRGGBB')
    }
  }
  if (modello.logoBase64) verificaLogo(modello.logoBase64)
  return copie
}

export function contenutoFir(fir: any, qrCodeDataUrl?: string): Content[] {
  const content: Content[] = []

  // Il controller passa il record Prisma grezzo: peso a destino in `effectiveWeight` (Decimal),
  // unita in `unit`, quantita in `quantity` (Decimal), parti come snapshot `*Name`/`*Address`.
  // I nomi `pesoEffettivo`/`unitOfMeasure`/`producer` restano accettati per i chiamanti che
  // passano un oggetto gia mappato.
  const pesoGrezzo = fir.pesoEffettivo ?? fir.effectiveWeight
  const peso = pesoGrezzo === null || pesoGrezzo === undefined ? null : Number(pesoGrezzo)
  const unita: string = fir.rifiuto?.unitaMisura ?? fir.unit ?? fir.unitOfMeasure ?? 'kg'
  const parte = (nome: 'producer' | 'carrier' | 'receiver') =>
    fir[nome] ??
    (fir[`${nome}Name`]
      ? {
          companyName: fir[`${nome}Name`],
          address: fir[`${nome}Address`],
          // P.IVA vuota (privato) → assente, cosi' il PDF stampa il codice fiscale (D9.10)
          vatNumber: fir[`${nome}PartitaIva`] || undefined,
          fiscalCode: fir[`${nome}CodiceFiscale`] || undefined,
        }
      : undefined)

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
          { text: fir.status, style: 'value', color: coloreStato(fir.status) },
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
  content.push(costruisciInfoParte(parte('producer')))

  // Carrier Section
  content.push({ text: 'TRASPORTATORE', style: 'sectionHeader' })
  content.push(costruisciInfoParte(parte('carrier')))

  // Receiver Section
  content.push({ text: 'DESTINATARIO', style: 'sectionHeader' })
  content.push(costruisciInfoParte(parte('receiver')))

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
              : `${fir.quantity} ${unita}`,
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
            text: etichettaOperazione(
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
  if (fir.fourthCopyReturnedAt || peso !== null) {
    content.push({ text: '4ª COPIA — ESITO DESTINATARIO', style: 'sectionHeader' })
    content.push({
      columns: [
        {
          width: '50%',
          stack: [
            { text: 'Peso effettivo ricevuto', style: 'label' },
            {
              text: peso !== null ? `${peso} ${unita}` : 'N/D',
              style: 'value',
            },
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

function costruisciInfoParte(company: any): Content {
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

function etichettaOperazione(codice?: string, tipo?: string): string {
  if (codice) {
    const prefix = codice.startsWith('R') ? 'Recupero' : codice.startsWith('D') ? 'Smaltimento' : ''
    return prefix ? `${prefix} (${codice})` : codice
  }
  if (tipo === 'RECOVERY') return 'Recupero (R)'
  if (tipo === 'DISPOSAL') return 'Smaltimento (D)'
  return 'N/D'
}

function coloreStato(status: string): string {
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

export interface FirConQr {
  fir: any
  /** Data URL del QR: da passare solo per un FIR vidimato (regola invariata). */
  qrCodeDataUrl?: string
}

function intestazione(modello: ModelloStampaFir | null | undefined): Content {
  const titolo = modello?.headerText?.trim() || 'FORMULARIO IDENTIFICAZIONE RIFIUTI (FIR)'
  if (modello?.logoBase64) {
    return {
      columns: [
        { image: verificaLogo(modello.logoBase64), fit: [80, 40], width: 90 },
        { text: titolo, style: 'header', alignment: 'center', width: '*' },
        { text: '', width: 90 },
      ],
      margin: [40, 12, 40, 0],
    }
  }
  return { text: titolo, style: 'header', alignment: 'center', margin: [0, 20, 0, 0] }
}

function stili(modello: ModelloStampaFir | null | undefined): TDocumentDefinitions['styles'] {
  return {
    header: {
      fontSize: 18,
      bold: true,
      color: modello?.primaryColor ?? COLORE_PRIMARIO_PREDEFINITO,
    },
    sectionHeader: {
      fontSize: 14,
      bold: true,
      color: modello?.secondaryColor ?? COLORE_SECONDARIO_PREDEFINITO,
      margin: [0, 15, 0, 8],
    },
    label: { fontSize: 9, color: '#7f8c8d', margin: [0, 2, 0, 0] },
    value: { fontSize: 11, margin: [0, 0, 0, 8] },
    signature: { fontSize: 10, color: '#27ae60', margin: [0, 4, 0, 4] },
    copia: { fontSize: 9, italics: true, alignment: 'right', color: '#7f8c8d' },
  }
}

/**
 * Definizione pdfmake di una serie di FIR: un solo documento, ogni FIR ripetuto `copie` volte
 * con un `pageBreak` fra una copia e la successiva e la dicitura "Copia n di N".
 * Funzione pura: nessun I/O. Rifiuta modelli non validi (copie, colori, magic bytes del logo).
 */
export function definizioneFirInSerie(
  elementi: FirConQr[],
  modello?: ModelloStampaFir | null
): TDocumentDefinitions {
  if (elementi.length === 0) throw new ModelloStampaNonValidoError('nessun FIR da stampare')
  if (elementi.length > FIR_SERIE_MAX) {
    throw new ModelloStampaNonValidoError(`al massimo ${FIR_SERIE_MAX} FIR per serie`)
  }
  const copie = validaModello(modello)

  const content: Content[] = []
  for (const { fir, qrCodeDataUrl } of elementi) {
    for (let n = 1; n <= copie; n++) {
      const blocco: Content[] = []
      if (copie > 1) {
        blocco.push({ text: `Copia ${n} di ${copie}`, style: 'copia' })
      }
      blocco.push(...contenutoFir(fir, qrCodeDataUrl))
      // Il primo elemento del documento non ha salto pagina davanti.
      if (content.length > 0 && blocco.length > 0) {
        blocco[0] = { stack: [blocco[0]], pageBreak: 'before' } as Content
      }
      content.push(...blocco)
    }
  }

  const piede = modello?.footerText?.trim()
  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, modello?.logoBase64 ? 70 : 60, 40, 60],
    header: intestazione(modello),
    footer: (currentPage: number, pageCount: number) => ({
      text: `${piede ? `${piede} - ` : ''}Pagina ${currentPage} di ${pageCount} - Generato il ${formattaDataItaliana(new Date())}`,
      alignment: 'center',
      fontSize: 8,
      margin: [0, 0, 0, 20],
    }),
    content,
    styles: stili(modello),
  }
  return doc
}

/** Definizione pdfmake di un singolo FIR (con le copie del modello, se presente). */
export function definizioneFir(
  fir: any,
  qrCodeDataUrl?: string,
  modello?: ModelloStampaFir | null
): TDocumentDefinitions {
  return definizioneFirInSerie([{ fir, qrCodeDataUrl }], modello)
}
