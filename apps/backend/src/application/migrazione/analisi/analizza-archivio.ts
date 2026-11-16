import {
  RecordCausaleRifiuti,
  RecordFormulario,
  RecordGiacenzaRifiuti,
  RecordMovimento,
  RecordRegistroRifiuti,
  RecordRenRegistrazione,
  RecordVersis,
} from '../../../domain/migrazione/winwaste/record'
import { StagingAperto } from '../staging/lettore-staging'
import { parsaCausaliRifiuti } from '../staging/parser/causali-rifiuti'
import { parsaFormulari } from '../staging/parser/formulari'
import { parsaGiacenzeRifiuti } from '../staging/parser/giacenze-rifiuti'
import { parsaMovimenti } from '../staging/parser/movimenti'
import { parsaRegistriRifiuti } from '../staging/parser/registri-rifiuti'
import { parsaRenRegistrazioni } from '../staging/parser/ren-registrazioni'
import { ContestoParser, EsitoParser, Segnalazione, sorgenteDa } from '../staging/parser/scarti'
import { parsaVersis } from '../staging/parser/versis'
import {
  Confronto1,
  Confronto3,
  Confronto4,
  Confronto5,
  ConteggioCodice,
  DifferenzaCarico,
  FORMATO_RAPPORTO,
  GiacenzaAlTaglio,
  GruppoProtocolli,
  RapportoSorgente,
  RigaTotale,
  SintesiTabella,
} from './rapporto-sorgente'

/**
 * Analizzatore dello staging WinWaste: legge, decodifica e produce il lato
 * "sorgente" dei confronti di riconciliazione (rapporto 04 §4.5, confronti
 * 1-5). NON apre il database e non importa Prisma ne NestJS (spec
 * `senza-database.spec.ts`). Gli scarti non sono un errore: finiscono nel
 * rapporto.
 */
export interface OpzioniAnalisi {
  /** Massimo di scarti elencati per esteso nel rapporto (i conteggi restano completi). */
  readonly maxScartiElencati?: number
  /** Massimo di buchi di protocollo elencati per registro. */
  readonly maxBuchi?: number
}

const SOGLIA_KG = 0.001
const ORDINE_TABELLE = [
  'MOVIMENTI',
  'FORMULARI',
  'GIACENZE RIFIUTI',
  'CAUSALI RIFIUTI',
  'REGISTRI RIFIUTI',
  'VERSIS',
  'RENregistrazioni',
] as const

const micro = (x: number): number => Math.round(x * 1e6)
const kg3 = (m: number): number => Math.round(m / 1000) / 1000
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const ordTabella = (t: string): number =>
  ORDINE_TABELLE.indexOf(t as (typeof ORDINE_TABELLE)[number])

function vuoto<R>(tabella: string): EsitoParser<R> {
  return { tabella, righeLette: 0, record: [], scarti: [], avvisi: [] }
}

function conteggiPerCodice(
  esiti: readonly { scarti: readonly Segnalazione[]; avvisi: readonly Segnalazione[] }[],
  campo: 'scarti' | 'avvisi'
): ConteggioCodice[] {
  const m = new Map<string, ConteggioCodice>()
  for (const e of esiti) {
    for (const s of e[campo]) {
      const k = `${s.tabella}|${s.codice}`
      const x = m.get(k)
      m.set(k, { tabella: s.tabella, codice: s.codice, conteggio: (x?.conteggio ?? 0) + 1 })
    }
  }
  return [...m.values()].sort(
    (a, b) => ordTabella(a.tabella) - ordTabella(b.tabella) || cmp(a.codice, b.codice)
  )
}

function contaPerChiave<T>(elementi: readonly T[], chiave: (e: T) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of elementi) m.set(chiave(e), (m.get(chiave(e)) ?? 0) + 1)
  return m
}

export async function analizzaArchivio(
  staging: StagingAperto,
  opzioni: OpzioniAnalisi = {}
): Promise<RapportoSorgente> {
  const maxScarti = opzioni.maxScartiElencati ?? 1000
  const maxBuchi = opzioni.maxBuchi ?? 200
  const { manifest } = staging
  const ctx: ContestoParser = { ditta: manifest.ditta, anno: manifest.anno }

  const movimenti = staging.ha('MOVIMENTI')
    ? await parsaMovimenti(sorgenteDa(staging, 'MOVIMENTI'), ctx)
    : vuoto<RecordMovimento>('MOVIMENTI')
  const formulari = staging.ha('FORMULARI')
    ? await parsaFormulari(sorgenteDa(staging, 'FORMULARI'), ctx)
    : vuoto<RecordFormulario>('FORMULARI')
  const giacenze = staging.ha('GIACENZE RIFIUTI')
    ? await parsaGiacenzeRifiuti(sorgenteDa(staging, 'GIACENZE RIFIUTI'))
    : vuoto<RecordGiacenzaRifiuti>('GIACENZE RIFIUTI')
  const causali = staging.ha('CAUSALI RIFIUTI')
    ? await parsaCausaliRifiuti(sorgenteDa(staging, 'CAUSALI RIFIUTI'))
    : vuoto<RecordCausaleRifiuti>('CAUSALI RIFIUTI')
  const registri = staging.ha('REGISTRI RIFIUTI')
    ? await parsaRegistriRifiuti(sorgenteDa(staging, 'REGISTRI RIFIUTI'))
    : vuoto<RecordRegistroRifiuti>('REGISTRI RIFIUTI')
  const versis = staging.ha('VERSIS')
    ? await parsaVersis(sorgenteDa(staging, 'VERSIS'))
    : vuoto<RecordVersis>('VERSIS')
  const ren = staging.ha('RENregistrazioni')
    ? await parsaRenRegistrazioni(sorgenteDa(staging, 'RENregistrazioni'))
    : vuoto<RecordRenRegistrazione>('RENregistrazioni')

  const esiti: EsitoParser<unknown>[] = [
    movimenti,
    formulari,
    giacenze,
    causali,
    registri,
    versis,
    ren,
  ]

  const perTabella: SintesiTabella[] = esiti.map(e => ({
    tabella: e.tabella,
    presente: staging.ha(e.tabella),
    righeDichiarate: manifest.tabelle[e.tabella]?.righe ?? 0,
    righeLette: e.righeLette,
    record: e.record.length,
    scartate: e.scarti.length,
    conAvvisi: new Set(e.avvisi.map(a => a.riga)).size,
  }))

  const tuttiScarti = esiti
    .flatMap(e => e.scarti)
    .sort((a, b) => ordTabella(a.tabella) - ordTabella(b.tabella) || a.riga - b.riga)

  const attivi = movimenti.record.filter(m => !m.annullato)

  // --- Confronto 1 -----------------------------------------------------------
  const perCausale = new Map<string, { attivi: number; annullati: number }>()
  const perOper = new Map<
    string,
    { tipo: string; dedotta: boolean; attivi: number; annullati: number }
  >()
  for (const m of movimenti.record) {
    const c = perCausale.get(m.causale) ?? { attivi: 0, annullati: 0 }
    c[m.annullato ? 'annullati' : 'attivi']++
    perCausale.set(m.causale, c)
    const o = perOper.get(m.oper.codice) ?? {
      tipo: m.oper.tipo,
      dedotta: m.oper.dedotta,
      attivi: 0,
      annullati: 0,
    }
    o[m.annullato ? 'annullati' : 'attivi']++
    perOper.set(m.oper.codice, o)
  }
  const confronto1: Confronto1 = {
    perTabella,
    movimentiPerCausale: [...perCausale.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([causale, v]) => ({ causale, ...v })),
    movimentiPerOper: [...perOper.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([oper, v]) => ({ oper, ...v })),
    formulariPerStato: [...contaPerChiave(formulari.record, f => f.statoFir)]
      .sort(([a], [b]) => cmp(a, b))
      .map(([stato, conteggio]) => ({ stato, conteggio })),
  }

  // --- Confronto 2 -----------------------------------------------------------
  const tot = new Map<
    string,
    {
      anno: number | null
      cer: string
      tipo: string
      n: number
      kg: number
      m3: number
      senza: number
    }
  >()
  for (const m of attivi) {
    const anno = m.data ? Number(m.data.slice(0, 4)) : null
    const cer = m.cer?.codice ?? '(assente)'
    const k = `${anno}|${cer}|${m.oper.tipo}`
    const t = tot.get(k) ?? { anno, cer, tipo: m.oper.tipo, n: 0, kg: 0, m3: 0, senza: 0 }
    t.n++
    if (m.kgnum === null) t.senza++
    else t.kg += micro(m.kgnum)
    t.m3 += micro(m.mcnum ?? 0)
    tot.set(k, t)
  }
  const confronto2 = {
    righe: [...tot.values()]
      .sort((a, b) => cmp(a.cer, b.cer) || (a.anno ?? 0) - (b.anno ?? 0) || cmp(a.tipo, b.tipo))
      .map<RigaTotale>(t => ({
        anno: t.anno,
        cer: t.cer,
        tipo: t.tipo,
        movimenti: t.n,
        kgnum: kg3(t.kg),
        mcnum: kg3(t.m3),
        senzaKgnum: t.senza,
      })),
  }

  // --- Confronto 3 -----------------------------------------------------------
  const scaricatoPerCarico = new Map<number, number>()
  const scaricatoG: Record<string, number> = { G0: 0, G1: 0, G2: 0, G3: 0, G4: 0, G5: 0 }
  let scaricatoP = 0
  for (const m of attivi) {
    for (const s of m.relaz) {
      if (s.tipo === 'G') scaricatoG[`G${s.riga}`] += micro(s.kg)
      else if (s.tipo === 'C') {
        scaricatoPerCarico.set(s.cod, (scaricatoPerCarico.get(s.cod) ?? 0) + micro(s.kg))
      } else scaricatoP += micro(s.kg)
    }
  }
  const carichi = attivi.filter(m => m.oper.tipo === 'CARICO' || m.oper.tipo === 'ENTRAMBI')
  const codiciCarico = new Set(carichi.map(m => m.cod))
  const differenze: DifferenzaCarico[] = []
  const gruppi = new Map<
    string,
    {
      g: Omit<GiacenzaAlTaglio, 'residuoDaRelaz' | 'residuoDaGiascar' | 'differenza'>
      relaz: number
      giascar: number
    }
  >()
  for (const c of carichi) {
    const kgnum = micro(c.kgnum ?? c.nettoKg ?? 0)
    const giascar = micro(c.giascar ?? 0)
    const daRelaz = scaricatoPerCarico.get(c.cod) ?? 0
    if (Math.abs(giascar - daRelaz) >= micro(SOGLIA_KG)) {
      differenze.push({
        cod: c.cod,
        cer: c.cer?.codice ?? '(assente)',
        kgnum: kg3(kgnum),
        giascar: kg3(giascar),
        scaricatoDaRelaz: kg3(daRelaz),
        differenza: kg3(giascar - daRelaz),
      })
    }
    const classe = c.stato.slice(0, 1) || '?'
    const posizione = c.stato.slice(1, 4)
    const magazzino = classe === 'T' || classe === 'X' ? c.mag1 : c.mag2 || c.mag1
    const cer = c.cer?.codice ?? '(assente)'
    const k = `${cer}|${classe}|${posizione}|${magazzino}`
    const g = gruppi.get(k) ?? {
      g: { cer, classe, posizione, magazzino, carichi: 0 },
      relaz: 0,
      giascar: 0,
    }
    g.g = { ...g.g, carichi: g.g.carichi + 1 }
    g.relaz += kgnum - daRelaz
    g.giascar += kgnum - giascar
    gruppi.set(k, g)
  }
  const confronto3: Confronto3 = {
    carichiEsaminati: carichi.length,
    sogliaKg: SOGLIA_KG,
    differenze: differenze.sort((a, b) => a.cod - b.cod),
    carichiCitatiInesistenti: [...scaricatoPerCarico.entries()]
      .filter(([cod]) => !codiciCarico.has(cod))
      .sort(([a], [b]) => a - b)
      .map(([cod, kg]) => ({ cod, kg: kg3(kg) })),
    scaricatoDaGiacenzeIniziali: Object.fromEntries(
      Object.entries(scaricatoG).map(([k, v]) => [k, kg3(v)])
    ),
    scaricatoDaAnnoPrecedente: kg3(scaricatoP),
    giacenzaAlTaglio: [...gruppi.values()]
      .sort(
        (a, b) =>
          cmp(a.g.cer, b.g.cer) ||
          cmp(a.g.classe + a.g.posizione, b.g.classe + b.g.posizione) ||
          cmp(a.g.magazzino, b.g.magazzino)
      )
      .map(x => ({
        ...x.g,
        residuoDaRelaz: kg3(x.relaz),
        residuoDaGiascar: kg3(x.giascar),
        differenza: kg3(x.giascar - x.relaz),
      })),
  }

  // --- Confronto 4 -----------------------------------------------------------
  const stampati = new Map<string, number | null>(
    registri.record.map(r => [r.cod, r.ultimoProtocollo])
  )
  const protocolli = new Map<string, { registro: string; anno: number; numeri: number[] }>()
  for (const m of movimenti.record) {
    const anno = m.data ? Number(m.data.slice(0, 4)) : manifest.anno
    for (const r of m.registri) {
      if (r.protocollo === null) continue
      const k = `${r.registro}|${anno}`
      const g = protocolli.get(k) ?? { registro: r.registro, anno, numeri: [] }
      g.numeri.push(r.protocollo)
      protocolli.set(k, g)
    }
  }
  const gruppiProtocolli: GruppoProtocolli[] = [...protocolli.values()]
    .sort((a, b) => cmp(a.registro, b.registro) || a.anno - b.anno)
    .map(g => {
      const ord = [...g.numeri].sort((a, b) => a - b)
      const unici = [...new Set(ord)]
      const duplicati = [...new Set(ord.filter((x, i) => i > 0 && ord[i - 1] === x))]
      const buchi: number[] = []
      let buchiTotali = 0
      for (let i = 1; i < unici.length; i++) {
        for (let p = unici[i - 1] + 1; p < unici[i]; p++) {
          buchiTotali++
          if (buchi.length < maxBuchi) buchi.push(p)
        }
      }
      return {
        registro: g.registro,
        anno: g.anno,
        conteggio: ord.length,
        primo: unici[0],
        ultimo: unici[unici.length - 1],
        buchi,
        buchiTotali,
        duplicati,
        ultimoStampato: stampati.get(g.registro) ?? null,
      }
    })
  const serie = new Map<string, { serie: string; anno2: string; numeri: number[] }>()
  for (const f of formulari.record) {
    if (!f.serieNumero) continue
    const k = `${f.serieNumero.serie}|${f.serieNumero.anno2}`
    const s = serie.get(k) ?? { serie: f.serieNumero.serie, anno2: f.serieNumero.anno2, numeri: [] }
    s.numeri.push(f.serieNumero.numero)
    serie.set(k, s)
  }
  const confronto4: Confronto4 = {
    registri: gruppiProtocolli,
    firPerSerie: [...serie.values()]
      .sort((a, b) => cmp(a.serie, b.serie) || cmp(a.anno2, b.anno2))
      .map(s => ({
        serie: s.serie,
        anno2: s.anno2,
        conteggio: s.numeri.length,
        primo: Math.min(...s.numeri),
        ultimo: Math.max(...s.numeri),
      })),
  }

  // --- Confronto 5 -----------------------------------------------------------
  const codiciMovimento = new Set(movimenti.record.map(m => m.cod))
  const confronto5: Confronto5 = {
    versis: staging.ha('VERSIS')
      ? {
          presente: true,
          righe: versis.record.length,
          perPrefisso: Object.fromEntries(
            [...contaPerChiave(versis.record, v => v.prefisso || '(nessuno)')].sort(([a], [b]) =>
              cmp(a, b)
            )
          ),
          righeSensibili: versis.record.filter(v => v.sensibile).length,
        }
      : { presente: false },
    renRegistrazioni: staging.ha('RENregistrazioni')
      ? (() => {
          const rr = ren.record
          return {
            presente: true as const,
            righe: rr.length,
            inviate: rr.filter(r => r.inviata).length,
            conIdRentri: rr.filter(r => r.idRentri !== '').length,
            inviateSenzaIdRentri: rr.filter(r => r.inviata && r.idRentri === '').length,
            movimentiRiferitiInesistenti: rr.filter(
              r => r.annoMovimento === String(manifest.anno) && !codiciMovimento.has(r.codMovimento)
            ).length,
          }
        })()
      : { presente: false as const, nota: 'tabelle RENTRI assenti dallo staging' },
  }

  const dedotte = [...perOper.entries()]
    .filter(([, v]) => v.dedotta)
    .sort(([a], [b]) => cmp(a, b))
    .map(([oper, v]) => ({ oper, movimenti: v.attivi + v.annullati }))

  return {
    formato: FORMATO_RAPPORTO,
    archivio: staging.archivio,
    ditta: manifest.ditta,
    anno: manifest.anno,
    estrattoIl: manifest.estrattoIl,
    hashManifest: staging.hashManifest,
    avvisiStaging: [...staging.avvisi],
    scartiPerCodice: conteggiPerCodice(esiti, 'scarti'),
    avvisiPerCodice: conteggiPerCodice(esiti, 'avvisi'),
    scarti: tuttiScarti.slice(0, maxScarti),
    scartiTroncati: tuttiScarti.length > maxScarti,
    confronto1,
    confronto2,
    confronto3,
    confronto4,
    confronto5,
    corrispondenzeDedotte: dedotte,
  }
}
