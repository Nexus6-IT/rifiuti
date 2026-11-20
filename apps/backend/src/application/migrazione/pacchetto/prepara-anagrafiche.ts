/**
 * `migrazione:prepara`, fase ANAGRAFICHE (I4): CLIFOR + SEDI LEGALI + UNITA LOCALI + AUTORIZZAZIONI +
 * AUTOMEZZI (+ l'uso nei MOVIMENTI/FORMULARI per dedurre i ruoli) -> ditte, sedi, produttori,
 * trasportatori, destinatari, automezzi. Pura: niente Prisma ne' NestJS, gira sulla workstation.
 *
 * REGOLE (decisioni del piano I4, §T1-T2):
 *  - Duplicati SEGNALATI (`DITTA_DUPLICATA`, `TARGA_DUPLICATA`, `SEDE_DUPLICATA`), mai fusi in
 *    silenzio. Gli scarti sono contati per tabella e codice, mai con valori.
 *  - Il ruolo P/T/S e' DEDOTTO dall'uso del soggetto nei movimenti e nei FIR (`PROD`/`TRAS`/`SMAL`).
 *    Senza MOVIMENTI ne FORMULARI nessun ruolo viene inventato (avviso `RUOLI_NON_DEDUCIBILI`).
 *    `INTE` (intermediario) non ha un modello in WasteFlow: contato, non importato.
 *  - Le unita' locali dell'azienda stessa (sito `X<sede>.<ul>`, VERSIS XRENTRI) non sono anagrafiche:
 *    non diventano sedi, ruoli ne' destinatari (`UNITA_LOCALE_PROPRIA`).
 *  - Mai creazione di tenant: l'azienda e' quella della mappa.
 *  - Una ditta agganciata (P.IVA gia' in WasteFlow) non e' inserita; le sue sedi e i suoi ruoli
 *    portano il `dittaId` esistente e nessuna sede e' principale (l'esistente ha gia' la sua).
 *
 * FORMA PRESUNTA (da riverificare sul primo `.bak`): `PRECOD` di UNITA LOCALI = soggetto (6 caratteri,
 * o 7 con il C/F davanti); `PRECOD` di AUTORIZZAZIONI/AUTOMEZZI e `PROD`/`TRAS`/`SMAL` = `soggetto.unita'`
 * (6+1+4); `AUTOMEZZI.RIMORCHIO` vuoto/0/N = motrice.
 *
 * Sedi: la sede legale ha UL riservata `SL` (da SEDI LEGALI, altrimenti dall'indirizzo di CLIFOR), la
 * seconda sede di CLIFOR `S2`; le unita' locali la loro UL. I soggetti con piu' righe CLIFOR (C e F,
 * stessa P.IVA) hanno una sola ditta: le chiavi di sedi e ruoli usano la riga TENUTA.
 */
import {
  chiaveAutomezzo,
  chiaveDitta,
  chiaveSede,
  chiaveSedeDaSoggettoUnita,
  chiaveSoggetto,
} from '../../../domain/migrazione/chiavi-legacy'
import {
  dataAutorizzazione,
  decodificaIndirizzo,
  decodificaTaraKg,
  esRimorchio,
  Indirizzo,
  normalizzaTarga,
  separaSoggettoUnita,
} from '../../../domain/migrazione/winwaste/anagrafica'
import { ElementoLettura, StagingAperto } from '../staging/lettore-staging'
import { PacchettoError } from './errori-pacchetto'
import { MappaImport, partitaIvaItalianaValida } from './mappa-import'
import { codiceFiscaleFormaValida, RecordDitta } from './record-ditta'
import {
  RecordAutomezzo,
  RecordDestinatario,
  RecordProduttore,
  RecordSede,
  RecordTrasportatore,
} from './record-anagrafiche'

export type CodiceScartoPrepara =
  | 'RIGA_ILLEGGIBILE'
  | 'FISCALE_ASSENTE'
  | 'PARTITA_IVA_NON_VALIDA'
  | 'CODICE_FISCALE_NON_VALIDO'
  | 'RAGIONE_SOCIALE_ASSENTE'
  | 'DITTA_DUPLICATA'
  | 'SEDE_LEGALE_INCOMPLETA'
  | 'UNITA_LOCALE_PROPRIA'
  | 'SOGGETTO_NON_RISOLTO'
  | 'SOGGETTO_AMBIGUO'
  | 'CODICE_UNITA_RISERVATO'
  | 'INDIRIZZO_INCOMPLETO'
  | 'SEDE_DUPLICATA'
  | 'INTERMEDIARIO_SENZA_MODELLO'
  | 'RUOLO_SENZA_SEDE'
  | 'NUMERO_ASSENTE'
  | 'RIMORCHIO_NON_IMPORTATO'
  | 'TARGA_NON_VALIDA'
  | 'TARGA_DUPLICATA'
  | 'CHIAVE_NON_VALIDA'
  | 'CHIAVE_DUPLICATA'

export type CodiceAvvisoPrepara =
  | 'SEDE_PRINCIPALE_DEDOTTA'
  | 'RUOLI_NON_DEDUCIBILI'
  | 'RUOLO_DEDOTTO'
  | 'PROPRIETARIO_SENZA_RUOLO'
  | 'PROPRIETARIO_AMBIGUO'
  | 'PROPRIETARIO_NON_RISOLTO'

export interface VoceConteggio<C extends string> {
  readonly tabella: string
  readonly codice: C
  readonly conteggio: number
}

export type RisoluzioneSoggetto =
  | { tipo: 'ok'; tenuto: SoggettoTenuto }
  | { tipo: 'proprio' }
  | { tipo: 'ambiguo' }
  | { tipo: 'sconosciuto' }

/** Soggetto CLIFOR tenuto (una riga per ditta): serve a chi deve riagganciare `PROD`/`TRAS`/`SMAL`. */
export interface SoggettoTenuto {
  readonly dittaKey: string
  readonly prec: string
  readonly cod: string
  readonly dittaId: string | null
}

/**
 * Indice per riagganciare un riferimento WinWaste (`soggetto.unita'`) alle ditte, ai ruoli e alle
 * sedi del pacchetto: lo usano i FIR (I5) e, dopo, il registro (I7), con la STESSA regola di `prepara`.
 */
export interface IndiceAnagrafiche {
  risolvi(codiceSoggetto: string): RisoluzioneSoggetto
  /** PRECOD (C/F) delle righe CLIFOR con quel COD. */
  precPerCod(codiceSoggetto: string): ReadonlySet<string> | undefined
  /** Chiave del ruolo importato per la ditta (`null` se il pacchetto non ne ha). */
  ruoloKey(ruolo: 'produttore' | 'trasportatore' | 'destinatario', dittaKey: string): string | null
  haSede(chiaveSede: string): boolean
  /** Sede legale (o prima unita' locale) della ditta, se il pacchetto ne ha una. */
  sedePredefinita(dittaKey: string): string | null
}

export interface RisultatoAnagrafiche {
  readonly ditte: readonly RecordDitta[]
  readonly sedi: readonly RecordSede[]
  readonly produttori: readonly RecordProduttore[]
  readonly trasportatori: readonly RecordTrasportatore[]
  readonly destinatari: readonly RecordDestinatario[]
  readonly automezzi: readonly RecordAutomezzo[]
  readonly scarti: ReadonlyArray<VoceConteggio<CodiceScartoPrepara>>
  /** Note che non sono scarti (scelte dedotte da controllare). */
  readonly avvisi: ReadonlyArray<VoceConteggio<CodiceAvvisoPrepara>>
  /** Ditte gia' presenti in WasteFlow (agganci della mappa): non vanno nel pacchetto. */
  readonly agganciate: number
  /** Righe scartate come duplicate, con quella tenuta: chiavi legacy, mai valori. `tabella` assente = CLIFOR. */
  readonly duplicati: ReadonlyArray<{ tabella?: string; scartata: string; tenuta: string }>
  readonly indice: IndiceAnagrafiche
}

type Campi = Readonly<Record<string, string | null>>
const T = (v: string | null | undefined): string => (v ?? '').trim()

function ragioneSociale(c: Campi): string {
  return [c.DES, c.EST]
    .map(v => T(v))
    .filter(v => v.length > 0)
    .join(' ')
    .slice(0, 255)
}

// eslint-disable-next-line no-control-regex
const CONTROLLO = /[\u0000-\u001f\u007f]/
const TELEFONO = /^[0-9+ ./()-]{3,20}$/
const telefono = (v: string | null | undefined): string | null =>
  TELEFONO.test(T(v)) ? T(v) : null

interface Tenuto {
  readonly dittaKey: string
  readonly prec: string
  readonly cod: string
  readonly dittaId: string | null
  readonly clifor: Campi
}

class Contatori<C extends string> {
  private readonly m = new Map<string, { tabella: string; codice: C; conteggio: number }>()
  conta(tabella: string, codice: C, n = 1): void {
    const k = `${tabella}|${codice}`
    const v = this.m.get(k)
    if (v) v.conteggio += n
    else this.m.set(k, { tabella, codice, conteggio: n })
  }
  elenco(): Array<VoceConteggio<C>> {
    return [...this.m.values()]
  }
}

async function* righe(
  staging: StagingAperto,
  tabella: string,
  scarto: () => void
): AsyncGenerator<Campi> {
  if (!staging.ha(tabella)) return
  for await (const el of staging.leggi(tabella) as AsyncGenerator<ElementoLettura>) {
    if (el.tipo === 'scarto') scarto()
    else yield el.riga.campi
  }
}

function indirizzoDi(c: Campi, suffisso = ''): Indirizzo | null {
  const r = decodificaIndirizzo({
    via: c[`IND${suffisso}`] ?? null,
    civico: c[`NUM${suffisso}`] ?? null,
    cap: c[`CAP${suffisso}`] ?? null,
    comune: c[`COM${suffisso}`] ?? null,
    provincia: c[suffisso === '2' ? 'PRO2' : 'PROV'] ?? null,
  })
  return r.ok ? r.valore : null
}

const stessoIndirizzo = (a: Indirizzo, b: Indirizzo) =>
  a.via === b.via && a.civico === b.civico && a.cap === b.cap && a.comune === b.comune

/** @throws PacchettoError `FILE_ASSENTE` se manca CLIFOR */
export async function preparaAnagrafiche(
  staging: StagingAperto,
  mappa: MappaImport
): Promise<RisultatoAnagrafiche> {
  if (!staging.ha('CLIFOR'))
    throw new PacchettoError('FILE_ASSENTE', 'lo staging non contiene CLIFOR')
  const scarti = new Contatori<CodiceScartoPrepara>()
  const avvisi = new Contatori<CodiceAvvisoPrepara>()
  const duplicati: Array<{ tabella?: string; scartata: string; tenuta: string }> = []
  const illeggibile = (t: string) => () => scarti.conta(t, 'RIGA_ILLEGGIBILE')

  // ---------------------------------------------------------------- ditte (CLIFOR)
  const ditte: RecordDitta[] = []
  const tenuti = new Map<string, Tenuto>()
  const perRiga = new Map<string, string>() // `PRECOD|COD` -> dittaKey (anche le righe duplicate)
  const perCod = new Map<string, Set<string>>() // COD -> ditte (C e F con lo stesso COD)
  const precPerCod = new Map<string, Set<string>>() // COD -> PRECOD delle righe CLIFOR con quel COD
  const registraCod = (cod: string, prec: string, dittaKey: string) => {
    if (!perCod.has(cod)) perCod.set(cod, new Set())
    perCod.get(cod)!.add(dittaKey)
    if (!precPerCod.has(cod)) precPerCod.set(cod, new Set())
    precPerCod.get(cod)!.add(prec)
  }
  const viste = new Map<string, { chiaveRiga: string; dittaKey: string }>()
  const agganci = new Map(mappa.agganci.map(a => [a.partitaIva, a.dittaId]))
  let agganciate = 0
  for await (const c of righe(staging, 'CLIFOR', illeggibile('CLIFOR'))) {
    const piva = T(c.PIVA)
    const cf = T(c.CODFIS).toUpperCase()
    const rs = ragioneSociale(c)
    if (rs === '') {
      scarti.conta('CLIFOR', 'RAGIONE_SOCIALE_ASSENTE')
      continue
    }
    if (piva === '' && cf === '') {
      scarti.conta('CLIFOR', 'FISCALE_ASSENTE')
      continue
    }
    if (piva !== '' && !partitaIvaItalianaValida(piva)) {
      scarti.conta('CLIFOR', 'PARTITA_IVA_NON_VALIDA')
      continue
    }
    if (cf !== '' && !codiceFiscaleFormaValida(cf)) {
      scarti.conta('CLIFOR', 'CODICE_FISCALE_NON_VALIDO')
      continue
    }
    const prec = T(c.PRECOD)
    const cod = T(c.COD)
    const dittaKey = chiaveDitta(mappa.ditta, piva !== '' ? piva : cf)
    const chiaveRiga = `${mappa.ditta}|${prec}|${cod}`
    const tenuta =
      (piva !== '' ? viste.get(piva) : undefined) ?? (cf !== '' ? viste.get(cf) : undefined)
    if (tenuta) {
      scarti.conta('CLIFOR', 'DITTA_DUPLICATA')
      duplicati.push({ scartata: chiaveRiga, tenuta: tenuta.chiaveRiga })
      perRiga.set(`${prec}|${cod}`, tenuta.dittaKey)
      registraCod(cod, prec, tenuta.dittaKey)
      continue
    }
    const v = { chiaveRiga, dittaKey }
    if (piva !== '') viste.set(piva, v)
    if (cf !== '') viste.set(cf, v)
    const dittaId = piva !== '' ? (agganci.get(piva) ?? null) : null
    if (dittaId !== null) agganciate++
    else
      ditte.push({
        legacyKey: dittaKey,
        ragioneSociale: rs,
        partitaIva: piva || null,
        codiceFiscale: cf || null,
      })
    try {
      chiaveSoggetto(mappa.ditta, prec, cod)
    } catch {
      // PRECOD diverso da C/F o COD non valido: la ditta c'e' ma non ha chiavi per sedi e ruoli.
      continue
    }
    tenuti.set(dittaKey, { dittaKey, prec, cod, dittaId, clifor: c })
    perRiga.set(`${prec}|${cod}`, dittaKey)
    registraCod(cod, prec, dittaKey)
  }

  // Sito proprio: codice soggetto fuori da CLIFOR che comincia per X, o elencato nella mappa.
  const codiciPropri = new Set(mappa.unitaLocali.map(u => u.legacy.split('.')[0].toUpperCase()))
  const eProprio = (cod: string) =>
    !perCod.has(cod) && (/^X/i.test(cod) || codiciPropri.has(cod.toUpperCase()))

  type Risoluzione =
    | { tipo: 'ok'; tenuto: Tenuto }
    | { tipo: 'proprio' }
    | { tipo: 'ambiguo' }
    | { tipo: 'sconosciuto' }
  function risolvi(cod: string): Risoluzione {
    const s = perCod.get(cod)
    if (!s) return eProprio(cod) ? { tipo: 'proprio' } : { tipo: 'sconosciuto' }
    if (s.size > 1) return { tipo: 'ambiguo' }
    const tenuto = tenuti.get([...s][0])
    return tenuto ? { tipo: 'ok', tenuto } : { tipo: 'sconosciuto' }
  }

  // ---------------------------------------------------------------- sedi
  const sedi: RecordSede[] = []
  const chiaviSedi = new Set<string>()
  const sedeDefault = new Map<string, string>()
  const legaleDaSediLegali = new Map<string, Indirizzo>()
  for await (const c of righe(staging, 'SEDI LEGALI', illeggibile('SEDI LEGALI'))) {
    const dittaKey = perRiga.get(`${T(c.PRECOD)}|${T(c.COD)}`)
    const ind = indirizzoDi(c)
    if (dittaKey && ind && !legaleDaSediLegali.has(dittaKey)) legaleDaSediLegali.set(dittaKey, ind)
  }
  /** La chiave sede usa il soggetto WinWaste della RIGA (`prec`/`cod`), mai quello della riga tenuta. */
  const aggiungiSede = (
    t: Tenuto,
    legacyKey: string,
    ind: Indirizzo,
    extra: { denominazione: string | null; telefono: string | null },
    tabella: string
  ): boolean => {
    if (chiaviSedi.has(legacyKey)) {
      scarti.conta(tabella, 'SEDE_DUPLICATA')
      duplicati.push({ tabella, scartata: legacyKey, tenuta: legacyKey })
      return false
    }
    chiaviSedi.add(legacyKey)
    sedi.push({
      legacyKey,
      dittaKey: t.dittaKey,
      dittaId: t.dittaId,
      denominazione: extra.denominazione,
      ...ind,
      telefono: extra.telefono,
      principale: false,
    })
    return true
  }
  const legali = new Set<string>()
  for (const t of tenuti.values()) {
    const ind = legaleDaSediLegali.get(t.dittaKey) ?? indirizzoDi(t.clifor)
    if (!ind) {
      scarti.conta('CLIFOR', 'SEDE_LEGALE_INCOMPLETA')
    } else if (
      aggiungiSede(
        t,
        chiaveSede(mappa.ditta, t.prec, t.cod, 'SL'),
        ind,
        { denominazione: null, telefono: telefono(t.clifor.TEL) },
        'CLIFOR'
      )
    ) {
      legali.add(t.dittaKey)
    }
    const seconda = indirizzoDi(t.clifor, '2')
    if (seconda && !(ind && stessoIndirizzo(ind, seconda))) {
      const den = [T(t.clifor.RAG2), T(t.clifor.EST2)].filter(Boolean).join(' ').slice(0, 255)
      aggiungiSede(
        t,
        chiaveSede(mappa.ditta, t.prec, t.cod, 'S2'),
        seconda,
        { denominazione: den || null, telefono: null },
        'CLIFOR'
      )
    }
  }
  const unitaDi = new Map<string, string[]>() // dittaKey -> chiavi UL, per la sede predefinita
  for await (const c of righe(staging, 'UNITA LOCALI', illeggibile('UNITA LOCALI'))) {
    const sep = separaSoggettoUnita(c.PRECOD)
    const ul = T(c.COD)
    if (!sep) {
      scarti.conta('UNITA LOCALI', 'SOGGETTO_NON_RISOLTO')
      continue
    }
    const r = risolvi(sep.soggetto)
    if (r.tipo === 'proprio') {
      scarti.conta('UNITA LOCALI', 'UNITA_LOCALE_PROPRIA')
      continue
    }
    if (r.tipo === 'ambiguo') {
      scarti.conta('UNITA LOCALI', 'SOGGETTO_AMBIGUO')
      continue
    }
    if (r.tipo === 'sconosciuto') {
      scarti.conta('UNITA LOCALI', 'SOGGETTO_NON_RISOLTO')
      continue
    }
    if (ul === 'SL' || ul === 'S2') {
      scarti.conta('UNITA LOCALI', 'CODICE_UNITA_RISERVATO')
      continue
    }
    const ind = indirizzoDi(c)
    if (!ind) {
      scarti.conta('UNITA LOCALI', 'INDIRIZZO_INCOMPLETO')
      continue
    }
    // Soggetto della RIGA: regola unica in `chiavi-legacy` (la usano anche FIR e registro).
    let legacyKey: string
    try {
      legacyKey = chiaveSedeDaSoggettoUnita(mappa.ditta, sep, ul, {
        precPerCod: precPerCod.get(sep.soggetto),
        precTenuto: r.tenuto.prec,
      })
    } catch {
      scarti.conta('UNITA LOCALI', 'CHIAVE_NON_VALIDA')
      continue
    }
    const den = T(c.DES).slice(0, 255)
    if (
      aggiungiSede(
        r.tenuto,
        legacyKey,
        ind,
        { denominazione: den || null, telefono: telefono(c.TEL) },
        'UNITA LOCALI'
      )
    ) {
      const l = unitaDi.get(r.tenuto.dittaKey) ?? []
      l.push(legacyKey)
      unitaDi.set(r.tenuto.dittaKey, l)
    }
  }
  // Principale: la sede legale; senza, la prima unita' locale (DEDOTTA). Mai su una ditta agganciata.
  const principali = new Set<string>()
  for (const t of tenuti.values()) {
    const slKey = chiaveSede(mappa.ditta, t.prec, t.cod, 'SL')
    if (legali.has(t.dittaKey)) {
      sedeDefault.set(t.dittaKey, slKey)
      if (t.dittaId === null) principali.add(slKey)
    } else {
      // solo UL del soggetto tenuto: la sede predefinita di un ruolo e' di quel soggetto
      const proprie = `${mappa.ditta}|${t.prec}|${t.cod}|`
      const prima = [...(unitaDi.get(t.dittaKey) ?? [])]
        .filter(k => k.startsWith(proprie))
        .sort()[0]
      if (prima) {
        sedeDefault.set(t.dittaKey, prima)
        if (t.dittaId === null) {
          principali.add(prima)
          avvisi.conta('CLIFOR', 'SEDE_PRINCIPALE_DEDOTTA')
        }
      }
    }
  }
  const sediFinali = sedi.map(s => (principali.has(s.legacyKey) ? { ...s, principale: true } : s))

  // ---------------------------------------------------------------- ruoli (uso nei movimenti)
  const autorizzazioni = new Map<string, { numero: string; scadenza: string | null }>()
  for await (const c of righe(staging, 'AUTORIZZAZIONI', illeggibile('AUTORIZZAZIONI'))) {
    const chiave = `${T(c.PRECOD)}|${T(c.COD)}`
    const numero = T(c.NUM)
    if (numero !== '' && !autorizzazioni.has(chiave))
      autorizzazioni.set(chiave, { numero, scadenza: dataAutorizzazione(c.SCAD) })
  }
  interface Uso {
    P: boolean
    T: Map<string, number>
    S: Map<string, number>
  }
  const uso = new Map<string, Uso>()
  const distinti = new Set<string>()
  const conteggiaUnaVolta = (id: string, tabella: string, codice: CodiceScartoPrepara) => {
    if (distinti.has(`${codice}|${id}`)) return
    distinti.add(`${codice}|${id}`)
    scarti.conta(tabella, codice)
  }
  const haEvidenza = staging.ha('MOVIMENTI') || staging.ha('FORMULARI')
  if (!haEvidenza) avvisi.conta('MOVIMENTI', 'RUOLI_NON_DEDUCIBILI')
  for (const tabella of ['MOVIMENTI', 'FORMULARI']) {
    for await (const c of righe(staging, tabella, illeggibile(tabella))) {
      for (const [campo, aut, ruolo] of [
        ['PROD', 'AUTP', 'P'],
        ['TRAS', 'AUTT', 'T'],
        ['SMAL', 'AUTS', 'S'],
        ['INTE', 'AUTI', 'I'],
      ] as const) {
        const sep = separaSoggettoUnita(c[campo])
        if (!sep) continue
        const r = risolvi(sep.soggetto)
        if (r.tipo === 'proprio') continue
        if (r.tipo === 'sconosciuto') {
          conteggiaUnaVolta(`${campo}|${sep.soggetto}`, 'MOVIMENTI', 'SOGGETTO_NON_RISOLTO')
          continue
        }
        if (r.tipo === 'ambiguo') {
          conteggiaUnaVolta(`${campo}|${sep.soggetto}`, 'MOVIMENTI', 'SOGGETTO_AMBIGUO')
          continue
        }
        if (ruolo === 'I') {
          conteggiaUnaVolta(`${sep.soggetto}`, 'MOVIMENTI', 'INTERMEDIARIO_SENZA_MODELLO')
          continue
        }
        const u = uso.get(r.tenuto.dittaKey) ?? { P: false, T: new Map(), S: new Map() }
        uso.set(r.tenuto.dittaKey, u)
        if (ruolo === 'P') u.P = true
        else {
          const codAut = T(c[aut])
          const k = `${T(c[campo])}|${codAut}`
          const m = ruolo === 'T' ? u.T : u.S
          m.set(k, (m.get(k) ?? 0) + (codAut === '' ? 0 : 1))
          if (!m.has(k)) m.set(k, 0)
        }
      }
    }
  }
  const migliore = (m: Map<string, number>) => {
    for (const [k] of [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
      const a = autorizzazioni.get(k)
      if (a && a.numero.length <= 50) return a
    }
    return null
  }
  const produttori: RecordProduttore[] = []
  const trasportatori: RecordTrasportatore[] = []
  const destinatari: RecordDestinatario[] = []
  const chiaveRuolo = new Map<string, string>() // dittaKey -> chiave del ruolo trasportatore
  for (const [dittaKey, u] of [...uso.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const t = tenuti.get(dittaKey)!
    const sedeKey = sedeDefault.get(dittaKey)
    const legacyKey = chiaveSoggetto(mappa.ditta, t.prec, t.cod)
    const base = { legacyKey, dittaKey, dittaId: t.dittaId }
    if (!sedeKey) {
      scarti.conta(
        'CLIFOR',
        'RUOLO_SENZA_SEDE',
        Number(u.P) + Number(u.T.size > 0) + Number(u.S.size > 0)
      )
      continue
    }
    if (u.P) {
      produttori.push({ ...base, sedeKey })
      avvisi.conta('PRODUTTORI', 'RUOLO_DEDOTTO')
    }
    if (u.T.size > 0) {
      const a = migliore(u.T)
      if (!a) scarti.conta('AUTORIZZAZIONI', 'NUMERO_ASSENTE')
      else {
        trasportatori.push({
          ...base,
          sedeKey,
          numeroIscrizione: a.numero,
          scadenzaIscrizione: a.scadenza,
        })
        chiaveRuolo.set(dittaKey, legacyKey)
        avvisi.conta('TRASPORTATORI', 'RUOLO_DEDOTTO')
      }
    }
    if (u.S.size > 0) {
      const a = migliore(u.S)
      if (!a) scarti.conta('AUTORIZZAZIONI', 'NUMERO_ASSENTE')
      else {
        destinatari.push({
          ...base,
          sedeKey,
          numeroAutorizzazione: a.numero,
          scadenzaAutorizzazione: a.scadenza,
        })
        avvisi.conta('DESTINATARI', 'RUOLO_DEDOTTO')
      }
    }
  }

  // ---------------------------------------------------------------- automezzi
  const automezzi: RecordAutomezzo[] = []
  const chiaviMezzi = new Map<string, string>() // chiave -> chiave (doppioni di PRECOD+COD)
  const targhe = new Map<string, string>() // targa -> chiave del mezzo tenuto
  for await (const c of righe(staging, 'AUTOMEZZI', illeggibile('AUTOMEZZI'))) {
    let legacyKey: string
    try {
      legacyKey = chiaveAutomezzo(mappa.ditta, T(c.PRECOD), T(c.COD))
    } catch {
      scarti.conta('AUTOMEZZI', 'CHIAVE_NON_VALIDA')
      continue
    }
    if (chiaviMezzi.has(legacyKey)) {
      scarti.conta('AUTOMEZZI', 'CHIAVE_DUPLICATA')
      duplicati.push({ tabella: 'AUTOMEZZI', scartata: legacyKey, tenuta: legacyKey })
      continue
    }
    chiaviMezzi.set(legacyKey, legacyKey)
    if (esRimorchio(c.RIMORCHIO)) {
      scarti.conta('AUTOMEZZI', 'RIMORCHIO_NON_IMPORTATO')
      continue
    }
    const targa = normalizzaTarga(c.TARGA)
    if (!targa) {
      scarti.conta('AUTOMEZZI', 'TARGA_NON_VALIDA')
      continue
    }
    const tenutoDa = targhe.get(targa)
    if (tenutoDa) {
      scarti.conta('AUTOMEZZI', 'TARGA_DUPLICATA')
      duplicati.push({ tabella: 'AUTOMEZZI', scartata: legacyKey, tenuta: tenutoDa })
      continue
    }
    targhe.set(targa, legacyKey)
    // Proprietario: il ruolo trasportatore del soggetto, se c'e'; il parco proprio non ne ha.
    let trasportatoreKey: string | null = null
    const sep = separaSoggettoUnita(c.PRECOD)
    if (sep) {
      const r = risolvi(sep.soggetto)
      if (r.tipo === 'ok') {
        trasportatoreKey = chiaveRuolo.get(r.tenuto.dittaKey) ?? null
        if (trasportatoreKey === null) avvisi.conta('AUTOMEZZI', 'PROPRIETARIO_SENZA_RUOLO')
      } else if (r.tipo === 'ambiguo') avvisi.conta('AUTOMEZZI', 'PROPRIETARIO_AMBIGUO')
      else if (r.tipo === 'sconosciuto') avvisi.conta('AUTOMEZZI', 'PROPRIETARIO_NON_RISOLTO')
    }
    const nota = T(c.DES).slice(0, 500)
    automezzi.push({
      legacyKey,
      targa,
      trasportatoreKey,
      taraKg: decodificaTaraKg(c.TARA),
      note: nota !== '' && !CONTROLLO.test(nota) ? nota : null,
    })
  }

  const chiaviRuoli = {
    produttore: new Set(produttori.map(r => r.dittaKey)),
    trasportatore: new Set(trasportatori.map(r => r.dittaKey)),
    destinatario: new Set(destinatari.map(r => r.dittaKey)),
  }
  const indice: IndiceAnagrafiche = {
    risolvi: cod => {
      const r = risolvi(cod)
      if (r.tipo !== 'ok') return r
      const { dittaKey, prec, cod: c, dittaId } = r.tenuto
      return { tipo: 'ok', tenuto: { dittaKey, prec, cod: c, dittaId } }
    },
    precPerCod: cod => precPerCod.get(cod),
    ruoloKey: (ruolo, dittaKey) => {
      const t = tenuti.get(dittaKey)
      return t && chiaviRuoli[ruolo].has(dittaKey)
        ? chiaveSoggetto(mappa.ditta, t.prec, t.cod)
        : null
    },
    haSede: chiave => chiaviSedi.has(chiave),
    sedePredefinita: dittaKey => sedeDefault.get(dittaKey) ?? null,
  }

  return {
    ditte,
    sedi: sediFinali,
    produttori,
    trasportatori,
    destinatari,
    automezzi,
    scarti: scarti.elenco(),
    avvisi: avvisi.elenco(),
    agganciate,
    duplicati,
    indice,
  }
}
