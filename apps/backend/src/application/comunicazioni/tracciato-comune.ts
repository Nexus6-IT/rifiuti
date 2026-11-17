/**
 * Utilita' comuni ai preparatori dei tracciati a record (CONOU e COBAT, 4.9c-d B5): risoluzione
 * ISTAT/regione con poche query fisse, soggetti «noi», avvisi aggregati per movimento.
 */
import type { PrismaClient } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { codiceRegione, letteraRegione } from '../../domain/comunicazioni/regioni-istat'
import type { MovimentoAvviso } from './comunicazioni-orso.port'
import type {
  AvvisoTracciato,
  AziendaPropria,
  CorrezioneAvviso,
} from './comunicazioni-tracciato.port'
import type { SedeDettaglio } from './lettore-dettagli-tracciato'
import type { MovimentoOrso } from './lettore-movimenti-orso'

export type DbIstat = Pick<PrismaClient, 'istatComune' | 'istatProvincia'>

/** Chiave di confronto per i nomi dei comuni: senza accenti, apostrofi uniformi, minuscola. */
export function chiaveNomeComune(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export interface IstatRisolto {
  /** Codice ISTAT del comune, 6 cifre. */
  istat6: string
  /** Regione: nome, codice ISTAT a 2 cifre e lettera di WinWaste. */
  regioneCodice: string
  regioneLettera: string
}

export interface ComuneNoto {
  code: string
  name: string
  provinciaSigla: string
  cap: string | null
}

export interface SedeIstat {
  comune: string
  provincia: string
  /** Forzatura dalla scheda della sede (D3), se presente. */
  codiceIstatForzato?: string | null
}

/** Catalogo ISTAT caricato in due query fisse (comuni delle province coinvolte, tutte le province). */
export class CatalogoIstat {
  private constructor(
    private readonly comuniPerNome: ReadonlyMap<string, ComuneNoto>,
    private readonly comuniPerCodice: ReadonlyMap<string, ComuneNoto>,
    private readonly provinciePerSigla: ReadonlyMap<string, string>,
    private readonly provinciePerCodice: ReadonlyMap<string, string>
  ) {}

  static async carica(
    db: DbIstat,
    sedi: ReadonlyArray<SedeIstat>,
    codiciExtra: ReadonlyArray<string> = []
  ): Promise<CatalogoIstat> {
    const sigle = [
      ...new Set(sedi.map(s => s.provincia.trim().toUpperCase()).filter(s => s.length === 2)),
    ]
    const forzati = [
      ...new Set(
        [...sedi.map(s => s.codiceIstatForzato ?? ''), ...codiciExtra].filter(c =>
          /^\d{6}$/.test(c)
        )
      ),
    ]
    const [comuni, province] = await Promise.all([
      sigle.length > 0 || forzati.length > 0
        ? db.istatComune.findMany({
            where: {
              OR: [
                ...(sigle.length > 0 ? [{ provinciaSigla: { in: sigle } }] : []),
                ...(forzati.length > 0 ? [{ code: { in: forzati } }] : []),
              ],
            },
            select: { code: true, name: true, provinciaSigla: true, cap: true },
          })
        : Promise.resolve([]),
      db.istatProvincia.findMany({ select: { sigla: true, code: true, regione: true } }),
    ])
    const perNome = new Map<string, ComuneNoto>()
    const perCodice = new Map<string, ComuneNoto>()
    for (const c of comuni) {
      perNome.set(`${c.provinciaSigla}|${chiaveNomeComune(c.name)}`, c)
      perCodice.set(c.code, c)
    }
    return new CatalogoIstat(
      perNome,
      perCodice,
      new Map(province.map(p => [p.sigla, p.regione])),
      new Map(province.map(p => [p.code, p.regione]))
    )
  }

  /** Comune per codice ISTAT a 6 cifre (nome, provincia, CAP), o `null`. */
  comune(codice: string): ComuneNoto | null {
    return this.comuniPerCodice.get(codice) ?? null
  }

  /** ISTAT e regione di una sede: la forzatura (D3) vince sulla risoluzione per nome. `null` se non risolvibile. */
  risolvi(sede: SedeIstat): IstatRisolto | null {
    let istat6: string | null = null
    let nomeRegione: string | undefined
    if (sede.codiceIstatForzato && /^\d{6}$/.test(sede.codiceIstatForzato)) {
      istat6 = sede.codiceIstatForzato
      nomeRegione = this.provinciePerCodice.get(istat6.slice(0, 3))
    } else {
      const sigla = sede.provincia.trim().toUpperCase()
      const c = this.comuniPerNome.get(`${sigla}|${chiaveNomeComune(sede.comune)}`)
      if (c) {
        istat6 = c.code
        nomeRegione = this.provinciePerSigla.get(sigla)
      }
    }
    if (!istat6 || !nomeRegione) return null
    const regioneCodice = codiceRegione(nomeRegione)
    const regioneLettera = letteraRegione(nomeRegione)
    if (!regioneCodice || !regioneLettera) return null
    return { istat6, regioneCodice, regioneLettera }
  }
}

/** Il soggetto con questo CF o P.IVA e' l'azienda stessa. */
export function eNoi(
  azienda: Pick<AziendaPropria, 'codiceFiscale' | 'partitaIva'>,
  cf: string | null | undefined,
  piva: string | null | undefined
): boolean {
  const norm = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, '').toUpperCase()
  const nostri = [norm(azienda.codiceFiscale), norm(azienda.partitaIva)].filter(v => v !== '')
  return [norm(cf), norm(piva)].some(v => v !== '' && nostri.includes(v))
}

/** Solo le cifre di un testo. */
export const soloCifre = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '')

/** Targa senza spazi, maiuscola. */
export const targaCompatta = (v: string | null | undefined): string =>
  (v ?? '').replace(/\s+/g, '').toUpperCase()

/** Numero progressivo e anno dal «n/anno» del lettore. */
export function progressivoDaNumero(numero: string): { n: number; anno: number } {
  const [n, anno] = numero.split('/')
  return { n: Number(n), anno: Number(anno) }
}

export interface SegnalazioneMovimento {
  codice: string
  messaggio: string
  bloccante: boolean
  movimento: MovimentoOrso
  correzione?: CorrezioneAvviso
  /** Campo del tracciato che contiene l'errore (se noto). */
  campo?: string
}

const chiaveCorrezione = (c?: CorrezioneAvviso): string =>
  !c ? '' : c.tipo === 'ANAGRAFICA_SEDE' ? `A:${c.sedeDittaId}` : c.tipo

/** Raggruppa le segnalazioni per (codice, messaggio, bloccante, correzione) con i movimenti coinvolti. */
export function aggregaSegnalazioni(
  segnalazioni: ReadonlyArray<SegnalazioneMovimento>
): AvvisoTracciato[] {
  const gruppi = new Map<string, { avviso: AvvisoTracciato; visti: Set<string> }>()
  for (const s of segnalazioni) {
    const k = [
      s.codice,
      s.messaggio,
      s.bloccante,
      chiaveCorrezione(s.correzione),
      s.campo ?? '',
    ].join('\u0000')
    let g = gruppi.get(k)
    if (!g) {
      g = {
        avviso: {
          codice: s.codice,
          messaggio: s.messaggio,
          movimentoIds: [],
          movimenti: [],
          bloccante: s.bloccante,
          ...(s.correzione ? { correzione: s.correzione } : {}),
          ...(s.campo ? { campo: s.campo } : {}),
        },
        visti: new Set(),
      }
      gruppi.set(k, g)
    }
    if (g.visti.has(s.movimento.id)) continue
    g.visti.add(s.movimento.id)
    g.avviso.movimentoIds.push(s.movimento.id)
    const voce: MovimentoAvviso = {
      id: s.movimento.id,
      data: giornoItaliano(s.movimento.movementDate),
      numero: s.movimento.numero,
      cer: s.movimento.cer,
    }
    g.avviso.movimenti?.push(voce)
  }
  // Prima i bloccanti, poi per codice: l'ordine e' stabile (importante per l'hash e il manifest).
  return [...gruppi.values()]
    .map(g => g.avviso)
    .sort(
      (a, b) =>
        Number(b.bloccante) - Number(a.bloccante) ||
        a.codice.localeCompare(b.codice) ||
        a.messaggio.localeCompare(b.messaggio)
    )
}

/** Ordina i movimenti come WinWaste (`ORDER BY DTUK, COD`): per data e numero di registro. */
export function ordinaMovimenti<T extends MovimentoOrso>(movimenti: ReadonlyArray<T>): T[] {
  return [...movimenti].sort((a, b) => {
    const d = a.movementDate.getTime() - b.movementDate.getTime()
    if (d !== 0) return d
    const pa = progressivoDaNumero(a.numero)
    const pb = progressivoDaNumero(b.numero)
    return pa.anno - pb.anno || pa.n - pb.n || a.id.localeCompare(b.id)
  })
}

/** Sede legale (principale) della ditta della sede, o la sede stessa se e' lei la principale. */
export function sedeLegaleDi(
  sede: SedeDettaglio,
  sedeLegalePerDitta: ReadonlyMap<string, SedeDettaglio>
): SedeDettaglio {
  return sedeLegalePerDitta.get(sede.dittaId) ?? sede
}
