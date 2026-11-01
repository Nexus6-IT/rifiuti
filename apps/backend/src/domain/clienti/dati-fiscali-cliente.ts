/**
 * Dati fiscali del cliente (D3): regole pure, senza Nest ne' Prisma.
 *
 * Decide forma e coerenza dei campi fiscali del cliente (che sono anche i predefiniti del
 * contratto, D4): codice destinatario SDI, PEC, riferimento amministrazione, IBAN, ritenuta,
 * nome/cognome del privato. Fonte WinWaste: evidenze E10-E12 (CLIFOR: destinatario, PEC, split)
 * ed E23 (ritenuta), piu' le specifiche della FatturaPA.
 *
 * Esistenza, stato e tipo dei riferimenti (`...Id`) NON si controllano qui: qui si normalizzano
 * soltanto, li verifica il servizio.
 *
 * Nessun messaggio riporta il valore ricevuto (codice fiscale, IBAN, PEC sono dati personali).
 * Importi e percentuali sono stringhe decimali, mai `number`.
 *
 * Dalla 4.2a (D7, Q3) il cliente ha anche listino (1-6), provvigione predefinita a cascata e il
 * suo tipo: predefiniti della riga, non del contratto (non sono in `CAMPI_EREDITATI_DAL_CLIENTE`).
 * Le regole di cascata sono quelle di `domain/listino`, non duplicate.
 */
import { TipoProvvigione } from '../listino/addebito'
import { cascataValida, normalizzaCascata } from '../listino/importi-riga'
import { validaCodiceTabella } from './codice-tabella'
import { confrontaDecimali, decimaleValido, normalizzaDecimale } from './decimali'
import { ibanValido, MESSAGGIO_IBAN_NON_VALIDO, normalizzaIban } from './iban'

export type EsigibilitaIva = 'IMMEDIATA' | 'DIFFERITA' | 'SCISSIONE'
export const ESIGIBILITA_IVA: readonly EsigibilitaIva[] = ['IMMEDIATA', 'DIFFERITA', 'SCISSIONE']

export interface DatiFiscaliCliente {
  codice: string | null
  codiceDestinatario: string | null
  pecFatturazione: string | null
  riferimentoAmministrazione: string | null
  iban: string | null
  contoCorrenteId: string | null
  condizionePagamentoId: string | null
  esigibilitaIva: EsigibilitaIva
  registroIvaId: string | null
  speseIncassoId: string | null
  bolloId: string | null
  agenteId: string | null
  ritenutaPercentuale: string | null
  /** Listino 1-6 del cliente (D7). */
  listino: number | null
  /** Provvigione a cascata (forma normalizzata, punto); va insieme al tipo. */
  provvigionePredefinita: string | null
  tipoProvvigionePredefinita: TipoProvvigione | null
  nome: string | null
  cognome: string | null
  note: string | null
}

export type CampoCliente = keyof DatiFiscaliCliente | 'sedeId' | 'attivo'

export const ETICHETTE_CAMPI_CLIENTE: Readonly<Record<CampoCliente, string>> = {
  codice: 'Codice cliente',
  codiceDestinatario: 'Codice destinatario SDI',
  pecFatturazione: 'PEC per la fattura elettronica',
  riferimentoAmministrazione: 'Riferimento amministrazione',
  iban: 'IBAN del cliente',
  contoCorrenteId: 'Nostre coordinate bancarie',
  condizionePagamentoId: 'Condizione di pagamento',
  esigibilitaIva: 'Esigibilità IVA',
  registroIvaId: 'Registro IVA',
  speseIncassoId: 'Spese di incasso',
  bolloId: 'Bollo',
  agenteId: 'Agente',
  ritenutaPercentuale: 'Ritenuta (%)',
  listino: 'Listino',
  provvigionePredefinita: 'Provvigione predefinita',
  tipoProvvigionePredefinita: 'Tipo di provvigione predefinita',
  nome: 'Nome',
  cognome: 'Cognome',
  note: 'Note',
  sedeId: 'Sede di fatturazione',
  attivo: 'Attivo',
}

const MSG_CODICE_DESTINATARIO =
  'Il codice destinatario SDI deve avere 7 caratteri (6 per la pubblica amministrazione).'
const MSG_CODICE_ESTERO = 'Il codice destinatario XXXXXXX vale solo per i clienti esteri.'
const MSG_PEC = 'La PEC per la fattura elettronica non è valida.'
const MSG_PEC_CON_CODICE =
  'La PEC per la fattura elettronica si indica solo con il codice destinatario 0000000 o senza codice.'
const MSG_RIFERIMENTO_LUNGO = 'Il riferimento amministrazione non può superare 20 caratteri.'
const MSG_RIFERIMENTO_SENZA_CODICE =
  'Il riferimento amministrazione si indica solo insieme al codice destinatario.'
const MSG_RITENUTA = 'La percentuale di ritenuta deve essere maggiore di 0 e non superiore a 30.'
const MSG_NOME_PRIVATO = 'Per un cliente persona fisica indica nome e cognome.'
const MSG_NOME_NON_PRIVATO = 'Nome e cognome si indicano solo per un cliente persona fisica.'
const MSG_NOME_LUNGO = 'Nome e cognome possono avere al massimo 60 caratteri.'
const MSG_LISTINO = 'Il listino del cliente va da 1 a 6.'
const MSG_PROVVIGIONE_SENZA_TIPO = 'Indica su cosa si calcola la provvigione del cliente.'
const MSG_TIPO_SENZA_PROVVIGIONE = 'Il tipo di provvigione si indica solo con la provvigione.'
const MSG_TIPO_NON_AMMESSO = 'Il tipo di provvigione del cliente non è ammesso (scontato o lordo).'
const MSG_PROVVIGIONE_FORMATO =
  'La provvigione predefinita si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.'
const MSG_ESIGIBILITA = "L'esigibilità IVA scelta non è ammessa."

const CODICE_NESSUN_DESTINATARIO = '0000000'

function testo(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Listino: intero o stringa di cifre. Un valore che non e' un intero (1.5, "abc") diventa 0, cosi'
 * la validazione lo rifiuta invece di scambiarlo per "non indicato".
 */
function normalizzaListino(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : 0
  const t = testo(v)
  if (t === null) return null
  return /^-?\d+$/.test(t) ? Number(t) : 0
}

export function normalizzaDatiFiscali(
  grezzo: Partial<Record<keyof DatiFiscaliCliente, unknown>>
): DatiFiscaliCliente {
  const iban = testo(grezzo.iban)
  const esigibilita = testo(grezzo.esigibilitaIva)
  return {
    codice: testo(grezzo.codice),
    codiceDestinatario: testo(grezzo.codiceDestinatario)?.toUpperCase() ?? null,
    pecFatturazione: testo(grezzo.pecFatturazione),
    riferimentoAmministrazione: testo(grezzo.riferimentoAmministrazione),
    iban: iban === null ? null : normalizzaIban(iban),
    contoCorrenteId: testo(grezzo.contoCorrenteId),
    condizionePagamentoId: testo(grezzo.condizionePagamentoId),
    esigibilitaIva: (esigibilita?.toUpperCase() ?? 'IMMEDIATA') as EsigibilitaIva,
    registroIvaId: testo(grezzo.registroIvaId),
    speseIncassoId: testo(grezzo.speseIncassoId),
    bolloId: testo(grezzo.bolloId),
    agenteId: testo(grezzo.agenteId),
    ritenutaPercentuale: normalizzaDecimale(grezzo.ritenutaPercentuale),
    listino: normalizzaListino(grezzo.listino),
    provvigionePredefinita: normalizzaCascata(grezzo.provvigionePredefinita),
    tipoProvvigionePredefinita: (testo(grezzo.tipoProvvigionePredefinita)?.toUpperCase() ??
      null) as TipoProvvigione | null,
    nome: testo(grezzo.nome),
    cognome: testo(grezzo.cognome),
    note: testo(grezzo.note),
  }
}

/** Messaggio se il codice destinatario non e' valido, altrimenti null (vuoto ammesso). */
export function validaCodiceDestinatario(c: string | null): string | null {
  if (c === null) return null
  if (!/^[A-Z0-9]{6,7}$/.test(c)) return MSG_CODICE_DESTINATARIO
  if (c === 'XXXXXX' || c === 'XXXXXXX') return MSG_CODICE_ESTERO
  return null
}

/**
 * Riferimento amministrazione: al massimo 20 caratteri e solo insieme a un codice destinatario
 * vero. `0000000` vuol dire "nessun codice" (R26 b, decisione di Graziano): col riferimento si
 * rifiuta. Riusata dal contratto cliente.
 */
export function validaRiferimentoAmministrazione(
  riferimento: string | null,
  codiceDestinatario: string | null
): string | null {
  if (riferimento === null) return null
  if (riferimento.length > 20) return MSG_RIFERIMENTO_LUNGO
  if (codiceDestinatario === null || codiceDestinatario === CODICE_NESSUN_DESTINATARIO) {
    return MSG_RIFERIMENTO_SENZA_CODICE
  }
  return null
}

/** Ritenuta: maggiore di 0 e non oltre 30 (E23). Riusata dal contratto. */
export function validaRitenuta(p: string | null): string | null {
  if (p === null) return null
  if (!decimaleValido(p, 2)) return MSG_RITENUTA
  if (confrontaDecimali(p, '0') <= 0 || confrontaDecimali(p, '30') > 0) return MSG_RITENUTA
  return null
}

/** 6 caratteri = pubblica amministrazione, 7 = impresa, vuoto o 0000000 = nessun destinatario. */
export function tipoDestinatario(codice: string | null): 'PA' | 'IMPRESA' | 'NESSUNO' {
  if (codice === null || codice === CODICE_NESSUN_DESTINATARIO) return 'NESSUNO'
  if (codice.length === 6) return 'PA'
  if (codice.length === 7) return 'IMPRESA'
  return 'NESSUNO'
}

/** Messaggi nell'ordine dei campi; elenco vuoto = dati validi. */
export function validaDatiFiscali(d: DatiFiscaliCliente, contesto: { privato: boolean }): string[] {
  const errori: string[] = []

  if (d.codice !== null) {
    const m = validaCodiceTabella(d.codice, 20, 'Il codice cliente')
    if (m) errori.push(m)
  }

  const mCodice = validaCodiceDestinatario(d.codiceDestinatario)
  if (mCodice) errori.push(mCodice)

  if (d.pecFatturazione !== null) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.pecFatturazione) || d.pecFatturazione.length > 255) {
      errori.push(MSG_PEC)
    } else if (
      d.codiceDestinatario !== null &&
      d.codiceDestinatario !== CODICE_NESSUN_DESTINATARIO
    ) {
      errori.push(MSG_PEC_CON_CODICE)
    }
  }

  const mRiferimento = validaRiferimentoAmministrazione(
    d.riferimentoAmministrazione,
    d.codiceDestinatario
  )
  if (mRiferimento) errori.push(mRiferimento)

  if (d.iban !== null && !ibanValido(d.iban)) errori.push(MESSAGGIO_IBAN_NON_VALIDO)

  if (!ESIGIBILITA_IVA.includes(d.esigibilitaIva)) errori.push(MSG_ESIGIBILITA)

  const mRitenuta = validaRitenuta(d.ritenutaPercentuale)
  if (mRitenuta) errori.push(mRitenuta)

  if (d.listino !== null && (d.listino < 1 || d.listino > 6)) errori.push(MSG_LISTINO)

  // R13: provvigione e tipo vanno insieme (il CHECK del database e' solo la rete di sicurezza).
  if (d.provvigionePredefinita !== null && !cascataValida(d.provvigionePredefinita)) {
    errori.push(MSG_PROVVIGIONE_FORMATO)
  }
  if (d.tipoProvvigionePredefinita !== null) {
    if (d.tipoProvvigionePredefinita !== 'SCONTATO' && d.tipoProvvigionePredefinita !== 'LORDO') {
      errori.push(MSG_TIPO_NON_AMMESSO)
    } else if (d.provvigionePredefinita === null) {
      errori.push(MSG_TIPO_SENZA_PROVVIGIONE)
    }
  } else if (d.provvigionePredefinita !== null) {
    errori.push(MSG_PROVVIGIONE_SENZA_TIPO)
  }

  if (contesto.privato) {
    if (d.nome === null || d.cognome === null) errori.push(MSG_NOME_PRIVATO)
  } else if (d.nome !== null || d.cognome !== null) {
    errori.push(MSG_NOME_NON_PRIVATO)
  }
  if ((d.nome?.length ?? 0) > 60 || (d.cognome?.length ?? 0) > 60) errori.push(MSG_NOME_LUNGO)

  return errori
}
