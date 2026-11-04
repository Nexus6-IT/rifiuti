// Il legame movimento-cliente-prezzo segue rettifiche e annulli del movimento (fase 4.3b, spec §7.5).
//
// Regola assoluta: la correzione del registro riesce SEMPRE. Il riallineamento del legame e' un fatto
// commerciale e gira in un SAVEPOINT con un tetto di attesa dei lock (`LOCK_TIMEOUT_AGGANCIO`) e un
// budget di tempo sulla transazione della correzione (`SOGLIA_BUDGET_LEGAME_MS`, come l'aggancio alla
// registrazione). Qualunque errore (lock scaduto, SQL, dominio) fa tornare al savepoint: la
// correzione resta, il legame resta indietro rispetto alla testa della catena e la lista lo mostra
// `DA_RIALLINEARE`, con audit `LEGAME_NON_RIUSCITO` e segnalazione.
//
// Ordine dei lock (mai invertito): il chiamante ha gia' il lock del registro (progressivo, giacenza)
// -> lock consultivo del legame sulla RADICE -> (dentro `LegamiService.allineaAlVigente` /
// `PropostaLegameService.proponiEScrivi`) impostazioni, contratto, elenchi, righe di listino FOR
// SHARE -> righe del legame FOR UPDATE. Una conferma concorrente prende solo la radice e poi il
// resto, senza lock di registro: non c'e' ciclo e le due operazioni si serializzano sulla radice.
//
// Effetti (tabella §7.5) in `LegamiService.allineaAlVigente`, che applica `esitoCorrezione`:
// - FATTURATO / IMPORTATO_FATTURATO: solo `movimento_vigente_id`, `scostamento_dopo_fattura` e
//   `scostamento_il` (data, stato, righe e prezzi restano); `AVVISO_SCOSTAMENTO` va in risposta,
//   non si persiste;
// - ogni altro esito aggiorna `movimento_vigente_id`, anche verso ESCLUSO o ANNULLATO (vincolo del
//   Task 18: una lista che vede il vigente indietro mostra DA_RIALLINEARE);
// - un ESCLUSO dall'utente resta escluso; un ESCLUSO automatico tornato idoneo viene riammesso.
// Il blocco `legame` della rettifica NON si scarta mai in silenzio: sul legame esistente, dopo il
// riallineamento, le scelte (cliente, contratto, elenco, righe) si applicano con le regole di
// `modifica`/`conferma` (Task 16) in un savepoint annidato; `azione: CONFERMA` conferma se il legame
// e' completo, altrimenti resta come il dominio dice (motivi nella risposta, avviso). Se le scelte
// non sono valide il legame resta allineato e un avviso dice che non sono state applicate.
// Senza legame la rettifica lo fa nascere (causale che diventa fatturabile, data che passa dopo
// «fatturazione da»); l'annullo non lo crea mai.
//
// Mai una scrittura su `waste_movements` (guardia automatica): `entryHash` e RENTRI non cambiano.
import { ConflictException, HttpException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import {
  AVVISO_SCOSTAMENTO,
  type AvvisoLegame,
  type MotivoLegame,
  type StatoLegame,
} from '../../domain/legami-movimento/codici'
import {
  agganciaLegameSenzaFallire,
  auditSenzaFallire,
  AVVISO_LEGAME_INCOMPLETO,
  AVVISO_LEGAME_NON_RIUSCITO,
  codiceSicuro,
  ripristinaTimeout,
  SOGLIA_BUDGET_LEGAME_MS,
  type DatiLegameRegistrazione,
} from './aggancio-registro'
import type { LegameVista, LegamiService } from './conferma-legame.service'
import { leggiFatturazioneDaInTx } from './impostazioni-fatturazione.service'
import { leggiTestaCatena } from './letture-legame'
import { bloccaLegamePerRadice, impostaTimeoutAggancio } from './lock-legame'
import type { PropostaLegameService } from './proposta-legame.service'

/** Avviso quando il legame non si e' potuto riallineare (resta «Da riallineare» in lista). */
export const AVVISO_LEGAME_DA_RIALLINEARE =
  'Correzione registrata; il collegamento a cliente e prezzo non è stato aggiornato: lo trovi in "Da collegare".'

/** Avviso quando il legame doveva nascere dalla rettifica e non ci e' riuscito. */
export const AVVISO_LEGAME_CORREZIONE_NON_RIUSCITO =
  'Correzione registrata; il collegamento a cliente e prezzo non è riuscito: lo trovi in "Da collegare".'

/** Avviso quando il legame nato dalla rettifica e' incompleto pur avendo chiesto la conferma. */
export const AVVISO_LEGAME_CORREZIONE_INCOMPLETO =
  'Correzione registrata; il collegamento a cliente e prezzo è incompleto: lo trovi in "Da collegare".'

/** Avviso quando le scelte di fatturazione indicate nella rettifica non si sono potute applicare. */
export const AVVISO_LEGAME_SCELTE_NON_APPLICATE =
  'Correzione registrata; le scelte di fatturazione indicate non sono state applicate: controlla il collegamento in "Da collegare".'

/** Avviso quando e' stata chiesta la conferma ma il legame non e' completo. */
export const AVVISO_LEGAME_CONFERMA_NON_POSSIBILE =
  'Correzione registrata; il collegamento a cliente e prezzo è incompleto e non è stato confermato: lo trovi in "Da collegare".'

/** Dati del movimento DOPO la correzione (la nuova testa). */
export interface DatiDopoCorrezione {
  type: 'CARICO' | 'SCARICO'
  causale: string
  causaleAziendaId: string | null
  cerCode: string
  movementDate: Date
  unit: string
  /** `Decimal.toFixed()`, mai la notazione esponenziale (M9). */
  quantity: string
  /** La causale della nuova testa e' fatturabile (rettifica); per l'annullo non conta. */
  fatturabile: boolean
  firId: string | null
}

/**
 * Blocco «Fatturazione» della risposta di rettifica/annullo (come quello della registrazione, con
 * l'esito in piu' `DA_RIALLINEARE`: il legame esiste ma e' rimasto indietro rispetto alla testa).
 * Assente se non c'era nulla da collegare.
 */
export interface FatturazioneCorrezione {
  esito: 'COLLEGATO' | 'NON_RIUSCITO' | 'DA_RIALLINEARE'
  legameId: string | null
  stato: StatoLegame | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
}

export interface EsitoRiallineamento {
  /** Avvisi per l'operatore, da aggiungere a quelli della correzione. */
  avvisi: string[]
  fatturazione: FatturazioneCorrezione | null
}

export interface DatiCorrezioneLegame {
  tenantId: string
  userId: string | null
  registroId: string
  tipo: 'RETTIFICA' | 'ANNULLAMENTO'
  /** Radice della catena: il lock del legame e' sulla radice. */
  radiceId: string
  /** L'annotazione appena inserita: la nuova testa. */
  nuovoVigenteId: string
  dopo: DatiDopoCorrezione
  /** Blocco «Fatturazione» della rettifica (facoltativo, gia' validato dal chiamante). */
  legame?: DatiLegameRegistrazione
  legami: LegamiService
  proposta: PropostaLegameService
  /** Millisecondi trascorsi dall'inizio della transazione della correzione (budget del legame). */
  trascorsoMs?: number
  logger?: { error(messaggio: string, errore?: Error, contesto?: Record<string, unknown>): void }
}

const NIENTE: EsitoRiallineamento = { avvisi: [], fatturazione: null }

/** Registra il fallimento (log, segnalazione, audit) senza mai lanciare. */
async function registraFallimento(
  tx: Prisma.TransactionClient,
  c: DatiCorrezioneLegame,
  legameId: string | null,
  tipoErrore: string,
  codice: string
): Promise<EsitoRiallineamento> {
  const sicuro = new Error(
    `Riallineamento del legame dopo la correzione non riuscito (${tipoErrore}${codice ? ` ${codice}` : ''})`
  )
  c.logger?.error('Legame non riallineato: la correzione del movimento resta registrata', sicuro, {
    tenantId: c.tenantId,
    registroId: c.registroId,
    tipoErrore,
    codice,
  })
  segnalaErroreJob('legameCorrezione', sicuro, { tenantId: c.tenantId })
  await auditSenzaFallire(tx, {
    tenantId: c.tenantId,
    userId: c.userId,
    action: 'LEGAME_NON_RIUSCITO',
    description: 'Legame non riallineato dopo la correzione: correzione registrata',
    metadata: {
      correzione: true,
      tipo: c.tipo,
      tipoErrore,
      codice,
      radiceId: c.radiceId,
      movimentoId: c.nuovoVigenteId,
      registroId: c.registroId,
    },
  })
  return {
    avvisi: [AVVISO_LEGAME_DA_RIALLINEARE],
    fatturazione: { esito: 'DA_RIALLINEARE', legameId, stato: null, motivi: [], avvisi: [] },
  }
}

const STATI_CON_SCELTE: readonly StatoLegame[] = ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO']

function eIncompleto(err: unknown): boolean {
  if (!(err instanceof ConflictException)) return false
  const r = (err as HttpException).getResponse() as { error?: unknown }
  return typeof r === 'object' && r?.error === 'LEGAME_INCOMPLETO'
}

/**
 * Prova a eseguire `fn` in un savepoint annidato: `ok` con il risultato, oppure l'errore dopo il
 * `ROLLBACK TO` (e il `RELEASE`). Non lancia mai per un errore di `fn`.
 */
async function inSavepoint<T>(
  tx: Prisma.TransactionClient,
  nome: string,
  fn: () => Promise<T>
): Promise<{ ok: true; valore: T } | { ok: false; errore: unknown }> {
  // Nome costante (nessun dato dell'utente).
  await tx.$executeRawUnsafe(`SAVEPOINT ${nome}`)
  try {
    const valore = await fn()
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${nome}`)
    return { ok: true, valore }
  } catch (errore) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${nome}`)
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${nome}`)
    return { ok: false, errore }
  }
}

/**
 * Applica al legame appena riallineato il blocco `legame` della rettifica (cliente, contratto,
 * elenco, righe, `azione`). Non lancia: ritorna la vista finale e gli avvisi.
 */
async function applicaBlocco(
  tx: Prisma.TransactionClient,
  c: DatiCorrezioneLegame,
  vista: LegameVista
): Promise<{ vista: LegameVista; avvisi: string[] }> {
  const b = c.legame
  if (!b) return { vista, avvisi: [] }
  const haScelte =
    b.clienteId !== undefined ||
    b.contrattoId !== undefined ||
    b.elencoId !== undefined ||
    (b.righe?.length ?? 0) > 0
  const vuoleConferma = b.azione === 'CONFERMA'
  if (!haScelte && !vuoleConferma) return { vista, avvisi: [] }
  if (!STATI_CON_SCELTE.includes(vista.stato)) {
    // Fatturato, escluso o annullato: le scelte non si possono applicare, ma non si tace.
    return { vista, avvisi: [AVVISO_LEGAME_SCELTE_NON_APPLICATE] }
  }
  const tenta = (conferma: boolean, nome: string) =>
    inSavepoint(tx, nome, () =>
      c.legami.applicaSceltaInTx(tx, c.tenantId, c.userId, vista.id, b, conferma)
    )

  if (vuoleConferma) {
    const r = await tenta(true, 'legame_correzione_scelte')
    if (r.ok) return { vista: r.valore, avvisi: [] }
    if (eIncompleto(r.errore)) {
      // Non e' completo: resta come il dominio dice (PROPOSTO / DA_COLLEGARE), con i motivi.
      if (!haScelte) return { vista, avvisi: [AVVISO_LEGAME_CONFERMA_NON_POSSIBILE] }
      const m = await tenta(false, 'legame_correzione_scelte2')
      if (m.ok) return { vista: m.valore, avvisi: [AVVISO_LEGAME_CONFERMA_NON_POSSIBILE] }
      return { vista, avvisi: [AVVISO_LEGAME_SCELTE_NON_APPLICATE] }
    }
    return { vista, avvisi: [AVVISO_LEGAME_SCELTE_NON_APPLICATE] }
  }
  const m = await tenta(false, 'legame_correzione_scelte')
  if (m.ok) return { vista: m.valore, avvisi: [] }
  return { vista, avvisi: [AVVISO_LEGAME_SCELTE_NON_APPLICATE] }
}

/**
 * Riallinea (o fa nascere) il legame della catena dopo una rettifica o un annullo. Va chiamata
 * DOPO l'inserimento della nuova annotazione, con il lock del registro gia' preso. Ritorna gli
 * avvisi e il blocco `fatturazione` per l'utente; non lancia per un problema del legame.
 *
 * Prima di tutto una SELECT senza lock: se il legame non esiste e non deve nascere (annullo,
 * causale non fatturabile, fatturazione spenta o movimento prima di «fatturazione da») non c'e'
 * nulla da fare, e non servono savepoint, budget, avvisi, audit ne' segnalazioni.
 */
export async function riallineaLegameDopoCorrezione(
  tx: Prisma.TransactionClient,
  c: DatiCorrezioneLegame
): Promise<EsitoRiallineamento> {
  const ingresso = Date.now()
  const prima = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM legami_movimento
    WHERE tenant_id = ${c.tenantId}::uuid AND movimento_originale_id = ${c.radiceId}::uuid`
  const legameNoto = prima[0]?.id ?? null
  if (legameNoto === null) {
    if (c.tipo !== 'RETTIFICA' || !c.dopo.fatturabile) return NIENTE
    const da = await leggiFatturazioneDaInTx(tx, c.tenantId)
    if (da === null || giornoItaliano(c.dopo.movementDate) < da) return NIENTE
  }

  if ((c.trascorsoMs ?? 0) > SOGLIA_BUDGET_LEGAME_MS) {
    // La correzione ha la precedenza: il legame non si prova nemmeno e resta indietro.
    return registraFallimento(tx, c, legameNoto, 'BudgetEsaurito', 'BUDGET_ESAURITO')
  }

  let timeoutPrima: string | null = null
  let daFarNascere = false
  const avvisi: string[] = []
  let fatturazione: FatturazioneCorrezione | null = null
  // Testo costante (nessun dato dell'utente).
  await tx.$executeRawUnsafe('SAVEPOINT legame_correzione')
  try {
    const lettura = await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('lock_timeout') AS v`
    timeoutPrima = lettura[0]?.v ?? null
    await impostaTimeoutAggancio(tx)
    await bloccaLegamePerRadice(tx, c.radiceId)
    const esistente = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM legami_movimento
      WHERE tenant_id = ${c.tenantId}::uuid AND movimento_originale_id = ${c.radiceId}::uuid`
    if (esistente.length > 0) {
      // La testa si legge DOPO il lock della radice (anche un ANNULLAMENTO).
      const testa = await leggiTestaCatena(tx, c.tenantId, c.radiceId)
      if (!testa || testa.id !== c.nuovoVigenteId) {
        throw new Error('Testa della catena diversa dalla correzione appena inserita')
      }
      const esito = await c.legami.allineaAlVigente(
        tx,
        c.tenantId,
        c.userId,
        esistente[0].id,
        testa
      )
      if (esito.scostamento) avvisi.push(AVVISO_SCOSTAMENTO)
      // Le scelte dell'utente si applicano al legame gia' allineato, in savepoint annidati: un
      // blocco non valido non puo' far restare indietro il riallineamento di base.
      const finale = await applicaBlocco(tx, c, esito.vista)
      avvisi.push(...finale.avvisi)
      fatturazione = {
        esito: 'COLLEGATO',
        legameId: finale.vista.id,
        stato: finale.vista.stato,
        motivi: finale.vista.motivi,
        avvisi: finale.vista.avvisi,
      }
    } else {
      daFarNascere = c.tipo === 'RETTIFICA' && c.dopo.fatturabile
    }
    await ripristinaTimeout(tx, timeoutPrima)
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT legame_correzione')
  } catch (err) {
    // Il ROLLBACK TO annulla anche il SET LOCAL del timeout e rilascia i lock presi nel savepoint.
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT legame_correzione')
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT legame_correzione')
    const tipo = err instanceof Error ? err.name : 'sconosciuto'
    return registraFallimento(tx, c, legameNoto, tipo, codiceSicuro(err))
  }

  if (daFarNascere) {
    // Il legame nasce come alla registrazione (savepoint, tetto di attesa e budget propri): la
    // radice resta quella della catena, il vigente e' la nuova testa. Il budget vede anche il
    // tempo passato nel primo savepoint.
    const aggancio = await agganciaLegameSenzaFallire(tx, {
      tenantId: c.tenantId,
      userId: c.userId,
      registroId: c.registroId,
      type: c.dopo.type,
      movimentoId: c.nuovoVigenteId,
      radiceId: c.radiceId,
      fatturabile: true,
      causale: c.dopo.causale,
      causaleAziendaId: c.dopo.causaleAziendaId,
      cerCode: c.dopo.cerCode,
      movementDate: c.dopo.movementDate,
      unit: c.dopo.unit,
      quantity: c.dopo.quantity,
      firId: c.dopo.firId,
      legame: c.legame,
      proposta: c.proposta,
      trascorsoMs: (c.trascorsoMs ?? 0) + (Date.now() - ingresso),
      logger: c.logger,
    })
    // Testi propri della correzione al posto di quelli della registrazione.
    for (const a of aggancio.avvisi) {
      avvisi.push(
        a === AVVISO_LEGAME_NON_RIUSCITO
          ? AVVISO_LEGAME_CORREZIONE_NON_RIUSCITO
          : a === AVVISO_LEGAME_INCOMPLETO
            ? AVVISO_LEGAME_CORREZIONE_INCOMPLETO
            : a
      )
    }
    fatturazione = aggancio.fatturazione
  }
  return { avvisi, fatturazione }
}
