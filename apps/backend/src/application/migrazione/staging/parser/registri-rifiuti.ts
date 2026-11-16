import { RecordRegistroRifiuti } from '../../../../domain/migrazione/winwaste/record'
import { Anomalia, EsitoParser, parsaTabella, SorgenteRighe } from './scarti'

/**
 * Parser di `[REGISTRI RIFIUTI]` (`docs/movimenti.md` §2.3, schema reale in
 * `docs/schema-db-winwaste.md` §6: 12 colonne): `PRT` ultimo protocollo
 * stampato (6 cifre), `ULT` data dell'ultima stampa (`gg-mm`), `MDL` modello,
 * `ASS = 1` protocollo assegnato alla registrazione.
 * Scarti: `COD_VUOTO`, `COD_DUPLICATO`. Avviso: `PRT_NON_VALIDO`.
 */
const RICHIESTE = ['COD', 'DES', 'PRT', 'ULT', 'MDL', 'ASS']

export async function parsaRegistriRifiuti(
  sorgente: SorgenteRighe
): Promise<EsitoParser<RecordRegistroRifiuti>> {
  const viste = new Set<string>()
  return parsaTabella<RecordRegistroRifiuti>('REGISTRI RIFIUTI', sorgente, RICHIESTE, riga => {
    const t = (n: string): string => (riga.campi[n] ?? '').trim()
    const cod = t('COD')
    if (cod === '') {
      return { cod, scarto: { codice: 'COD_VUOTO', dettaglio: 'COD: obbligatorio' }, avvisi: [] }
    }
    if (viste.has(cod)) {
      return {
        cod,
        scarto: { codice: 'COD_DUPLICATO', dettaglio: 'COD gia presente nella tabella' },
        avvisi: [],
      }
    }
    viste.add(cod)
    const avvisi: Anomalia[] = []
    const prt = t('PRT')
    let ultimoProtocollo: number | null = null
    if (prt !== '') {
      if (/^\d{1,6}$/.test(prt)) ultimoProtocollo = Number(prt)
      else avvisi.push({ codice: 'PRT_NON_VALIDO', dettaglio: 'PRT: attese al piu 6 cifre' })
    }
    return {
      cod,
      avvisi,
      record: {
        tabella: 'REGISTRI RIFIUTI',
        riga: riga.numeroRiga,
        cod,
        descrizione: t('DES'),
        ultimoProtocollo,
        ultimaStampa: t('ULT'),
        modello: t('MDL'),
        assegnaProtocollo: t('ASS') === '1',
        avvisi: avvisi.map(a => a.codice),
      },
    }
  })
}
