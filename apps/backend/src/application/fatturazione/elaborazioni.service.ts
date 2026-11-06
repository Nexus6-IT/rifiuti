// Elaborazioni di fatturazione per periodo (fase 4.4b1, Task 18, spec §5.1, §5.3 e §8): avvio,
// lista, dettaglio, ricalcolo, scarto ed esclusione dei documenti. L'anteprima la calcola il job
// della coda `fatturazione` (`anteprima.ts`); la definitiva e' del Task 19.
//
// Il tenant arriva sempre dal chiamante (mai dal corpo della richiesta). Le scritture interattive
// usano `impostaTimeoutLock` e `OPZIONI_TRANSAZIONE_SCRITTURA`; 55P03, P2028 e 40P01 diventano 409
// `OPERAZIONE_CONCORRENTE`. L'elaborazione si blocca `FOR UPDATE` per prima (spec §8).
import { InjectQueue } from '@nestjs/bullmq'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Queue } from 'bullmq'
import {
  MESSAGGI_ERRORE,
  STATI_ELABORAZIONE,
  TETTO_DOCUMENTI_DEFINITIVA,
  type ErroreDocumento,
  type ErroreGenerale,
  type Segnalazione,
  type StatoElaborazione,
} from '../../domain/fatturazione/codici'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { leggiCedenteVista } from './cedente.service'
import {
  DIMENSIONE_MASSIMA_PAGINA,
  MAX_PAGINA,
  DocumentiFatturaService,
  type DocumentoRiga,
  type Pagina,
  type SegnalazioneVista,
} from './documenti-fattura.service'
import { bloccaElaborazione } from './lock-fatturazione'
import { eDataIso, oggiRoma } from './numerazione'
import { eViolazioneUnica, segnaFallita, type RiepilogoElaborazione } from './anteprima'
import {
  definitiveAttive,
  leggiCandidati,
  primoErroreBloccante,
  riportaAnteprimaPronta,
  ultimaDataSuperiore,
} from './definitiva'
import {
  cedenteNormalizzabile,
  type FiltriElaborazione,
  type ParametriElaborazione,
} from './selezione-fatturazione'

export const CODA_FATTURAZIONE = 'fatturazione'

export interface JobFatturazione {
  tenantId: string
  elaborazioneId: string
  tipo: 'anteprima' | 'definitiva'
  versione: number
  /** Volte che il job e' stato rimesso in attesa per un'altra elaborazione attiva (Q12). */
  rinvii?: number
  /** Chi ha chiesto la definitiva (solo per `definitiva`): finisce in `definita_da`. */
  utenteId?: string
}

/**
 * Id del job BullMQ (Q5): comprende la versione dopo l'incremento, cosi' un secondo `add` dello
 * stesso tipo non viene ignorato e un job fallito non impedisce di ripetere la richiesta. BullMQ
 * 5.62 non ammette id con i `:` (li rifiuta o li legge come id di job ripetuto): il separatore e' il trattino.
 */
export function idJobFatturazione(j: {
  tipo: 'anteprima' | 'definitiva'
  elaborazioneId: string
  versione: number
}): string {
  return `${j.tipo}-${j.elaborazioneId}-v${j.versione}`
}

export interface ElaborazioneRiga {
  id: string
  stato: StatoElaborazione
  createdAt: string
  periodoDal: string
  periodoAl: string
  dataDocumento: string
  documenti: number
  totale: string
  errori: number
  avvisi: number
}

export interface ElaborazioneDettaglio extends ElaborazioneRiga {
  raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'
  includiArretrati: boolean
  filtri: FiltriElaborazione
  impronta: string | null
  versione: number
  definitiveAttive: boolean
  erroriGenerali: SegnalazioneVista[]
  erroriPeriodo: { motivo: string; quanti: number; contrattoId: string | null }[]
  numerazionePrevista: RiepilogoElaborazione['numerazionePrevista']
  totaliPerRegistro: RiepilogoElaborazione['totaliPerRegistro']
  documentiNonGenerati: {
    contrattoId: string
    contrattoNumero: string
    clienteId: string
    denominazione: string
    errori: SegnalazioneVista[]
  }[]
  errore: {
    codice: string
    differenze?: { nuovi: number; cambiati: number; fatturatiDaAltri: number }
    ultimaData?: string
  } | null
  erroreTecnico: string | null
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'ELABORAZIONE_FATTURAZIONE',
  soggetto: "L'elaborazione",
  femminile: true,
}

/**
 * Un `IN_CODA` piu' vecchio di cosi' e' orfano (il processo e' caduto fra il commit e `coda.add`):
 * non blocca piu' il tenant e si puo' ricalcolare o scartare. Sta sopra i rinvii del job
 * (10 x 30 s), che non aggiornano `updated_at`.
 */
export const ORFANA_DOPO_MINUTI = 15

const STATI_ATTIVI = ['IN_CODA', 'IN_CORSO', 'IN_DEFINITIVA'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHIAVI_FILTRI_ID = ['clienteIds', 'contrattoIds', 'categoriaIds', 'registroIvaIds'] as const

const elaborazioneNonTrovata = () =>
  new NotFoundException({
    error: 'ELABORAZIONE_NON_TROVATA',
    message: 'Elaborazione non trovata.',
  })
const elaborazioneInCorso = () =>
  new ConflictException({
    error: 'ELABORAZIONE_IN_CORSO',
    message: "C'è già un'elaborazione in corso: attendi che finisca o scartala.",
  })
const versioneSuperata = () =>
  new ConflictException({
    error: 'VERSIONE_SUPERATA',
    message: "L'elaborazione è cambiata nel frattempo: ricarica per vedere i dati aggiornati.",
  })
const anteprimaSuperata = () =>
  new ConflictException({
    error: 'ANTEPRIMA_SUPERATA',
    message: "I dati sono cambiati dopo l'anteprima: ricalcola per vedere i documenti aggiornati.",
  })
const giaInDefinitiva = (messaggio: string) =>
  new ConflictException({ error: 'ELABORAZIONE_GIA_IN_DEFINITIVA', message: messaggio })

function periodoNonValido(message: string): BadRequestException {
  return new BadRequestException({ error: 'PERIODO_NON_VALIDO', message })
}

interface RigaElaborazione {
  id: string
  stato: StatoElaborazione
  createdAt: string
  periodoDal: string
  periodoAl: string
  dataDocumento: string
  raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'
  includiArretrati: boolean
  filtri: FiltriElaborazione | null
  impronta: string | null
  versione: number
  erroriGenerali: string[]
  esito: unknown
  erroreTecnico: string | null
  riepilogo: Partial<RiepilogoElaborazione> | null
}

const vistaErrore = (s: Segnalazione<ErroreDocumento | ErroreGenerale>): SegnalazioneVista => ({
  codice: s.codice,
  messaggio: MESSAGGI_ERRORE[s.codice] ?? s.codice,
  ...(s.dettaglio !== undefined && s.dettaglio !== null ? { dettaglio: s.dettaglio } : {}),
})

/** `esito` e' scritto dal job della definitiva (`{ codice, differenze?, ultimaData? }`). */
function leggiErrore(esito: unknown): ElaborazioneDettaglio['errore'] {
  if (esito === null || typeof esito !== 'object') return null
  const e = esito as { codice?: unknown; differenze?: unknown; ultimaData?: unknown }
  if (typeof e.codice !== 'string') return null
  return {
    codice: e.codice,
    ...(e.differenze !== undefined && e.differenze !== null
      ? { differenze: e.differenze as NonNullable<ElaborazioneDettaglio['errore']>['differenze'] }
      : {}),
    ...(typeof e.ultimaData === 'string' ? { ultimaData: e.ultimaData } : {}),
  }
}

const COLONNE = Prisma.sql`
  id::text AS id, stato::text AS stato,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  periodo_dal::text AS "periodoDal", periodo_al::text AS "periodoAl",
  data_documento::text AS "dataDocumento", raggruppamento::text AS raggruppamento,
  includi_arretrati AS "includiArretrati", filtri, impronta, versione::int AS versione,
  COALESCE(errori_generali, ARRAY[]::text[]) AS "erroriGenerali", esito,
  errore_tecnico AS "erroreTecnico", riepilogo`

function riga(r: RigaElaborazione): ElaborazioneRiga {
  const p = r.riepilogo ?? {}
  return {
    id: r.id,
    stato: r.stato,
    createdAt: r.createdAt,
    periodoDal: r.periodoDal,
    periodoAl: r.periodoAl,
    dataDocumento: r.dataDocumento,
    documenti: p.documenti ?? 0,
    totale: p.totale ?? '0.00',
    errori: p.errori ?? 0,
    avvisi: p.avvisi ?? 0,
  }
}

@Injectable()
export class ElaborazioniService {
  /** Orologio sostituibile nei test (la data «di oggi» dell'avvio e' quella italiana). */
  orologio: () => Date = () => new Date()

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentiFattura: DocumentiFatturaService,
    @InjectQueue(CODA_FATTURAZIONE) private readonly coda: Queue
  ) {}

  /** 400 `DATA_FUTURA`, `PERIODO_NON_VALIDO`, `CEDENTE_INCOMPLETO`; 409 `ELABORAZIONE_IN_CORSO`. */
  async avvia(
    tenantId: string,
    utenteId: string,
    p: ParametriElaborazione
  ): Promise<{ id: string }> {
    this.validaParametri(p)
    const filtri = this.puliscifiltri(p.filtri)
    const id = await nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const cedente = await leggiCedenteVista(tx, tenantId)
          if (!(cedente.completo && cedenteNormalizzabile(cedente))) {
            throw new BadRequestException({
              error: 'CEDENTE_INCOMPLETO',
              message: MESSAGGI_ERRORE.CEDENTE_INCOMPLETO,
            })
          }
          // Lettura semplice (Q12): l'indice unico parziale copre solo IN_CORSO e IN_DEFINITIVA,
          // quindi due avvii nella stessa finestra passano entrambi e li risolve il job.
          await this.rifiutaSeAltraAttiva(tx, tenantId, null)
          const nuovoId = (
            await tx.$queryRaw<{ id: string }[]>`SELECT gen_random_uuid()::text AS id`
          )[0].id
          const jobId = idJobFatturazione({
            tipo: 'anteprima',
            elaborazioneId: nuovoId,
            versione: 1,
          })
          await tx.$executeRaw`
            INSERT INTO elaborazioni_fatturazione
              (id, tenant_id, stato, periodo_dal, periodo_al, data_documento, filtri, raggruppamento,
               includi_arretrati, job_id, avviata_da, updated_at)
            VALUES (${nuovoId}::uuid, ${tenantId}::uuid, 'IN_CODA', ${p.periodoDal}::date,
                    ${p.periodoAl}::date, ${p.dataDocumento}::date, ${JSON.stringify(filtri)}::jsonb,
                    ${p.raggruppamento}::raggruppamento_fatturazione, ${p.includiArretrati}::boolean,
                    ${jobId}, ${utenteId}::uuid, now())`
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'ELABORAZIONE_FATTURAZIONE_AVVIATA',
              description: 'Elaborazione di fatturazione avviata',
              metadata: {
                elaborazioneId: nuovoId,
                periodoDal: p.periodoDal,
                periodoAl: p.periodoAl,
                dataDocumento: p.dataDocumento,
                raggruppamento: p.raggruppamento,
              } as Prisma.InputJsonValue,
            },
          })
          return nuovoId
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    )
    await this.accoda(tenantId, id, 1)
    return { id }
  }

  async lista(
    tenantId: string,
    q: { pagina: number; dimensione: number; stato?: StatoElaborazione }
  ): Promise<Pagina<ElaborazioneRiga>> {
    this.validaPagina(q.pagina, q.dimensione)
    if (q.stato !== undefined && !(STATI_ELABORAZIONE as readonly string[]).includes(q.stato)) {
      throw new BadRequestException({
        error: 'FILTRO_NON_VALIDO',
        message: 'Lo stato del filtro non è valido.',
      })
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const dove =
          q.stato === undefined
            ? Prisma.sql`tenant_id = ${tenantId}::uuid`
            : Prisma.sql`tenant_id = ${tenantId}::uuid AND stato = ${q.stato}::stato_elaborazione_fatturazione`
        const [{ totale }] = await tx.$queryRaw<{ totale: number }[]>`
          SELECT count(*)::int AS totale FROM elaborazioni_fatturazione WHERE ${dove}`
        const righe = await tx.$queryRaw<RigaElaborazione[]>`
          SELECT ${COLONNE} FROM elaborazioni_fatturazione WHERE ${dove}
          ORDER BY created_at DESC, id
          LIMIT ${q.dimensione}::int OFFSET ${(q.pagina - 1) * q.dimensione}::int`
        return {
          elementi: righe.map(riga),
          totale,
          pagina: q.pagina,
          dimensione: q.dimensione,
        }
      })
    )
  }

  async dettaglio(tenantId: string, id: string): Promise<ElaborazioneDettaglio> {
    if (!UUID.test(id)) throw elaborazioneNonTrovata()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const [r] = await tx.$queryRaw<RigaElaborazione[]>`
          SELECT ${COLONNE} FROM elaborazioni_fatturazione
          WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
        if (!r) throw elaborazioneNonTrovata()
        // Lettura semplice, nessun lock (S5); l'azienda senza riga ha le definitive spente.
        const [i] = await tx.$queryRaw<{ attive: boolean }[]>`
          SELECT definitive_attive AS attive FROM impostazioni_fatturazione
          WHERE tenant_id = ${tenantId}::uuid`
        const p = r.riepilogo ?? {}
        return {
          ...riga(r),
          raggruppamento: r.raggruppamento,
          includiArretrati: r.includiArretrati,
          filtri: r.filtri ?? {},
          impronta: r.impronta,
          versione: r.versione,
          definitiveAttive: i?.attive ?? false,
          // Dal riepilogo (con il dettaglio); la colonna, che ha solo i codici, e' il ripiego.
          erroriGenerali: (
            p.erroriGenerali ??
            r.erroriGenerali.map(codice => ({ codice: codice as ErroreGenerale }))
          ).map(vistaErrore),
          erroriPeriodo: p.erroriPeriodo ?? [],
          numerazionePrevista: p.numerazionePrevista ?? [],
          totaliPerRegistro: p.totaliPerRegistro ?? [],
          documentiNonGenerati: (p.documentiNonGenerati ?? []).map(d => ({
            ...d,
            errori: d.errori.map(vistaErrore),
          })),
          errore: leggiErrore(r.esito),
          erroreTecnico: r.erroreTecnico,
        }
      })
    )
  }

  async documenti(
    tenantId: string,
    id: string,
    q: { pagina: number; dimensione: number; conErrori?: boolean }
  ): Promise<Pagina<DocumentoRiga>> {
    this.validaPagina(q.pagina, q.dimensione)
    if (!UUID.test(id)) throw elaborazioneNonTrovata()
    const esiste = await nelContestoTenant(
      tenantId,
      () =>
        this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM elaborazioni_fatturazione
        WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
    )
    if (esiste.length === 0) throw elaborazioneNonTrovata()
    return this.documentiFattura.lista(tenantId, {
      elaborazioneId: id,
      conErrori: q.conErrori,
      pagina: q.pagina,
      dimensione: q.dimensione,
    })
  }

  /** 409 `ELABORAZIONE_IN_CORSO` sincrono se il tenant ha un'altra elaborazione attiva (Q12). */
  async ricalcola(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    const nuovaVersione = await this.scriviStato(tenantId, id, versione, async (tx, e) => {
      if (e.stato === 'IN_DEFINITIVA') {
        throw giaInDefinitiva("L'elaborazione è già in definitiva: non si può ricalcolare.")
      }
      if (e.stato === 'DEFINITIVA') {
        throw giaInDefinitiva("L'elaborazione è definitiva: non si può ricalcolare.")
      }
      if (e.stato === 'IN_CORSO') throw elaborazioneInCorso()
      if (e.stato === 'IN_CODA' && !(await this.eOrfana(tx, tenantId, id))) {
        throw elaborazioneInCorso()
      }
      if (e.stato === 'SCARTATA') throw statoNonValido('ricalcolare')
      await this.rifiutaSeAltraAttiva(tx, tenantId, id)
      const nuova = e.versione + 1
      const jobId = idJobFatturazione({ tipo: 'anteprima', elaborazioneId: id, versione: nuova })
      // `esito` si azzera a ogni nuovo calcolo (Q17); le bozze vecchie le sostituisce il job.
      await tx.$executeRaw`
        UPDATE elaborazioni_fatturazione
        SET stato = 'IN_CODA', versione = ${nuova}::int, job_id = ${jobId}, esito = NULL,
            errore_tecnico = NULL, riepilogo = NULL, impronta = NULL, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
      await this.audit(tx, tenantId, utenteId, 'ELABORAZIONE_FATTURAZIONE_RICALCOLATA', id)
      return nuova
    })
    await this.accoda(tenantId, id, nuovaVersione)
  }

  /** Risponde `{ id }`: il frontend (Task 14) lo usa per rileggere. */
  async scarta(
    tenantId: string,
    utenteId: string,
    id: string,
    versione: number
  ): Promise<{ id: string }> {
    await this.scriviStato(tenantId, id, versione, async (tx, e) => {
      if (e.stato === 'IN_DEFINITIVA') {
        throw giaInDefinitiva("L'elaborazione è già in definitiva: non si può scartare.")
      }
      if (e.stato === 'DEFINITIVA') {
        throw giaInDefinitiva("L'elaborazione è definitiva: non si può scartare.")
      }
      if (e.stato === 'IN_CORSO') throw elaborazioneInCorso()
      if (e.stato === 'IN_CODA' && !(await this.eOrfana(tx, tenantId, id))) {
        throw elaborazioneInCorso()
      }
      if (e.stato === 'SCARTATA') throw statoNonValido('scartare')
      await tx.$executeRaw`
        DELETE FROM documenti_fattura
        WHERE tenant_id = ${tenantId}::uuid AND elaborazione_id = ${id}::uuid AND stato = 'BOZZA'`
      await tx.$executeRaw`
        UPDATE elaborazioni_fatturazione
        SET stato = 'SCARTATA', versione = ${e.versione + 1}::int, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
      await this.audit(tx, tenantId, utenteId, 'ELABORAZIONE_FATTURAZIONE_SCARTATA', id)
      return e.versione + 1
    })
    return { id }
  }

  /**
   * Esclude (o riammette) una bozza dalla definitiva. L'elaborazione si blocca `FOR UPDATE` per
   * prima: cosi' non corre con la definitiva (scansione P41). 409 `ELABORAZIONE_GIA_IN_DEFINITIVA`
   * se non e' `ANTEPRIMA_PRONTA`.
   */
  async escludi(
    tenantId: string,
    id: string,
    documentoId: string,
    escluso: boolean
  ): Promise<DocumentoRiga> {
    if (!UUID.test(id)) throw elaborazioneNonTrovata()
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const e = await bloccaElaborazione(tx, tenantId, id)
          if (e.stato !== 'ANTEPRIMA_PRONTA') {
            throw giaInDefinitiva(
              e.stato === 'IN_DEFINITIVA' || e.stato === 'DEFINITIVA'
                ? "L'elaborazione è già in definitiva: i documenti non si possono più escludere."
                : "L'anteprima non è pronta: i documenti non si possono escludere."
            )
          }
          if (!UUID.test(documentoId)) throw documentoNonTrovato()
          const [d] = await tx.$queryRaw<{ stato: string }[]>`
            SELECT stato::text AS stato FROM documenti_fattura
            WHERE tenant_id = ${tenantId}::uuid AND id = ${documentoId}::uuid
              AND elaborazione_id = ${id}::uuid
            FOR UPDATE`
          if (!d) throw documentoNonTrovato()
          if (d.stato !== 'BOZZA') {
            throw new ConflictException({
              error: 'DOCUMENTO_NON_IN_BOZZA',
              message: 'Solo un documento in bozza si può escludere o riammettere.',
            })
          }
          await tx.$executeRaw`
            UPDATE documenti_fattura
            SET escluso_da_definitiva = ${escluso}::boolean, versione = versione + 1, updated_at = now()
            WHERE tenant_id = ${tenantId}::uuid AND id = ${documentoId}::uuid`
          const [vista] = await this.documentiFattura.righeInTx(tx, tenantId, [documentoId])
          return vista
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    )
  }

  /**
   * Richiesta della definitiva (spec §5.4, rotta `POST /:id/definitiva`): transazione breve e
   * SINCRONA, perche' i codici HTTP non possono venire da un job (scansione P36). Controlla, in
   * quest'ordine: stato (il secondo clic riceve `ELABORAZIONE_GIA_IN_DEFINITIVA`, prima della
   * versione), versione, impronta, interruttore delle definitive, errori generali bloccanti
   * (decisione 24), data anteriore all'ultima fattura (Q15), documenti da numerare (1-500).
   * Poi porta l'elaborazione a `IN_DEFINITIVA` con la versione + 1 e il `job_id`, e DOPO il commit
   * accoda il job `definitiva` con quell'id (Q5: un rilancio dopo un fallimento ha una versione
   * nuova e quindi un id nuovo). Risponde `{ id }` (202 dalla rotta).
   */
  async chiediDefinitiva(
    tenantId: string,
    utenteId: string,
    id: string,
    b: { impronta: string; versione: number }
  ): Promise<{ id: string }> {
    if (!UUID.test(id)) throw elaborazioneNonTrovata()
    const nuovaVersione = await nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const e = await bloccaElaborazione(tx, tenantId, id)
          // a. Il secondo clic: prima della versione.
          if (e.stato === 'IN_DEFINITIVA' || e.stato === 'DEFINITIVA') {
            throw giaInDefinitiva(
              e.stato === 'DEFINITIVA'
                ? "L'elaborazione è già definitiva."
                : "L'elaborazione è già in definitiva: attendi che finisca."
            )
          }
          if (e.stato !== 'ANTEPRIMA_PRONTA') throw elaborazioneInCorso()
          if (e.versione !== b.versione) throw versioneSuperata()
          const [r] = await tx.$queryRaw<
            { impronta: string | null; erroriGenerali: string[]; dataDocumento: string }[]
          >`
            SELECT impronta, COALESCE(errori_generali, ARRAY[]::text[]) AS "erroriGenerali",
                   data_documento::text AS "dataDocumento"
            FROM elaborazioni_fatturazione
            WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
          if (r.impronta === null || r.impronta !== b.impronta) throw anteprimaSuperata()
          // b. Interruttore (lettura semplice, nessun lock).
          if (!(await definitiveAttive(tx, tenantId))) {
            throw new ConflictException({
              error: 'DEFINITIVE_NON_ATTIVE',
              message: 'Le definitive non sono ancora attive per questa azienda.',
            })
          }
          // c. Errori generali bloccanti (decisione 24).
          const bloccante = primoErroreBloccante(r.erroriGenerali)
          if (bloccante !== null) {
            throw new ConflictException({
              error: bloccante,
              message: MESSAGGI_ERRORE[bloccante],
            })
          }
          const candidati = await leggiCandidati(tx, tenantId, id)
          const ultimaData = await ultimaDataSuperiore(tx, tenantId, candidati, r.dataDocumento)
          if (ultimaData !== null) {
            throw new ConflictException({
              error: 'DATA_ANTERIORE_ULTIMA_FATTURA',
              message: MESSAGGI_ERRORE.DATA_ANTERIORE_ULTIMA_FATTURA,
              details: { ultimaData },
            })
          }
          // d. Documenti da numerare.
          if (candidati.length === 0) {
            throw new ConflictException({
              error: 'NESSUN_DOCUMENTO_DEFINIBILE',
              message: 'Nessun documento è definibile: sono tutti esclusi o hanno errori.',
            })
          }
          if (candidati.length > TETTO_DOCUMENTI_DEFINITIVA) {
            throw new BadRequestException({
              error: 'TROPPI_DOCUMENTI',
              message: `Al massimo ${TETTO_DOCUMENTI_DEFINITIVA} documenti per volta: dividi l'elaborazione con i filtri.`,
            })
          }
          // e. IN_DEFINITIVA con la versione nuova. 23505 dell'indice unico (§4.2): un'altra
          // elaborazione del tenant e' `IN_CORSO` o `IN_DEFINITIVA`.
          const nuova = e.versione + 1
          const jobId = idJobFatturazione({
            tipo: 'definitiva',
            elaborazioneId: id,
            versione: nuova,
          })
          await tx.$executeRaw`
            UPDATE elaborazioni_fatturazione
            SET stato = 'IN_DEFINITIVA', versione = ${nuova}::int, job_id = ${jobId}, esito = NULL,
                errore_tecnico = NULL, updated_at = now()
            WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'ELABORAZIONE_FATTURAZIONE_DEFINITIVA_RICHIESTA',
              description: 'Definitiva di fatturazione richiesta',
              metadata: {
                elaborazioneId: id,
                documenti: candidati.length,
              } as Prisma.InputJsonValue,
            },
          })
          return nuova
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => {
          if (eViolazioneUnica(err)) throw elaborazioneInCorso()
          return traduciErrorePrisma(err, ENTITA, {})
        })
    )
    await this.accodaDefinitiva(tenantId, utenteId, id, nuovaVersione)
    return { id }
  }

  // -------------------------------------------------------------------------------------------

  /**
   * Transazione di scrittura su un'elaborazione: blocco `FOR UPDATE` per primo, confronto della
   * versione, poi `fn`. Restituisce quello che restituisce `fn`.
   */
  private async scriviStato<R>(
    tenantId: string,
    id: string,
    versione: number,
    fn: (
      tx: Prisma.TransactionClient,
      e: { stato: StatoElaborazione; versione: number }
    ) => Promise<R>
  ): Promise<R> {
    if (!UUID.test(id)) throw elaborazioneNonTrovata()
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const e = await bloccaElaborazione(tx, tenantId, id)
          if (e.versione !== versione) throw versioneSuperata()
          return fn(tx, e)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    )
  }

  private async eOrfana(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<boolean> {
    const [r] = await tx.$queryRaw<{ orfana: boolean }[]>`
      SELECT (updated_at < now() - make_interval(mins => ${ORFANA_DOPO_MINUTI}::int)) AS orfana
      FROM elaborazioni_fatturazione WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
    return r?.orfana === true
  }

  private async rifiutaSeAltraAttiva(
    tx: Prisma.TransactionClient,
    tenantId: string,
    escludiId: string | null
  ): Promise<void> {
    const attive = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM elaborazioni_fatturazione
      WHERE tenant_id = ${tenantId}::uuid AND stato::text = ANY(${[...STATI_ATTIVI]}::text[])
        AND NOT (stato = 'IN_CODA'
                 AND updated_at < now() - make_interval(mins => ${ORFANA_DOPO_MINUTI}::int))
        ${escludiId === null ? Prisma.empty : Prisma.sql`AND id <> ${escludiId}::uuid`}
      LIMIT 1`
    if (attive.length > 0) throw elaborazioneInCorso()
  }

  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    action: string,
    elaborazioneId: string
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action,
        description: 'Elaborazione di fatturazione',
        metadata: { elaborazioneId } as Prisma.InputJsonValue,
      },
    })
  }

  /**
   * Accoda il job di anteprima dopo il commit. Se la coda non risponde l'elaborazione non deve
   * restare `IN_CODA` per sempre (bloccherebbe il tenant): diventa `FALLITA`.
   */
  private async accoda(tenantId: string, elaborazioneId: string, versione: number): Promise<void> {
    const dati: JobFatturazione = { tenantId, elaborazioneId, tipo: 'anteprima', versione }
    try {
      await this.coda.add('anteprima', dati, {
        jobId: idJobFatturazione(dati),
        attempts: 2,
        backoff: { type: 'fixed', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800 },
      })
    } catch {
      await segnaFallita(
        this.prisma,
        tenantId,
        elaborazioneId,
        "Impossibile accodare l'elaborazione",
        versione
      )
      throw new ServiceUnavailableException({
        error: 'CODA_NON_DISPONIBILE',
        message: "Non è stato possibile avviare l'elaborazione: riprova fra poco.",
      })
    }
  }

  /**
   * Accoda il job della definitiva dopo il commit, senza ritentativi (`attempts: 1`, spec §9). Se
   * la coda non risponde l'elaborazione non deve restare `IN_DEFINITIVA`: torna `ANTEPRIMA_PRONTA`.
   */
  private async accodaDefinitiva(
    tenantId: string,
    utenteId: string,
    elaborazioneId: string,
    versione: number
  ): Promise<void> {
    const dati: JobFatturazione = {
      tenantId,
      elaborazioneId,
      tipo: 'definitiva',
      versione,
      utenteId,
    }
    const jobId = idJobFatturazione(dati)
    try {
      await this.coda.add('definitiva', dati, {
        jobId,
        attempts: 1,
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800 },
      })
    } catch {
      await riportaAnteprimaPronta(
        this.prisma,
        tenantId,
        elaborazioneId,
        { versione, jobId },
        { esito: null, erroreTecnico: 'Impossibile accodare la definitiva' }
      )
      throw new ServiceUnavailableException({
        error: 'CODA_NON_DISPONIBILE',
        message: 'Non è stato possibile avviare la definitiva: riprova fra poco.',
      })
    }
  }

  private validaPagina(pagina: number, dimensione: number): void {
    if (
      !Number.isInteger(pagina) ||
      pagina < 1 ||
      !Number.isInteger(dimensione) ||
      dimensione < 1 ||
      dimensione > DIMENSIONE_MASSIMA_PAGINA ||
      pagina > MAX_PAGINA
    ) {
      throw new BadRequestException({
        error: 'PAGINAZIONE_NON_VALIDA',
        message: `La pagina va da 1 a ${MAX_PAGINA} e la dimensione da 1 a ${DIMENSIONE_MASSIMA_PAGINA}.`,
      })
    }
  }

  private validaParametri(p: ParametriElaborazione): void {
    for (const d of [p.periodoDal, p.periodoAl, p.dataDocumento]) {
      if (typeof d !== 'string' || !eDataIso(d)) {
        throw periodoNonValido('Le date devono essere nel formato AAAA-MM-GG.')
      }
    }
    if (p.periodoDal > p.periodoAl) {
      throw periodoNonValido('Il periodo non è valido: la data iniziale segue quella finale.')
    }
    if (p.periodoDal.slice(0, 4) !== p.periodoAl.slice(0, 4)) {
      throw periodoNonValido("Il periodo non può attraversare l'anno solare.")
    }
    if (p.dataDocumento < p.periodoAl) {
      throw periodoNonValido('La data del documento non può precedere la fine del periodo.')
    }
    // «Oggi» e' il giorno italiano: alle 00:30 di Roma l'UTC e' ancora il giorno prima.
    if (p.dataDocumento > oggiRoma(this.orologio())) {
      throw new BadRequestException({
        error: 'DATA_FUTURA',
        message: MESSAGGI_ERRORE.DATA_FUTURA,
      })
    }
  }

  /** Tiene solo le chiavi note; gli id devono essere UUID (il DTO del Task 25a li ricontrolla). */
  private puliscifiltri(f: FiltriElaborazione | undefined): FiltriElaborazione {
    const pulito: FiltriElaborazione = {}
    for (const chiave of CHIAVI_FILTRI_ID) {
      const valori = f?.[chiave]
      if (valori === undefined) continue
      if (!Array.isArray(valori) || valori.some(v => typeof v !== 'string' || !UUID.test(v))) {
        throw new BadRequestException({
          error: 'FILTRO_NON_VALIDO',
          message: 'Un filtro per identificativo non è valido.',
        })
      }
      if (valori.length > 0) pulito[chiave] = valori
    }
    const tipi = f?.tipiAddebito
    if (tipi !== undefined) {
      if (!Array.isArray(tipi) || tipi.some(t => typeof t !== 'string' || t.length > 10)) {
        throw new BadRequestException({
          error: 'FILTRO_NON_VALIDO',
          message: 'Il filtro per tipo di addebito non è valido.',
        })
      }
      if (tipi.length > 0) pulito.tipiAddebito = tipi
    }
    return pulito
  }
}

function statoNonValido(azione: string): never {
  throw new ConflictException({
    error: 'STATO_ELABORAZIONE_NON_VALIDO',
    message: `L'elaborazione non è in uno stato in cui si possa ${azione}.`,
  })
}

function documentoNonTrovato(): NotFoundException {
  return new NotFoundException({
    error: 'DOCUMENTO_NON_TROVATO',
    message: 'Documento non trovato.',
  })
}
