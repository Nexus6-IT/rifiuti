// Variazione automatica dei prezzi delle righe dei contratti (4.2b, Task 24, D20, E21) e
// adeguamento ISTAT (D22, E24): anteprima e applicazione.
//
// Come la variazione dell'archivio (Task 10): l'anteprima calcola vecchio -> nuovo senza scrivere;
// l'applicazione e' UNA transazione che blocca le righe `FOR NO KEY UPDATE` in ordine di id e poi
// le fasce per (riga, ordine) (R46), rilegge, ricalcola, confronta l'impronta e solo allora scrive
// (`versione + 1` sulle righe toccate) con un unico audit. Un errore dell'anteprima (prezzo
// negativo...) rifiuta tutta la variazione: niente applicazioni parziali. Chi stava modificando
// una riga riceve 409 al salvataggio (D23: la variazione scrive `versione + 1`).
//
// Perimetro: righe di contratti non annullati e non eliminati dell'azienda, sempre. Le righe a
// prezzo speciale cambiano nelle fasce (zero e vuoti restano), le altre in `prezzo` (o nel
// `minimo_fatturabile` con `soloMinimi`). ISTAT: solo i contratti col flag `incrementoIstat`
// (Q5), scelti per mese di inizio; il flag e' la differenza voluta da WinWaste.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  annoSolareItaliano,
  formattaDataItaliana,
  giornoItaliano,
} from '../../core/time/anno-italiano'
import { arrotonda, prezzoCalcolato } from '../../domain/listino/importi-riga'
import { tipoAddebitoValido } from '../../domain/listino/tipi-addebito'
import {
  TIPI_VARIAZIONE,
  aumentoIstat,
  improntaVariazione,
  nuoviScaglioni,
  nuovoPrezzo,
  validaPercentualiIstat,
  validaValoreVariazione,
  type TipoVariazione,
} from '../../domain/listino/variazione-prezzi'
import { cerCanonico } from '../../domain/waste-movement/cer-registro'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { MSG_VARIAZIONE_SUPERATA, traduciConflitto } from './conflitti-variazione'
import { controllaRiferimentiListino } from './riferimenti-listino'

export interface FiltroVariazioneContratti {
  addebitoId?: string
  cerCode?: string
  clienteId?: string
  riferimento?: string
  prezzoAttuale?: string
  anchePrezziZero?: boolean
  tipiPrezzo?: ('NORMALE' | 'SPECIALE')[]
  tipi?: string[]
  categorieAddebitoIds?: string[]
  centriRicavoIds?: string[]
  tipiContrattoIds?: string[]
  categorieContrattoIds?: string[]
  inizioDal?: string
  inizioAl?: string
  fineDal?: string
  fineAl?: string
  contrattiIds?: string[]
  addebitiIds?: string[]
  primaScadenzaFissi?: string
}

export interface CorpoVariazioneContratti {
  tipo: TipoVariazione
  valore?: string
  daCodiceIvaId?: string
  aCodiceIvaId?: string
  soloMinimi?: boolean
  filtri: FiltroVariazioneContratti
}

export interface PercentualeIstatCorpo {
  anno: number
  mese: number
  percentuale: string
}

export interface CorpoIstat {
  percentuali: PercentualeIstatCorpo[]
  tipi: string[]
}

/**
 * R46: forma propria, NON l'`AnteprimaVariazione` dell'archivio. `righe` sono le prime 200
 * (`totale` le conta tutte); per una riga a prezzo speciale `prima` e `dopo` elencano i prezzi
 * delle fasce separati da " / ".
 */
export interface AnteprimaVariazioneContratti {
  totale: number
  /** Righe del perimetro il cui prezzo non cambia: restano in `righe`, non si scrivono (I1). */
  invariate: number
  righe: {
    id: string
    cliente: string | null
    contratto: string
    elenco: string
    /** CER o codice dell'addebito (o il tipo, se la riga non ha ne' l'uno ne' l'altro). */
    voce: string
    prima: string
    dopo: string
    /** Il prezzo nuovo e' uguale al vecchio (arrotondamento): la riga non si scrive (I1). */
    invariata: boolean
  }[]
  errori: { id: string; voce: string; messaggio: string }[]
  /** Righe che l'applicazione scrive davvero (quelle con `invariata = false`). */
  /** `improntaVariazione` su `{ id: rigaId, versione }` piu' i parametri. */
  impronta: string
}

/** Anteprima ISTAT: come quella dei contratti, piu' gli avvisi di mesi gia' adeguati (M3). */
export interface AnteprimaIstat extends AnteprimaVariazioneContratti {
  /** Es. "ISTAT di marzo 2010 già applicato il 15/04/2026 a 12 contratti". Non blocca. */
  avvisi: string[]
}

export interface MeseIstat {
  anno: number
  mese: number
  contratti: number
  /** 'AAAA-MM-GG' (data italiana) dell'ultima applicazione ISTAT che ha cambiato prezzi in questo mese. */
  ultimaApplicazione: string | null
}

export interface EsitoVariazioneContratti {
  aggiornati: number
}

/** Tetto di righe per variazione (R12, D20): oltre, si restringono i filtri. */
const MAX_RIGHE = 10_000
/** Righe mostrate nell'anteprima (D20). */
const RIGHE_ANTEPRIMA = 200
const MSG_TROPPE = 'La variazione tocca troppe righe: restringi i filtri.'
/** La variazione e' una sola transazione: piu' tempo del default di Prisma (5 s). */
const MESI = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
] as const
const OPZIONI_TRANSAZIONE = { timeout: 30_000, maxWait: 5_000 } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface FiltriNormalizzati {
  addebitoId: string | null
  cerCode: string | null
  clienteId: string | null
  riferimento: string | null
  prezzoAttuale: string | null
  anchePrezziZero: boolean
  tipiPrezzo: ('NORMALE' | 'SPECIALE')[]
  tipi: string[]
  categorieAddebitoIds: string[]
  centriRicavoIds: string[]
  tipiContrattoIds: string[]
  categorieContrattoIds: string[]
  inizioDal: string | null
  inizioAl: string | null
  fineDal: string | null
  fineAl: string | null
  contrattiIds: string[]
  addebitiIds: string[]
  primaScadenzaFissi: string | null
}

interface MeseNormalizzato {
  anno: number
  mese: number
  percentuale: string
}

interface Criteri {
  /** `ISTAT` = adeguamento ISTAT (aumento percentuale per mese di inizio, solo contratti col flag). */
  modalita: 'VARIAZIONE' | 'ISTAT'
  tipo: TipoVariazione
  valore: string
  da: string
  a: string
  soloMinimi: boolean
  filtri: FiltriNormalizzati
  mesi: MeseNormalizzato[]
}

/** Riga letta con il suo contesto (contratto, elenco, addebito) e le sue fasce. */
interface RigaLetta {
  id: string
  versione: number
  tipo: string
  cerCode: string | null
  /** Stringa decimale; `null` sulle righe a prezzo speciale. */
  prezzo: string | null
  prezzoSpeciale: boolean
  minimo: string | null
  addebitoCodice: string | null
  elencoCodice: string
  contrattoId: string
  contratto: string
  /** 'AAAA-MM-GG' */
  inizio: string
  cliente: string | null
  fasce: { id: string; prezzo: string }[]
}

interface Calcolo {
  righe: AnteprimaVariazioneContratti['righe']
  errori: AnteprimaVariazioneContratti['errori']
  prezzi: { id: string; prezzo: string }[]
  minimi: { id: string; prezzo: string }[]
  fasce: { id: string; prezzo: string }[]
  /** Righe da scrivere (versione + 1), in ordine di id: solo quelle che cambiano davvero. */
  righeIds: string[]
  contratti: number
  invariate: number
  /** Per mese di inizio (chiave `anno*12+mese-1`), i contratti con almeno una riga cambiata. */
  perMese: Map<number, Set<string>>
  impronta: string
}

const nonValida = (messaggi: string[], error = 'VARIAZIONE_NON_VALIDA'): never => {
  throw new BadRequestException({ message: messaggi, error })
}

const ordinati = (v: readonly string[] | undefined): string[] =>
  [...new Set((v ?? []).map(x => x.trim().toLowerCase()))].sort()

/** 'AAAA-MM-GG' reale (il 31 febbraio no) -> Date UTC; altrimenti `null`. */
function dataIso(testo: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testo)) return null
  const d = new Date(`${testo}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== testo ? null : d
}

function normalizzaFiltri(f: FiltroVariazioneContratti | undefined, errori: string[]) {
  const g = f ?? {}
  const testo = (v: string | undefined): string | null => {
    const t = (v ?? '').trim()
    return t === '' ? null : t
  }
  const uuid = (v: string | undefined): string | null => {
    const t = testo(v)
    if (t === null) return null
    if (!UUID.test(t)) {
      errori.push('Un identificativo del filtro non è valido.')
      return null
    }
    return t.toLowerCase()
  }
  const elenco = (v: string[] | undefined): string[] => {
    const l = ordinati(v)
    if (l.some(x => !UUID.test(x))) errori.push('Un identificativo del filtro non è valido.')
    return l
  }
  const data = (v: string | undefined, nome: string): string | null => {
    const t = testo(v)
    if (t === null) return null
    if (dataIso(t) === null) {
      errori.push(`${nome}: la data non è valida.`)
      return null
    }
    return t
  }

  const tipi = [...new Set((g.tipi ?? []).map(t => t.trim()))].sort()
  if (tipi.some(t => !tipoAddebitoValido(t))) errori.push('Il tipo di addebito non è ammesso.')
  const tipiPrezzo = [...new Set(g.tipiPrezzo ?? [])].sort() as ('NORMALE' | 'SPECIALE')[]
  if (tipiPrezzo.some(t => t !== 'NORMALE' && t !== 'SPECIALE')) {
    errori.push('Il tipo di prezzo non è ammesso.')
  }

  const cer = testo(g.cerCode)
  let prezzoAttuale: string | null = null
  const pa = testo(g.prezzoAttuale)
  if (pa !== null) {
    if (!/^\d+([.,]\d+)?$/.test(pa)) errori.push('Il prezzo attuale non è un numero.')
    else prezzoAttuale = new Prisma.Decimal(pa.replace(',', '.')).toFixed()
  }

  const risultato: FiltriNormalizzati = {
    addebitoId: uuid(g.addebitoId),
    cerCode: cer === null ? null : cerCanonico(cer.toUpperCase()),
    clienteId: uuid(g.clienteId),
    // Il riferimento si confronta senza spazi iniziali e finali; uno vuoto o fatto di soli
    // spazi vale "nessun filtro": non si possono scegliere le sole righe senza riferimento (M7).
    riferimento: g.riferimento === undefined ? null : testo(g.riferimento?.trimEnd()),
    prezzoAttuale,
    anchePrezziZero: g.anchePrezziZero === true,
    tipiPrezzo,
    tipi,
    categorieAddebitoIds: elenco(g.categorieAddebitoIds),
    centriRicavoIds: elenco(g.centriRicavoIds),
    tipiContrattoIds: elenco(g.tipiContrattoIds),
    categorieContrattoIds: elenco(g.categorieContrattoIds),
    inizioDal: data(g.inizioDal, 'Inizio dal'),
    inizioAl: data(g.inizioAl, 'Inizio al'),
    fineDal: data(g.fineDal, 'Fine dal'),
    fineAl: data(g.fineAl, 'Fine al'),
    contrattiIds: elenco(g.contrattiIds),
    addebitiIds: elenco(g.addebitiIds),
    primaScadenzaFissi: data(g.primaScadenzaFissi, 'Prima scadenza dei fissi'),
  }
  const intervallo = (dal: string | null, al: string | null, nome: string) => {
    if (dal !== null && al !== null && dal > al)
      errori.push(`${nome}: la data iniziale segue quella finale.`)
  }
  intervallo(risultato.inizioDal, risultato.inizioAl, 'Inizio del contratto')
  intervallo(risultato.fineDal, risultato.fineAl, 'Fine del contratto')
  return risultato
}

function normalizzaVariazione(corpo: CorpoVariazioneContratti): Criteri {
  const errori: string[] = []
  if (!(TIPI_VARIAZIONE as readonly string[]).includes(corpo.tipo)) {
    return nonValida(['Il tipo di variazione non è ammesso.'])
  }
  const filtri = normalizzaFiltri(corpo.filtri, errori)
  let valore = ''
  let da = ''
  let a = ''
  if (corpo.tipo === 'SOSTITUZIONE_IVA') {
    da = (corpo.daCodiceIvaId ?? '').toLowerCase()
    a = (corpo.aCodiceIvaId ?? '').toLowerCase()
    if (da === '' || a === '') errori.push('Indica il codice IVA da sostituire e quello nuovo.')
    else if (da === a) errori.push('I due codici IVA devono essere diversi.')
    if (corpo.soloMinimi === true) {
      errori.push('Il solo minimo fatturabile non si applica alla sostituzione del codice IVA.')
    }
  } else {
    valore = (corpo.valore ?? '').trim().replace(',', '.')
    if (valore === '') errori.push('Indica il valore della variazione.')
    else {
      const erroreValore = validaValoreVariazione(corpo.tipo, valore)
      if (erroreValore !== null) errori.push(erroreValore)
    }
  }
  if (errori.length > 0) nonValida([...new Set(errori)])
  return {
    modalita: 'VARIAZIONE',
    tipo: corpo.tipo,
    valore,
    da,
    a,
    soloMinimi: corpo.soloMinimi === true,
    filtri,
    mesi: [],
  }
}

function normalizzaIstat(corpo: CorpoIstat, annoCorrente: number): Criteri {
  const errori: string[] = []
  const percentuali = (corpo.percentuali ?? []).map(p => ({
    anno: p.anno,
    mese: p.mese,
    percentuale: typeof p.percentuale === 'string' ? p.percentuale.trim().replace(',', '.') : '',
  }))
  errori.push(...validaPercentualiIstat(percentuali))
  if (percentuali.some(p => Number.isInteger(p.anno) && p.anno >= annoCorrente)) {
    errori.push('L’adeguamento ISTAT riguarda i contratti iniziati prima dell’anno in corso.')
  }
  const tipi = [...new Set((corpo.tipi ?? []).map(t => t.trim()))].sort()
  if (tipi.length === 0) errori.push('Scegli almeno un tipo di addebito.')
  else if (tipi.some(t => !tipoAddebitoValido(t))) errori.push('Il tipo di addebito non è ammesso.')
  if (errori.length > 0) nonValida([...new Set(errori)], 'ISTAT_NON_VALIDO')

  const filtri = normalizzaFiltri({ tipi }, [])
  const mesi = percentuali
    .map(p => ({
      anno: p.anno,
      mese: p.mese,
      percentuale: new Prisma.Decimal(p.percentuale).toFixed(),
    }))
    .sort((x, y) => x.anno * 12 + x.mese - (y.anno * 12 + y.mese))
  return {
    modalita: 'ISTAT',
    tipo: 'AUMENTO_PERCENTUALE',
    valore: '',
    da: '',
    a: '',
    soloMinimi: false,
    filtri,
    mesi,
  }
}

const chiaveMese = (anno: number, mese: number): number => anno * 12 + (mese - 1)

@Injectable()
export class VariazioniPrezziService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------------------------
  // Variazione dei prezzi dei contratti (D20)
  // -----------------------------------------------------------------------------------------

  async anteprima(
    tenantId: string,
    corpo: CorpoVariazioneContratti
  ): Promise<AnteprimaVariazioneContratti> {
    return this.anteprimaCriteri(tenantId, normalizzaVariazione(corpo))
  }

  async applica(
    tenantId: string,
    utenteId: string,
    corpo: CorpoVariazioneContratti & { impronta: string }
  ): Promise<EsitoVariazioneContratti> {
    return this.applicaCriteri(tenantId, utenteId, normalizzaVariazione(corpo), corpo.impronta)
  }

  // -----------------------------------------------------------------------------------------
  // Adeguamento ISTAT (D22)
  // -----------------------------------------------------------------------------------------

  /**
   * Mesi di inizio dei contratti col flag `incrementoIstat`, non annullati ne' eliminati. L'anno
   * corrente (data italiana) e' escluso; anche il precedente, salvo `ancheAnnoPrecedente` (E24).
   */
  async mesiIstat(tenantId: string, ancheAnnoPrecedente: boolean): Promise<MeseIstat[]> {
    const annoCorrente = annoSolareItaliano(new Date())
    const ultimoAnno = ancheAnnoPrecedente ? annoCorrente - 1 : annoCorrente - 2
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const righe = await tx.$queryRaw<{ anno: number; mese: number; contratti: number }[]>`
          SELECT EXTRACT(YEAR FROM data_inizio)::int AS anno,
                 EXTRACT(MONTH FROM data_inizio)::int AS mese,
                 count(*)::int AS contratti
          FROM contratti_cliente
          WHERE tenant_id = ${tenantId}::uuid
            AND incremento_istat
            AND stato <> 'ANNULLATO'
            AND eliminato_il IS NULL
            AND EXTRACT(YEAR FROM data_inizio) <= ${ultimoAnno}
          GROUP BY 1, 2
          ORDER BY 1, 2`
        const ultime = await this.ultimeApplicazioniIstat(tx, tenantId)
        return righe.map(r => ({
          anno: r.anno,
          mese: r.mese,
          contratti: r.contratti,
          ultimaApplicazione: ultime.get(chiaveMese(r.anno, r.mese))?.giorno ?? null,
        }))
      }, OPZIONI_TRANSAZIONE)
    )
  }

  async anteprimaIstat(tenantId: string, corpo: CorpoIstat): Promise<AnteprimaIstat> {
    const a = await this.anteprimaCriteri(
      tenantId,
      normalizzaIstat(corpo, annoSolareItaliano(new Date()))
    )
    return { ...a, avvisi: a.avvisi ?? [] }
  }

  async applicaIstat(
    tenantId: string,
    utenteId: string,
    corpo: CorpoIstat & { impronta: string }
  ): Promise<EsitoVariazioneContratti> {
    return this.applicaCriteri(
      tenantId,
      utenteId,
      normalizzaIstat(corpo, annoSolareItaliano(new Date())),
      corpo.impronta
    )
  }

  // -----------------------------------------------------------------------------------------
  // Comune
  // -----------------------------------------------------------------------------------------

  /**
   * Per mese di inizio, l'ultima applicazione ISTAT dell'azienda che ha cambiato almeno un
   * contratto di quel mese, letta dall'audit `PREZZI_ISTAT` (campo `mesi` della metadata).
   */
  private async ultimeApplicazioniIstat(
    tx: Prisma.TransactionClient,
    tenantId: string
  ): Promise<Map<number, { giorno: string; data: Date; contratti: number }>> {
    const log = await tx.activityLog.findMany({
      where: { tenantId, action: 'PREZZI_ISTAT' },
      select: { createdAt: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    })
    const ultime = new Map<number, { giorno: string; data: Date; contratti: number }>()
    for (const l of log) {
      const mesi = (l.metadata as { mesi?: unknown } | null)?.mesi
      if (!Array.isArray(mesi)) continue
      for (const m of mesi as { anno?: unknown; mese?: unknown; contratti?: unknown }[]) {
        if (
          typeof m.anno === 'number' &&
          typeof m.mese === 'number' &&
          typeof m.contratti === 'number' &&
          m.contratti > 0
        ) {
          ultime.set(chiaveMese(m.anno, m.mese), {
            giorno: giornoItaliano(l.createdAt),
            data: l.createdAt,
            contratti: m.contratti,
          })
        }
      }
    }
    return ultime
  }

  private async anteprimaCriteri(
    tenantId: string,
    c: Criteri
  ): Promise<AnteprimaVariazioneContratti & { avvisi?: string[] }> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const codici = await this.codiciIva(tx, tenantId, c)
        const calcolo = this.calcola(await this.trova(tx, tenantId, c), c, codici)
        const avvisi: string[] = []
        if (c.modalita === 'ISTAT') {
          // Doppia applicazione: si avvisa, non si impedisce (M3).
          const ultime = await this.ultimeApplicazioniIstat(tx, tenantId)
          for (const m of c.mesi) {
            const u = ultime.get(chiaveMese(m.anno, m.mese))
            if (!u) continue
            avvisi.push(
              `ISTAT di ${MESI[m.mese - 1]} ${m.anno} già applicato il ${formattaDataItaliana(u.data)} a ${u.contratti} ${u.contratti === 1 ? 'contratto' : 'contratti'}`
            )
          }
        }
        return {
          totale: calcolo.righe.length - calcolo.invariate,
          invariate: calcolo.invariate,
          righe: calcolo.righe.slice(0, RIGHE_ANTEPRIMA),
          errori: calcolo.errori,
          impronta: calcolo.impronta,
          ...(c.modalita === 'ISTAT' ? { avvisi } : {}),
        }
      }, OPZIONI_TRANSAZIONE)
    )
  }

  private async applicaCriteri(
    tenantId: string,
    utenteId: string,
    c: Criteri,
    impronta: string
  ): Promise<EsitoVariazioneContratti> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          // Chi aspetta un lock piu' di 10 s rinuncia (55P03 -> 409), invece di tenere la transazione.
          await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`
          const codici = await this.codiciIva(tx, tenantId, c)

          // `FOR NO KEY UPDATE` (gli UPDATE non toccano colonne chiave): non confligge col FOR KEY SHARE
          // delle FK. Ordine stabile (R46): righe per id, poi fasce per (riga, ordine); due
          // applicazioni concorrenti non si incrociano e chi arriva dopo trova un'impronta diversa.
          const candidate = (await this.trova(tx, tenantId, c)).map(r => r.id).sort()
          if (candidate.length > 0) {
            await tx.$queryRaw`
              SELECT id::text AS id FROM righe_addebito
              WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${candidate}::uuid[])
              ORDER BY id FOR NO KEY UPDATE`
            await tx.$queryRaw`
              SELECT id::text AS id FROM scaglioni_riga_addebito
              WHERE tenant_id = ${tenantId}::uuid AND riga_id = ANY(${candidate}::uuid[])
              ORDER BY riga_id, ordine FOR NO KEY UPDATE`
          }

          // Rilettura dopo il blocco: e' questo lo stato che si confronta e si scrive.
          const riletta = await this.trova(tx, tenantId, c)
          // Una riga entrata nel filtro dopo la prima lettura non e' bloccata: non si scrive (M1).
          const bloccate = new Set(candidate)
          if (riletta.some(r => !bloccate.has(r.id))) {
            throw new ConflictException({
              message: MSG_VARIAZIONE_SUPERATA,
              error: 'VARIAZIONE_SUPERATA',
            })
          }
          const calcolo = this.calcola(riletta, c, codici)
          if (calcolo.impronta !== impronta) {
            throw new ConflictException({
              message: MSG_VARIAZIONE_SUPERATA,
              error: 'VARIAZIONE_SUPERATA',
            })
          }
          if (calcolo.errori.length > 0) {
            nonValida(
              calcolo.errori.map(e => `${e.voce}: ${e.messaggio}`),
              'VARIAZIONE_CON_ERRORI'
            )
          }

          await this.scrivi(tx, tenantId, c, calcolo)

          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: c.modalita === 'ISTAT' ? 'PREZZI_ISTAT' : 'PREZZI_VARIATI',
              description:
                c.modalita === 'ISTAT'
                  ? 'Adeguamento ISTAT dei prezzi dei contratti'
                  : 'Prezzi dei contratti variati',
              // Solo parametri e conteggi (D25): niente ragioni sociali, note o descrizioni libere.
              metadata: this.metadataAudit(c, calcolo, impronta) as Prisma.InputJsonValue,
            },
          })
          return { aggiornati: calcolo.righeIds.length }
        }, OPZIONI_TRANSAZIONE)
        .catch(traduciConflitto)
    )
  }

  /**
   * Scrive i prezzi nuovi. OGNI riga e' aggiornata da UNA sola istruzione (prezzo e `versione + 1`
   * insieme): un secondo UPDATE sulla stessa riga nella stessa transazione rifa' scattare il
   * controllo delle FK (la versione precedente e' stata creata dalla transazione stessa) e prende
   * `FOR KEY SHARE` sull'elenco, che confligge col `FOR UPDATE` di chi salva una riga dello stesso
   * elenco: deadlock con il collega (visto in prova). Le righe che cambiano solo nelle fasce hanno
   * un UPDATE di sola versione. Nella sostituzione IVA cambia `codice_iva_id`, una colonna FK: il
   * controllo scatta comunque, una volta per riga, e prende `FOR KEY SHARE` sul codice IVA nuovo
   * (non sull'elenco): nessun deadlock col collega, solo la coda dietro un PATCH di quel codice.
   */
  private async scrivi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    c: Criteri,
    calcolo: Calcolo
  ): Promise<void> {
    if (calcolo.righeIds.length === 0) return
    if (c.tipo === 'SOSTITUZIONE_IVA') {
      await tx.$executeRaw`
        UPDATE righe_addebito
        SET codice_iva_id = ${c.a}::uuid, versione = versione + 1, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${calcolo.righeIds}::uuid[])`
      return
    }
    if (calcolo.prezzi.length > 0) {
      await tx.$executeRaw`
        UPDATE righe_addebito r
        SET prezzo = v.prezzo, versione = r.versione + 1, updated_at = now()
        FROM (SELECT unnest(${calcolo.prezzi.map(p => p.id)}::uuid[]) AS id,
                     unnest(${calcolo.prezzi.map(p => p.prezzo)}::numeric[]) AS prezzo) v
        WHERE r.tenant_id = ${tenantId}::uuid AND r.id = v.id`
    }
    if (calcolo.minimi.length > 0) {
      await tx.$executeRaw`
        UPDATE righe_addebito r
        SET minimo_fatturabile = v.prezzo, versione = r.versione + 1, updated_at = now()
        FROM (SELECT unnest(${calcolo.minimi.map(p => p.id)}::uuid[]) AS id,
                     unnest(${calcolo.minimi.map(p => p.prezzo)}::numeric[]) AS prezzo) v
        WHERE r.tenant_id = ${tenantId}::uuid AND r.id = v.id`
    }
    if (calcolo.fasce.length > 0) {
      await tx.$executeRaw`
        UPDATE scaglioni_riga_addebito s SET prezzo = v.prezzo
        FROM (SELECT unnest(${calcolo.fasce.map(p => p.id)}::uuid[]) AS id,
                     unnest(${calcolo.fasce.map(p => p.prezzo)}::numeric[]) AS prezzo) v
        WHERE s.tenant_id = ${tenantId}::uuid AND s.id = v.id`
    }
    const gia = new Set([...calcolo.prezzi, ...calcolo.minimi].map(p => p.id))
    const soloFasce = calcolo.righeIds.filter(id => !gia.has(id))
    if (soloFasce.length > 0) {
      await tx.$executeRaw`
        UPDATE righe_addebito SET versione = versione + 1, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${soloFasce}::uuid[])`
    }
  }

  private metadataAudit(c: Criteri, calcolo: Calcolo, impronta: string): Record<string, unknown> {
    const conteggi = {
      righe: calcolo.righeIds.length,
      contratti: calcolo.contratti,
      fasce: calcolo.fasce.length,
      invariate: calcolo.invariate,
      // Collega l'audit alla sua anteprima: due applicazioni uguali si distinguono (M3).
      impronta,
    }
    if (c.modalita === 'ISTAT') {
      return {
        percentuali: c.mesi,
        tipi: c.filtri.tipi,
        mesi: [...calcolo.perMese.entries()]
          .map(([k, v]) => ({ anno: Math.floor(k / 12), mese: (k % 12) + 1, contratti: v.size }))
          .sort((x, y) => x.anno * 12 + x.mese - (y.anno * 12 + y.mese)),
        ...conteggi,
      }
    }
    return {
      tipo: c.tipo,
      ...(c.tipo === 'SOSTITUZIONE_IVA'
        ? { daCodiceIvaId: c.da, aCodiceIvaId: c.a }
        : { valore: c.valore, soloMinimi: c.soloMinimi }),
      filtri: c.filtri,
      ...conteggi,
    }
  }

  /** Sostituzione IVA: il codice nuovo deve essere attivo; ritorna i codici per l'anteprima. */
  private async codiciIva(
    tx: Prisma.TransactionClient,
    tenantId: string,
    c: Criteri
  ): Promise<Map<string, string>> {
    if (c.tipo !== 'SOSTITUZIONE_IVA') return new Map()
    const errori = await controllaRiferimentiListino(tx, tenantId, { codiceIvaId: c.a })
    if (errori.length > 0) nonValida(errori)
    const righe = await tx.codiceIva.findMany({
      where: { tenantId, id: { in: [c.da, c.a] } },
      select: { id: true, codice: true },
    })
    return new Map(righe.map(r => [r.id.toLowerCase(), r.codice]))
  }

  /** Condizioni sulle righe e sul loro contratto; i filtri sono in AND. */
  private dove(tenantId: string, c: Criteri): Prisma.RigaAddebitoWhereInput {
    const f = c.filtri
    const and: Prisma.RigaAddebitoWhereInput[] = []

    const contratto: Prisma.ContrattoClienteWhereInput = {
      tenantId,
      // Annullati ed eliminati non si toccano mai (D20).
      eliminatoIl: null,
      stato: { not: 'ANNULLATO' },
    }
    if (f.clienteId) contratto.clienteId = f.clienteId
    if (f.contrattiIds.length > 0) contratto.id = { in: f.contrattiIds }
    if (f.tipiContrattoIds.length > 0) contratto.tipoId = { in: f.tipiContrattoIds }
    if (f.categorieContrattoIds.length > 0) contratto.categoriaId = { in: f.categorieContrattoIds }
    const intervallo = (dal: string | null, al: string | null) =>
      dal === null && al === null
        ? undefined
        : {
            ...(dal !== null ? { gte: dataIso(dal) as Date } : {}),
            ...(al !== null ? { lte: dataIso(al) as Date } : {}),
          }
    const inizio = intervallo(f.inizioDal, f.inizioAl)
    if (inizio) contratto.dataInizio = inizio
    const fine = intervallo(f.fineDal, f.fineAl)
    if (fine) contratto.dataFine = fine

    if (c.modalita === 'ISTAT') {
      // Solo i contratti col flag (Q5) iniziati nei mesi indicati.
      contratto.incrementoIstat = true
      contratto.OR = c.mesi.map(m => ({
        dataInizio: {
          gte: new Date(Date.UTC(m.anno, m.mese - 1, 1)),
          lt: new Date(Date.UTC(m.anno, m.mese, 1)),
        },
      }))
    }

    const riga: Prisma.RigaAddebitoWhereInput = { tenantId, elenco: { contratto } }
    if (f.addebitoId) riga.addebitoId = f.addebitoId
    if (f.cerCode) riga.cerCode = f.cerCode
    if (f.riferimento !== null) riga.riferimento = f.riferimento
    if (f.tipi.length > 0) riga.tipo = { in: f.tipi }
    if (f.categorieAddebitoIds.length > 0) riga.categoriaId = { in: f.categorieAddebitoIds }
    if (f.centriRicavoIds.length > 0) riga.centroRicavoId = { in: f.centriRicavoIds }
    if (f.addebitiIds.length > 0) riga.addebitoId = { in: f.addebitiIds }
    if (f.addebitoId && f.addebitiIds.length > 0) {
      // Entrambi i filtri: l'addebito deve essere quello indicato E fra quelli scelti.
      riga.addebitoId = f.addebitiIds.includes(f.addebitoId) ? f.addebitoId : { in: [] }
    }
    and.push(riga)

    if (f.tipiPrezzo.length === 1) {
      and.push({ prezzoSpeciale: f.tipiPrezzo[0] === 'SPECIALE' })
    }
    if (f.prezzoAttuale !== null) {
      and.push({
        OR: [{ prezzo: f.prezzoAttuale }, { scaglioni: { some: { prezzo: f.prezzoAttuale } } }],
      })
    }
    if (f.primaScadenzaFissi !== null) {
      const d = dataIso(f.primaScadenzaFissi) as Date
      and.push({
        tipo: 'F',
        scadenze: {
          some: {
            ordine: 1,
            giorno: d.getUTCDate(),
            mese: d.getUTCMonth() + 1,
            OR: [{ anno: null }, { anno: d.getUTCFullYear() }],
          },
        },
      })
    }

    // Quali righe hanno qualcosa da variare. Zero e vuoti restano invariati (D20): senza
    // `anchePrezziZero` non entrano nemmeno nell'anteprima. La sostituzione IVA guarda solo il codice.
    if (c.tipo === 'SOSTITUZIONE_IVA') {
      and.push({ codiceIvaId: c.da })
    } else if (c.soloMinimi) {
      and.push({
        prezzoSpeciale: false,
        minimoFatturabile: f.anchePrezziZero ? { gte: 0 } : { gt: 0 },
      })
    } else {
      and.push({
        OR: [
          { prezzoSpeciale: false, prezzo: f.anchePrezziZero ? { gte: 0 } : { gt: 0 } },
          { prezzoSpeciale: true, scaglioni: { some: { prezzo: { gt: 0 } } } },
        ],
      })
    }
    return { AND: and }
  }

  /**
   * Righe che corrispondono ai criteri, in ordine di id; oltre il tetto → 400. Prima si scelgono
   * gli id con una lettura piatta (con la sola `where` di Prisma), poi il dettaglio si legge con
   * due query SQL a `= ANY(uuid[])`: le relazioni annidate di Prisma su 10.000 righe generano
   * liste `IN` che superano lo stack di PostgreSQL (54001).
   */
  private async trova(
    tx: Prisma.TransactionClient,
    tenantId: string,
    c: Criteri
  ): Promise<RigaLetta[]> {
    const scelte = await tx.rigaAddebito.findMany({
      where: this.dove(tenantId, c),
      select: { id: true },
      orderBy: { id: 'asc' },
      take: MAX_RIGHE + 1,
    })
    if (scelte.length > MAX_RIGHE) nonValida([MSG_TROPPE], 'VARIAZIONE_TROPPE_RIGHE')
    if (scelte.length === 0) return []
    const ids = scelte.map(r => r.id)

    // Sempre `WHERE id = ANY(uuid[])` su una tabella alla volta e unione in memoria: un join
    // con liste da 10.000 id, con le statistiche non ancora aggiornate dopo una copia in massa,
    // e' stato misurato a 36 s; cosi' ogni lettura e' lineare qualunque piano scelga il planner.
    const righe = await tx.$queryRaw<
      {
        id: string
        versione: number
        tipo: string
        cerCode: string | null
        prezzo: string | null
        prezzoSpeciale: boolean
        minimo: string | null
        elencoId: string
        addebitoId: string | null
      }[]
    >`
      SELECT id::text AS id, versione, tipo, cer_code AS "cerCode", prezzo::text AS prezzo,
             prezzo_speciale AS "prezzoSpeciale", minimo_fatturabile::text AS minimo,
             elenco_id::text AS "elencoId", addebito_id::text AS "addebitoId"
      FROM righe_addebito
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])
      ORDER BY id`
    const elencoIds = [...new Set(righe.map(r => r.elencoId))]
    const addebitoIds = [...new Set(righe.flatMap(r => (r.addebitoId ? [r.addebitoId] : [])))]
    const elenchi = await tx.$queryRaw<{ id: string; codice: string; contrattoId: string }[]>`
      SELECT id::text AS id, codice, contratto_id::text AS "contrattoId"
      FROM elenchi_addebiti
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${elencoIds}::uuid[])`
    const contrattoIds = [...new Set(elenchi.map(e => e.contrattoId))]
    const contratti = await tx.$queryRaw<
      { id: string; numero: string; inizio: string; clienteId: string }[]
    >`
      SELECT id::text AS id, numero, data_inizio::text AS inizio, cliente_id::text AS "clienteId"
      FROM contratti_cliente
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${contrattoIds}::uuid[])`
    const clienteIds = [...new Set(contratti.map(k => k.clienteId))]
    const clienti = await tx.$queryRaw<{ id: string; codice: string | null }[]>`
      SELECT id::text AS id, codice FROM clienti
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${clienteIds}::uuid[])`
    const addebiti = await tx.$queryRaw<{ id: string; codice: string }[]>`
      SELECT id::text AS id, codice FROM addebiti
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${addebitoIds}::uuid[])`
    const fasce = await tx.$queryRaw<{ id: string; rigaId: string; prezzo: string }[]>`
      SELECT id::text AS id, riga_id::text AS "rigaId", prezzo::text AS prezzo
      FROM scaglioni_riga_addebito
      WHERE tenant_id = ${tenantId}::uuid AND riga_id = ANY(${ids}::uuid[])
      ORDER BY riga_id, ordine`

    const perRiga = new Map<string, { id: string; prezzo: string }[]>()
    for (const f of fasce) {
      const l = perRiga.get(f.rigaId) ?? []
      l.push({ id: f.id, prezzo: f.prezzo })
      perRiga.set(f.rigaId, l)
    }
    const elencoPer = new Map(elenchi.map(e => [e.id, e]))
    const contrattoPer = new Map(contratti.map(k => [k.id, k]))
    const clientePer = new Map(clienti.map(k => [k.id, k.codice]))
    const addebitoPer = new Map(addebiti.map(k => [k.id, k.codice]))
    return righe.map(r => {
      // Le FK composite garantiscono che elenco, contratto e cliente esistano.
      const e = elencoPer.get(r.elencoId) as { codice: string; contrattoId: string }
      const k = contrattoPer.get(e.contrattoId) as {
        numero: string
        inizio: string
        clienteId: string
      }
      return {
        id: r.id,
        versione: r.versione,
        tipo: r.tipo,
        cerCode: r.cerCode,
        prezzo: r.prezzo,
        prezzoSpeciale: r.prezzoSpeciale,
        minimo: r.minimo,
        addebitoCodice: r.addebitoId ? (addebitoPer.get(r.addebitoId) ?? null) : null,
        elencoCodice: e.codice,
        contrattoId: e.contrattoId,
        contratto: k.numero,
        inizio: k.inizio,
        cliente: clientePer.get(k.clienteId) ?? null,
        fasce: perRiga.get(r.id) ?? [],
      }
    })
  }

  private calcola(trovate: RigaLetta[], c: Criteri, codici: Map<string, string>): Calcolo {
    const righe: Calcolo['righe'] = []
    const errori: Calcolo['errori'] = []
    const prezzi: Calcolo['prezzi'] = []
    const minimi: Calcolo['minimi'] = []
    const fasce: Calcolo['fasce'] = []
    const righeIds: string[] = []
    const contratti = new Set<string>()
    const perMese = new Map<number, Set<string>>()
    let invariate = 0
    const percentuali = new Map(c.mesi.map(m => [chiaveMese(m.anno, m.mese), m.percentuale]))

    for (const r of trovate) {
      const base = {
        id: r.id,
        cliente: r.cliente,
        contratto: r.contratto,
        elenco: r.elencoCodice,
        voce: r.cerCode ?? r.addebitoCodice ?? r.tipo,
      }

      if (c.tipo === 'SOSTITUZIONE_IVA') {
        righe.push({
          ...base,
          prima: codici.get(c.da) ?? '',
          dopo: codici.get(c.a) ?? '',
          invariata: false,
        })
        righeIds.push(r.id)
        contratti.add(r.contrattoId)
        continue
      }

      const valore =
        c.modalita === 'ISTAT'
          ? (percentuali.get(
              chiaveMese(Number(r.inizio.slice(0, 4)), Number(r.inizio.slice(5, 7)))
            ) ?? '')
          : c.valore
      const segnala = (messaggio: string) =>
        errori.push({
          id: r.id,
          voce: base.voce,
          messaggio: `Contratto ${base.contratto}, elenco ${base.elenco}: ${messaggio}`,
        })
      const tipo = c.tipo as Exclude<TipoVariazione, 'SOSTITUZIONE_IVA'>
      // L'ISTAT passa dal dominio `aumentoIstat` (oggi coincide con un aumento percentuale).
      const nuovo = (prezzo: string) =>
        c.modalita === 'ISTAT' ? aumentoIstat(prezzo, valore) : nuovoPrezzo(prezzo, tipo, valore)
      const uguali = (a: string, b: string) => new Prisma.Decimal(a).equals(new Prisma.Decimal(b))
      let cambiata = true

      if (c.soloMinimi) {
        if (r.minimo === null) continue
        const prima = prezzoCalcolato(r.minimo)
        const esito = nuovo(prima)
        if ('errore' in esito) {
          segnala(esito.errore)
          continue
        }
        // Il minimo e' un importo a due decimali (Decimal(12,2)): il valore mostrato e' quello scritto.
        const dopo = arrotonda(esito.prezzo, 2)
        cambiata = !uguali(prima, dopo)
        righe.push({ ...base, prima, dopo, invariata: !cambiata })
        if (cambiata) minimi.push({ id: r.id, prezzo: dopo })
      } else if (r.prezzoSpeciale) {
        const origine = r.fasce
        const nuovi = nuoviScaglioni(origine, nuovo)
        if ('errore' in nuovi) {
          segnala(nuovi.errore)
          continue
        }
        const cambiate = origine.flatMap((s, i) =>
          // Zero e vuoti restano; si scrivono solo le fasce il cui prezzo cambia davvero.
          !new Prisma.Decimal(s.prezzo).isZero() && !uguali(s.prezzo, nuovi.scaglioni[i].prezzo)
            ? [{ id: s.id, prezzo: nuovi.scaglioni[i].prezzo }]
            : []
        )
        cambiata = cambiate.length > 0
        righe.push({
          ...base,
          prima: origine.map(s => prezzoCalcolato(s.prezzo)).join(' / '),
          dopo: nuovi.scaglioni.map(s => prezzoCalcolato(s.prezzo)).join(' / '),
          invariata: !cambiata,
        })
        fasce.push(...cambiate)
      } else {
        if (r.prezzo === null) continue
        const prima = prezzoCalcolato(r.prezzo)
        const esito = nuovo(prima)
        if ('errore' in esito) {
          segnala(esito.errore)
          continue
        }
        cambiata = !uguali(prima, esito.prezzo)
        righe.push({ ...base, prima, dopo: esito.prezzo, invariata: !cambiata })
        if (cambiata) prezzi.push({ id: r.id, prezzo: esito.prezzo })
      }
      if (!cambiata) {
        invariate++
        continue
      }
      righeIds.push(r.id)
      contratti.add(r.contrattoId)
      const km = chiaveMese(Number(r.inizio.slice(0, 4)), Number(r.inizio.slice(5, 7)))
      perMese.set(km, (perMese.get(km) ?? new Set<string>()).add(r.contrattoId))
    }
    if (righe.length + errori.length > MAX_RIGHE) nonValida([MSG_TROPPE], 'VARIAZIONE_TROPPE_RIGHE')

    // Impronta: (riga, versione) piu' i parametri, cosi' un corpo diverso da quello dell'anteprima
    // non puo' riusarne l'impronta. Le fasce cambiano solo con la riga (che alza la versione).
    const parametri = JSON.stringify([
      c.modalita,
      c.tipo,
      c.valore,
      c.da,
      c.a,
      c.soloMinimi,
      c.filtri,
      c.mesi,
    ])
    const impronta = improntaVariazione([
      ...trovate.map(r => ({ id: r.id, versione: r.versione })),
      { id: `parametri:${parametri}`, versione: 0 },
    ])
    return {
      righe,
      errori,
      prezzi,
      minimi,
      fasce,
      righeIds,
      contratti: contratti.size,
      invariate,
      perMese,
      impronta,
    }
  }
}
