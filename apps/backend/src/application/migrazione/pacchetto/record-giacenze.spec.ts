import { mappaValida, U1 } from '../../../test-support/migrazione/mappa-di-prova'
import { PacchettoError } from './errori-pacchetto'
import { validaMappa } from './mappa-import'
import { RecordGiacenza, validaRecordGiacenza } from './record-giacenze'

const mappa = () => validaMappa(mappaValida())
const base = (): Record<string, unknown> => ({
  legacyKey: `0001|2026|GIACENZE|${U1}|150101|-`,
  registroId: U1,
  cerCode: '15 01 01',
  statoFisico: null,
  quantita: 120.5,
  unita: 'KG',
  dataRiferimento: '2026-06-30',
  origini: [{ anno: 2026, protocollo: 12, quantita: 100 }],
})
const rifiuta = (mod: Record<string, unknown>, campo: string) => {
  try {
    validaRecordGiacenza({ ...base(), ...mod }, mappa())
  } catch (e) {
    expect(e).toBeInstanceOf(PacchettoError)
    expect((e as PacchettoError).dettaglio).toBe(`giacenze: ${campo}`)
    return
  }
  throw new Error('doveva essere rifiutata')
}

describe('I6: validazione del record giacenze (il server non si fida del pacchetto)', () => {
  it('accetta un record valido', () => {
    const r: RecordGiacenza = validaRecordGiacenza(base(), mappa())
    expect(r).toMatchObject({ quantita: 120.5, unita: 'KG', statoFisico: null })
  })
  it('accetta stato fisico e CER pericoloso', () => {
    expect(() =>
      validaRecordGiacenza(
        {
          ...base(),
          legacyKey: `0001|2026|GIACENZE|${U1}|130205|S`,
          cerCode: '13 02 05*',
          statoFisico: 'S',
        },
        mappa()
      )
    ).not.toThrow()
  })
  it('chiave incoerente con registro, CER o stato fisico', () => {
    rifiuta({ legacyKey: `0001|2026|GIACENZE|${U1}|150102|-` }, 'CHIAVE')
    rifiuta({ legacyKey: `0001|2026|GIACENZE|${U1}|150101|S` }, 'CHIAVE')
    rifiuta({ legacyKey: `0001|2026|MOVIMENTI|${U1}|150101|-` }, 'CHIAVE')
    rifiuta({ legacyKey: `0002|2026|GIACENZE|${U1}|150101|-` }, 'CHIAVE')
  })
  it('registro fuori dalla mappa', () => {
    rifiuta({ registroId: '99999999-9999-4999-8999-999999999999' }, 'REGISTRO')
  })
  it('quantita non positiva, con troppi decimali, enorme o non numerica', () => {
    for (const q of [0, -1, 0.001, 100_000_000, '5', NaN]) rifiuta({ quantita: q }, 'QUANTITA')
  })
  it('unita diversa da KG e data diversa dal taglio', () => {
    rifiuta({ unita: 'T' }, 'UNITA')
    rifiuta({ dataRiferimento: '2026-07-01' }, 'DATA')
  })
  it('CER e stato fisico non validi', () => {
    rifiuta({ cerCode: '150101' }, 'CER')
    rifiuta({ statoFisico: 'a|b', legacyKey: `0001|2026|GIACENZE|${U1}|150101|a|b` }, 'STATO_FISICO')
    rifiuta({ statoFisico: '-' }, 'STATO_FISICO')
    rifiuta({ statoFisico: '' }, 'STATO_FISICO')
  })
  it('origini: duplicate, somma oltre la quantita, anno o protocollo non validi, oltre 200', () => {
    rifiuta(
      {
        origini: [
          { anno: 2026, protocollo: 1, quantita: 1 },
          { anno: 2026, protocollo: 1, quantita: 1 },
        ],
      },
      'ORIGINI'
    )
    rifiuta({ origini: [{ anno: 2026, protocollo: 1, quantita: 121 }] }, 'ORIGINI')
    rifiuta({ origini: [{ anno: 1980, protocollo: 1, quantita: 1 }] }, 'ORIGINI')
    rifiuta({ origini: [{ anno: 2026, protocollo: 0, quantita: 1 }] }, 'ORIGINI')
    rifiuta(
      { origini: Array.from({ length: 201 }, (_, i) => ({ anno: 2026, protocollo: i + 1, quantita: 0.01 })) },
      'ORIGINI'
    )
  })
  it('forma: chiavi in piu o in meno, o non oggetto', () => {
    rifiuta({ extra: 1 }, 'FORMA')
    expect(() => validaRecordGiacenza(null, mappa())).toThrow(PacchettoError)
    const senza = base()
    delete senza.origini
    expect(() => validaRecordGiacenza(senza, mappa())).toThrow(PacchettoError)
  })
})
