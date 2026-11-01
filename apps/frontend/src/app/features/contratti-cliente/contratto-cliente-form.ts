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

const vuoto = (v: string): string | null => (v.trim() === '' ? null : v.trim())
const vuotoId = (v: string): string | null => (v === '' ? null : v)
const giorno = (d: string | null): string => (d ? d.slice(0, 10) : '')

const ritenuta = (v: string | null): string | null => {
  const t = (v ?? '').trim().replace(',', '.')
  return t === '' ? null : t
}

const stessoNumero = (a: string | null, b: string | null): boolean =>
  a === b || (a !== null && b !== null && Number(a) === Number(b))

const quantita = (v: string): number | null => {
  const t = v.trim()
  return t === '' ? null : Number.parseInt(t, 10)
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

/** Coppie [campo, valore del form, valore salvato], con le stesse normalizzazioni dei due lati. */
function confronti(v: ValoriContratto, b: ContrattoCliente): Confronto[] {
  const id = (campo: CampoForm, nuovo: string, vecchio: string | null): Confronto => [
    campo,
    vuotoId(nuovo),
    vecchio ?? null,
  ]
  const testo = (campo: CampoForm, nuovo: string | null, vecchio: string | null): Confronto => [
    campo,
    nuovo,
    vecchio?.trim() ? vecchio.trim() : null,
  ]
  const data = (campo: CampoForm, nuovo: string, vecchio: string | null): Confronto => [
    campo,
    nuovo || null,
    vecchio ? giorno(vecchio) : null,
  ]
  return [
    testo('numero', vuoto(v.numero), b.numero),
    testo('descrizione', vuoto(v.descrizione), b.descrizione),
    id('clienteId', v.clienteId, b.clienteId),
    id('clienteFatturazioneId', v.clienteFatturazioneId, b.clienteFatturazioneId),
    id('sedeId', v.sedeId, b.sedeId),
    id('categoriaId', v.categoriaId, b.categoriaId),
    id('tipoId', v.tipoId, b.tipoId),
    data('dataInizio', v.dataInizio, b.dataInizio),
    data('dataFine', v.dataFine, b.dataFine),
    data('dataStipula', v.dataStipula, b.dataStipula),
    ['validitaQuantita', quantita(v.validitaQuantita), b.validitaQuantita ?? null],
    ['validitaUnita', v.validitaUnita || null, b.validitaUnita ?? null],
    id('condizionePagamentoId', v.condizionePagamentoId, b.condizionePagamentoId),
    id('contoCorrenteId', v.contoCorrenteId, b.contoCorrenteId),
    id('speseIncassoId', v.speseIncassoId, b.speseIncassoId),
    id('bolloId', v.bolloId, b.bolloId),
    id('registroIvaId', v.registroIvaId, b.registroIvaId),
    ['esigibilitaIva', v.esigibilitaIva, b.esigibilitaIva],
    ['ritenutaPercentuale', ritenuta(v.ritenutaPercentuale), ritenuta(b.ritenutaPercentuale)],
    id('agenteId', v.agenteId, b.agenteId),
    id('testoFatturazioneId', v.testoFatturazioneId, b.testoFatturazioneId),
    testo(
      'codiceDestinatario',
      vuoto(v.codiceDestinatario)?.toUpperCase() ?? null,
      b.codiceDestinatario
    ),
    testo(
      'riferimentoAmministrazione',
      vuoto(v.riferimentoAmministrazione),
      b.riferimentoAmministrazione
    ),
    ['periodi', v.periodi, b.periodi ?? []],
  ]
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
  for (const [campo, nuovo] of confronti(v, {} as ContrattoCliente)) {
    if (campo in dati || campo === 'periodi') continue
    const dalCliente = CAMPI_DAL_CLIENTE.includes(campo)
    const valorizzato = nuovo !== null && nuovo !== ''
    if (dalCliente ? toccati.has(campo) : valorizzato) dati[campo] = nuovo
  }
  if (v.periodi.length > 0) dati['periodi'] = v.periodi
  return dati as unknown as NuovoContrattoCliente
}
