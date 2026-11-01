import { FormControl, FormGroup } from '@angular/forms'
import {
  ContrattoCliente,
  EsigibilitaIva,
  ModificaContrattoCliente,
  NuovoContrattoCliente,
  PeriodoFatturazione,
} from '../clienti/clienti.model'

/**
 * Form del contratto cliente. Il Task 26 aggiunge qui i controlli delle altre sezioni (CIG e
 * CUP, soglia, rinnovo, annotazioni…) e le loro righe in `valoriDaContratto`, `differenze` e
 * `datiNuovo`.
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
  })
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

const ritenuta = (v: string | null): string | null => {
  const t = (v ?? '').trim().replace(',', '.')
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
    ritenutaPercentuale: ritenuta(v.ritenutaPercentuale),
    agenteId: id(v.agenteId),
    testoFatturazioneId: id(v.testoFatturazioneId),
    codiceDestinatario: testo(v.codiceDestinatario)?.toUpperCase() ?? null,
    riferimentoAmministrazione: testo(v.riferimentoAmministrazione),
    periodi: v.periodi,
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
    ritenutaPercentuale: ritenuta(b.ritenutaPercentuale),
    agenteId: b.agenteId ?? null,
    testoFatturazioneId: b.testoFatturazioneId ?? null,
    codiceDestinatario: testo(b.codiceDestinatario),
    riferimentoAmministrazione: testo(b.riferimentoAmministrazione),
    periodi: b.periodi ?? [],
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
  if (campo === 'ritenutaPercentuale')
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
    const valorizzato = nuovo !== null && nuovo !== ''
    if (dalCliente ? toccati.has(campo) : valorizzato) dati[campo] = nuovo
  }
  if (v.periodi.length > 0) dati['periodi'] = v.periodi
  return dati as unknown as NuovoContrattoCliente
}
