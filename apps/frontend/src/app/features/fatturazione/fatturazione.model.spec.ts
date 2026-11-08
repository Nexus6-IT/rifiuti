import {
  CHIAVI_DOCUMENTO_DETTAGLIO,
  CHIAVI_DOCUMENTO_RIGA,
  CHIAVI_ELABORAZIONE_DETTAGLIO,
  CHIAVI_ELABORAZIONE_RIGA,
  CHIAVI_RIGA_DOCUMENTO,
  CHIAVI_SCOSTAMENTO_RIGA,
  DocumentoRiga,
  ElaborazioneRiga,
} from './fatturazione.model'

describe('chiavi esaustive del modello', () => {
  it('elenco dei campi di ogni tipo, scritto a mano', () => {
    expect(Object.keys(CHIAVI_ELABORAZIONE_RIGA).sort()).toEqual(
      [
        'id',
        'stato',
        'createdAt',
        'periodoDal',
        'periodoAl',
        'dataDocumento',
        'documenti',
        'totale',
        'errori',
        'avvisi',
      ].sort()
    )
    expect(Object.keys(CHIAVI_ELABORAZIONE_DETTAGLIO).length).toBe(10 + 13)
    expect(Object.keys(CHIAVI_DOCUMENTO_RIGA).length).toBe(18)
    expect(Object.keys(CHIAVI_DOCUMENTO_DETTAGLIO).length).toBe(18 + 10)
    expect(Object.keys(CHIAVI_RIGA_DOCUMENTO).length).toBe(19)
    expect(Object.keys(CHIAVI_SCOSTAMENTO_RIGA).length).toBe(11)
    expect(CHIAVI_DOCUMENTO_DETTAGLIO['xmlGenerato']).toBeTrue()
    expect(CHIAVI_ELABORAZIONE_DETTAGLIO['erroreTecnico']).toBeTrue()
  })

  it('un campo in più o in meno non compila', () => {
    // @ts-expect-error manca la chiave `avvisi`
    const inMeno: Record<keyof ElaborazioneRiga, true> = {
      id: true,
      stato: true,
      createdAt: true,
      periodoDal: true,
      periodoAl: true,
      dataDocumento: true,
      documenti: true,
      totale: true,
      errori: true,
    }
    const inPiu: Record<keyof DocumentoRiga, true> = {
      ...CHIAVI_DOCUMENTO_RIGA,
      // @ts-expect-error `nonEsiste` non è un campo di DocumentoRiga
      nonEsiste: true,
    }
    expect(Object.keys(inMeno).length).toBe(9)
    expect(Object.keys(inPiu).length).toBe(19)
  })
})
