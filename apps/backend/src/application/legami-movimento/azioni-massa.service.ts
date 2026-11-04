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
  leggiRadiceDelMovimento,
  leggiTestaCatena,
} from './letture-legame'
import { bloccaLegamePerRadice } from './lock-legame'
import { PropostaLegameService } from './proposta-legame.service'

/** Tetto di elementi per richiesta (spec §7.3). */
export const MAX_ELEMENTI_AZIONE_MASSA = 500

export type AzioneMassa = 'CONFERMA' | 'ESCLUDI'

/** Stessi nomi di `CorpoAzioneMassa` del frontend (`legami.model.ts`). */
export interface RichiestaAzioneMassa {
  azione: AzioneMassa
  elementi: { legameId: string; versione: number }[]
  /** Obbligatorio con ESCLUDI, ignorato con CONFERMA. */
  motivo?: string
}

/** Stessi nomi di `EsitoAzioneMassa` del frontend. `messaggio` non contiene id ne' dati personali. */
export interface EsitoAzioneMassa {
  riusciti: number
  falliti: { legameId: string; codice: string; messaggio: string }[]
}

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
  motivo: string | null
} {
  if (!r || (r.azione !== 'CONFERMA' && r.azione !== 'ESCLUDI')) {
    throw richiestaNonValida('AZIONE_NON_VALIDA', 'L’azione richiesta non è valida.')
  }
  if (!Array.isArray(r.elementi) || r.elementi.length === 0) {
    throw richiestaNonValida('ELEMENTI_NON_VALIDI', 'Indica almeno un movimento.')
  }
  if (r.elementi.length > MAX_ELEMENTI_AZIONE_MASSA) {
    throw richiestaNonValida(
      'TROPPI_ELEMENTI',
      `Si possono trattare al massimo ${MAX_ELEMENTI_AZIONE_MASSA} movimenti per volta.`
    )
  }
  const visti = new Set<string>()
  for (const x of r.elementi) {
    if (!x || !eUuid(x.legameId) || !Number.isInteger(x.versione)) {
      throw richiestaNonValida('ELEMENTO_NON_VALIDO', 'Uno dei movimenti indicati non è valido.')
    }
    if (visti.has(x.legameId)) {
      throw richiestaNonValida('ELEMENTO_DUPLICATO', 'Lo stesso movimento è indicato più volte.')
    }
    visti.add(x.legameId)
  }
  let motivo: string | null = null
  if (r.azione === 'ESCLUDI') {
    const m = validaMotivoEsclusione(r.motivo)
    if (!m.ok) throw richiestaNonValida('MOTIVO_ESCLUSIONE_NON_VALIDO', m.errore)
    motivo = m.valore
  }
  return { azione: r.azione, elementi: r.elementi, motivo }
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
   * Conferma o esclude piu' legami. Richiesta non valida (azione, 0 o piu' di 500 elementi,
   * id o versione non validi, doppioni, motivo mancante): 400 e non si tocca nulla. Per il resto
   * la risposta e' sempre 200 con l'esito per elemento.
   */
  async esegui(
    tenantId: string,
    utenteId: string,
    richiesta: RichiestaAzioneMassa
  ): Promise<EsitoAzioneMassa> {
    const { azione, elementi, motivo } = validaRichiestaAzioneMassa(richiesta)
    const falliti: EsitoAzioneMassa['falliti'] = []
    let riusciti = 0

    // Una sola lettura per l'ordine dei lock (JOIN unnest, mai una query per elemento).
    const chiavi = await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await impostaTimeoutLock(tx)
        return leggiChiaviLockDeiLegami(
          tx,
          tenantId,
          elementi.map(x => x.legameId)
        )
      }, OPZIONI_TRANSAZIONE_SCRITTURA)
    )
    const chiavePer = new Map(chiavi.map(c => [c.id, c.chiave]))
    const ordinati = elementi
      .filter(x => chiavePer.has(x.legameId))
      .sort((a, b) => {
        const d = chiavePer.get(a.legameId)! - chiavePer.get(b.legameId)!
        return d !== 0 ? d : a.legameId < b.legameId ? -1 : a.legameId > b.legameId ? 1 : 0
      })
    for (const x of elementi) {
      if (!chiavePer.has(x.legameId)) {
        falliti.push({
          legameId: x.legameId,
          codice: CODICE_NON_TROVATO,
          messaggio: 'Legame non trovato.',
        })
      }
    }

    for (const x of ordinati) {
      try {
        if (azione === 'CONFERMA') {
          await this.legami.conferma(tenantId, utenteId, x.legameId, x.versione)
        } else {
          await this.legami.escludi(tenantId, utenteId, x.legameId, x.versione, motivo ?? '')
        }
        riusciti++
      } catch (err) {
        const d = descriviErrore(err)
        if (d) {
          falliti.push({ legameId: x.legameId, ...d })
        } else {
          // Errore non previsto: l'elemento fallisce, gli altri proseguono. Niente dettagli
          // all'utente (potrebbero contenere SQL o dati); nel log solo il tipo.
          this.log.error(
            `Azione di massa ${azione}: errore non previsto (${err instanceof Error ? err.name : typeof err})`
          )
          falliti.push({
            legameId: x.legameId,
            codice: CODICE_ERRORE_INTERNO,
            messaggio: 'Operazione non riuscita: riprova più tardi.',
          })
        }
      }
    }

    await this.scriviAudit(tenantId, utenteId, azione, elementi.length, riusciti, falliti)
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
            return this.legami.allineaAlVigente(tx, tenantId, utenteId, esistente[0].id, testa)
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
                falliti: falliti.map(f => ({ legameId: f.legameId, codice: f.codice })),
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
