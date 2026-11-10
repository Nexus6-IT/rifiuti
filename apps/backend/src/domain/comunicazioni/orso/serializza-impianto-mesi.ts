import type { TracciatoComunicazione } from '../tracciato-comunicazione'
import type {
  ImpiantoMesiDati,
  IngressoDati,
  RifiutoProdottoDati,
  RifiutoRicevutoDati,
  UscitaDati,
} from './impianto-mesi'

export const NAMESPACE_IMPIANTO_MESI = 'https://orso.arpalombardia.it/schemi/ImpiantoMesi.xsd'

const RE_CER = /^[0-9]{6}$/
const RE_DECIMALE = /^[0-9]+(\.[0-9]+)?$/
const RE_OPERAZIONE = /^(R([1-9]|1[0-3])|D([1-9]|1[0-5]))$/
const RE_ID = /^[0-9]{1,9}$/
const TIPI_IN = new Set(['C', 'I', 'Inew', 'Tot', 'Extra'])
const TIPI_OUT = new Set(['I', 'Inew', 'Tot'])
/** Caratteri non ammessi in XML 1.0 (controlli e U+FFFE/FFFF). */
// eslint-disable-next-line no-control-regex
const RE_NON_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

const zero = (q: string) => /^0+(\.0+)?$/.test(q)

/** Escape di testo e attributi. I caratteri non ammessi da XML 1.0 vengono tolti. */
export function escapeXml(s: string): string {
  return s
    .replace(RE_NON_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function validaIngresso(i: IngressoDati, p: string, out: string[]): void {
  if (!RE_DECIMALE.test(i.q)) out.push(`${p}: quantità non valida`)
  if (i.f !== 0 && i.f !== 1) out.push(`${p}: il flag FIR deve essere 0 o 1`)
  if (!TIPI_IN.has(i.ts)) out.push(`${p}: tipo soggetto non ammesso`)
  if (!RE_ID.test(i.s)) out.push(`${p}: identificativo soggetto non valido`)
}

function validaUscita(u: UscitaDati, p: string, out: string[]): void {
  if (!RE_DECIMALE.test(u.q) || zero(u.q)) out.push(`${p}: quantità non valida (zero non ammesso)`)
  if (!TIPI_OUT.has(u.ts)) out.push(`${p}: tipo soggetto non ammesso`)
  if (!RE_ID.test(u.s)) out.push(`${p}: identificativo soggetto non valido`)
}

function validaRifiuto(r: { cer: string; descrizione: string }, p: string, out: string[]): void {
  if (!RE_CER.test(r.cer)) out.push(`${p}: CER non valido`)
  const d = r.descrizione.replace(RE_NON_XML, '').trim().replace(/\s+/g, ' ')
  if (d.length < 1 || d.length > 100) out.push(`${p}: descrizione di 1-100 caratteri`)
}

/** Errori bloccanti dei dati rispetto all'XSD; lista vuota se serializzabili. */
export function validaImpiantoMesi(dati: ImpiantoMesiDati): string[] {
  const out: string[] = []
  if (dati.anni.length === 0) out.push('Nessun anno presente')
  const anniVisti = new Set<number>()
  for (const a of dati.anni) {
    if (!Number.isInteger(a.anno) || a.anno < 1900 || a.anno > 2999) {
      out.push(`Anno ${a.anno}: fuori intervallo 1900-2999`)
    }
    if (anniVisti.has(a.anno)) out.push(`Anno ${a.anno}: duplicato`)
    anniVisti.add(a.anno)
    if (a.mesi.length === 0) out.push(`Anno ${a.anno}: nessun mese presente`)
    const mesiVisti = new Set<number>()
    for (const m of a.mesi) {
      const pm = `${a.anno}-${String(m.mese).padStart(2, '0')}`
      if (!Number.isInteger(m.mese) || m.mese < 1 || m.mese > 12) out.push(`${pm}: mese non valido`)
      if (mesiVisti.has(m.mese)) out.push(`${pm}: mese duplicato`)
      mesiVisti.add(m.mese)
      m.ricevuti.forEach((r, ri) => {
        const p = `${pm} ricevuto ${ri + 1}`
        validaRifiuto(r, p, out)
        for (const op of r.operazioni) {
          if (!RE_OPERAZIONE.test(op)) out.push(`${p}: operazione ${op} non ammessa`)
        }
        if (r.trattato !== undefined && !RE_DECIMALE.test(r.trattato)) {
          out.push(`${p}: quantità trattata non valida`)
        }
        r.ingressi.forEach((i, ii) => validaIngresso(i, `${p} ingresso ${ii + 1}`, out))
      })
      m.prodotti.forEach((r, ri) => {
        const p = `${pm} prodotto ${ri + 1}`
        validaRifiuto(r, p, out)
        if (!RE_DECIMALE.test(r.quantitaTrattataInternamente)) {
          out.push(`${p}: quantità trattata internamente non valida`)
        }
        r.uscite.forEach((u, ui) => validaUscita(u, `${p} uscita ${ui + 1}`, out))
      })
    }
  }
  return out
}

function xmlRicevuto(r: RifiutoRicevutoDati): string {
  const parti = [`<Descrizione>${escapeXml(r.descrizione)}</Descrizione>`]
  for (const op of r.operazioni) parti.push(`<Operazione>${op}</Operazione>`)
  if (r.trattato !== undefined) parti.push(`<Trattato>${r.trattato}</Trattato>`)
  for (const i of r.ingressi) parti.push(`<In q="${i.q}" f="${i.f}" ts="${i.ts}" s="${i.s}"/>`)
  return `<RifiutoRicevuto CER="${r.cer}">${parti.join('')}</RifiutoRicevuto>`
}

function xmlProdotto(r: RifiutoProdottoDati): string {
  const parti = [`<Descrizione>${escapeXml(r.descrizione)}</Descrizione>`]
  for (const u of r.uscite) parti.push(`<Out q="${u.q}" ts="${u.ts}" s="${u.s}"/>`)
  return `<RifiutoProdotto CER="${r.cer}" QuantitaTrattataInternamente="${r.quantitaTrattataInternamente}">${parti.join('')}</RifiutoProdotto>`
}

/**
 * Serializza i dati nel file XML `ImpiantoMesi`. Il testo è protetto con escape (non serve CDATA:
 * la descrizione è l'unico contenuto libero). Lancia se i dati non rispettano l'XSD.
 */
export function serializzaImpiantoMesi(dati: ImpiantoMesiDati): string {
  const errori = validaImpiantoMesi(dati)
  if (errori.length > 0) throw new Error(`Dati ImpiantoMesi non validi: ${errori.join('; ')}`)
  const autore = dati.autore ? ` autore="${escapeXml(dati.autore)}"` : ''
  const anni = dati.anni.map(
    a =>
      `<Anno value="${a.anno}">` +
      a.mesi
        .map(
          m =>
            `<Mese value="${m.mese}">${m.ricevuti.map(xmlRicevuto).join('')}${m.prodotti.map(xmlProdotto).join('')}</Mese>`
        )
        .join('') +
      '</Anno>'
  )
  return `<?xml version="1.0" encoding="utf-8"?>\n<ImpiantoMesi xmlns="${NAMESPACE_IMPIANTO_MESI}"${autore}>${anni.join('')}</ImpiantoMesi>\n`
}

export const TracciatoOrsoImpiantoMesi: TracciatoComunicazione<ImpiantoMesiDati> = {
  consorzio: 'ORSO',
  versione: 'ImpiantoMesi-1',
  estensione: 'xml',
  contentType: 'application/xml',
  validaDati: validaImpiantoMesi,
  serializza: serializzaImpiantoMesi,
}
