// Aggancio del legame movimento-cliente-prezzo alla registrazione (fase 4.3, spec §7.1, §12.8).
//
// Regola assoluta: il movimento si registra SEMPRE. Il legame e' un fatto commerciale: nasce in un
// SAVEPOINT, con un tetto di attesa dei lock di `LOCK_TIMEOUT_AGGANCIO`. Qualunque errore (lock
// scaduto, chiave esterna, eccezione del dominio, SQL) fa tornare al savepoint: il movimento resta,
// il legame manca (la lista lo mostra «Mancante») e l'operatore ha un avviso. Modello:
// `abbinaSenzaFallire` del caso d'uso di registrazione.
//
// Ordine dei lock (spec §5): il chiamante ha gia' il lock del registro; qui advisory della radice
// -> `impostazioni_fatturazione` FOR SHARE -> contratto/elenco/righe FOR SHARE (tutto in
// `PropostaLegameService.proponiEScrivi`). La radice e' il movimento appena inserito: nessun altro
// la conosce ancora, quindi il lock consultivo non puo' fare attendere nessuno.
//
// Mai una scrittura su `waste_movements` (guardia automatica): `entryHash` e RENTRI non cambiano.
import { BadRequestException, HttpException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import {
  MOTIVI_LEGAME,
  type AvvisoLegame,
  type MotivoLegame,
  type StatoLegame,
} from '../../domain/legami-movimento/codici'
import { statoDopoRicalcolo } from '../../domain/legami-movimento/stato-legame'
import {
  avvisiDaRighe,
  motiviRighe,
  type RigaLegameValori,
} from '../../domain/legami-movimento/valori-legame'
import {
  applicaModificheRighe,
  type CambioRiga,
  righaDaProposta,
  validaModifiche,
  type ModificheLegame,
  type ModificheNorm,
} from './conferma-legame-righe'
import { impostaTimeoutAggancio } from './lock-legame'
import {
  importoVista,
  type PropostaLegameService,
  type PropostaVista,
} from './proposta-legame.service'

/** Blocco `legame` facoltativo della richiesta di registrazione (e della rettifica, Task 21). */
export interface DatiLegameRegistrazione extends ModificheLegame {
  /** `CONFERMA`: legame confermato se la proposta e' completa; `PROPOSTA`: solo proposto. */
  azione: 'CONFERMA' | 'PROPOSTA'
}

/**
 * Budget della transazione di registrazione (timeout esplicito: i 5 s di default di Prisma non
 * bastano quando piu' registrazioni dello stesso registro si accodano sul lock del progressivo).
 */
export const TIMEOUT_TRANSAZIONE_REGISTRAZIONE_MS = 30_000
export const ATTESA_CONNESSIONE_REGISTRAZIONE_MS = 10_000
/**
 * Oltre questo tempo trascorso dall'inizio della transazione il legame si salta senza aprire il
 * savepoint: il movimento ha la precedenza e il legame resta «Mancante». Meta' del timeout: lascia
 * il tempo per il commit anche se il legame attendesse tutti i suoi `LOCK_TIMEOUT_AGGANCIO`.
 */
export const SOGLIA_BUDGET_LEGAME_MS = TIMEOUT_TRANSAZIONE_REGISTRAZIONE_MS / 2

/** Avviso quando il legame non si e' potuto scrivere. */
export const AVVISO_LEGAME_NON_RIUSCITO =
  'Movimento registrato; il collegamento a cliente e prezzo non è riuscito: lo trovi in "Da collegare".'

/** Avviso quando l'operatore ha chiesto di confermare ma la proposta non era completa. */
export const AVVISO_LEGAME_INCOMPLETO =
  'Movimento registrato; il collegamento a cliente e prezzo è incompleto: lo trovi in "Da collegare".'

/**
 * Blocco «Fatturazione» della risposta di registrazione (assente se la causale non e' fatturabile
 * o la fatturazione non e' attiva per quel giorno).
 */
export interface FatturazioneRegistrazione {
  /** `COLLEGATO`: legame scritto (guarda `stato`); `NON_RIUSCITO`: movimento registrato, legame no. */
  esito: 'COLLEGATO' | 'NON_RIUSCITO'
  legameId: string | null
  stato: StatoLegame | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
}

export interface EsitoAggancio {
  /** Avvisi per l'operatore, da aggiungere a quelli della registrazione. */
  avvisi: string[]
  /** `null` se non c'era nulla da collegare (non fatturabile, fatturazione spenta o non ancora attiva). */
  fatturazione: FatturazioneRegistrazione | null
}

export interface DatiAggancio {
  tenantId: string
  userId: string | null
  registroId: string
  type: 'CARICO' | 'SCARICO'
  /** Il movimento appena inserito (per una correzione: la nuova testa della catena). */
  movimentoId: string
  /** Radice della catena; omessa vale `movimentoId` (movimento appena registrato = radice). */
  radiceId?: string
  fatturabile: boolean
  causale: string
  causaleAziendaId: string | null
  cerCode: string
  movementDate: Date
  unit: string
  /** `Decimal.toFixed()`, mai la notazione esponenziale (M9). */
  quantity: string
  firId: string | null
  legame?: DatiLegameRegistrazione
  proposta: PropostaLegameService
  /** Millisecondi trascorsi dall'inizio della transazione di registrazione (budget del legame). */
  trascorsoMs?: number
  logger?: { error(messaggio: string, errore?: Error, contesto?: Record<string, unknown>): void }
}

const NESSUN_COLLEGAMENTO: EsitoAggancio = { avvisi: [], fatturazione: null }

/**
 * Valida le modifiche del blocco `legame` PRIMA di aprire la transazione: un numero scritto male
 * e' un errore del client (400), non un problema commerciale da nascondere in un savepoint.
 * In registrazione le righe si possono solo ritoccare (quantita', prezzo, sconto), non togliere.
 */
export function validaDatiLegame(legame: DatiLegameRegistrazione | undefined): ModificheNorm {
  if (legame === undefined) return { righe: new Map() }
  if (legame.azione !== 'CONFERMA' && legame.azione !== 'PROPOSTA') {
    throw new BadRequestException({
      error: 'AZIONE_LEGAME_NON_VALIDA',
      message: 'L’azione del legame non è valida.',
    })
  }
  const norm = validaModifiche(legame)
  for (const m of norm.righe.values()) {
    if (m.rimuovi) {
      throw new BadRequestException({
        error: 'RIGA_NON_VALIDA',
        message: 'In registrazione le righe del legame non si tolgono.',
      })
    }
  }
  return norm
}

/** Codice sicuro di un errore: SQLSTATE (5 caratteri), poi codice Prisma, poi codice HTTP del dominio. */
export function codiceSicuro(err: unknown): string {
  const e = err as { code?: unknown; meta?: { code?: unknown } } | null
  const forma = /^[0-9A-Z]{5}$/
  for (const c of [e?.meta?.code, e?.code]) {
    if (typeof c === 'string' && forma.test(c)) return c
  }
  if (err instanceof HttpException) {
    const corpo = err.getResponse() as { error?: unknown } | string
    const codice = typeof corpo === 'object' ? corpo.error : undefined
    if (typeof codice === 'string' && /^[A-Z0-9_]{1,60}$/.test(codice)) return codice
  }
  return ''
}

/** Riporta il valore del timeout al valore che aveva prima del savepoint (`set_config` e' parametrizzabile). */
export async function ripristinaTimeout(tx: Prisma.TransactionClient, prima: string | null) {
  if (prima === null) return
  await tx.$queryRaw`SELECT set_config('lock_timeout', ${prima}, true)`
}

/**
 * Applica a una proposta calcolata le modifiche scritte a mano (quantita', prezzo, sconto delle
 * righe PROPOSTE). Una riga che non e' nella proposta e' un errore (400, finisce nel savepoint).
 * Motivi, avvisi e stato si ricalcolano con le stesse funzioni di dominio della conferma.
 */
export function applicaModificheAllaProposta(
  p: PropostaVista,
  mods: ModificheNorm
): { proposta: PropostaVista; cambi: CambioRiga[] } {
  if (mods.righe.size === 0) return { proposta: p, cambi: [] }
  const presenti = new Set(p.righe.map(r => r.rigaAddebitoId))
  for (const id of mods.righe.keys()) {
    if (!presenti.has(id)) {
      throw new BadRequestException({
        error: 'RIGA_NON_NEL_LEGAME',
        message: 'La riga indicata non è fra quelle proposte.',
      })
    }
  }
  const { righe: modificate, cambi } = applicaModificheRighe(
    p.righe.map(righaDaProposta),
    mods,
    'PROPOSTO'
  )
  const righe = p.righe.map((r, i) => ({
    ...r,
    quantita: modificate[i].quantita,
    quantitaOrigine: modificate[i].quantitaOrigine,
    prezzo: modificate[i].prezzo,
    sconto: modificate[i].sconto,
    prezzoManuale: modificate[i].prezzoManuale,
    importo: importoVista(modificate[i].quantita, modificate[i].prezzo, modificate[i].sconto),
  }))
  const valori: RigaLegameValori[] = righe.map(r => ({
    rigaAddebitoId: r.rigaAddebitoId,
    origine: r.origine,
    prezzoSpeciale: r.prezzoSpeciale,
    prezzo: r.prezzo,
    sconto: r.sconto,
    quantita: r.quantita,
    quantitaOrigine: r.quantitaOrigine,
    prezzoManuale: r.prezzoManuale,
    codiceIvaId: r.codiceIvaId,
  }))
  // I motivi delle righe si rifanno da zero; gli altri (cliente, contratto, elenco) restano.
  const dalleRighe: MotivoLegame[] = ['SENZA_PREZZO', 'SENZA_QUANTITA']
  const nuoviRighe = motiviRighe(valori)
  const motivi = MOTIVI_LEGAME.filter(
    m => (p.motivi.includes(m) && !dalleRighe.includes(m)) || nuoviRighe.includes(m)
  )
  const completo = !!p.cliente && !!p.contratto && !!p.elenco && righe.length > 0
  return {
    cambi,
    proposta: {
      ...p,
      righe,
      motivi,
      avvisi: avvisiDaRighe(p.avvisi, righe),
      stato: statoDopoRicalcolo('NESSUN_LEGAME', { motivi, completo }) as StatoLegame,
    },
  }
}

/** Scrive l'audit in un sottoblocco proprio: un audit che fallisce non puo' toccare la registrazione. */
export async function auditSenzaFallire(
  tx: Prisma.TransactionClient,
  dati: Prisma.ActivityLogUncheckedCreateInput
): Promise<void> {
  await tx.$executeRawUnsafe('SAVEPOINT legame_audit')
  try {
    await tx.activityLog.create({ data: dati })
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT legame_audit')
  } catch {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT legame_audit')
  }
}

const NON_RIUSCITO: FatturazioneRegistrazione = {
  esito: 'NON_RIUSCITO',
  legameId: null,
  stato: null,
  motivi: [],
  avvisi: [],
}

/** Il legame non si prova nemmeno: la registrazione ha gia' consumato il suo budget di tempo. */
async function saltaPerBudget(
  tx: Prisma.TransactionClient,
  c: DatiAggancio
): Promise<EsitoAggancio> {
  const sicuro = new Error('Legame del nuovo movimento saltato (BUDGET_ESAURITO)')
  c.logger?.error(
    'Legame del movimento saltato: budget di tempo della registrazione esaurito',
    sicuro,
    {
      tenantId: c.tenantId,
      registroId: c.registroId,
      movimentoId: c.movimentoId,
    }
  )
  segnalaErroreJob('legameNuovoMovimento', sicuro, { tenantId: c.tenantId })
  await auditSenzaFallire(tx, {
    tenantId: c.tenantId,
    userId: c.userId,
    action: 'LEGAME_NON_RIUSCITO',
    description: 'Legame del nuovo movimento saltato: movimento registrato senza legame',
    metadata: {
      tipoErrore: 'BudgetEsaurito',
      codice: 'BUDGET_ESAURITO',
      movimentoId: c.movimentoId,
      registroId: c.registroId,
    },
  })
  return { avvisi: [AVVISO_LEGAME_NON_RIUSCITO], fatturazione: NON_RIUSCITO }
}

/**
 * Collega il movimento appena registrato, senza mai farlo fallire. Va chiamata DOPO l'inserimento
 * dell'annotazione e (per gli scarichi) dopo l'abbinamento, con il lock del registro gia' preso.
 *
 * Con una causale fatturabile il savepoint si apre sempre: la data «fatturazione da» si legge
 * FOR SHARE dentro (seguito m-C del Task 5), con il tetto di attesa del legame, cosi' una
 * impostazione in corso di modifica non fa sfuggire il movimento ne' blocca il registro.
 */
export async function agganciaLegameSenzaFallire(
  tx: Prisma.TransactionClient,
  c: DatiAggancio
): Promise<EsitoAggancio> {
  if (!c.fatturabile) return NESSUN_COLLEGAMENTO
  if ((c.trascorsoMs ?? 0) > SOGLIA_BUDGET_LEGAME_MS) return saltaPerBudget(tx, c)

  const conferma = c.legame?.azione === 'CONFERMA'
  let timeoutPrima: string | null = null
  // Testo costante (nessun dato dell'utente).
  await tx.$executeRawUnsafe('SAVEPOINT legame')
  try {
    const mods = validaDatiLegame(c.legame)
    const lettura = await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('lock_timeout') AS v`
    timeoutPrima = lettura[0]?.v ?? null
    await impostaTimeoutAggancio(tx)
    let cambi: CambioRiga[] = []
    const r = await c.proposta.proponiEScrivi(tx, {
      tenantId: c.tenantId,
      userId: c.userId,
      registroId: c.registroId,
      verso: c.type,
      movimentoOriginaleId: c.radiceId ?? c.movimentoId,
      movimentoVigenteId: c.movimentoId,
      input: {
        causale: c.causale,
        causaleAziendaId: c.causaleAziendaId,
        type: c.type,
        cerCode: c.cerCode,
        movementDate: c.movementDate.toISOString(),
        unit: c.unit,
        quantity: c.quantity,
        firId: c.firId,
      },
      // `righe` e' la selezione completa (come `scelte.righe` di POST /proposta): chi registra
      // manda lo stesso oggetto che ha mandato alla proposta.
      scelte: {
        clienteId: c.legame?.clienteId,
        contrattoId: c.legame?.contrattoId,
        elencoId: c.legame?.elencoId,
        righeIds: c.legame?.righe?.map(riga => riga.rigaAddebitoId),
      },
      conferma,
      adatta: p => {
        const e = applicaModificheAllaProposta(p, mods)
        cambi = e.cambi
        return e.proposta
      },
    })
    if (r.legameId === null) {
      // Fatturazione spenta o movimento prima di «fatturazione da» (letta FOR SHARE).
      await ripristinaTimeout(tx, timeoutPrima)
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT legame')
      return NESSUN_COLLEGAMENTO
    }
    if (r.stato === null || r.proposta === null) {
      // Il legame della catena esisteva gia': nulla scritto, nessun audit.
      await ripristinaTimeout(tx, timeoutPrima)
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT legame')
      return {
        avvisi: [],
        fatturazione: {
          esito: 'COLLEGATO',
          legameId: r.legameId,
          stato: null,
          motivi: [],
          avvisi: [],
        },
      }
    }
    const stato = r.stato
    let totale = new Prisma.Decimal(0)
    for (const riga of r.proposta.righe)
      if (riga.importo !== null) totale = totale.plus(riga.importo)
    // Audit di creazione (decisioni 16-17: prezzi e quantita' scritti a mano si vedono qui).
    await tx.activityLog.create({
      data: {
        tenantId: c.tenantId,
        userId: c.userId,
        action:
          stato === 'CONFERMATO' ? 'LEGAME_MOVIMENTO_CONFERMATO' : 'LEGAME_MOVIMENTO_GENERATO',
        description:
          stato === 'CONFERMATO'
            ? 'Legame movimento confermato alla registrazione'
            : 'Legame movimento generato alla registrazione',
        metadata: {
          legameId: r.legameId,
          alRegistro: true,
          statoDopo: stato,
          motivi: r.proposta.motivi,
          importoTotale: totale.toFixed(),
          righe: cambi,
        } as unknown as Prisma.InputJsonValue,
      },
    })
    // SET LOCAL sopravvive al RELEASE: senza questo il resto della transazione erediterebbe i 2 s.
    await ripristinaTimeout(tx, timeoutPrima)
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT legame')
    return {
      avvisi: conferma && stato !== 'CONFERMATO' ? [AVVISO_LEGAME_INCOMPLETO] : [],
      fatturazione: {
        esito: 'COLLEGATO',
        legameId: r.legameId,
        stato,
        motivi: r.proposta.motivi,
        avvisi: r.proposta.avvisi,
      },
    }
  } catch (err) {
    // Il ROLLBACK TO annulla anche il SET LOCAL del timeout: nessun ripristino da fare qui (e
    // nessuna istruzione in piu' fuori dal savepoint che potrebbe fallire).
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT legame')
    const tipo = err instanceof Error ? err.name : 'sconosciuto'
    const codice = codiceSicuro(err)
    // Un errore «pulito»: il messaggio dell'originale potrebbe riportare valori (dati personali).
    const sicuro = new Error(
      `Legame del nuovo movimento non riuscito (${tipo}${codice ? ` ${codice}` : ''})`
    )
    c.logger?.error(
      'Legame del movimento non riuscito: il movimento resta registrato senza legame',
      sicuro,
      { tenantId: c.tenantId, registroId: c.registroId, tipoErrore: tipo, codice }
    )
    segnalaErroreJob('legameNuovoMovimento', sicuro, { tenantId: c.tenantId })
    await auditSenzaFallire(tx, {
      tenantId: c.tenantId,
      userId: c.userId,
      action: 'LEGAME_NON_RIUSCITO',
      description: 'Legame del nuovo movimento non riuscito: movimento registrato senza legame',
      metadata: { tipoErrore: tipo, codice, movimentoId: c.movimentoId, registroId: c.registroId },
    })
    return { avvisi: [AVVISO_LEGAME_NON_RIUSCITO], fatturazione: NON_RIUSCITO }
  }
}
