import { FormControl, FormGroup } from '@angular/forms'
import {
  ContrattoCliente,
  EsigibilitaIva,
  ModificaContrattoCliente,
  CodiceRinnovo,
  NuovoContrattoCliente,
  PeriodoFatturazione,
} from '../clienti/clienti.model'

/** Le tre annotazioni libere del contratto (E32), ciascuna fino a 45 caratteri. */
export const NUMERO_ANNOTAZIONI = 3

/**
 * Form del contratto cliente. Chi aggiunge un controllo deve aggiungerlo anche in `nuovi`,
 * `vecchi` e `valoriDaContratto` (altrimenti non compila).
 */
export function creaFormContratto() {
  const testo = () => new FormControl('', { nonNullable: true })
  return new FormGroup({
    numero: testo(),
    descrizione: testo(),
    clienteId: testo(),
    clienteFatturazioneId: testo(),
    sedeId: testo(),
    categoriaId: testo(),
    tipoId: testo(),
    dataInizio: testo(),
    dataFine: testo(),
    dataStipula: testo(),
    validitaQuantita: testo(),
    validitaUnita: testo(),
    condizionePagamentoId: testo(),
    contoCorrenteId: testo(),
    speseIncassoId: testo(),
    bolloId: testo(),
    registroIvaId: testo(),
    esigibilitaIva: new FormControl<EsigibilitaIva>('IMMEDIATA', { nonNullable: true }),
    ritenutaPercentuale: testo(),
    agenteId: testo(),
    testoFatturazioneId: testo(),
    codiceDestinatario: testo(),
    riferimentoAmministrazione: testo(),
    periodi: new FormControl<PeriodoFatturazione[]>([], { nonNullable: true }),
    contrattoPrincipaleId: testo(),
    codiceCig: testo(),
    codiceCup: testo(),
    idDocumentoPa: testo(),
    escludiDichiarazioneIntento: new FormControl(false, { nonNullable: true }),
    sogliaDal: testo(),
    sogliaImporto: testo(),
    sogliaIvaEsclusa: new FormControl(false, { nonNullable: true }),
    rinnovoAutomatico: new FormControl(false, { nonNullable: true }),
    codiceRinnovo: new FormControl<CodiceRinnovo | ''>('', { nonNullable: true }),
    incrementoIstat: new FormControl(false, { nonNullable: true }),
    commessa: testo(),
    annotazioni: new FormControl<string[]>(annotazioniVuote(), { nonNullable: true }),
  })
}

const annotazioniVuote = (): string[] => Array.from({ length: NUMERO_ANNOTAZIONI }, () => '')

/** Vero se il codice destinatario è un codice vero (non vuoto e non `0000000`, D3). */
export const codiceDestinatarioVero = (codice: string | null): boolean => {
  const c = (codice ?? '').trim().toUpperCase()
  return c !== '' && c !== '0000000'
}

export type FormContratto = ReturnType<typeof creaFormContratto>
export type CampoForm = keyof FormContratto['controls']
export type ValoriContratto = ReturnType<FormContratto['getRawValue']>

/**
 * Campi che alla creazione il backend copia dal cliente (D4) se assenti nel corpo; per
 * codice destinatario e riferimento dal cliente di fatturazione, se il contratto ne ha uno (R35).
 * Il dialog li precompila per mostrarli e li invia solo se l'operatore li ha toccati.
 */
export const CAMPI_DAL_CLIENTE: readonly CampoForm[] = [
  'condizionePagamentoId',
  'agenteId',
  'registroIvaId',
  'speseIncassoId',
  'bolloId',
  'esigibilitaIva',
  'ritenutaPercentuale',
  'codiceDestinatario',
  'riferimentoAmministrazione',
]

const vuotoId = (v: string): string | null => (v === '' ? null : v)
const giorno = (d: string | null): string => (d ? d.slice(0, 10) : '')

/** Decimale come stringa: tagliato, virgole in punti, vuoto = null. Serve a ritenuta e soglia. */
const decimale = (v: string | null): string | null => {
  const t = (v ?? '').trim().replace(/,/g, '.')
  return t === '' ? null : t
}

const stessoNumero = (a: string | null, b: string | null): boolean =>
  a === b || (a !== null && b !== null && Number(a) === Number(b))

/** Vuoto = nessuna; un intero diventa numero; altro resta com'è (lo rifiuta il dialog, D20). */
const quantita = (v: string): number | string | null => {
  const t = v.trim()
  if (t === '') return null
  return /^\d+$/.test(t) ? Number(t) : t
}

const stessiPeriodi = (a: PeriodoFatturazione[], b: PeriodoFatturazione[]): boolean =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.giornoInizio === b[i].giornoInizio &&
      p.meseInizio === b[i].meseInizio &&
      p.giornoFine === b[i].giornoFine &&
      p.meseFine === b[i].meseFine
  )

/** Annotazioni come le vede il backend: tagliate e senza quelle vuote. */
const annotazioniDi = (v: readonly string[] | null | undefined): string[] =>
  (v ?? []).map(a => a.trim()).filter(a => a !== '')

const stessiTesti = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** Valori del form per un contratto letto dal server (null = campo vuoto). */
export function valoriDaContratto(c: ContrattoCliente): ValoriContratto {
  return {
    numero: c.numero,
    descrizione: c.descrizione,
    clienteId: c.clienteId,
    clienteFatturazioneId: c.clienteFatturazioneId ?? '',
    sedeId: c.sedeId ?? '',
    categoriaId: c.categoriaId ?? '',
    tipoId: c.tipoId ?? '',
    dataInizio: giorno(c.dataInizio),
    dataFine: giorno(c.dataFine),
    dataStipula: giorno(c.dataStipula),
    validitaQuantita: c.validitaQuantita === null ? '' : String(c.validitaQuantita),
    validitaUnita: c.validitaUnita ?? '',
    condizionePagamentoId: c.condizionePagamentoId ?? '',
    contoCorrenteId: c.contoCorrenteId ?? '',
    speseIncassoId: c.speseIncassoId ?? '',
    bolloId: c.bolloId ?? '',
    registroIvaId: c.registroIvaId ?? '',
    esigibilitaIva: c.esigibilitaIva,
    ritenutaPercentuale: c.ritenutaPercentuale ?? '',
    agenteId: c.agenteId ?? '',
    testoFatturazioneId: c.testoFatturazioneId ?? '',
    codiceDestinatario: c.codiceDestinatario ?? '',
    riferimentoAmministrazione: c.riferimentoAmministrazione ?? '',
    periodi: c.periodi,
    contrattoPrincipaleId: c.contrattoPrincipaleId ?? '',
    codiceCig: c.codiceCig ?? '',
    codiceCup: c.codiceCup ?? '',
    idDocumentoPa: c.idDocumentoPa ?? '',
    escludiDichiarazioneIntento: !!c.escludiDichiarazioneIntento,
    sogliaDal: giorno(c.sogliaDal ?? null),
    sogliaImporto: c.sogliaImporto ?? '',
    sogliaIvaEsclusa: !!c.sogliaIvaEsclusa,
    rinnovoAutomatico: !!c.rinnovoAutomatico,
    codiceRinnovo: c.codiceRinnovo ?? '',
    incrementoIstat: !!c.incrementoIstat,
    commessa: c.commessa ?? '',
    annotazioni: [...(c.annotazioni ?? []), ...annotazioniVuote()].slice(0, NUMERO_ANNOTAZIONI),
  }
}

type Confronto = [campo: CampoForm, nuovo: unknown, vecchio: unknown]

const id = (v: string): string | null => vuotoId(v)
const testo = (v: string | null): string | null => (v?.trim() ? v.trim() : null)
const data = (v: string | null): string | null => (v ? giorno(v) : null)

/**
 * Valori del form come li vede il backend. `Record<CampoForm, …>`: chi aggiunge un controllo
 * (Task 26) deve aggiungerlo anche qui, o non compila.
 */
function nuovi(v: ValoriContratto): Record<CampoForm, unknown> {
  return {
    numero: testo(v.numero),
    descrizione: testo(v.descrizione),
    clienteId: id(v.clienteId),
    clienteFatturazioneId: id(v.clienteFatturazioneId),
    sedeId: id(v.sedeId),
    categoriaId: id(v.categoriaId),
    tipoId: id(v.tipoId),
    dataInizio: data(v.dataInizio),
    dataFine: data(v.dataFine),
    dataStipula: data(v.dataStipula),
    validitaQuantita: quantita(v.validitaQuantita),
    validitaUnita: v.validitaUnita || null,
    condizionePagamentoId: id(v.condizionePagamentoId),
    contoCorrenteId: id(v.contoCorrenteId),
    speseIncassoId: id(v.speseIncassoId),
    bolloId: id(v.bolloId),
    registroIvaId: id(v.registroIvaId),
    esigibilitaIva: v.esigibilitaIva,
    ritenutaPercentuale: decimale(v.ritenutaPercentuale),
    agenteId: id(v.agenteId),
    testoFatturazioneId: id(v.testoFatturazioneId),
    codiceDestinatario: testo(v.codiceDestinatario)?.toUpperCase() ?? null,
    // Il riferimento si indica solo con un codice vero (R41): altrimenti non parte.
    riferimentoAmministrazione: codiceDestinatarioVero(v.codiceDestinatario)
      ? testo(v.riferimentoAmministrazione)
      : null,
    periodi: v.periodi,
    contrattoPrincipaleId: id(v.contrattoPrincipaleId),
    codiceCig: testo(v.codiceCig)?.toUpperCase() ?? null,
    codiceCup: testo(v.codiceCup)?.toUpperCase() ?? null,
    idDocumentoPa: testo(v.idDocumentoPa),
    escludiDichiarazioneIntento: v.escludiDichiarazioneIntento,
    sogliaDal: data(v.sogliaDal),
    sogliaImporto: decimale(v.sogliaImporto),
    // Senza soglia la casella non ha senso (D27): il backend la normalizza a false.
    sogliaIvaEsclusa: decimale(v.sogliaImporto) !== null && v.sogliaIvaEsclusa,
    rinnovoAutomatico: v.rinnovoAutomatico,
    codiceRinnovo: v.codiceRinnovo || null,
    incrementoIstat: v.incrementoIstat,
    commessa: testo(v.commessa),
    annotazioni: annotazioniDi(v.annotazioni),
  }
}

/** Gli stessi campi dal contratto salvato, con le stesse normalizzazioni. */
function vecchi(b: ContrattoCliente): Record<CampoForm, unknown> {
  return {
    numero: testo(b.numero),
    descrizione: testo(b.descrizione),
    clienteId: b.clienteId ?? null,
    clienteFatturazioneId: b.clienteFatturazioneId ?? null,
    sedeId: b.sedeId ?? null,
    categoriaId: b.categoriaId ?? null,
    tipoId: b.tipoId ?? null,
    dataInizio: data(b.dataInizio),
    dataFine: data(b.dataFine),
    dataStipula: data(b.dataStipula),
    validitaQuantita: b.validitaQuantita ?? null,
    validitaUnita: b.validitaUnita ?? null,
    condizionePagamentoId: b.condizionePagamentoId ?? null,
    contoCorrenteId: b.contoCorrenteId ?? null,
    speseIncassoId: b.speseIncassoId ?? null,
    bolloId: b.bolloId ?? null,
    registroIvaId: b.registroIvaId ?? null,
    esigibilitaIva: b.esigibilitaIva,
    ritenutaPercentuale: decimale(b.ritenutaPercentuale),
    agenteId: b.agenteId ?? null,
    testoFatturazioneId: b.testoFatturazioneId ?? null,
    codiceDestinatario: testo(b.codiceDestinatario),
    riferimentoAmministrazione: testo(b.riferimentoAmministrazione),
    periodi: b.periodi ?? [],
    contrattoPrincipaleId: b.contrattoPrincipaleId ?? null,
    codiceCig: testo(b.codiceCig ?? null)?.toUpperCase() ?? null,
    codiceCup: testo(b.codiceCup ?? null)?.toUpperCase() ?? null,
    idDocumentoPa: testo(b.idDocumentoPa ?? null),
    escludiDichiarazioneIntento: !!b.escludiDichiarazioneIntento,
    sogliaDal: data(b.sogliaDal ?? null),
    sogliaImporto: decimale(b.sogliaImporto ?? null),
    sogliaIvaEsclusa: !!b.sogliaIvaEsclusa,
    rinnovoAutomatico: !!b.rinnovoAutomatico,
    codiceRinnovo: b.codiceRinnovo ?? null,
    incrementoIstat: !!b.incrementoIstat,
    commessa: testo(b.commessa ?? null),
    annotazioni: annotazioniDi(b.annotazioni),
  }
}

function confronti(v: ValoriContratto, b: ContrattoCliente): Confronto[] {
  const n = nuovi(v)
  const o = vecchi(b)
  return (Object.keys(n) as CampoForm[]).map(c => [c, n[c], o[c]])
}

function uguali(campo: CampoForm, nuovo: unknown, vecchio: unknown): boolean {
  if (campo === 'periodi')
    return stessiPeriodi(nuovo as PeriodoFatturazione[], vecchio as PeriodoFatturazione[])
  if (campo === 'annotazioni') return stessiTesti(nuovo as string[], vecchio as string[])
  if (campo === 'ritenutaPercentuale' || campo === 'sogliaImporto')
    return stessoNumero(nuovo as string | null, vecchio as string | null)
  return nuovo === vecchio
}

/**
 * Solo i campi modificabili e cambiati rispetto al contratto letto, più la versione. Un campo
 * svuotato parte come `null`; i periodi come elenco intero.
 */
export function differenze(
  v: ValoriContratto,
  base: ContrattoCliente,
  versione: number
): ModificaContrattoCliente {
  const dati: Record<string, unknown> = { versione }
  for (const [campo, nuovo, vecchio] of confronti(v, base)) {
    if (base.modificabili.includes(campo) && !uguali(campo, nuovo, vecchio)) dati[campo] = nuovo
  }
  return dati as ModificaContrattoCliente
}

/**
 * Corpo della creazione. I campi che il backend copia dal cliente partono solo se l'operatore li
 * ha toccati (`toccati`); gli altri solo se valorizzati.
 */
export function datiNuovo(
  v: ValoriContratto,
  toccati: ReadonlySet<CampoForm>
): NuovoContrattoCliente {
  const dati: Record<string, unknown> = {
    numero: v.numero.trim(),
    descrizione: v.descrizione.trim(),
    clienteId: v.clienteId,
    dataInizio: v.dataInizio,
  }
  const n = nuovi(v)
  for (const campo of Object.keys(n) as CampoForm[]) {
    if (campo in dati || campo === 'periodi') continue
    const nuovo = n[campo]
    const dalCliente = CAMPI_DAL_CLIENTE.includes(campo)
    // Alla creazione un falso o un elenco vuoto è il valore di partenza: non si invia.
    const valorizzato =
      nuovo !== null && nuovo !== '' && nuovo !== false && !(Array.isArray(nuovo) && !nuovo.length)
    if (dalCliente ? toccati.has(campo) : valorizzato) dati[campo] = nuovo
  }
  if (v.periodi.length > 0) dati['periodi'] = v.periodi
  return dati as unknown as NuovoContrattoCliente
}
