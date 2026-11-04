// Azioni di massa dalla lista «da collegare» e generazione del legame da un movimento (fase 4.3,
// spec §7.3, decisioni 5, 13, 20, 21; Task 19).
//
// AZIONI DI MASSA (`esegui`): confermare piu' proposte complete o escludere piu' legami, al massimo
// 500 per richiesta. Ogni elemento e' la SUA transazione (`LegamiService.conferma` / `escludi`,
// con tutte le regole e i lock di quei servizi): un elemento che fallisce non annulla gli altri e
// finisce in `falliti` con codice e motivo. Quindi una transazione tiene al piu' UN lock
// consultivo di radice alla volta e due azioni di massa sovrapposte NON possono andare in
// deadlock per costruzione. Gli elementi si elaborano comunque in ordine deterministico, per
// chiave del lock (`hashtext(radice)`, poi id): non per id, perche' con una collisione di hash due
// ordini per id potrebbero incrociarsi (nota m7 del Task 14). Chi in futuro tenesse piu' radici
// nella stessa transazione deve prenderle in QUESTO ordine.
//
// MANCANTI IN MASSA: `movimentoIds` accanto a `elementi` (totale 1..500). Per ogni movimento una
// transazione genera la proposta (`LEGAME_GIA_PRESENTE` se il legame esiste gia') e una seconda la
// conferma o la esclude: una proposta incompleta resta DA_COLLEGARE e il movimento esce in
// `falliti` con `LEGAME_INCOMPLETO`. Un budget di tempo (60 s) chiude la richiesta: gli elementi
// non ancora trattati escono con `TEMPO_SCADUTO`, quelli riusciti restano.
//
// `daMovimento`: genera il legame di un movimento che non ne ha (MANCANTE) o riallinea quello
// rimasto indietro rispetto alla testa della catena (DA_RIALLINEARE). Una transazione: lock
// consultivo della radice -> lettura della testa -> `proponiEScrivi` oppure
// `LegamiService.allineaAlVigente`. Il lock del registro non si prende: non si scrive il registro,
// e una correzione concorrente (che ha il lock del registro) prende poi lo stesso lock della
// radice, trova il legame gia' scritto e lo riallinea lei. Idempotente.
//
// Nessuna scrittura su `waste_movements`.
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { validaMotivoEsclusione } from '../../domain/legami-movimento/codici'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  MSG_OPERAZIONE_CONCORRENTE,
  traduciErrorePrisma,
  type DescrizioneEntita,
} from '../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { eUuid } from './conferma-legame-righe'
import { inputDaMovimento, LegamiService, type LegameVista } from './conferma-legame.service'
import { eViolazioneFk } from './legame-scrittura'
import {
  leggiChiaviLockDeiLegami,
  leggiChiaviLockDeiMovimenti,
  leggiRadiceDelMovimento,
  leggiTestaCatena,
} from './letture-legame'
import { bloccaLegamePerRadice } from './lock-legame'
import { PropostaLegameService } from './proposta-legame.service'

/** Tetto di elementi per richiesta (spec §7.3). */
export const MAX_ELEMENTI_AZIONE_MASSA = 500

export type AzioneMassa = 'CONFERMA' | 'ESCLUDI'

/** Stessi nomi di `CorpoAzioneMassa` del frontend (`legami.model.ts`). Totale elementi + movimenti: 1..500. */
export interface RichiestaAzioneMassa {
  azione: AzioneMassa
  elementi?: { legameId: string; versione: number }[]
  /** Movimenti MANCANTI da lavorare in un solo passo (proposta + conferma o esclusione). */
  movimentoIds?: string[]
  /** Obbligatorio con ESCLUDI, ignorato con CONFERMA. */
  motivo?: string
}

/** Stessi nomi di `EsitoAzioneMassa` del frontend. `messaggio` non contiene id ne' dati personali. */
export interface EsitoAzioneMassa {
  riusciti: number
  /** `legameId` null: il fallimento e' avvenuto prima che il legame esistesse. */
  falliti: { legameId: string | null; movimentoId?: string; codice: string; messaggio: string }[]
}

/** Tempo massimo di una richiesta: oltre, gli elementi restanti escono con `TEMPO_SCADUTO`. */
export const BUDGET_MS_AZIONE_MASSA = 60_000

const ENTITA: DescrizioneEntita = {
  prefisso: 'LEGAME_MOVIMENTO',
  soggetto: 'Il legame',
  femminile: false,
}

const CODICE_NON_TROVATO = 'LEGAME_MOVIMENTO_NON_TROVATO'
const CODICE_ERRORE_INTERNO = 'ERRORE_INTERNO'

const richiestaNonValida = (error: string, message: string) =>
  new BadRequestException({ error, message })

const movimentoNonTrovato = () =>
  new NotFoundException({ error: 'MOVIMENTO_NON_TROVATO', message: 'Movimento non trovato.' })

/** Codice e messaggio di un errore di un elemento (mai dettagli interni ne' id). */
function descriviErrore(err: unknown): { codice: string; messaggio: string } | null {
  if (!(err instanceof HttpException)) return null
  const r = err.getResponse()
  if (typeof r === 'string') return { codice: `HTTP_${err.getStatus()}`, messaggio: r }
  const corpo = r as { error?: unknown; message?: unknown }
  const codice = typeof corpo.error === 'string' ? corpo.error : `HTTP_${err.getStatus()}`
  const messaggio =
    typeof corpo.message === 'string'
      ? corpo.message
      : Array.isArray(corpo.message)
        ? corpo.message.filter(m => typeof m === 'string').join(' ')
        : 'Operazione non riuscita.'
  return { codice, messaggio }
}

export function validaRichiestaAzioneMassa(r: RichiestaAzioneMassa): {
  azione: AzioneMassa
  elementi: { legameId: string; versione: number }[]
  movimentoIds: string[]
  motivo: string | null
} {
  if (!r || (r.azione !== 'CONFERMA' && r.azione !== 'ESCLUDI')) {
    throw richiestaNonValida('AZIONE_NON_VALIDA', 'L’azione richiesta non è valida.')
  }
  const elementi = r.elementi ?? []
  const movimentoIds = r.movimentoIds ?? []
  if (!Array.isArray(elementi) || !Array.isArray(movimentoIds)) {
    throw richiestaNonValida('ELEMENTI_NON_VALIDI', 'L’elenco dei movimenti non è valido.')
  }
  const totale = elementi.length + movimentoIds.length
  if (totale === 0) {
    throw richiestaNonValida('ELEMENTI_NON_VALIDI', 'Indica almeno un movimento.')
  }
  if (totale > MAX_ELEMENTI_AZIONE_MASSA) {
    throw richiestaNonValida(
      'TROPPI_ELEMENTI',
      `Si possono trattare al massimo ${MAX_ELEMENTI_AZIONE_MASSA} movimenti per volta.`
    )
  }
  const visti = new Set<string>()
  for (const x of elementi) {
    if (!x || !eUuid(x.legameId) || !Number.isInteger(x.versione)) {
      throw richiestaNonValida('ELEMENTO_NON_VALIDO', 'Uno dei movimenti indicati non è valido.')
    }
    if (visti.has(x.legameId)) {
      throw richiestaNonValida('ELEMENTO_DUPLICATO', 'Lo stesso movimento è indicato più volte.')
    }
    visti.add(x.legameId)
  }
  const vistiMov = new Set<string>()
  for (const id of movimentoIds) {
    if (!eUuid(id)) {
      throw richiestaNonValida('ELEMENTO_NON_VALIDO', 'Uno dei movimenti indicati non è valido.')
    }
    if (vistiMov.has(id)) {
      throw richiestaNonValida('ELEMENTO_DUPLICATO', 'Lo stesso movimento è indicato più volte.')
    }
    vistiMov.add(id)
  }
  let motivo: string | null = null
  if (r.azione === 'ESCLUDI') {
    const m = validaMotivoEsclusione(r.motivo)
    if (!m.ok) throw richiestaNonValida('MOTIVO_ESCLUSIONE_NON_VALIDO', m.errore)
    motivo = m.valore
  }
  return { azione: r.azione, elementi, movimentoIds, motivo }
}

@Injectable()
export class AzioniMassaService {
  private readonly log = new Logger(AzioniMassaService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly proposta: PropostaLegameService,
    private readonly legami: LegamiService
  ) {}

  /**
   * Conferma o esclude piu' legami (`elementi`) e/o movimenti ancora senza legame
   * (`movimentoIds`). Richiesta non valida (azione, 0 o piu' di 500 elementi in tutto, id o
   * versione non validi, doppioni, motivo mancante): 400 e non si tocca nulla. Per il resto la
   * risposta e' sempre 200 con l'esito per elemento.
   */
  async esegui(
    tenantId: string,
    utenteId: string,
    richiesta: RichiestaAzioneMassa,
    opzioni: { budgetMs?: number } = {}
  ): Promise<EsitoAzioneMassa> {
    const { azione, elementi, movimentoIds, motivo } = validaRichiestaAzioneMassa(richiesta)
    const budgetMs = opzioni.budgetMs ?? BUDGET_MS_AZIONE_MASSA
    const inizio = Date.now()
    const falliti: EsitoAzioneMassa['falliti'] = []
    let riusciti = 0

    // Una sola lettura per legami e una per movimenti (JOIN unnest, mai una query per elemento).
    const { chiaviLegami, chiaviMovimenti } = await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await impostaTimeoutLock(tx)
        return {
          chiaviLegami: await leggiChiaviLockDeiLegami(
            tx,
            tenantId,
            elementi.map(x => x.legameId)
          ),
          chiaviMovimenti: await leggiChiaviLockDeiMovimenti(tx, tenantId, movimentoIds),
        }
      }, OPZIONI_TRANSAZIONE_SCRITTURA)
    )
    const chiaveLegame = new Map(chiaviLegami.map(c => [c.id, c.chiave]))
    const chiaveMov = new Map(chiaviMovimenti.map(c => [c.id, c.chiave]))

    type Lavoro =
      | { tipo: 'legame'; id: string; versione: number; chiave: number }
      | { tipo: 'movimento'; id: string; chiave: number }
    const lavori: Lavoro[] = []
    for (const x of elementi) {
      const chiave = chiaveLegame.get(x.legameId)
      if (chiave === undefined) {
        falliti.push({
          legameId: x.legameId,
          codice: CODICE_NON_TROVATO,
          messaggio: 'Legame non trovato.',
        })
      } else lavori.push({ tipo: 'legame', id: x.legameId, versione: x.versione, chiave })
    }
    for (const id of movimentoIds) {
      const chiave = chiaveMov.get(id)
      if (chiave === undefined) {
        falliti.push({
          legameId: null,
          movimentoId: id,
          codice: 'MOVIMENTO_NON_TROVATO',
          messaggio: 'Movimento non trovato.',
        })
      } else lavori.push({ tipo: 'movimento', id, chiave })
    }
    lavori.sort((a, b) => a.chiave - b.chiave || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const agisci = (legameId: string, versione: number) =>
      azione === 'CONFERMA'
        ? this.legami.conferma(tenantId, utenteId, legameId, versione)
        : this.legami.escludi(tenantId, utenteId, legameId, versione, motivo ?? '')

    for (const x of lavori) {
      const riferimento =
        x.tipo === 'legame' ? { legameId: x.id } : { legameId: null, movimentoId: x.id }
      if (Date.now() - inizio >= budgetMs) {
        falliti.push({
          ...riferimento,
          codice: 'TEMPO_SCADUTO',
          messaggio: 'Tempo esaurito: riprova per i movimenti rimasti.',
        })
        continue
      }
      let legameIdCorrente: string | null = x.tipo === 'legame' ? x.id : null
      try {
        if (x.tipo === 'legame') {
          await agisci(x.id, x.versione)
        } else {
          const nuova = await this.eseguiInTransazioneMovimento(tenantId, utenteId, x.id, true)
          legameIdCorrente = nuova.id
          await agisci(nuova.id, nuova.versione)
        }
        riusciti++
      } catch (err) {
        const base = {
          legameId: legameIdCorrente,
          ...(x.tipo === 'movimento' ? { movimentoId: x.id } : {}),
        }
        const d = descriviErrore(err)
        if (d) {
          falliti.push({ ...base, ...d })
        } else {
          // Errore non previsto: l'elemento fallisce, gli altri proseguono. Niente dettagli
          // all'utente (potrebbero contenere SQL o dati); nel log solo il tipo.
          this.log.error(
            `Azione di massa ${azione}: errore non previsto (${err instanceof Error ? err.name : typeof err})`
          )
          falliti.push({
            ...base,
            codice: CODICE_ERRORE_INTERNO,
            messaggio: 'Operazione non riuscita: riprova più tardi.',
          })
        }
      }
    }

    await this.scriviAudit(
      tenantId,
      utenteId,
      azione,
      elementi.length + movimentoIds.length,
      riusciti,
      falliti
    )
    return { riusciti, falliti }
  }

  /**
   * Genera la proposta di un movimento senza legame (MANCANTE) o riallinea il legame rimasto
   * indietro (DA_RIALLINEARE). `movimentoId` e' un movimento qualunque della catena (la lista
   * indica la testa). Se il legame esiste ed e' gia' allineato risponde con la vista, senza
   * scrivere. 404 `MOVIMENTO_NON_TROVATO`; 409 `CAUSALE_NON_FATTURABILE`,
   * `MOVIMENTO_FUORI_FATTURAZIONE` (data prima di «fatturazione da» o fatturazione spenta),
   * `MOVIMENTO_ANNULLATO` (catena annullata e nessun legame).
   */
  async daMovimento(tenantId: string, utenteId: string, movimentoId: string): Promise<LegameVista> {
    return this.eseguiInTransazioneMovimento(tenantId, utenteId, movimentoId, false)
  }

  /**
   * Una transazione: lock della radice -> testa -> genera o riallinea. Con `soloNuovo` un legame
   * gia' presente e' un 409 `LEGAME_GIA_PRESENTE` (azione di massa sui MANCANTI: l'elemento era
   * MANCANTE quando l'utente ha scelto, ora non lo e' piu').
   */
  private async eseguiInTransazioneMovimento(
    tenantId: string,
    utenteId: string,
    movimentoId: string,
    soloNuovo: boolean
  ): Promise<LegameVista> {
    if (!eUuid(movimentoId)) throw movimentoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const radice = await leggiRadiceDelMovimento(tx, tenantId, movimentoId)
          if (!radice) throw movimentoNonTrovato()
          await bloccaLegamePerRadice(tx, radice)
          // La testa si legge DOPO il lock: chi ci precedeva ha gia' scritto.
          const testa = await leggiTestaCatena(tx, tenantId, radice)
          if (!testa) throw movimentoNonTrovato()

          const esistente = await tx.$queryRaw<{ id: string }[]>`
            SELECT id::text AS id FROM legami_movimento
            WHERE tenant_id = ${tenantId}::uuid AND movimento_originale_id = ${radice}::uuid`
          if (esistente.length > 0) {
            if (soloNuovo) {
              throw new ConflictException({
                error: 'LEGAME_GIA_PRESENTE',
                message: 'Il movimento è già collegato: ricarica la lista.',
              })
            }
            return (
              await this.legami.allineaAlVigente(tx, tenantId, utenteId, esistente[0].id, testa)
            ).vista
          }

          if (testa.tipoAnnotazione === 'ANNULLAMENTO') {
            throw new ConflictException({
              error: 'MOVIMENTO_ANNULLATO',
              message: 'Il movimento è stato annullato: non c’è nulla da collegare.',
            })
          }
          const r = await this.proposta.proponiEScrivi(tx, {
            tenantId,
            userId: utenteId,
            registroId: testa.registroId,
            verso: testa.type,
            movimentoOriginaleId: radice,
            movimentoVigenteId: testa.id,
            input: inputDaMovimento(testa),
          })
          if (!r.legameId) {
            if (r.proposta && !r.proposta.fatturabile) {
              throw new ConflictException({
                error: 'CAUSALE_NON_FATTURABILE',
                message: 'La causale del movimento non è fatturabile.',
              })
            }
            throw new ConflictException({
              error: 'MOVIMENTO_FUORI_FATTURAZIONE',
              message:
                'Il movimento è precedente alla data di «fatturazione da» (o la fatturazione è spenta).',
            })
          }
          if (r.creato) {
            await tx.activityLog.create({
              data: {
                tenantId,
                userId: utenteId,
                action: 'LEGAME_MOVIMENTO_GENERATO',
                description: 'Legame movimento generato dalla lista',
                metadata: {
                  legameId: r.legameId,
                  stato: r.proposta?.stato ?? null,
                  motivi: r.proposta?.motivi ?? [],
                } as Prisma.InputJsonValue,
              },
            })
          }
          return this.legami.vistaInTx(tx, tenantId, r.legameId)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => {
          if (eViolazioneFk(err)) {
            throw new ConflictException({
              error: 'OPERAZIONE_CONCORRENTE',
              message: MSG_OPERAZIONE_CONCORRENTE,
            })
          }
          return traduciErrorePrisma(err, ENTITA, {})
        })
    )
  }

  /** Riepilogo dell'azione di massa (le righe le scrive gia' ogni singola azione). Un errore qui non rovescia l'esito. */
  private async scriviAudit(
    tenantId: string,
    utenteId: string,
    azione: AzioneMassa,
    richiesti: number,
    riusciti: number,
    falliti: EsitoAzioneMassa['falliti']
  ): Promise<void> {
    try {
      await nelContestoTenant(tenantId, () =>
        this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'LEGAMI_AZIONE_MASSA',
              description: 'Azione di massa sui legami movimento',
              // Solo id dei legami e codici: nessun testo libero (il motivo dell'esclusione e'
              // gia' sul legame) e nessun dato personale.
              metadata: {
                azione,
                richiesti,
                riusciti,
                falliti: falliti.map(f => ({
                  legameId: f.legameId,
                  ...(f.movimentoId ? { movimentoId: f.movimentoId } : {}),
                  codice: f.codice,
                })),
              } as Prisma.InputJsonValue,
            },
          })
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
      )
    } catch (err) {
      this.log.error(
        `Azione di massa ${azione}: audit non scritto (${err instanceof Error ? err.name : typeof err})`
      )
    }
  }
}
