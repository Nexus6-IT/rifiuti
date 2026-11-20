import { cerSoloCifre } from '../../waste-movement/cer-registro'
import { RecordGiacenzaRifiuti, RecordMovimento } from './record'
import { ClasseRelaz } from './relaz'
import { DataIso } from './risultato'

/**
 * Giacenze iniziali al taglio (I6): ricalcolo INDIPENDENTE da `RELAZ`, righe di `[GIACENZE RIFIUTI]`
 * e carichi aperti, confrontato con `GIASCAR` (`docs/giacenze.md` §2.1-2.3, §4.1-4.2, §6-7). Pura:
 * niente database, niente Prisma.
 *
 * COME SI CALCOLA. Per famiglia (registro WasteFlow, CER, stato fisico) la giacenza al taglio e'
 *   apertura        = righe NORMALI di `[GIACENZE RIFIUTI]` (classi RR, RL, DR, DL, DT) meno i kg dei
 *                     segmenti `G` e `P` degli scarichi fino al taglio, classe per classe, con la
 *                     compensazione di `calcresgiac` (R13 con R13, D15 con D15);
 *                   + carichi dell'anno aperti = netto meno i kg dei segmenti `C` (scarichi fino al taglio).
 * E' la stessa forma della «riga normale» del riporto d'anno (`AggGIACRIFIUTI`, §4.2) e non dipende
 * dalla modalita' del passaggio d'anno: in modalita G lo scarico consuma segmenti `G`, in modalita P
 * consuma carichi dell'anno precedente (`P`), ma il totale e' lo stesso. Le righe di compensazione
 * (`UL` che comincia per 8, «riga 8») servono solo a distinguere in modalita P la parte «orfana» dai
 * carichi `P` ancora aperti: sommarle qui conterebbe due volte, quindi NON si sommano (e si contano).
 *
 * `GIASCAR` non entra nel calcolo: si ricalcola e si CONFRONTA. Una differenza >= 0,001 kg va nel
 * rapporto con i due valori (mai corretta in silenzio); il residuo caricato e' quello ricalcolato.
 * Il confronto vede solo i segmenti `C` dell'archivio: `GIASCAR` conta anche i `P` dell'anno
 * successivo, quindi con un anno successivo gia' aperto una differenza puo' essere legittima.
 *
 * LIMITI NOTI (si segnalano, non si correggono):
 *  - il deposito del produttore (`G0`, classe `X`) vive in `[Schede produttori]`, non nello staging;
 *  - OPER 13 crea sempre un carico R/D; i carichi di 15, 24, 16, 26 vanno su un'altra UL (POS2) e restano
 *    fuori dalla giacenza con avviso e elenco (Q2, decisione di Graziano);
 *  - i m³ non si portano (WasteFlow non li traccia sulle aperture);
 *  - FORMA PRESUNTA, da riverificare sul primo `.bak`: il magazzino di un carico e' `MAG1` per le
 *    classi T e X e `MAG2` per R/D; il magazzino dei segmenti `G` e `P` e' `MAG1` dello scarico.
 */
export type CodiceAvvisoGiacenze =
  | 'CARICO_DOPO_IL_TAGLIO'
  | 'CARICO_ALTRA_UL_FUORI_GIACENZA'
  | 'DEPOSITO_PRODUTTORE_APERTURA_NON_NELLO_STAGING'
  | 'CARICO_SCARICATO_OLTRE_IL_NETTO'
  | 'GIACENZA_INIZIALE_NEGATIVA'
  | 'RIGHE_COMPENSAZIONE_NON_SOMMATE'
  | 'ORIGINI_APERTURA_NON_NOTE'
  | 'CARICO_SENZA_PROTOCOLLO'
  | 'ORIGINI_OLTRE_IL_LIMITE'
  | 'SEGMENTO_C_SENZA_CARICO'

export type CodiceScartoGiacenze =
  | 'MAGAZZINO_NON_IN_MAPPA'
  | 'MAGAZZINO_ASSENTE'
  | 'MODA_NON_RICONOSCIUTA'
  | 'CER_FORMATO'
  | 'STATO_FISICO_NON_VALIDO'

export interface OrigineGiacenzaTaglio {
  readonly anno: number
  readonly protocollo: number
  readonly quantita: number
}

export interface FamigliaGiacenza {
  readonly registroId: string
  /** `NN NN NN`, con `*` se un movimento lo porta; il catalogo ha l'ultima parola al caricamento. */
  readonly cerCode: string
  readonly statoFisico: string | null
  /** kg, al massimo 2 decimali, maggiore di zero. */
  readonly quantitaKg: number
  readonly origini: readonly OrigineGiacenzaTaglio[]
}

export interface DifferenzaGiascar {
  /** `COD` del carico: un numero, nessun dato personale. */
  readonly cod: number
  readonly giascarKg: number
  readonly ricalcolatoKg: number
}

/** Carico su un'altra unita' locale (OPER 15, 24, 16, 26) escluso dalla giacenza: COD e protocollo, niente dati personali. */
export interface CaricoAltraUl {
  readonly cod: number
  readonly oper: string
  readonly protocollo: number | null
}

export interface VoceGiacenze<C extends string> {
  readonly codice: C
  readonly conteggio: number
}

export interface IngressiGiacenze {
  readonly movimenti: readonly RecordMovimento[]
  readonly righeGiacenza: readonly RecordGiacenzaRifiuti[]
  readonly dataTaglio: DataIso
  /** Codice (magazzino o registro) WinWaste -> id del registro WasteFlow, `null` se non in mappa. */
  readonly registroDi: (codice: string) => string | null
}

export interface RisultatoGiacenze {
  readonly famiglie: readonly FamigliaGiacenza[]
  readonly differenzeGiascar: readonly DifferenzaGiascar[]
  readonly caricoAltraUl: readonly CaricoAltraUl[]
  readonly avvisi: ReadonlyArray<VoceGiacenze<CodiceAvvisoGiacenze>>
  readonly scarti: ReadonlyArray<VoceGiacenze<CodiceScartoGiacenze>>
}

export const SOGLIA_DIFFERENZA_GIASCAR_KG = 0.001
export const ORIGINI_MASSIME = 200

type ClasseApertura = 'RR' | 'RL' | 'DR' | 'DL' | 'DT'
const CLASSI_APERTURA: readonly ClasseApertura[] = ['RR', 'RL', 'DR', 'DL', 'DT']
const DA_SEGMENTO: Partial<Record<ClasseRelaz, ClasseApertura>> = {
  R: 'RR',
  r: 'RL',
  D: 'DR',
  d: 'DL',
  T: 'DT',
}

class Contatori<C extends string> {
  private readonly m = new Map<C, number>()
  conta(c: C): void {
    this.m.set(c, (this.m.get(c) ?? 0) + 1)
  }
  elenco(): Array<VoceGiacenze<C>> {
    return [...this.m.entries()]
      .map(([codice, conteggio]) => ({ codice, conteggio }))
      .sort((a, b) => (a.codice < b.codice ? -1 : 1))
  }
}

interface Famiglia {
  registroId: string
  cifre: string
  statoFisico: string | null
  pericoloso: boolean
  /** Apertura per classe, in millesimi di kg. */
  apertura: Record<ClasseApertura, number>
  carichi: Array<{
    anno: number
    protocolli: ReadonlyArray<{ registro: string; protocollo: number | null }>
    residuoMilli: number
  }>
}

const milli = (kg: number): number => Math.round(kg * 1000)

/** `NN NN NN` da sei cifre (senza asterisco: lo aggiunge chi sa che il rifiuto e' pericoloso). */
function cerSpaziato(cifre: string): string {
  return `${cifre.slice(0, 2)} ${cifre.slice(2, 4)} ${cifre.slice(4, 6)}`
}

function statoFisicoPulito(v: string): string | null | 'NON_VALIDO' {
  const t = v.trim().toUpperCase()
  if (t === '') return null
  // eslint-disable-next-line no-control-regex
  if (t.length > 50 || t.includes('|') || /[\u0000-\u001f\u007f]/.test(t)) return 'NON_VALIDO'
  return t
}

type ClasseCarico = 'T' | 'R_D' | 'X'

/**
 * Classe del carico che un movimento crea nel PROPRIO registro, `null` se non ne crea. OPER 13 crea
 * SEMPRE un carico R/D (movimenti.md §2.4). I carichi di 15, 24 (ENTRAMBI) e 16, 26 (CARICO senza
 * classe) vanno in `POS2`, cioe' su un'ALTRA unita' locale: decisione di Graziano (Q2), restano FUORI
 * dalla giacenza importata e si elencano nel rapporto (`caricoAltraUl`) perche' l'operatore li inserisca
 * a mano se servono.
 */
function classeCarico(m: RecordMovimento): ClasseCarico | null {
  if (m.oper.tipo === 'CARICO' && m.oper.classe !== null) return m.oper.classe
  if (m.oper.tipo === 'ENTRAMBI' && m.oper.codice === '13') return 'R_D'
  return null
}

const verteSuAltraUl = (m: RecordMovimento): boolean =>
  m.oper.tipo === 'ENTRAMBI' || (m.oper.tipo === 'CARICO' && m.oper.classe === null)

export function calcolaGiacenzeAlTaglio(i: IngressiGiacenze): RisultatoGiacenze {
  const avvisi = new Contatori<CodiceAvvisoGiacenze>()
  const scarti = new Contatori<CodiceScartoGiacenze>()
  const famiglie = new Map<string, Famiglia>()

  function famiglia(
    mag: string,
    cerGrezzo: string,
    sf: string,
    pericoloso: boolean
  ): Famiglia | null {
    const m = mag.trim()
    if (m === '' || m === '0') {
      scarti.conta('MAGAZZINO_ASSENTE')
      return null
    }
    const registroId = i.registroDi(m)
    if (registroId === null) {
      scarti.conta('MAGAZZINO_NON_IN_MAPPA')
      return null
    }
    const cifre = cerSoloCifre(cerGrezzo)
    if (cifre.length !== 6) {
      scarti.conta('CER_FORMATO')
      return null
    }
    const stato = statoFisicoPulito(sf)
    if (stato === 'NON_VALIDO') {
      scarti.conta('STATO_FISICO_NON_VALIDO')
      return null
    }
    const chiave = `${registroId}|${cifre}|${stato ?? ''}`
    let f = famiglie.get(chiave)
    if (!f) {
      f = {
        registroId,
        cifre,
        statoFisico: stato,
        pericoloso: false,
        apertura: { RR: 0, RL: 0, DR: 0, DL: 0, DT: 0 },
        carichi: [],
      }
      famiglie.set(chiave, f)
    }
    if (pericoloso) f.pericoloso = true
    return f
  }

  const entroIlTaglio = (d: DataIso | null): boolean => d !== null && d <= i.dataTaglio
  const vivi = i.movimenti.filter(m => !m.annullato)

  // 1. kg scaricati per carico (C), con e senza il limite del taglio.
  const scaricatoTotale = new Map<number, number>()
  const scaricatoAlTaglio = new Map<number, number>()
  const codiciCarico = new Set<number>()
  for (const m of vivi) {
    if (classeCarico(m) !== null) codiciCarico.add(m.cod)
  }
  const segnalatiSenzaCarico = new Set<number>()
  for (const m of vivi) {
    for (const s of m.relaz) {
      if (s.tipo !== 'C') continue
      if (!codiciCarico.has(s.cod) && !segnalatiSenzaCarico.has(s.cod)) {
        segnalatiSenzaCarico.add(s.cod)
        avvisi.conta('SEGMENTO_C_SENZA_CARICO')
      }
      scaricatoTotale.set(s.cod, (scaricatoTotale.get(s.cod) ?? 0) + milli(s.kg))
      if (entroIlTaglio(m.data)) {
        scaricatoAlTaglio.set(s.cod, (scaricatoAlTaglio.get(s.cod) ?? 0) + milli(s.kg))
      }
    }
  }

  // 2. apertura: righe normali di [GIACENZE RIFIUTI].
  for (const r of i.righeGiacenza) {
    if (r.compensazione) {
      avvisi.conta('RIGHE_COMPENSAZIONE_NON_SOMMATE')
      continue
    }
    const totale = CLASSI_APERTURA.reduce((t, c) => t + Math.abs(r.giacenze[c].kg), 0)
    if (totale === 0) continue
    const f = famiglia(r.mag, r.cer, r.sf, false)
    if (f === null) continue
    for (const c of CLASSI_APERTURA) f.apertura[c] += milli(r.giacenze[c].kg)
  }

  // 3. scarichi: i segmenti G e P riducono l'apertura, classe per classe.
  for (const m of vivi) {
    if (!entroIlTaglio(m.data)) continue
    for (const s of m.relaz) {
      if (s.tipo === 'C') continue
      if (s.classe === 'X' || (s.tipo === 'G' && s.riga === 0)) {
        avvisi.conta('DEPOSITO_PRODUTTORE_APERTURA_NON_NELLO_STAGING')
        continue
      }
      const classe = DA_SEGMENTO[s.classe]
      if (classe === undefined || m.cer === null) continue
      const f = famiglia(m.mag1, m.cer.codice, m.statoFisico, m.cer.pericoloso)
      if (f === null) continue
      f.apertura[classe] -= milli(s.kg)
    }
  }

  // 4. carichi aperti dell'anno.
  const differenze: DifferenzaGiascar[] = []
  const fuori: CaricoAltraUl[] = []
  for (const m of vivi) {
    const classe = classeCarico(m)
    if (classe === null) {
      if (verteSuAltraUl(m) && m.data !== null && entroIlTaglio(m.data)) {
        avvisi.conta('CARICO_ALTRA_UL_FUORI_GIACENZA')
        fuori.push({
          cod: m.cod,
          oper: m.oper.codice,
          protocollo: m.registri.find(p => p.protocollo !== null)?.protocollo ?? null,
        })
      }
      continue
    }
    if (m.cer === null || m.data === null || (m.nettoKg ?? 0) <= 0) continue
    if (!entroIlTaglio(m.data)) {
      avvisi.conta('CARICO_DOPO_IL_TAGLIO')
      continue
    }
    if (classe === 'R_D' && !/^[RD]/i.test(m.moda.trim())) {
      scarti.conta('MODA_NON_RICONOSCIUTA')
      continue
    }
    const mag = classe === 'R_D' ? m.mag2 : m.mag1
    const f = famiglia(mag, m.cer.codice, m.statoFisico, m.cer.pericoloso)
    if (f === null) continue
    const nettoMilli = milli(m.nettoKg as number)
    const totaleMilli = scaricatoTotale.get(m.cod) ?? 0
    if (m.giascar !== null) {
      const diff = Math.abs(m.giascar - totaleMilli / 1000)
      if (diff >= SOGLIA_DIFFERENZA_GIASCAR_KG - 1e-9) {
        differenze.push({
          cod: m.cod,
          giascarKg: Math.round(m.giascar * 1000) / 1000,
          ricalcolatoKg: totaleMilli / 1000,
        })
      }
    }
    let residuo = nettoMilli - (scaricatoAlTaglio.get(m.cod) ?? 0)
    if (residuo < 0) {
      avvisi.conta('CARICO_SCARICATO_OLTRE_IL_NETTO')
      residuo = 0
    }
    f.carichi.push({
      anno: Number(m.data.slice(0, 4)),
      protocolli: m.registri,
      residuoMilli: residuo,
    })
  }

  // 5. per famiglia: compensazione, somma in centesimi, origini.
  const out: FamigliaGiacenza[] = []
  const ordinate = [...famiglie.values()].sort((a, b) =>
    a.registroId !== b.registroId
      ? a.registroId < b.registroId
        ? -1
        : 1
      : a.cifre !== b.cifre
        ? a.cifre < b.cifre
          ? -1
          : 1
        : (a.statoFisico ?? '') < (b.statoFisico ?? '')
          ? -1
          : (a.statoFisico ?? '') > (b.statoFisico ?? '')
            ? 1
            : 0
  )
  for (const f of ordinate) {
    const a = f.apertura
    // calcresgiac, punto 3: il negativo di "da terzi" si compensa con "da nostre lavorazioni".
    for (const [x, y] of [
      ['RR', 'RL'],
      ['DR', 'DL'],
    ] as const) {
      for (const [da, verso] of [
        [x, y],
        [y, x],
      ] as const) {
        if (a[da] < 0 && a[verso] > 0) {
          const t = Math.min(-a[da], a[verso])
          a[da] += t
          a[verso] -= t
        }
      }
    }
    let aperturaMilli = 0
    for (const c of CLASSI_APERTURA) {
      if (a[c] < 0) {
        avvisi.conta('GIACENZA_INIZIALE_NEGATIVA')
        continue
      }
      aperturaMilli += a[c]
    }
    const aperturaCent = Math.round(aperturaMilli / 10)
    const componenti = f.carichi
      .map(c => ({ ...c, cent: Math.round(c.residuoMilli / 10) }))
      .filter(c => c.cent > 0)
    const totaleCent = aperturaCent + componenti.reduce((t, c) => t + c.cent, 0)
    if (totaleCent <= 0) continue
    if (aperturaCent > 0) avvisi.conta('ORIGINI_APERTURA_NON_NOTE')

    // Origini: anno e protocollo del carico (registro della famiglia, altrimenti il primo con numero).
    const origini = new Map<string, { anno: number; protocollo: number; cent: number }>()
    for (const c of componenti) {
      const scelto =
        c.protocolli.find(
          p => p.protocollo !== null && i.registroDi(p.registro) === f.registroId
        ) ?? c.protocolli.find(p => p.protocollo !== null)
      if (!scelto || scelto.protocollo === null) {
        avvisi.conta('CARICO_SENZA_PROTOCOLLO')
        continue
      }
      const k = `${c.anno}/${scelto.protocollo}`
      const e = origini.get(k)
      if (e) e.cent += c.cent
      else origini.set(k, { anno: c.anno, protocollo: scelto.protocollo, cent: c.cent })
    }
    let elencoOrigini = [...origini.values()]
      .sort((x, y) => x.anno - y.anno || x.protocollo - y.protocollo)
      .map(o => ({ anno: o.anno, protocollo: o.protocollo, quantita: o.cent / 100 }))
    if (elencoOrigini.length > ORIGINI_MASSIME) {
      avvisi.conta('ORIGINI_OLTRE_IL_LIMITE')
      elencoOrigini = []
    }
    out.push({
      registroId: f.registroId,
      cerCode: `${cerSpaziato(f.cifre)}${f.pericoloso ? '*' : ''}`,
      statoFisico: f.statoFisico,
      quantitaKg: totaleCent / 100,
      origini: elencoOrigini,
    })
  }

  return {
    famiglie: out,
    differenzeGiascar: differenze.sort((x, y) => x.cod - y.cod),
    caricoAltraUl: fuori.sort((x, y) => x.cod - y.cod),
    avvisi: avvisi.elenco(),
    scarti: scarti.elenco(),
  }
}
