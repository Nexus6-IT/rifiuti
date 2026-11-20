/**
 * Eventi dal campo (app campo, P4): gli esiti che l'autista registra sul telefono e invia quando
 * c'e' rete. Regola unica: l'ufficio decide anagrafica e pianificazione, i FATTI del campo non si
 * scartano mai. Ogni evento valido viene quindi sempre registrato (append-only); se non si puo'
 * applicare al ritiro resta «DA_RICONCILIARE» con il motivo, visibile all'ufficio.
 *
 * Idempotenza: `(azienda, evento_uuid)` e' unico. Un lock di sessione sull'uuid serializza i
 * reinvii (rete lenta, due richieste insieme) e il ritiro si blocca `FOR UPDATE` come in
 * `RitiriService.scrivi`, quindi l'applicazione e l'INSERT dell'evento stanno nella stessa
 * transazione: o ci sono entrambe o nessuna.
 */
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository, type Tx } from '../../infrastructure/persistence/ritiri.repository'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { RitiroDatiNonValidiError, RitiroNonTrovatoError } from '../ritiri/errori-ritiri'
import { AutistaNonCollegatoError, EventoCampoDiAltroUtenteError } from './errori-campo'
import {
  normalizzaEventoCampo,
  type DatiEventoCampo,
  type EventoCampoValori,
  type TipoEventoCampo,
} from './eventi-campo.input'

export type EsitoEventoCampo = 'APPLICATO' | 'DA_RICONCILIARE'

export type MotivoConflittoEvento =
  | 'RITIRO_ANNULLATO'
  | 'RITIRO_RIASSEGNATO'
  | 'RITIRO_STATO_CAMBIATO'
  | 'RITIRO_MODIFICATO'
  | 'RITIRO_CON_FIR'
  | 'ESITO_GIA_REGISTRATO'

/** Risposta al telefono: identica a ogni reinvio dello stesso evento. */
export interface RispostaEventoCampo {
  id: string
  esito: EsitoEventoCampo
  motivoConflitto: MotivoConflittoEvento | null
  ricevutoIl: string
}

export interface FiltriEsitiCampo {
  esito?: EsitoEventoCampo
  pagina?: number
  dimensione?: number
}

export interface EsitoCampoVista {
  id: string
  tipo: TipoEventoCampo
  esito: EsitoEventoCampo
  motivoConflitto: MotivoConflittoEvento | null
  dati: DatiEventoCampo
  versioneVista: number
  rilevatoIl: string
  ricevutoIl: string
  autista: { id: string; nome: string }
  ritiro: {
    id: string
    dataPrevista: string
    produttore: string
    cerCode: string
    descrizione: string
    stato: string
    versione: number
  }
}

export interface ElencoEsitiCampo {
  righe: EsitoCampoVista[]
  totale: number
}

const DIMENSIONE_PREDEFINITA = 50
const DIMENSIONE_MASSIMA = 200

interface Decisione {
  esito: EsitoEventoCampo
  motivoConflitto: MotivoConflittoEvento | null
  /** Da eseguire sul ritiro bloccato (solo se l'evento va applicato). */
  applica?: (tx: Tx) => Promise<void>
}

const eViolazioneUnicita = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

@Injectable()
export class EventiCampoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RitiriRepository
  ) {}

  /**
   * Registra un evento dell'autista collegato a `utenteId`. Sempre la stessa risposta per lo
   * stesso uuid; 404 se il ritiro non e' dell'azienda, 403 se l'utente non e' un autista attivo,
   * 409 se l'uuid e' di un altro utente, 400 se il corpo non e' valido.
   */
  async registra(
    tenantId: string,
    utenteId: string,
    grezzo: Parameters<typeof normalizzaEventoCampo>[0]
  ): Promise<RispostaEventoCampo> {
    const n = normalizzaEventoCampo(grezzo)
    if (!n.ok) throw new RitiroDatiNonValidiError(n.messaggi)
    const ev = n.valori
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(tx =>
          this.registraInTransazione(tx, tenantId, utenteId, ev)
        )
      } catch (err) {
        // Nessuna corsa dovrebbe arrivare qui (lock sull'uuid); se capita, l'altra transazione ha
        // gia' scritto: si risponde con la sua riga.
        if (eViolazioneUnicita(err)) {
          const esistente = await this.prisma.$transaction(tx =>
            this.leggiEsistente(tx, tenantId, utenteId, ev.id)
          )
          if (esistente) return esistente
        }
        throw err
      }
    })
  }

  private async registraInTransazione(
    tx: Tx,
    tenantId: string,
    utenteId: string,
    ev: EventoCampoValori
  ): Promise<RispostaEventoCampo> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eventi_campo:${tenantId}:${ev.id}`}, 0))`
    const esistente = await this.leggiEsistente(tx, tenantId, utenteId, ev.id)
    if (esistente) return esistente

    const autista = await tx.autista.findFirst({
      where: { tenantId, userId: utenteId, attivo: true },
      select: { id: true },
    })
    if (!autista) throw new AutistaNonCollegatoError()

    const bloccato = await this.repo.bloccaPerId(tx, tenantId, ev.ritiroId)
    if (!bloccato) throw new RitiroNonTrovatoError()
    const autistaDelRitiro = await this.repo.autistaDelRitiro(tx, tenantId, ev.ritiroId)

    const decisione = await this.decidi(tx, tenantId, ev, autista.id, autistaDelRitiro, bloccato)
    if (decisione.applica) await decisione.applica(tx)

    const riga = await tx.eventoCampo.create({
      data: {
        tenantId,
        eventoUuid: ev.id,
        ritiroId: ev.ritiroId,
        autistaId: autista.id,
        utenteId,
        tipo: ev.tipo,
        dati: ev.dati as Prisma.InputJsonObject,
        versioneVista: ev.versioneVista,
        rilevatoIl: ev.rilevatoIl,
        esito: decisione.esito,
        motivoConflitto: decisione.motivoConflitto,
      },
    })
    return this.risposta(riga)
  }

  /** Riga gia' registrata per questo uuid: stessa risposta, oppure 409 se e' di un altro utente. */
  private async leggiEsistente(
    tx: Tx,
    tenantId: string,
    utenteId: string,
    eventoUuid: string
  ): Promise<RispostaEventoCampo | null> {
    const riga = await tx.eventoCampo.findUnique({
      where: { tenantId_eventoUuid: { tenantId, eventoUuid } },
    })
    if (!riga) return null
    if (riga.utenteId !== utenteId) throw new EventoCampoDiAltroUtenteError()
    return this.risposta(riga)
  }

  /**
   * Tabella dei conflitti (ritiro gia' bloccato FOR UPDATE). Il non eseguito scrive sul ritiro, quindi
   * vuole la versione che l'autista ha visto; l'eseguito non cambia il ritiro (non esiste uno stato
   * «eseguito» sul ritiro: lo chiude il FIR) ma anch'esso vuole la versione vista.
   */
  private async decidi(
    tx: Tx,
    tenantId: string,
    ev: EventoCampoValori,
    autistaId: string,
    autistaDelRitiro: string | null,
    ritiro: { stato: string; versione: number }
  ): Promise<Decisione> {
    const conflitto = (m: MotivoConflittoEvento): Decisione => ({
      esito: 'DA_RICONCILIARE',
      motivoConflitto: m,
    })
    if (autistaDelRitiro !== autistaId) return conflitto('RITIRO_RIASSEGNATO')
    // Un solo esito applicato per ritiro (anche da un altro telefono o dopo un logout): un secondo,
    // magari contraddittorio, non si applica mai ma non si perde. Siamo sotto il FOR UPDATE.
    const precedente = await tx.eventoCampo.findFirst({
      where: { tenantId, ritiroId: ev.ritiroId, esito: 'APPLICATO' },
      select: { id: true },
    })
    if (precedente) return conflitto('ESITO_GIA_REGISTRATO')
    if (ritiro.stato === 'ANNULLATO') return conflitto('RITIRO_ANNULLATO')
    if (ritiro.stato !== 'PROGRAMMATO') return conflitto('RITIRO_STATO_CAMBIATO')
    // `versione` sale a ogni modifica d'ufficio (anche un riordino): non basta a bloccare. Conta
    // solo cio' che cambia il senso dell'esito: la data del giro e la sede/cliente (stato, autista
    // e FIR sono controllati qui sopra e sotto, sul dato corrente).
    const attuale = await tx.ritiro.findFirst({
      where: { id: ev.ritiroId, tenantId },
      select: { dataPrevista: true, produttoreSedeId: true },
    })
    if (
      !attuale ||
      attuale.dataPrevista.toISOString().slice(0, 10) !== ev.dataVista ||
      attuale.produttoreSedeId.toLowerCase() !== ev.sedeVista
    ) {
      return conflitto('RITIRO_MODIFICATO')
    }
    if (ev.tipo === 'RITIRO_ESEGUITO') return { esito: 'APPLICATO', motivoConflitto: null }

    if (await this.repo.firAttivo(tx, tenantId, ev.ritiroId)) return conflitto('RITIRO_CON_FIR')
    const motivo = ev.dati.motivo as string
    return {
      esito: 'APPLICATO',
      motivoConflitto: null,
      applica: tx2 =>
        this.repo.impostaStato(tx2, tenantId, ev.ritiroId, { stato: 'NON_ESEGUITO', motivo }),
    }
  }

  private risposta(riga: {
    eventoUuid: string
    esito: EsitoEventoCampo
    motivoConflitto: string | null
    ricevutoIl: Date
  }): RispostaEventoCampo {
    return {
      id: riga.eventoUuid,
      esito: riga.esito,
      motivoConflitto: riga.motivoConflitto as MotivoConflittoEvento | null,
      ricevutoIl: riga.ricevutoIl.toISOString(),
    }
  }

  /** «Esiti dal campo» per l'ufficio: dal piu' recente, con ritiro e autista. */
  async elenca(tenantId: string, filtri: FiltriEsitiCampo): Promise<ElencoEsitiCampo> {
    const dimensione = Math.min(
      Math.max(Math.trunc(filtri.dimensione ?? DIMENSIONE_PREDEFINITA), 1),
      DIMENSIONE_MASSIMA
    )
    const pagina = Math.max(Math.trunc(filtri.pagina ?? 1), 1)
    const where = filtri.esito
      ? Prisma.sql`AND e.esito = ${filtri.esito}::esito_evento_campo`
      : Prisma.empty
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const righe = await tx.$queryRaw<RigaEsito[]>(Prisma.sql`
          SELECT e.evento_uuid::text AS id, e.tipo, e.esito::text AS esito, e.motivo_conflitto,
                 e.dati, e.versione_vista, e.rilevato_il, e.ricevuto_il,
                 au.id::text AS autista_id, (au.cognome || ' ' || au.nome) AS autista_nome,
                 r.id::text AS ritiro_id, to_char(r.data_prevista, 'YYYY-MM-DD') AS data_prevista,
                 dp.ragione_sociale AS produttore, r.cer_code, r.descrizione,
                 r.stato::text AS stato, r.versione,
                 count(*) OVER ()::int AS totale
          FROM eventi_campo e
          JOIN ritiri r ON r.id = e.ritiro_id AND r.tenant_id = e.tenant_id
          JOIN autisti au ON au.id = e.autista_id AND au.tenant_id = e.tenant_id
          JOIN produttori p ON p.id = r.produttore_id AND p.tenant_id = r.tenant_id
          JOIN ditte dp ON dp.id = p.ditta_id AND dp.tenant_id = r.tenant_id
          WHERE e.tenant_id = ${tenantId}::uuid ${where}
          ORDER BY e.ricevuto_il DESC, e.id DESC
          LIMIT ${dimensione} OFFSET ${(pagina - 1) * dimensione}`)
        return {
          totale: righe[0]?.totale ?? 0,
          righe: righe.map(r => ({
            id: r.id,
            tipo: r.tipo as TipoEventoCampo,
            esito: r.esito as EsitoEventoCampo,
            motivoConflitto: r.motivo_conflitto as MotivoConflittoEvento | null,
            dati: r.dati,
            versioneVista: r.versione_vista,
            rilevatoIl: r.rilevato_il.toISOString(),
            ricevutoIl: r.ricevuto_il.toISOString(),
            autista: { id: r.autista_id, nome: r.autista_nome },
            ritiro: {
              id: r.ritiro_id,
              dataPrevista: r.data_prevista,
              produttore: r.produttore,
              cerCode: r.cer_code,
              descrizione: r.descrizione,
              stato: r.stato,
              versione: r.versione,
            },
          })),
        }
      })
    )
  }
}

interface RigaEsito {
  id: string
  tipo: string
  esito: string
  motivo_conflitto: string | null
  dati: DatiEventoCampo
  versione_vista: number
  rilevato_il: Date
  ricevuto_il: Date
  autista_id: string
  autista_nome: string
  ritiro_id: string
  data_prevista: string
  produttore: string
  cer_code: string
  descrizione: string
  stato: string
  versione: number
  totale: number
}
