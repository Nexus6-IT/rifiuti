/**
 * Creazione atomica di un ruolo (produttore, trasportatore, destinatario) su una ditta (F2-10, D3).
 *
 * UNA sola transazione, in quest'ordine: lock sugli identificativi, ricerca/creazione della ditta,
 * sede (tutto in `DitteService.risolviPerRuolo`), poi il ruolo gia' presente per la ditta (400),
 * poi l'insert della riga di ruolo con lo stesso `tx`. Se un passo fallisce la transazione si
 * annulla per intero: niente ditte o sedi orfane lasciate da un ruolo respinto.
 *
 * Nessun messaggio riporta partite IVA, codici fiscali, tenant o chiavi (D12).
 */
import { Prisma } from '@prisma/client'
import {
  DatiControparteNonValidiError,
  DittaIdentificativiInConflittoError,
  DittaNonTrovataError,
  IdentificativoNonCorrispondenteError,
  SedeNonModificabileError,
  SedeNonTrovataError,
} from '../../core/domain/errors'
import { RuoloControparte } from '../../domain/registry/entities/sede-ditta'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { ClientDitte } from '../../infrastructure/persistence/ditta-prisma.repository'
import { DatiRisoluzioneRuolo, DitteService, RisoluzioneRuolo } from './ditte/ditte.service'

export interface EsitoCreazioneRuolo<E> {
  ruolo: E
  /** La ditta c'era gia' (creata da un altro ruolo): in risposta, `dittaEsistente`. */
  dittaEsistente: boolean
  /** Es. "La ragione sociale registrata per questa ditta e' «...»: e' stata mantenuta." */
  avvisi: string[]
}

export type NomeRuolo = 'produttore' | 'trasportatore' | 'destinatario'

export function messaggioRuoloPresente(nome: NomeRuolo): string {
  return `Esiste già un ${nome} per questa ditta`
}

/** Il ruolo c'e' gia' per la ditta: 400. Interno: i use case lo traducono in `Result.fail`. */
export class RuoloGiaPresenteError extends Error {
  constructor(nome: NomeRuolo) {
    super(messaggioRuoloPresente(nome))
    this.name = 'RuoloGiaPresenteError'
  }
}

/**
 * Errori di ditta e sede che il filtro HTTP sa mappare (400/404/409): i use case li rilanciano
 * invece di appiattirli in un `Result.fail` (che diventerebbe sempre 400).
 */
export function eErroreDiDittaDaPropagare(error: unknown): boolean {
  return (
    error instanceof DatiControparteNonValidiError ||
    error instanceof DittaIdentificativiInConflittoError ||
    error instanceof IdentificativoNonCorrispondenteError ||
    error instanceof SedeNonModificabileError ||
    error instanceof DittaNonTrovataError ||
    error instanceof SedeNonTrovataError
  )
}

/** P2002 sul vincolo "una riga per ruolo per ditta" (`<tabella>_tenant_id_ditta_id_key`). */
export function eViolazioneRuoloPerDitta(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false
  }
  const target = ([] as unknown[]).concat((error.meta as { target?: unknown })?.target ?? [])
  return target.map(String).join(',').includes('ditta_id')
}

/**
 * Messaggio sicuro per un errore imprevisto: gli errori del driver possono riportare la riga
 * (con il codice fiscale), quindi non passano mai in una risposta.
 */
export function messaggioSicuro(error: unknown): string {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError
  ) {
    return 'Operazione non riuscita'
  }
  return error instanceof Error ? error.message : 'Operazione non riuscita'
}

export interface ParametriCreazioneRuolo<E> {
  ruolo: RuoloControparte
  nome: NomeRuolo
  dati: DatiRisoluzioneRuolo
  /** Il ruolo gia' presente per la ditta (stesso `tx`). */
  esistente: (tx: ClientDitte, dittaId: string) => Promise<unknown>
  /** Costruisce l'entita' dalla ditta e dalla sede risolte. */
  costruisci: (risoluzione: RisoluzioneRuolo) => E
  /** Insert della riga di ruolo (stesso `tx`). */
  inserisci: (tx: ClientDitte, entita: E) => Promise<void>
}

export async function creaRuoloSuDitta<E>(
  prisma: PrismaService,
  ditte: DitteService,
  p: ParametriCreazioneRuolo<E>
): Promise<EsitoCreazioneRuolo<E>> {
  try {
    return await prisma.$transaction(async tx => {
      const risoluzione = await ditte.risolviPerRuolo(tx, p.ruolo, p.dati)
      if (await p.esistente(tx, risoluzione.dittaId)) throw new RuoloGiaPresenteError(p.nome)
      const ruolo = p.costruisci(risoluzione)
      await p.inserisci(tx, ruolo)
      return { ruolo, dittaEsistente: risoluzione.dittaEsistente, avvisi: risoluzione.avvisi }
    })
  } catch (error) {
    // rete di sicurezza dopo il lock: lo stesso 400 del controllo esplicito
    if (eViolazioneRuoloPerDitta(error)) throw new RuoloGiaPresenteError(p.nome)
    throw error
  }
}

/** D7: nella modifica di un ruolo `sedeId` e indirizzo si escludono a vicenda. */
export const MESSAGGIO_SEDE_E_INDIRIZZO =
  "Scegli la nuova sede predefinita oppure modifica l'indirizzo, non entrambi"
