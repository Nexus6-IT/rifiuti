/**
 * Distinta dei ritiri in PDF (4.7, T4): foglio di viaggio per giorno e mezzo.
 *
 * Solo definizione pura (`definizioneDistinta`): nessun DB, nessun rendering. Il rendering con
 * pdfmake e le rotte stanno in T16. Il modello arriva come oggetto (forma `CompanyTemplate` +
 * `ambito`); `sceglieModelloDistinta` applica la regola DISTINTA_RITIRI, poi GENERALE, poi niente.
 */
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'

export type AmbitoModello = 'GENERALE' | 'FIR' | 'DISTINTA_RITIRI'

export interface ModelloStampaDistinta {
  ambito: AmbitoModello
  logoBase64: string | null
  headerText: string | null
  footerText: string | null
  primaryColor: string
  secondaryColor: string
}

export interface RigaDistinta {
  fascia: 'MATTINA' | 'POMERIGGIO' | null
  ordineGiro: number | null
  produttore: string
  indirizzoSede: string
  cerCode: string
  /** Quantita` presunta, decimale in stringa (kg). */
  quantitaPresunta: string | null
  numeroFir: string | null
}

export interface DatiDistinta {
  /** `AAAA-MM-GG`. */
  data: string
  automezzo: { targa: string; descrizione: string | null } | null
  righe: RigaDistinta[]
}

export const FIR_NON_GENERATO = 'FIR non generato'
export const ETICHETTA_FASCIA = { MATTINA: 'Mattina', POMERIGGIO: 'Pomeriggio' } as const
const SENZA_FASCIA = 'Senza fascia'
const COLORE_ESADECIMALE = /^#[0-9a-fA-F]{6}$/

/** DISTINTA_RITIRI, altrimenti GENERALE, altrimenti nessuno. */
export function sceglieModelloDistinta(
  modelli: readonly ModelloStampaDistinta[]
): ModelloStampaDistinta | null {
  return (
    modelli.find(m => m.ambito === 'DISTINTA_RITIRI') ??
    modelli.find(m => m.ambito === 'GENERALE') ??
    null
  )
}

/** Logo valido solo se data URL base64 con firma PNG o JPEG reale; altrimenti si omette. */
export function logoValido(logoBase64: string | null): string | null {
  if (!logoBase64) return null
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(logoBase64)
  if (!m) return null
  const testa = Buffer.from(m[2].slice(0, 16), 'base64')
  const png = m[1] === 'png' && testa.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const jpg = m[1] === 'jpeg' && testa.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  return png || jpg ? logoBase64 : null
}

function dataIt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

function quantitaIt(q: string | null): string {
  if (!q) return ''
  const m = /^(-?\d+)(?:\.(\d+))?$/.exec(q.trim())
  if (!m) return q
  const intero = m[1].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return m[2] ? `${intero},${m[2]}` : intero
}

/** Ordine: fascia (mattina, pomeriggio, senza), ordine giro (senza in fondo), poi produttore. */
export function ordinaRigheDistinta(righe: readonly RigaDistinta[]): RigaDistinta[] {
  const pesoFascia = (f: RigaDistinta['fascia']) =>
    f === 'MATTINA' ? 0 : f === 'POMERIGGIO' ? 1 : 2
  return righe
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        pesoFascia(a.r.fascia) - pesoFascia(b.r.fascia) ||
        (a.r.ordineGiro ?? Number.MAX_SAFE_INTEGER) - (b.r.ordineGiro ?? Number.MAX_SAFE_INTEGER) ||
        a.r.produttore.localeCompare(b.r.produttore, 'it') ||
        a.i - b.i
    )
    .map(x => x.r)
}

export function nomeFileDistinta(dati: DatiDistinta): string {
  const targa = dati.automezzo ? `-${dati.automezzo.targa.replace(/[^A-Za-z0-9]+/g, '')}` : ''
  return `distinta-ritiri-${dati.data}${targa}.pdf`
}

export function definizioneDistinta(
  dati: DatiDistinta,
  modello: ModelloStampaDistinta | null
): TDocumentDefinitions {
  const colore = (c: string | undefined, predefinito: string) =>
    c && COLORE_ESADECIMALE.test(c) ? c : predefinito
  const primario = colore(modello?.primaryColor, '#000000')
  const secondario = colore(modello?.secondaryColor, '#444444')
  const logo = logoValido(modello?.logoBase64 ?? null)
  const righe = ordinaRigheDistinta(dati.righe)

  const intestazione: Content = {
    columns: [
      {
        width: '*',
        stack: [
          { text: 'Distinta dei ritiri', fontSize: 16, bold: true, color: primario },
          { text: `Data: ${dataIt(dati.data)}`, fontSize: 11 },
          {
            text: dati.automezzo
              ? `Mezzo: ${[dati.automezzo.targa, dati.automezzo.descrizione].filter(Boolean).join(' - ')}`
              : 'Tutti i mezzi',
            fontSize: 10,
            color: secondario,
          },
          ...(modello?.headerText ? [{ text: modello.headerText, fontSize: 9 } as Content] : []),
        ],
      },
      ...(logo ? [{ image: logo, width: 80, alignment: 'right' } as unknown as Content] : []),
    ],
  } as unknown as Content

  const corpo: Content[][] = [
    [
      'Fascia',
      'N.',
      'Produttore / sede',
      'CER',
      'Q.tà presunta (kg)',
      'N. FIR',
      'Note autista',
    ].map(t => ({ text: t, bold: true, color: primario, fontSize: 9 }) as Content),
  ]
  let fasciaPrec: string | null = null
  for (const r of righe) {
    const etichetta = r.fascia ? ETICHETTA_FASCIA[r.fascia] : SENZA_FASCIA
    corpo.push([
      { text: etichetta === fasciaPrec ? '' : etichetta, fontSize: 9 },
      { text: r.ordineGiro === null ? '' : String(r.ordineGiro), alignment: 'center', fontSize: 9 },
      {
        stack: [
          { text: r.produttore, bold: true, fontSize: 9 },
          { text: r.indirizzoSede, fontSize: 8 },
        ],
      },
      { text: r.cerCode, fontSize: 9 },
      { text: quantitaIt(r.quantitaPresunta), alignment: 'right', fontSize: 9 },
      r.numeroFir
        ? { text: r.numeroFir, fontSize: 9 }
        : { text: FIR_NON_GENERATO, italics: true, fontSize: 8, color: secondario },
      { text: '\n\n', fontSize: 9 }, // spazio per le note dell'autista
    ] as Content[])
    fasciaPrec = etichetta
  }
  if (righe.length === 0) {
    corpo.push([
      { text: 'Nessun ritiro programmato', colSpan: 7, alignment: 'center', italics: true },
      ...Array<Content>(6).fill({ text: '' }),
    ] as Content[])
  }

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 40],
    defaultStyle: { fontSize: 9 },
    content: [
      intestazione,
      {
        margin: [0, 12, 0, 0],
        table: {
          headerRows: 1,
          widths: [58, 22, '*', 40, 70, 80, 150],
          body: corpo,
        },
        layout: 'lightHorizontalLines',
      } as unknown as Content,
    ],
    footer: (pagina: number, totale: number): Content =>
      ({
        columns: [
          { text: modello?.footerText ?? '', fontSize: 8, margin: [28, 0, 0, 0] },
          {
            text: `Pagina ${pagina} di ${totale}`,
            alignment: 'right',
            fontSize: 8,
            margin: [0, 0, 28, 0],
          },
        ],
      }) as unknown as Content,
  }
}
