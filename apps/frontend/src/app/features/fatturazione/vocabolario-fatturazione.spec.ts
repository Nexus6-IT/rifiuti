import { STATI_DOCUMENTO, STATI_ELABORAZIONE } from './fatturazione.model'
import {
  AVVISI_DOCUMENTO_VOCI,
  ERRORI_DOCUMENTO_VOCI,
  ERRORI_GENERALI_VOCI,
  ERRORI_HTTP_VOCI,
  ESITI_ELABORAZIONE,
  ESITI_ELABORAZIONE_VOCI,
  MOTIVI_NON_ANNULLABILE_VOCI,
  MOTIVI_NON_STORNABILE_VOCI,
  STATI_DOCUMENTO_VOCI,
  STATI_ELABORAZIONE_VOCI,
  TIPI_RIGA_VOCI,
  voceSegnalazione,
} from './vocabolario-fatturazione'

const SEVERITA = ['errore', 'avviso', 'info', 'successo']

function tutteCompilate(voci: Record<string, { etichetta: string; severita: string }>): void {
  for (const [codice, voce] of Object.entries(voci)) {
    expect(voce.etichetta.trim().length).withContext(codice).toBeGreaterThan(0)
    expect(SEVERITA).withContext(codice).toContain(voce.severita)
  }
}

describe('vocabolario della fatturazione', () => {
  it('ogni stato di elaborazione e di documento ha etichetta e severità', () => {
    expect(Object.keys(STATI_ELABORAZIONE_VOCI).sort()).toEqual([...STATI_ELABORAZIONE].sort())
    expect(Object.keys(STATI_DOCUMENTO_VOCI).sort()).toEqual([...STATI_DOCUMENTO].sort())
    tutteCompilate(STATI_ELABORAZIONE_VOCI)
    tutteCompilate(STATI_DOCUMENTO_VOCI)
  })

  it('ogni errore (4 generali + 18 del documento) e avviso (7) ha etichetta e severità', () => {
    expect(Object.keys(ERRORI_GENERALI_VOCI).length).toBe(4)
    expect(Object.keys(ERRORI_DOCUMENTO_VOCI).length).toBe(18)
    expect(Object.keys(AVVISI_DOCUMENTO_VOCI).length).toBe(7)
    tutteCompilate(ERRORI_GENERALI_VOCI)
    tutteCompilate(ERRORI_DOCUMENTO_VOCI)
    tutteCompilate(AVVISI_DOCUMENTO_VOCI)
    for (const v of Object.values(ERRORI_DOCUMENTO_VOCI)) expect(v.severita).toBe('errore')
    for (const v of Object.values(AVVISI_DOCUMENTO_VOCI)) expect(v.severita).toBe('avviso')
  })

  it('LEGAMI_SENZA_CONTRATTO ha severità avviso (decisione 24); gli altri tre generali errore', () => {
    expect(ERRORI_GENERALI_VOCI.LEGAMI_SENZA_CONTRATTO.severita).toBe('avviso')
    expect(ERRORI_GENERALI_VOCI.CEDENTE_INCOMPLETO.severita).toBe('errore')
    expect(ERRORI_GENERALI_VOCI.DATA_ANTERIORE_ULTIMA_FATTURA.severita).toBe('errore')
    expect(ERRORI_GENERALI_VOCI.DATA_FUTURA.severita).toBe('errore')
  })

  it('RIGA_LEGAME_INCOMPLETA ha il testo del Q19', () => {
    expect(ERRORI_DOCUMENTO_VOCI.RIGA_LEGAME_INCOMPLETA.etichetta).toBe(
      'Una riga del legame o del listino è incompleta: mancano quantità o prezzo.'
    )
  })

  it('errori HTTP di P7 compresi, con i testi fissati dalla scansione', () => {
    expect(ERRORI_HTTP_VOCI.DEFINITIVE_NON_ATTIVE.etichetta).toBe(
      'Le fatture definitive non sono ancora attive per questa azienda'
    )
    expect(ERRORI_HTTP_VOCI.XML_NON_DISPONIBILE.etichetta).toBe(
      "Un documento annullato non ha l'XML"
    )
    expect(ERRORI_HTTP_VOCI.STORNO_NON_AMMESSO.etichetta.length).toBeGreaterThan(0)
    const attesi = [
      'ANTEPRIMA_SUPERATA',
      'ELABORAZIONE_GIA_IN_DEFINITIVA',
      'ELABORAZIONE_IN_CORSO',
      'STATO_ELABORAZIONE_NON_VALIDO',
      'DOCUMENTO_NON_IN_BOZZA',
      'CODA_NON_DISPONIBILE',
      'TROPPI_DOCUMENTI',
      'ANNULLO_NON_AMMESSO',
      'STORNO_GIA_PRESENTE',
      'XML_NON_VALIDO',
      'MAPPATURE_MANCANTI',
      'VERSIONE_SUPERATA',
      'OPERAZIONE_CONCORRENTE',
      'NESSUN_DOCUMENTO_DEFINIBILE',
      'DOPPIA_FATTURAZIONE',
      'PARTENZA_NON_MODIFICABILE',
      'SUFFISSO_NON_MODIFICABILE',
      'SCOSTAMENTO_NON_APERTO',
      'DEFINITIVE_NON_ATTIVE',
      'XML_NON_DISPONIBILE',
      'STORNO_NON_AMMESSO',
      'PERIODO_NON_VALIDO',
      'DATA_FUTURA',
      'CONFERMA_EMISSIONE_RICHIESTA',
      'ADATTATORE_SCONOSCIUTO',
      'PARTENZA_NON_VALIDA',
      'RIGA_ADDEBITO_IN_USO',
      // Task 25a (m4, m7): 400 e 404 dei servizi della fatturazione.
      'MOTIVO_NON_VALIDO',
      'VERSIONE_NON_VALIDA',
      'DATA_NON_VALIDA',
      'RIFATTURABILE_NON_VALIDO',
      'NOTA_NON_VALIDA',
      'PAGINAZIONE_NON_VALIDA',
      'FILTRO_NON_VALIDO',
      'LEGAME_MOVIMENTO_NON_TROVATO',
      'DOCUMENTO_NON_TROVATO',
      'ELABORAZIONE_NON_TROVATA',
    ]
    expect(Object.keys(ERRORI_HTTP_VOCI).sort()).toEqual([...attesi].sort())
    tutteCompilate(ERRORI_HTTP_VOCI)
  })

  it('i codici 400 e 404 del Task 25a hanno un testo per l`utente, non il codice grezzo', () => {
    for (const codice of [
      'MOTIVO_NON_VALIDO',
      'VERSIONE_NON_VALIDA',
      'DATA_NON_VALIDA',
      'RIFATTURABILE_NON_VALIDO',
      'NOTA_NON_VALIDA',
      'PAGINAZIONE_NON_VALIDA',
      'FILTRO_NON_VALIDO',
      'LEGAME_MOVIMENTO_NON_TROVATO',
      'DOCUMENTO_NON_TROVATO',
      'ELABORAZIONE_NON_TROVATA',
    ]) {
      const voce = voceSegnalazione(codice)
      expect([codice, voce.severita, voce.etichetta === codice]).toEqual([codice, 'errore', false])
    }
  })

  it('i cinque MotivoNonAnnullabile, STORNATO compreso, e i due MotivoNonStornabile', () => {
    expect(Object.keys(MOTIVI_NON_ANNULLABILE_VOCI).sort()).toEqual(
      ['EMESSO', 'NON_DEFINITIVO', 'NON_ULTIMO', 'NOTA_DI_CREDITO', 'STORNATO'].sort()
    )
    expect(MOTIVI_NON_ANNULLABILE_VOCI.STORNATO.etichetta.length).toBeGreaterThan(0)
    expect(Object.keys(MOTIVI_NON_STORNABILE_VOCI).sort()).toEqual(
      ['NON_DEFINITIVO', 'NOTA_DI_CREDITO'].sort()
    )
    tutteCompilate(MOTIVI_NON_ANNULLABILE_VOCI)
    tutteCompilate(MOTIVI_NON_STORNABILE_VOCI)
  })

  it('i sette esiti di errore.codice hanno etichetta, ELABORAZIONE_INTERROTTA e NESSUN_DOCUMENTO_DEFINIBILE compresi', () => {
    expect([...ESITI_ELABORAZIONE].map(String).sort()).toEqual(
      [
        'ANTEPRIMA_SUPERATA',
        'CEDENTE_INCOMPLETO',
        'DATA_ANTERIORE_ULTIMA_FATTURA',
        'DEFINITIVE_NON_ATTIVE',
        'DOPPIA_FATTURAZIONE',
        'ELABORAZIONE_INTERROTTA',
        'NESSUN_DOCUMENTO_DEFINIBILE',
      ].sort()
    )
    expect(Object.keys(ESITI_ELABORAZIONE_VOCI).length).toBe(7)
    tutteCompilate(ESITI_ELABORAZIONE_VOCI)
    expect(ESITI_ELABORAZIONE_VOCI.ELABORAZIONE_INTERROTTA.etichetta).toBe(
      "L'elaborazione si è interrotta: richiedi di nuovo la definitiva"
    )
  })

  it('il tipo riga QUANTITA_MOVIMENTI ha etichetta, come gli altri sette', () => {
    expect(Object.keys(TIPI_RIGA_VOCI).length).toBe(8)
    expect(TIPI_RIGA_VOCI['QUANTITA_MOVIMENTI'].etichetta.length).toBeGreaterThan(0)
  })

  it('voceSegnalazione trova ogni codice noto e non rompe su uno sconosciuto', () => {
    expect(voceSegnalazione('LEGAMI_SENZA_CONTRATTO').severita).toBe('avviso')
    expect(voceSegnalazione('FPA_DA_FIRMARE').severita).toBe('avviso')
    expect(voceSegnalazione('ELABORAZIONE_INTERROTTA').severita).toBe('errore')
    expect(voceSegnalazione('NUOVO_CODICE')).toEqual({
      etichetta: 'NUOVO_CODICE',
      severita: 'errore',
    })
    expect(voceSegnalazione('toString').etichetta).toBe('toString')
  })
})
