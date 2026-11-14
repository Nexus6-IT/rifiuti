import {
  caratteriNonRappresentabili,
  dataAaaammgg,
  normalizzaTesto,
  numeroZeri,
  spazi,
  testo,
} from '../fisso/campo-fisso'
import type { TracciatoComunicazione } from '../tracciato-comunicazione'
import {
  ATTIVITA_ORR,
  CODIFICA_ORR,
  FINE_RIGA_ORR,
  LUNGHEZZA_RECORD_ORR,
  MOLTIPLICATORE_QUANTITA_ORR,
  VERSIONE_ORR,
} from './costanti'
import {
  LAYOUT_ORR,
  type DatiFileOrr,
  type NomeCampoOrr,
  type RecordOrr,
  type SoggettoOrr,
} from './record-orr'

/**
 * Serializzatore O.R.R. Campania (4.9f D2): record da 718 caratteri (CRLF compreso), uno per
 * movimento. Le sezioni C, D, E ripetono il blocco soggetto; i campi `00000000` sono i riservati
 * di WinWaste. Tracciato ricavato da WinWaste: da confermare con un file reale.
 */

const RISERVATO = '00000000'
const RE_CER = /^[0-9]{6}$/
const RE_CAP = /^[0-9]{5}$/
const RE_ISTAT = /^[0-9]{6}$/
const RE_ATECO = /^([0-9]{2}\.[0-9]{2}\.[0-9]{2}|00)$/
const RE_GIORNO = /^(\d{4})-(\d{2})-(\d{2})$/
const QUANTITA_MASSIMA = 10 ** 11 - 1

function giornoValido(s: string): boolean {
  const m = RE_GIORNO.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** `kg x 1000` arrotondato all'intero (nessun errore di virgola mobile sui 3 decimali dei kg). */
export function quantitaOrr(kg: number): number {
  return Math.round(kg * MOLTIPLICATORE_QUANTITA_ORR)
}

/** Blocco soggetto (10 campi: dalla ragione sociale all'ISTAT dell'unita' locale); `null` = tutto vuoto. */
function soggettoCampi(s: SoggettoOrr | null): string[] {
  const lunghezze = [45, 16, 8, 45, 5, 6, 8, 45, 5, 6]
  if (!s) return lunghezze.map((n, i) => (i === 2 || i === 6 ? RISERVATO : spazi(n)))
  return [
    testo(s.ragioneSociale, 45),
    testo(s.codice, 16),
    RISERVATO,
    testo(s.indirizzoSedeLegale, 45),
    testo(s.capSedeLegale, 5),
    testo(s.istatSedeLegale, 6),
    RISERVATO,
    testo(s.indirizzoUnitaLocale, 45),
    testo(s.capUnitaLocale, 5),
    testo(s.istatUnitaLocale, 6),
  ]
}

/** Un record come mappa campo -> valore gia' a larghezza fissa (senza CRLF: e' il campo `F1`). */
export function campiRecordOrr(r: RecordOrr): Record<NomeCampoOrr, string> {
  const det = r.detentore
  const tra = r.trasportatore
  const des = r.destinatario
  const [c2, c3, c4, c5, c6, c7, c8, c9, c10, c11] = soggettoCampi(det)
  const [d2, d3, d4, d5, d6, d7, d8, d9, d10, d11] = soggettoCampi(tra)
  const [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10] = soggettoCampi(des)
  return {
    a1: numeroZeri(r.anno, 4),
    a2: numeroZeri(r.mese, 2),
    a3: testo(r.formulario, 15),
    a4: dataAaaammgg(r.dataFormulario),
    a5: testo(r.tipoDichiarante, 3),
    b1: testo(r.cer, 6),
    b2: numeroZeri(quantitaOrr(r.quantitaKg), 11),
    b3: spazi(3),
    b4: testo(r.destinazione, 3),
    c1: det ? '0' : '1',
    c2,
    c3,
    c4,
    c5,
    c6,
    c7,
    c8,
    c9,
    c10,
    c11,
    c12: det ? testo(det.ateco, 8) : spazi(8),
    c13: det ? testo(det.tipo, 3) : testo('PRO', 3),
    d1: tra ? '0' : '1',
    d2,
    d3,
    d4,
    d5,
    d6,
    d7,
    d8,
    d9,
    d10,
    d11,
    d12: tra ? dataAaaammgg(tra.alboData) : spazi(8),
    d13: tra ? testo(tra.alboNumero, 16) : spazi(16),
    d14: tra ? testo(tra.alboClassi, 30) : spazi(30),
    e1,
    e2,
    e3,
    e4,
    e5,
    e6,
    e7,
    e8,
    e9,
    e10,
    e11: dataAaaammgg(des.autorizzazioneData),
    e12: testo(des.autorizzazioneNumero, 16),
    e13: testo(des.tipoImpianto, 3),
    F1: FINE_RIGA_ORR,
  }
}

/** Un record di 718 caratteri. */
export function serializzaRecordOrr(r: RecordOrr): string {
  const campi = campiRecordOrr(r)
  const riga = LAYOUT_ORR.map(c => campi[c.nome as NomeCampoOrr]).join('')
  if (riga.length !== LUNGHEZZA_RECORD_ORR) {
    throw new RangeError(
      `record O.R.R. di ${riga.length} caratteri invece di ${LUNGHEZZA_RECORD_ORR}`
    )
  }
  return riga
}

function testiDaControllare(r: RecordOrr): Array<[string, string]> {
  const out: Array<[string, string]> = [
    ['formulario', r.formulario],
    ['destinazione', r.destinazione],
    ['destinatario.tipoImpianto', r.destinatario.tipoImpianto],
    ['destinatario.autorizzazioneNumero', r.destinatario.autorizzazioneNumero],
  ]
  const soggetti: Array<[string, SoggettoOrr | null]> = [
    ['detentore', r.detentore],
    ['trasportatore', r.trasportatore],
    ['destinatario', r.destinatario],
  ]
  for (const [nome, s] of soggetti) {
    if (!s) continue
    out.push(
      [`${nome}.ragioneSociale`, s.ragioneSociale],
      [`${nome}.codice`, s.codice],
      [`${nome}.indirizzoSedeLegale`, s.indirizzoSedeLegale],
      [`${nome}.indirizzoUnitaLocale`, s.indirizzoUnitaLocale]
    )
  }
  if (r.trasportatore) {
    out.push(
      ['trasportatore.alboNumero', r.trasportatore.alboNumero],
      ['trasportatore.alboClassi', r.trasportatore.alboClassi]
    )
  }
  return out
}

function controllaSoggetto(
  nome: string,
  s: SoggettoOrr,
  et: string,
  errori: string[],
  conAteco: string | null
): void {
  const richiesto = (valore: string, campo: string) => {
    if (normalizzaTesto(valore) === '') errori.push(`${et}: manca ${nome} ${campo}`)
  }
  richiesto(s.ragioneSociale, 'ragione sociale')
  richiesto(s.codice, 'partita IVA o codice fiscale')
  if (normalizzaTesto(s.codice).length > 16)
    errori.push(`${et}: ${nome} partita IVA o codice fiscale oltre 16 caratteri`)
  richiesto(s.indirizzoSedeLegale, 'indirizzo della sede legale')
  if (!RE_CAP.test(s.capSedeLegale)) errori.push(`${et}: ${nome} CAP della sede legale non valido`)
  if (!RE_ISTAT.test(s.istatSedeLegale))
    errori.push(`${et}: ${nome} codice ISTAT della sede legale non valido`)
  richiesto(s.indirizzoUnitaLocale, "indirizzo dell'unità locale")
  if (!RE_CAP.test(s.capUnitaLocale)) errori.push(`${et}: ${nome} CAP dell'unità locale non valido`)
  if (!RE_ISTAT.test(s.istatUnitaLocale))
    errori.push(`${et}: ${nome} codice ISTAT dell'unità locale non valido`)
  if (conAteco !== null && !RE_ATECO.test(conAteco))
    errori.push(`${et}: ${nome} codice ATECO mancante o non valido (NN.NN.NN)`)
}

/**
 * Errori bloccanti (i `controlladati` di WinWaste, §6): formulario, autorizzazioni (numero, data,
 * classi), partita IVA o codice fiscale, indirizzi, CAP, ISTAT e ATECO del produttore. Se anche un
 * solo record ha un errore non si crea il file (D14). Un carattere fuori da Windows-1252 e' un
 * errore, un testo troppo lungo (nome, indirizzo) si tronca; gli identificativi no.
 */
export function validaFileOrr(dati: DatiFileOrr): string[] {
  const errori: string[] = []
  if (!ATTIVITA_ORR.includes(dati.attivita)) errori.push(`attività non valida: ${dati.attivita}`)
  if (dati.attivita === 'AUT') {
    errori.push(
      'Autodemolitore (AUT): i dati di pedana non sono gestiti, il file non si può generare'
    )
  }
  if (dati.record.length === 0) errori.push('Nessun record da comunicare')
  for (const r of dati.record) {
    const et = `Movimento ${r.movimento}`
    if (r.tipoDichiarante !== dati.attivita)
      errori.push(`${et}: tipo dichiarante ${r.tipoDichiarante} diverso dal file ${dati.attivita}`)
    if (!Number.isInteger(r.anno) || r.anno < 1000 || r.anno > 9999)
      errori.push(`${et}: anno non valido`)
    if (!Number.isInteger(r.mese) || r.mese < 1 || r.mese > 12)
      errori.push(`${et}: mese non valido`)
    const formulario = normalizzaTesto(r.formulario)
    if (formulario === '') errori.push(`${et}: manca il numero del formulario`)
    else if (formulario.length > 15)
      errori.push(`${et}: numero del formulario oltre 15 caratteri (${formulario.length})`)
    if (r.dataFormulario !== null && !giornoValido(r.dataFormulario))
      errori.push(`${et}: data del formulario non valida`)
    if (!RE_CER.test(r.cer)) errori.push(`${et}: CER non valido`)
    const q = Number.isFinite(r.quantitaKg) ? quantitaOrr(r.quantitaKg) : NaN
    if (!Number.isInteger(q) || q < 0 || q > QUANTITA_MASSIMA)
      errori.push(`${et}: quantità non valida o oltre 11 cifre`)
    if (normalizzaTesto(r.destinazione).length > 3)
      errori.push(`${et}: codice operazione oltre 3 caratteri`)

    if (r.detentore) controllaSoggetto('produttore', r.detentore, et, errori, r.detentore.ateco)
    if (r.trasportatore) {
      const t = r.trasportatore
      controllaSoggetto('trasportatore', t, et, errori, null)
      if (normalizzaTesto(t.alboNumero) === '')
        errori.push(`${et}: manca il numero di iscrizione all'Albo del trasportatore`)
      else if (normalizzaTesto(t.alboNumero).length > 16)
        errori.push(`${et}: numero di iscrizione all'Albo oltre 16 caratteri`)
      if (!t.alboData || !giornoValido(t.alboData))
        errori.push(`${et}: manca la data di iscrizione all'Albo del trasportatore`)
      if (normalizzaTesto(t.alboClassi) === '')
        errori.push(`${et}: mancano le classi di iscrizione all'Albo`)
    }
    const d = r.destinatario
    controllaSoggetto('destinatario', d, et, errori, null)
    const numeroAut = normalizzaTesto(d.autorizzazioneNumero)
    if (numeroAut === '') errori.push(`${et}: manca il numero dell'autorizzazione del destinatario`)
    else if (numeroAut.length > 16)
      errori.push(`${et}: numero di autorizzazione oltre 16 caratteri`)
    if (!d.autorizzazioneData || !giornoValido(d.autorizzazioneData))
      errori.push(`${et}: manca la data dell'autorizzazione del destinatario`)
    if (normalizzaTesto(d.tipoImpianto).length !== 3)
      errori.push(`${et}: tipo impianto del destinatario non valido`)

    for (const [campo, valore] of testiDaControllare(r)) {
      errori.push(...caratteriNonRappresentabili(valore, `${et}, ${campo}`))
    }
  }
  return errori
}

export function serializzaFileOrr(dati: DatiFileOrr): string {
  const errori = validaFileOrr(dati)
  if (errori.length > 0)
    throw new RangeError(`Dati O.R.R. non validi: ${errori.slice(0, 5).join('; ')}`)
  return dati.record.map(serializzaRecordOrr).join('')
}

export const TracciatoOrr: TracciatoComunicazione<DatiFileOrr> = {
  consorzio: 'ORR',
  versione: VERSIONE_ORR,
  estensione: 'txt',
  contentType: 'text/plain',
  codifica: CODIFICA_ORR,
  affidabilita: 'RICAVATO_WINWASTE',
  notaAffidabilita:
    'Tracciato ricavato da WinWaste (classe Campania, record da 718 caratteri), da confermare con un file reale: non esiste una specifica ufficiale verificata e dal 2017 la Campania usa O.R.So.',
  validaDati: validaFileOrr,
  serializza: serializzaFileOrr,
}
