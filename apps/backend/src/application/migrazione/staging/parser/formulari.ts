import { decodificaDataDocumento } from '../../../../domain/migrazione/winwaste/data-registrazione'
import { decodificaDecimaleSql } from '../../../../domain/migrazione/winwaste/numero-it'
import { confrontaConNumerici } from '../../../../domain/migrazione/winwaste/quantita'
import {
  RecordFormulario,
  SerieFormulario,
  StatoFormulario,
} from '../../../../domain/migrazione/winwaste/record'
import { COLONNE_CORPO_RICHIESTE, decodificaCorpo } from './corpo'
import { Anomalia, ContestoParser, EsitoParser, parsaTabella, SorgenteRighe } from './scarti'

/**
 * Parser di `FORMULARI` (`docs/formulari.md` §2.1-2.3, schema reale in
 * `docs/schema-db-winwaste.md` §6): stesse 101 colonne di `MOVIMENTI` ma
 * `STATO` varchar(1), `NFATT` varchar(8), `LEGAME` varchar(10) e
 * `KGNUM`/`MCNUM` decimal(18,0).
 *
 * `C7` (stato del formulario, §2.3): `''` emesso; `R` e `9` ricopiato in un
 * movimento; `A` annullato (la riga non si cancella); `0 1 2 3 4 8ELIMINATA`
 * richieste del portale. Altri valori: scarto `C7_SCONOSCIUTO`.
 * Un FIR emesso non ha ancora la relazione di carico/scarico: l'obbligo di
 * relazione vale solo per i movimenti.
 */
const RICHIESTE = [...COLONNE_CORPO_RICHIESTE, 'FORMU', 'DATD', 'C6', 'C7', 'KGNUM']
const EXTRA = new Set(['FORMU', 'DATD', 'C6', 'C7', 'KGNUM'])

const PORTALE = new Set(['0', '1', '2', '3', '4', '8ELIMINATA'])

export function classificaC7(c7: string): StatoFormulario | null {
  if (c7 === '') return 'EMESSO'
  if (c7 === 'R' || c7 === '9') return 'RICOPIATO'
  if (c7 === 'A') return 'ANNULLATO'
  if (PORTALE.has(c7)) return 'PORTALE'
  return null
}

/** `<serie><numero>/<aa>`, 14 caratteri in tutto (`docs/formulari.md` §2.4). */
export function decodificaFormu(formu: string): SerieFormulario | null {
  const m = /^([A-Za-z]*)(\d+)\/(\d{2})$/.exec(formu)
  return m ? { serie: m[1], numero: Number(m[2]), anno2: m[3] } : null
}

export async function parsaFormulari(
  sorgente: SorgenteRighe,
  contesto: ContestoParser
): Promise<EsitoParser<RecordFormulario>> {
  const visti = new Set<number>()
  return parsaTabella<RecordFormulario>('FORMULARI', sorgente, RICHIESTE, riga => {
    const c = (n: string): string | null => riga.campi[n] ?? null
    const esito = decodificaCorpo(riga, contesto, 'FORMULARI', EXTRA)
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

    const c7 = (c('C7') ?? '').trim()
    const statoFir = classificaC7(c7)
    if (statoFir === null) {
      return {
        cod,
        scarto: { codice: 'C7_SCONOSCIUTO', dettaglio: 'C7: stato del formulario non previsto' },
        avvisi: [],
      }
    }

    const datd = decodificaDataDocumento(c('DATD'))
    if (!datd.ok) avvisi.push({ codice: datd.codice, dettaglio: datd.dettaglio })
    const dataDocumento = datd.ok ? datd.valore : null
    if (dataDocumento !== null && corpo.data !== null && dataDocumento !== corpo.data) {
      avvisi.push({ codice: 'DATD_DTUK_DIVERSE', dettaglio: 'DATD e DTUK indicano date diverse' })
    }

    const kg = decodificaDecimaleSql(c('KGNUM'))
    if (!kg.ok) avvisi.push({ codice: 'KGNUM_NON_VALIDO', dettaglio: 'KGNUM: decimale non valido' })
    const kgnum = kg.ok ? kg.valore : null
    // KGNUM e MCNUM sono decimal(18,0) nei FIR: arrotondati all'unita', tolleranza 1.
    for (const codice of confrontaConNumerici(
      { nettoKg: corpo.nettoKg, volumeM3: null },
      kgnum,
      null,
      1
    )) {
      avvisi.push({ codice, dettaglio: 'NETTO/KGNUM non coincidono' })
    }

    const formu = (c('FORMU') ?? '').trim()
    const c6 = (c('C6') ?? '').trim().toUpperCase()
    const { grezzoCorpo, ...resto } = corpo
    const annullatoC7 = statoFir === 'ANNULLATO'
    const record: RecordFormulario = {
      ...resto,
      annullato: corpo.annullato || annullatoC7,
      causaAnnullo: corpo.causaAnnullo ?? (annullatoC7 ? 'C7_ANNULLATO' : null),
      tabella: 'FORMULARI',
      formu,
      serieNumero: decodificaFormu(formu),
      dataDocumento,
      statoFir,
      c7,
      digitale: c6.startsWith('DIGITALE') || c6.startsWith('INVIATO A RENTRI'),
      kgnum,
      avvisi: avvisi.map(a => a.codice),
      grezzo: grezzoCorpo,
    }
    return { cod, record, avvisi }
  })
}
