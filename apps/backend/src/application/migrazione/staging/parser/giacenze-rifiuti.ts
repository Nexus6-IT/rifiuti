import { decodificaDecimaleSql } from '../../../../domain/migrazione/winwaste/numero-it'
import { RecordGiacenzaRifiuti } from '../../../../domain/migrazione/winwaste/record'
import { Anomalia, EsitoParser, parsaTabella, raccogliGrezzo, SorgenteRighe } from './scarti'

/**
 * Parser di `[GIACENZE RIFIUTI]` (`docs/giacenze.md` §2.3, schema reale in
 * `docs/schema-db-winwaste.md` §6: 73 colonne, PK `UL+MAG+POS+CER+SF+RIF`).
 *
 * Le giacenze iniziali sono nelle colonne `GIRRK/M` (R13 da terzi), `GIRLK/M`
 * (R13 da lavorazioni), `GIDRK/M` (D15 da terzi), `GIDLK/M` (D15 da
 * lavorazioni), `GIDTK/M` (deposito temporaneo); K = kg, M = m3. Gli altri
 * gruppi di colonne (`CR*`, `CD*`, `SI*`, `ST*`, `GF*`, `GIASCAR*`) hanno
 * significato non verificato: finiscono nel `grezzo` se non nulli.
 * Una riga con `UL` che inizia per `8` e' di compensazione del riporto d'anno
 * (in negativo, solo kg).
 *
 * Scarti: `CHIAVE_VUOTA` (UL o CER mancanti), `CHIAVE_DUPLICATA`, `DECIMALE_SQL`.
 */
const RICHIESTE = [
  'UL',
  'MAG',
  'POS',
  'CER',
  'SF',
  'RIF',
  'GIRRK',
  'GIRRM',
  'GIRLK',
  'GIRLM',
  'GIDRK',
  'GIDRM',
  'GIDLK',
  'GIDLM',
  'GIDTK',
  'GIDTM',
]
const MAPPATE = new Set(RICHIESTE)

const CLASSI = [
  ['RR', 'GIRRK', 'GIRRM'],
  ['RL', 'GIRLK', 'GIRLM'],
  ['DR', 'GIDRK', 'GIDRM'],
  ['DL', 'GIDLK', 'GIDLM'],
  ['DT', 'GIDTK', 'GIDTM'],
] as const

export async function parsaGiacenzeRifiuti(
  sorgente: SorgenteRighe
): Promise<EsitoParser<RecordGiacenzaRifiuti>> {
  const viste = new Set<string>()
  return parsaTabella<RecordGiacenzaRifiuti>('GIACENZE RIFIUTI', sorgente, RICHIESTE, riga => {
    const t = (n: string): string => (riga.campi[n] ?? '').trim()
    const ul = t('UL')
    const mag = t('MAG')
    const pos = t('POS')
    const cer = t('CER')
    const sf = t('SF')
    const rif = t('RIF')
    const chiave = [ul, mag, pos, cer, sf, rif].join('|')
    const avvisi: Anomalia[] = []
    if (ul === '' || cer === '') {
      return {
        cod: '',
        scarto: { codice: 'CHIAVE_VUOTA', dettaglio: 'UL e CER sono obbligatori nella chiave' },
        avvisi,
      }
    }
    if (viste.has(chiave)) {
      return {
        cod: chiave,
        scarto: {
          codice: 'CHIAVE_DUPLICATA',
          dettaglio: 'chiave UL+MAG+POS+CER+SF+RIF gia presente',
        },
        avvisi,
      }
    }
    viste.add(chiave)
    const giacenze = {} as Record<'RR' | 'RL' | 'DR' | 'DL' | 'DT', { kg: number; m3: number }>
    for (const [classe, colKg, colM3] of CLASSI) {
      const kg = decodificaDecimaleSql(riga.campi[colKg] ?? null)
      const m3 = decodificaDecimaleSql(riga.campi[colM3] ?? null)
      if (!kg.ok || !m3.ok) {
        return {
          cod: chiave,
          scarto: { codice: 'DECIMALE_SQL', dettaglio: `${colKg}/${colM3}: decimale non valido` },
          avvisi,
        }
      }
      giacenze[classe] = { kg: kg.valore ?? 0, m3: m3.valore ?? 0 }
    }
    return {
      cod: chiave,
      avvisi,
      record: {
        tabella: 'GIACENZE RIFIUTI',
        riga: riga.numeroRiga,
        chiaveNaturale: chiave,
        ul,
        mag,
        pos,
        cer,
        sf,
        rif,
        compensazione: ul.startsWith('8'),
        giacenze,
        grezzo: raccogliGrezzo(riga.campi, MAPPATE),
      },
    }
  })
}
