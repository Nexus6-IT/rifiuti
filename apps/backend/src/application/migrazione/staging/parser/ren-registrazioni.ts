import { RecordRenRegistrazione } from '../../../../domain/migrazione/winwaste/record'
import { EsitoParser, parsaTabella, SorgenteRighe } from './scarti'

/**
 * Parser minimo di `RENregistrazioni` (`docs/rentri/03-aggancio-a-winwaste.md`
 * §3.1; schema reale: 95 colonne, PK `REGISTRO+PROTOCOLLO`, legame col
 * movimento `CODMOVIMENTO` + `ANNOMOVIMENTO`). Serve solo al confronto 5
 * (registrazioni gia' trasmesse a RENTRI): legge la chiave, `XSEINVIATO` e
 * `IDRENTRI`; il resto non si interpreta in questo blocco.
 * Scarti: `CODMOVIMENTO_NON_VALIDO`, `CHIAVE_DUPLICATA`.
 */
const RICHIESTE = [
  'CODMOVIMENTO',
  'ANNOMOVIMENTO',
  'REGISTRO',
  'PROTOCOLLO',
  'XSEINVIATO',
  'IDRENTRI',
]

export async function parsaRenRegistrazioni(
  sorgente: SorgenteRighe
): Promise<EsitoParser<RecordRenRegistrazione>> {
  const viste = new Set<string>()
  return parsaTabella<RecordRenRegistrazione>('RENregistrazioni', sorgente, RICHIESTE, riga => {
    const t = (n: string): string => (riga.campi[n] ?? '').trim()
    const cod = t('CODMOVIMENTO')
    if (!/^\d+$/.test(cod)) {
      return {
        cod: '',
        scarto: { codice: 'CODMOVIMENTO_NON_VALIDO', dettaglio: 'CODMOVIMENTO: atteso intero' },
        avvisi: [],
      }
    }
    const chiave = `${t('REGISTRO')}|${t('PROTOCOLLO')}`
    if (viste.has(chiave)) {
      return {
        cod,
        scarto: {
          codice: 'CHIAVE_DUPLICATA',
          dettaglio: 'chiave REGISTRO+PROTOCOLLO gia presente',
        },
        avvisi: [],
      }
    }
    viste.add(chiave)
    return {
      cod,
      avvisi: [],
      record: {
        tabella: 'RENregistrazioni',
        riga: riga.numeroRiga,
        codMovimento: Number(cod),
        annoMovimento: t('ANNOMOVIMENTO'),
        registro: t('REGISTRO'),
        protocollo: t('PROTOCOLLO'),
        inviata: t('XSEINVIATO') === 'X',
        idRentri: t('IDRENTRI'),
      },
    }
  })
}
