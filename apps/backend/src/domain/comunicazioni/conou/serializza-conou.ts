import {
  caratteriNonRappresentabili,
  dataAaaammgg,
  layout,
  numeroSegnato,
  testo,
  type CampoLayout,
} from '../fisso/campo-fisso'
import type { TracciatoComunicazione } from '../tracciato-comunicazione'
import {
  CODIFICA_CONOU,
  CONTENT_TYPE_CONOU,
  FINE_RIGA_CONOU,
  LUNGHEZZA_RIGA_CONOU,
  PERCENTUALE_OLIO_MASSIMA,
  VERSIONE_CONOU,
} from './costanti'
import type { DatiFileConou, RigaConou } from './riga-conou'

/**
 * Layout dei 24 campi scritti (ComunicazioneCou2023:creafile): il campo 11 di riserva e' omesso.
 * Lunghezza totale 299; `layout()` lancia se la somma non coincide.
 */
export const LAYOUT_CONOU = layout(
  [
    { nome: 'cfDetentore', lunghezza: 16 },
    { nome: 'cap', lunghezza: 5 },
    { nome: 'partitaIva', lunghezza: 11 },
    { nome: 'ragioneSociale', lunghezza: 60 },
    { nome: 'indirizzo', lunghezza: 40 },
    { nome: 'civico', lunghezza: 7 },
    { nome: 'provincia', lunghezza: 2 },
    { nome: 'comune', lunghezza: 40 },
    { nome: 'ateco', lunghezza: 8 },
    { nome: 'istat', lunghezza: 9 },
    { nome: 'codiceDeposito', lunghezza: 10 },
    { nome: 'dataRegistrazione', lunghezza: 8 },
    { nome: 'serie', lunghezza: 6 },
    { nome: 'numero', lunghezza: 10 },
    { nome: 'anno', lunghezza: 4 },
    { nome: 'dataFormulario', lunghezza: 8 },
    { nome: 'cfTrasportatore', lunghezza: 16 },
    { nome: 'targa', lunghezza: 8 },
    { nome: 'cer', lunghezza: 6 },
    { nome: 'percentualeX100', lunghezza: 4 },
    { nome: 'protocollo', lunghezza: 8 },
    { nome: 'quantitaKg', lunghezza: 11 },
    { nome: 'prodotto', lunghezza: 1 },
    { nome: 'causale', lunghezza: 1 },
  ] satisfies CampoLayout[],
  LUNGHEZZA_RIGA_CONOU
)

const TESTUALI: ReadonlyArray<keyof RigaConou> = [
  'cfDetentore',
  'ragioneSociale',
  'indirizzo',
  'civico',
  'comune',
  'cfTrasportatore',
  'targa',
]

/** Campi su cui un valore piu' lungo del campo viene troncato in silenzio (come `PadRight`+taglio). */
function compatta(valore: string): string {
  return valore.replace(/\s+/g, '')
}

export function serializzaRigaConou(r: RigaConou): string {
  const lung = (nome: string) => LAYOUT_CONOU.find(c => c.nome === nome)?.lunghezza ?? 0
  const t = (nome: keyof RigaConou) => testo(String(r[nome]), lung(nome))
  return [
    t('cfDetentore'),
    t('cap'),
    t('partitaIva'),
    t('ragioneSociale'),
    t('indirizzo'),
    t('civico'),
    t('provincia'),
    t('comune'),
    t('ateco'),
    t('istat'),
    t('codiceDeposito'),
    dataAaaammgg(r.dataRegistrazione),
    t('serie'),
    t('numero'),
    t('anno'),
    dataAaaammgg(r.dataFormulario),
    t('cfTrasportatore'),
    // La targa si scrive senza spazi (`automezzi.targa`, spazi tolti).
    testo(compatta(r.targa), lung('targa')),
    t('cer'),
    numeroSegnato(r.percentualeX100, 4),
    numeroSegnato(r.protocollo, 8),
    numeroSegnato(r.quantitaKg, 11),
    t('prodotto'),
    t('causale'),
  ].join('')
}

const nonVuoto = (v: string) => v.trim() !== ''

/** Errori bloccanti di una riga (`ComunicazioneCou2023.Controlla` + code page, D6). */
export function validaRigaConou(r: RigaConou): string[] {
  const e: string[] = []
  if (!nonVuoto(r.cfDetentore)) e.push('Manca Codice Fiscale Detentore/Destinatario')
  if (!nonVuoto(r.ateco)) e.push('Manca Codice ATECO')
  if (!/^\d{9}$/.test(r.istat)) e.push('Codice ISTAT Comune errato (servono 9 cifre)')
  if (!/^[A-Za-z0-9]{3,10}$/.test(r.codiceDeposito)) {
    e.push('Codice deposito errato (da 3 a 10 caratteri)')
  }
  if (r.serie.length > 6) e.push('Serie formulario di lunghezza errata')
  if (r.numero.length > 10) e.push('Numero formulario di lunghezza errata')
  if (r.anno !== '' && !/^\d{4}$/.test(r.anno)) e.push('Anno formulario errato')
  if (!Number.isInteger(r.protocollo) || r.protocollo <= 0) e.push('Manca protocollo registro')
  else if (String(r.protocollo).length > 8) e.push('Protocollo registro oltre 8 cifre')
  if (!/^[ABCEG]$/.test(r.prodotto)) e.push('Codice prodotto errato')
  if (!/^[BEUMDL]$/.test(r.causale)) e.push('Causale Conou errata')
  if (/^[BEU]$/.test(r.causale)) {
    if (!nonVuoto(r.serie)) e.push('Manca Serie Formulario')
    if (!nonVuoto(r.numero)) e.push('Manca Numero Formulario')
    if (!nonVuoto(r.cfTrasportatore)) e.push('Manca Codice Fiscale Trasportatore')
    if (!nonVuoto(compatta(r.targa))) e.push('Manca Targa')
  }
  if (!/^\d{6}$/.test(r.cer)) e.push('CER errato (servono 6 cifre)')
  if (
    !Number.isInteger(r.percentualeX100) ||
    r.percentualeX100 < 1 ||
    r.percentualeX100 > PERCENTUALE_OLIO_MASSIMA
  ) {
    e.push(`Percentuale olio errata (da 0,01 a ${PERCENTUALE_OLIO_MASSIMA / 100})`)
  }
  if (!Number.isInteger(r.quantitaKg) || r.quantitaKg === 0) e.push('Quantita errata')
  else if (String(r.quantitaKg).length > 11) e.push('Quantita oltre 11 caratteri')
  for (const nome of TESTUALI) {
    e.push(...caratteriNonRappresentabili(String(r[nome]), nome))
  }
  return e
}

/**
 * Tracciato CONOU 2023 ricavato da WinWaste (D7): una riga di 299 caratteri per movimento, CRLF,
 * nessuna intestazione ne' totale. Il contenuto resta testo; si codifica allo scaricamento.
 */
export const TracciatoConou: TracciatoComunicazione<DatiFileConou> = {
  consorzio: 'CONOU',
  versione: VERSIONE_CONOU,
  estensione: 'txt',
  contentType: CONTENT_TYPE_CONOU,
  codifica: CODIFICA_CONOU,
  affidabilita: 'RICAVATO_WINWASTE',
  notaAffidabilita:
    'Tracciato ricavato da WinWaste, da confermare con un file reale accettato dal CONOU.',
  validaDati(dati) {
    const errori: string[] = []
    if (dati.righe.length === 0) errori.push('Nessun movimento da comunicare')
    dati.righe.forEach((r, i) => {
      for (const m of validaRigaConou(r)) errori.push(`Riga ${i + 1} (${r.riferimento}): ${m}`)
    })
    return errori
  },
  serializza(dati) {
    const errori = this.validaDati(dati)
    if (errori.length > 0)
      throw new Error(`Dati CONOU non validi: ${errori.slice(0, 5).join('; ')}`)
    return dati.righe.map(r => serializzaRigaConou(r) + FINE_RIGA_CONOU).join('')
  },
}
