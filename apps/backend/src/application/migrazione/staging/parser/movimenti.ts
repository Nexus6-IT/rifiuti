import { decodificaDecimaleSql } from '../../../../domain/migrazione/winwaste/numero-it'
import { confrontaConNumerici } from '../../../../domain/migrazione/winwaste/quantita'
import { RecordMovimento } from '../../../../domain/migrazione/winwaste/record'
import { decodificaRegistri } from '../../../../domain/migrazione/winwaste/registri'
import { COLONNE_CORPO_RICHIESTE, decodificaCorpo } from './corpo'
import { Anomalia, ContestoParser, EsitoParser, parsaTabella, SorgenteRighe } from './scarti'

/**
 * Parser di `MOVIMENTI` (`docs/movimenti.md` §2.2, schema reale in
 * `docs/schema-db-winwaste.md` §6): registro di carico e scarico.
 *
 * Scarti: `COD_NON_VALIDO`, `COD_DUPLICATO`, `DTUK_NON_VALIDA`, `OPER_SCONOSCIUTO`,
 * `NUMERO_IT`, `UM_SCONOSCIUTA`, `CER_FORMATO`, `RELAZ_*`, `RELAZIONE_MANCANTE`.
 * Un movimento annullato (`$$` in `DTUK`) e' letto e marcato, non scartato.
 */
const RICHIESTE = [...COLONNE_CORPO_RICHIESTE, 'KGNUM', 'MCNUM', 'GIASCAR', 'STATO']
const EXTRA = new Set([
  'REG1',
  'REG2',
  'REG3',
  'REG4',
  'PROT1',
  'PROT2',
  'PROT3',
  'PROT4',
  'KGNUM',
  'MCNUM',
  'GIASCAR',
  'STATO',
  'NFATT',
])

export async function parsaMovimenti(
  sorgente: SorgenteRighe,
  contesto: ContestoParser
): Promise<EsitoParser<RecordMovimento>> {
  const visti = new Set<number>()
  return parsaTabella<RecordMovimento>('MOVIMENTI', sorgente, RICHIESTE, riga => {
    const c = (n: string): string | null => riga.campi[n] ?? null
    const esito = decodificaCorpo(riga, contesto, 'MOVIMENTI', EXTRA)
    if ('scarto' in esito) return esito
    const { corpo } = esito
    const avvisi: Anomalia[] = [...esito.avvisi]
    const cod = String(corpo.cod)

    if (visti.has(corpo.cod)) {
      return {
        cod,
        scarto: { codice: 'COD_DUPLICATO', dettaglio: 'COD gia presente nella tabella' },
        avvisi: [],
      }
    }
    visti.add(corpo.cod)

    // Obbligo di relazione (docs/movimenti.md §2.4): MAG1 > 0, NETTO > 0, OPER che scarica.
    const mag1Positivo = /^\d+$/.test(corpo.mag1) && Number(corpo.mag1) > 0
    if (
      !corpo.annullato &&
      corpo.oper.richiedeRelazione &&
      mag1Positivo &&
      (corpo.nettoKg ?? 0) > 0 &&
      corpo.relaz.length === 0
    ) {
      return {
        cod,
        scarto: {
          codice: 'RELAZIONE_MANCANTE',
          dettaglio: 'RELAZ: manca la relazione di carico/scarico richiesta dall OPER',
        },
        avvisi: [],
      }
    }

    const dec = (nome: string): number | null => {
      const r = decodificaDecimaleSql(c(nome))
      if (!r.ok) {
        avvisi.push({ codice: `${nome}_NON_VALIDO`, dettaglio: `${nome}: decimale non valido` })
        return null
      }
      return r.valore
    }
    const kgnum = dec('KGNUM')
    const mcnum = dec('MCNUM')
    const giascar = dec('GIASCAR')
    for (const codice of confrontaConNumerici(
      { nettoKg: corpo.nettoKg, volumeM3: corpo.volumeM3 },
      kgnum,
      mcnum
    )) {
      avvisi.push({
        codice,
        dettaglio: `${codice === 'KGNUM_INCOERENTE' ? 'NETTO/KGNUM' : 'VOLU/MCNUM'} non coincidono`,
      })
    }

    const reg = [1, 2, 3, 4].map(i => c(`REG${i}`))
    const prot = [1, 2, 3, 4].map(i => c(`PROT${i}`))
    const registri = decodificaRegistri(reg, prot)
    if (!registri.ok) avvisi.push({ codice: registri.codice, dettaglio: registri.dettaglio })

    const { grezzoCorpo, ...resto } = corpo
    const record: RecordMovimento = {
      ...resto,
      tabella: 'MOVIMENTI',
      registri: registri.ok ? registri.valore : [],
      kgnum,
      mcnum,
      giascar,
      stato: (c('STATO') ?? '').trim(),
      nfatt: (c('NFATT') ?? '').trim(),
      avvisi: avvisi.map(a => a.codice),
      grezzo: grezzoCorpo,
    }
    return { cod, record, avvisi }
  })
}
