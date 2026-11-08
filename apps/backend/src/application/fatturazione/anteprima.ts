// Anteprima di un'elaborazione di fatturazione (fase 4.4b1, Task 18, spec §5.3): selezione in
// `REPEATABLE READ`, calcolo di dominio puro, poi UNA transazione che sostituisce le bozze
// dell'elaborazione e la porta a `ANTEPRIMA_PRONTA`.
//
// Le bozze NON toccano mai i legami ne' i marcatori: sono solo righe di documento. Ogni riga scrive
// `riga_legame_id = NULL` anche se il calcolo conosce la riga del legame (seguiti 4.4a, I1, Q1, Q2):
// chi deve risalire alla riga del legame usa `(legame_id, riga_addebito_id)`.
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type {
  ErroreDocumento,
  ErroreGenerale,
  Segnalazione,
} from '../../domain/fatturazione/codici'
import {
  calcolaDocumento,
  type DocumentoCalcolato,
} from '../../domain/fatturazione/calcola-documento'
import { improntaElaborazione } from '../../domain/fatturazione/impronta'
import type { FotografiaSalvata } from '../../domain/fatturazione/tipi'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { impostaTimeoutLock } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { bloccaElaborazione } from './lock-fatturazione'
import { leggiCodiciRicavo } from './codici-ricavo'
import { conJoinLineari } from './piani-query'
import {
  chiaveNumerazione,
  numeroTesto,
  suffissiDelleSerie,
  type CoppiaNumerazione,
} from './numerazione'
import {
  selezionaElaborazione,
  type DocumentoSelezionato,
  type FiltriElaborazione,
  type ParametriElaborazione,
  type SelezioneElaborazione,
} from './selezione-fatturazione'

/**
 * Forma di `elaborazioni_fatturazione.riepilogo` (Q17, Q11), con i nomi del modello del frontend.
 * `dettaglio()` mappa le `Segnalazione` in `SegnalazioneVista` col messaggio.
 */
export interface RiepilogoElaborazione {
  /**
   * I conteggi sono PER DOCUMENTO, non per segnalazione. `documenti`: le bozze scritte (quelli
   * senza registro non lo sono: stanno in `documentiNonGenerati`). `errori`: bozze con almeno un
   * errore PIU' i documenti non generati, quindi puo' superare `documenti`; gli errori generali
   * dell'elaborazione (`erroriGenerali`) NON ci sono. `avvisi`: bozze con almeno un avviso.
   * `totale`: somma di tutte le bozze, anche quelle con errori che non saranno emesse.
   */
  documenti: number
  totale: string
  errori: number
  avvisi: number
  /** Errori generali con il loro dettaglio (la colonna `errori_generali` ha solo i codici). */
  erroriGenerali: Segnalazione<ErroreGenerale>[]
  erroriPeriodo: SelezioneElaborazione['erroriPeriodo']
  numerazionePrevista: { registroIvaId: string; codiceRegistro: string; da: string; a: string }[]
  totaliPerRegistro: { registroIvaId: string; imponibile: string; iva: string; totale: string }[]
  documentiNonGenerati: {
    contrattoId: string
    contrattoNumero: string
    clienteId: string
    denominazione: string
    errori: Segnalazione<ErroreDocumento>[]
  }[]
  /** Istante (ISO, UTC) del passaggio a `ANTEPRIMA_PRONTA`: serve alle differenze del Task 19. */
  prontaIl: string
}

/** Un'altra elaborazione dello stesso tenant e' `IN_CORSO` o `IN_DEFINITIVA` (23505 sull'indice unico parziale). */
export class ElaborazioneAttivaError extends Error {
  constructor() {
    super("Un'altra elaborazione era in corso")
    this.name = 'ElaborazioneAttivaError'
  }
}

/** L'elaborazione non esiste per questo tenant (o e' di un'altra azienda: la RLS non la mostra). */
export class ElaborazioneNonTrovataError extends Error {
  constructor() {
    super('Elaborazione non trovata')
    this.name = 'ElaborazioneNonTrovataError'
  }
}

export const MESSAGGIO_ALTRA_ELABORAZIONE = "Un'altra elaborazione era in corso"
export const MESSAGGIO_ERRORE_TECNICO_ANTEPRIMA = "Errore tecnico durante il calcolo dell'anteprima"

const OPZIONI_LETTURA = { timeout: 120_000, maxWait: 30_000 } as const
const OPZIONI_SCRITTURA = { timeout: 120_000, maxWait: 30_000 } as const
const BLOCCO_RIGHE = 500

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v)
const dataUtc = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)
const distinti = <T>(l: readonly T[]): T[] => [...new Set(l)]

function inBlocchi<T>(l: readonly T[], n: number): T[][] {
  const blocchi: T[][] = []
  for (let i = 0; i < l.length; i += n) blocchi.push(l.slice(i, i + n))
  return blocchi
}

/** 23505: il raw di Prisma lo riporta come P2010 con `meta.code`, il client tipizzato come P2002. */
export function eViolazioneUnica(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (err.code === 'P2002') return true
  return err.code === 'P2010' && (err.meta as { code?: unknown } | undefined)?.code === '23505'
}

// ---------------------------------------------------------------------------------------------
// Calcolo puro
// ---------------------------------------------------------------------------------------------

export interface BozzaCalcolata {
  id: string
  selezionato: DocumentoSelezionato
  calcolato: DocumentoCalcolato
}

const ESIGIBILITA_DB = { I: 'IMMEDIATA', D: 'DIFFERITA', S: 'SCISSIONE' } as const

/**
 * Calcola i documenti della selezione. Un documento senza registro IVA non diventa bozza (Q3):
 * va in `documentiNonGenerati` con le sue segnalazioni. Funzione pura, nessun database.
 */
export function calcolaBozze(documenti: readonly DocumentoSelezionato[]): {
  bozze: BozzaCalcolata[]
  nonGenerati: RiepilogoElaborazione['documentiNonGenerati']
} {
  const bozze: BozzaCalcolata[] = []
  const nonGenerati: RiepilogoElaborazione['documentiNonGenerati'] = []
  for (const d of documenti) {
    const calcolato = calcolaDocumento(d.input)
    if (d.registroIvaId === null) {
      const errori = [...calcolato.errori]
      if (!errori.some(e => e.codice === 'SENZA_REGISTRO_IVA')) {
        errori.push({ codice: 'SENZA_REGISTRO_IVA' })
      }
      nonGenerati.push({
        contrattoId: d.contrattoId,
        contrattoNumero: d.contrattoNumero,
        clienteId: d.clienteFatturazioneId,
        denominazione: d.denominazione,
        errori,
      })
      continue
    }
    bozze.push({ id: randomUUID(), selezionato: d, calcolato })
  }
  return { bozze, nonGenerati }
}

/** Stato di una numerazione, senza lock (solo informazione per la numerazione prevista). */
export interface ContestoNumerazione {
  codiciRegistro: ReadonlyMap<string, string>
  ultimoNumero: ReadonlyMap<string, number>
  suffissi: ReadonlyMap<string, string | null>
}

const sommaDecimali = (valori: readonly string[]): Prisma.Decimal =>
  valori.reduce((s, v) => s.plus(D(v)), new Prisma.Decimal(0))

/** Riepilogo dell'anteprima (senza `prontaIl`, che si legge dal database al passaggio di stato). */
export function costruisciRiepilogo(
  bozze: readonly BozzaCalcolata[],
  nonGenerati: RiepilogoElaborazione['documentiNonGenerati'],
  erroriPeriodo: SelezioneElaborazione['erroriPeriodo'],
  anno: number,
  contesto: ContestoNumerazione,
  erroriGenerali: SelezioneElaborazione['erroriGenerali'] = [],
  /** `DocumentoSelezionato.chiave` dei documenti esclusi dalla definitiva: non si numerano. */
  esclusi: ReadonlySet<string> = new Set()
): Omit<RiepilogoElaborazione, 'prontaIl'> {
  const codice = (registroIvaId: string): string => contesto.codiciRegistro.get(registroIvaId) ?? ''
  const perRegistro = new Map<string, BozzaCalcolata[]>()
  for (const b of bozze) {
    const id = b.selezionato.registroIvaId as string
    perRegistro.set(id, [...(perRegistro.get(id) ?? []), b])
  }
  const registri = [...perRegistro.keys()].sort((a, b) =>
    codice(a) === codice(b) ? (a < b ? -1 : 1) : codice(a) < codice(b) ? -1 : 1
  )

  const numerazionePrevista: RiepilogoElaborazione['numerazionePrevista'] = []
  for (const registroIvaId of registri) {
    // Si numerano i documenti senza errori e non esclusi (all'anteprima nessuno e' escluso).
    const numerabili = perRegistro
      .get(registroIvaId)!
      .filter(b => b.calcolato.errori.length === 0 && !esclusi.has(b.selezionato.chiave))
    if (numerabili.length === 0) continue
    const chiave = chiaveNumerazione(registroIvaId, anno)
    const ultimo = contesto.ultimoNumero.get(chiave) ?? 0
    const suffisso = contesto.suffissi.get(chiave) ?? null
    numerazionePrevista.push({
      registroIvaId,
      codiceRegistro: codice(registroIvaId),
      da: numeroTesto(ultimo + 1, suffisso),
      a: numeroTesto(ultimo + numerabili.length, suffisso),
    })
  }

  const totaliPerRegistro = registri.map(registroIvaId => {
    const documenti = perRegistro.get(registroIvaId)!
    return {
      registroIvaId,
      imponibile: sommaDecimali(documenti.map(b => b.calcolato.totaleImponibile)).toFixed(2),
      iva: sommaDecimali(documenti.map(b => b.calcolato.totaleIva)).toFixed(2),
      totale: sommaDecimali(documenti.map(b => b.calcolato.totaleDocumento)).toFixed(2),
    }
  })

  return {
    documenti: bozze.length,
    totale: sommaDecimali(bozze.map(b => b.calcolato.totaleDocumento)).toFixed(2),
    errori: bozze.filter(b => b.calcolato.errori.length > 0).length + nonGenerati.length,
    avvisi: bozze.filter(b => b.calcolato.avvisi.length > 0).length,
    erroriGenerali,
    erroriPeriodo,
    numerazionePrevista,
    totaliPerRegistro,
    documentiNonGenerati: nonGenerati,
  }
}

// ---------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------

interface ElaborazioneLetta {
  stato: string
  versione: number
  periodoDal: string
  periodoAl: string
  dataDocumento: string
  filtri: FiltriElaborazione
  raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'
  includiArretrati: boolean
}

/**
 * Porta l'elaborazione a `IN_CORSO` e ne restituisce i parametri; `null` se il job non ha piu'
 * niente da fare (versione superata, stato che non e' ne' `IN_CODA` ne' `IN_CORSO`). Un secondo
 * tentativo dello stesso job trova `IN_CORSO` e lo accetta come proprio (Q30). Il passaggio e' una
 * transazione a se': un 23505 la abortisce e basta.
 */
async function portaInCorso(
  prisma: PrismaService,
  tenantId: string,
  elaborazioneId: string,
  versione: number | undefined
): Promise<ParametriElaborazione | null> {
  const [riga] = await prisma.$queryRaw<ElaborazioneLetta[]>`
    SELECT stato::text AS stato, versione, periodo_dal::text AS "periodoDal",
           periodo_al::text AS "periodoAl", data_documento::text AS "dataDocumento", filtri,
           raggruppamento::text AS raggruppamento, includi_arretrati AS "includiArretrati"
    FROM elaborazioni_fatturazione
    WHERE tenant_id = ${tenantId}::uuid AND id = ${elaborazioneId}::uuid`
  if (!riga) throw new ElaborazioneNonTrovataError()
  if (versione !== undefined && riga.versione !== versione) return null
  if (riga.stato !== 'IN_CODA' && riga.stato !== 'IN_CORSO') return null
  if (riga.stato === 'IN_CODA') {
    try {
      const passate = await prisma.$transaction(async tx => {
        await impostaTimeoutLock(tx)
        return tx.$executeRaw`
          UPDATE elaborazioni_fatturazione SET stato = 'IN_CORSO', updated_at = now()
          WHERE tenant_id = ${tenantId}::uuid AND id = ${elaborazioneId}::uuid
            AND stato = 'IN_CODA' AND versione = ${riga.versione}::int`
      })
      if (passate === 0) return null
    } catch (err) {
      if (eViolazioneUnica(err)) throw new ElaborazioneAttivaError()
      throw err
    }
  }
  return {
    periodoDal: riga.periodoDal,
    periodoAl: riga.periodoAl,
    dataDocumento: riga.dataDocumento,
    raggruppamento: riga.raggruppamento,
    includiArretrati: riga.includiArretrati,
    filtri: riga.filtri ?? {},
  }
}

/** Segna `FALLITA` (solo se ancora `IN_CODA` o `IN_CORSO`) con un messaggio fisso, senza dati personali. */
export async function segnaFallita(
  prisma: PrismaService,
  tenantId: string,
  elaborazioneId: string,
  messaggio: string,
  versione?: number
): Promise<void> {
  await nelContestoTenant(tenantId, () =>
    prisma.$transaction(
      tx => tx.$executeRaw`
        UPDATE elaborazioni_fatturazione
        SET stato = 'FALLITA', errore_tecnico = left(${messaggio}, 200), updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${elaborazioneId}::uuid
          AND stato IN ('IN_CODA', 'IN_CORSO')
          ${versione === undefined ? Prisma.empty : Prisma.sql`AND versione = ${versione}::int`}`
    )
  )
}

async function leggiContestoNumerazione(
  tx: Prisma.TransactionClient,
  tenantId: string,
  registroIds: readonly string[],
  anno: number
): Promise<ContestoNumerazione> {
  const codiciRegistro = new Map<string, string>()
  const ultimoNumero = new Map<string, number>()
  if (registroIds.length === 0) return { codiciRegistro, ultimoNumero, suffissi: new Map() }
  const registri = await tx.$queryRaw<{ id: string; codice: string }[]>`
    SELECT id::text AS id, codice FROM registri_iva
    WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${[...registroIds]}::uuid[])`
  for (const r of registri) codiciRegistro.set(r.id, r.codice)
  const numerazioni = await tx.$queryRaw<{ registroIvaId: string; ultimo: number }[]>`
    SELECT registro_iva_id::text AS "registroIvaId", ultimo_numero::int AS ultimo
    FROM numerazioni_fattura
    WHERE tenant_id = ${tenantId}::uuid AND anno = ${anno}::int
      AND registro_iva_id = ANY(${[...registroIds]}::uuid[])`
  for (const n of numerazioni) ultimoNumero.set(chiaveNumerazione(n.registroIvaId, anno), n.ultimo)
  const coppie: CoppiaNumerazione[] = registroIds.map(registroIvaId => ({ registroIvaId, anno }))
  return { codiciRegistro, ultimoNumero, suffissi: await suffissiDelleSerie(tx, tenantId, coppie) }
}

function fotografiaSalvata(b: BozzaCalcolata): FotografiaSalvata {
  return {
    ...b.selezionato.fotografia,
    segnalazioni: { errori: b.calcolato.errori, avvisi: b.calcolato.avvisi },
  }
}

async function scriviBozze(
  tx: Prisma.TransactionClient,
  tenantId: string,
  elaborazioneId: string,
  p: ParametriElaborazione,
  bozze: readonly BozzaCalcolata[]
): Promise<void> {
  const anno = Number(p.dataDocumento.slice(0, 4))
  const dataDocumento = dataUtc(p.dataDocumento)
  for (const blocco of inBlocchi(bozze, BLOCCO_RIGHE)) {
    await tx.documentoFattura.createMany({
      data: blocco.map(b => {
        const c = b.selezionato.input.contratto
        const destinatario = (c.codiceDestinatario ?? '').trim()
        const pec = (c.pec ?? '').trim()
        return {
          id: b.id,
          tenantId,
          elaborazioneId,
          stato: 'BOZZA' as const,
          tipoDocumento: b.calcolato.tipoDocumento,
          registroIvaId: b.selezionato.registroIvaId as string,
          anno,
          dataDocumento,
          clienteId: b.selezionato.clienteId,
          clienteFatturazioneId: b.selezionato.clienteFatturazioneId,
          contrattoId: b.selezionato.contrattoId,
          elencoId: p.raggruppamento === 'PER_ELENCO' ? b.selezionato.elencoId : null,
          periodoDal: dataUtc(b.selezionato.periodo.dal),
          periodoAl: dataUtc(b.selezionato.periodo.al),
          formatoTrasmissione: b.calcolato.formatoTrasmissione,
          codiceDestinatario: destinatario === '' ? null : destinatario.slice(0, 7),
          pecDestinatario: pec === '' ? null : pec.slice(0, 255),
          esigibilitaIva: ESIGIBILITA_DB[c.esigibilita],
          totaleImponibile: b.calcolato.totaleImponibile,
          totaleIva: b.calcolato.totaleIva,
          totaleDocumento: b.calcolato.totaleDocumento,
          nettoAPagare: b.calcolato.nettoAPagare,
          bolloDovuto: b.calcolato.bolloDovuto,
          importoBollo: b.calcolato.importoBollo,
          fotografia: fotografiaSalvata(b) as unknown as Prisma.InputJsonValue,
          errori: distinti(b.calcolato.errori.map(e => e.codice)),
          avvisi: distinti(b.calcolato.avvisi.map(a => a.codice)),
        }
      }),
    })
  }

  // Centro di ricavo e categoria dell'addebito, fotografati sulla riga (Task 30b): una query per
  // tutte le righe con un addebito, non una per riga.
  const codici = await leggiCodiciRicavo(
    tx,
    tenantId,
    bozze.flatMap(b =>
      b.calcolato.righe.flatMap(r => (r.rigaAddebitoId === null ? [] : [r.rigaAddebitoId]))
    )
  )
  const righe = bozze.flatMap(b =>
    b.calcolato.righe.map(r => ({
      tenantId,
      documentoId: b.id,
      numeroLinea: r.numeroLinea,
      tipoRiga: r.tipoRiga,
      legameId: r.legameId,
      // Sempre NULL (I1, Q1, Q2): vedi l'intestazione del file.
      rigaLegameId: null,
      rigaAddebitoId: r.rigaAddebitoId,
      centroRicavoCodice:
        r.rigaAddebitoId === null
          ? null
          : (codici.get(r.rigaAddebitoId)?.centroRicavoCodice ?? null),
      categoriaCodice:
        r.rigaAddebitoId === null ? null : (codici.get(r.rigaAddebitoId)?.categoriaCodice ?? null),
      descrizione: r.descrizione,
      dataMovimento: r.dataMovimento === null ? null : dataUtc(r.dataMovimento),
      cerCode: r.cerCode,
      numeroFir: r.numeroFir,
      quantita: r.quantita,
      unitaMisura: r.unitaMisura,
      prezzoUnitario: r.prezzoUnitario,
      sconto: r.sconto,
      importoLordo: r.importoLordo,
      importoSconto: r.importoSconto,
      prezzoTotale: r.prezzoTotale,
      codiceIvaId: r.codiceIvaId,
      aliquotaIva: r.aliquotaIva,
      naturaIva: r.naturaIva,
    }))
  )
  for (const blocco of inBlocchi(righe, BLOCCO_RIGHE)) {
    await tx.rigaDocumentoFattura.createMany({ data: blocco })
  }

  const riepiloghi = bozze.flatMap(b =>
    b.calcolato.riepiloghi.map(r => ({
      tenantId,
      documentoId: b.id,
      aliquota: r.aliquota,
      natura: r.natura,
      imponibile: r.imponibile,
      imposta: r.imposta,
      esigibilita: ESIGIBILITA_DB[r.esigibilita],
      riferimentoNormativo: r.riferimentoNormativo,
    }))
  )
  for (const blocco of inBlocchi(riepiloghi, BLOCCO_RIGHE)) {
    await tx.riepilogoIvaDocumento.createMany({ data: blocco })
  }

  const rate = bozze.flatMap(b =>
    b.calcolato.rate.map(r => ({
      tenantId,
      documentoId: b.id,
      ordine: r.ordine,
      modalita: r.modalita,
      dataScadenza: dataUtc(r.dataScadenza),
      importo: r.importo,
      istituto: r.istituto,
      iban: r.iban,
      abi: r.abi,
      cab: r.cab,
      bic: r.bic,
    }))
  )
  for (const blocco of inBlocchi(rate, BLOCCO_RIGHE)) {
    await tx.rataDocumentoFattura.createMany({ data: blocco })
  }
}

/**
 * Job di anteprima (spec §5.3). Il chiamante e' nel contesto del tenant (il job lo apre, un
 * servizio lo eredita). Lancia `ElaborazioneNonTrovataError` se l'elaborazione non e' del tenant,
 * `ElaborazioneAttivaError` se un'altra e' `IN_CORSO`; ogni altro errore lascia l'elaborazione
 * `IN_CORSO` per il tentativo successivo (la porta a `FALLITA` il chiamante, all'ultimo).
 *
 * `versione`: quella del job. Se l'elaborazione e' gia' piu' avanti (un ricalcolo ha accodato un
 * job piu' nuovo) il job vecchio esce senza scrivere.
 */
export async function eseguiAnteprima(
  prisma: PrismaService,
  tenantId: string,
  elaborazioneId: string,
  versione?: number
): Promise<void> {
  await nelContestoTenant(tenantId, async () => {
    const parametri = await portaInCorso(prisma, tenantId, elaborazioneId, versione)
    if (parametri === null) return

    // 1. Selezione: un'istantanea per job, sola lettura.
    const selezione = await prisma.$transaction(
      tx => selezionaElaborazione(tx, tenantId, parametri),
      { ...OPZIONI_LETTURA, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )

    // 2. Calcolo (puro) e impronta.
    const { bozze, nonGenerati } = calcolaBozze(selezione.documenti)
    const impronta = improntaElaborazione(selezione.versioni)
    const anno = Number(parametri.dataDocumento.slice(0, 4))

    // 3. Scrittura: elaborazione FOR UPDATE per prima, poi bozze, riepilogo e stato.
    await prisma.$transaction(async tx => {
      await impostaTimeoutLock(tx)
      const bloccata = await bloccaElaborazione(tx, tenantId, elaborazioneId)
      if (
        bloccata.stato !== 'IN_CORSO' ||
        (versione !== undefined && bloccata.versione !== versione)
      ) {
        return
      }
      // Le esclusioni sopravvivono al ricalcolo (legate alla chiave del documento): un documento
      // che l'utente aveva escluso non deve finire nella definitiva dopo «Ricalcola».
      const esclusiPrima = await tx.$queryRaw<{ contrattoId: string; elencoId: string | null }[]>`
        SELECT contratto_id::text AS "contrattoId", elenco_id::text AS "elencoId"
        FROM documenti_fattura
        WHERE tenant_id = ${tenantId}::uuid AND elaborazione_id = ${elaborazioneId}::uuid
          AND stato = 'BOZZA' AND escluso_da_definitiva`
      const esclusi = new Set(
        esclusiPrima.map(e =>
          e.elencoId === null ? e.contrattoId : `${e.contrattoId}:${e.elencoId}`
        )
      )
      await tx.$executeRaw`
        DELETE FROM documenti_fattura
        WHERE tenant_id = ${tenantId}::uuid AND elaborazione_id = ${elaborazioneId}::uuid
          AND stato = 'BOZZA'`
      const contesto = await leggiContestoNumerazione(
        tx,
        tenantId,
        distinti(bozze.map(b => b.selezionato.registroIvaId as string)),
        anno
      )
      await scriviBozze(tx, tenantId, elaborazioneId, parametri, bozze)
      const bozzeEscluse = bozze.filter(b => esclusi.has(b.selezionato.chiave))
      if (bozzeEscluse.length > 0) {
        // Un documento che non esiste piu' perde l'esclusione (non e' fra le bozze nuove).
        await conJoinLineari(
          tx,
          () => tx.$executeRaw`
          UPDATE documenti_fattura SET escluso_da_definitiva = true, updated_at = now()
          WHERE tenant_id = ${tenantId}::uuid AND id IN (SELECT unnest(${bozzeEscluse.map(b => b.id)}::uuid[]))`
        )
      }
      const parziale = costruisciRiepilogo(
        bozze,
        nonGenerati,
        selezione.erroriPeriodo,
        anno,
        contesto,
        selezione.erroriGenerali,
        esclusi
      )
      const [{ adesso }] = await tx.$queryRaw<{ adesso: string }[]>`
        SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS adesso`
      const riepilogo: RiepilogoElaborazione = { ...parziale, prontaIl: adesso }
      const erroriGenerali = distinti(selezione.erroriGenerali.map(e => e.codice))
      await tx.$executeRaw`
        UPDATE elaborazioni_fatturazione
        SET stato = 'ANTEPRIMA_PRONTA', impronta = ${impronta}, riepilogo = ${JSON.stringify(riepilogo)}::jsonb,
            errori_generali = ${erroriGenerali}::text[], esito = NULL, errore_tecnico = NULL,
            updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${elaborazioneId}::uuid`
    }, OPZIONI_SCRITTURA)
  })
}
