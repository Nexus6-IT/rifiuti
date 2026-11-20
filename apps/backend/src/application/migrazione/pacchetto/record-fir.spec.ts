import { PacchettoError } from './errori-pacchetto'
import { mappaValida, T_PROVA, U2 } from '../../../test-support/migrazione/mappa-di-prova'
import { validaMappa } from './mappa-import'
import { RecordFir, validaRecordFir, validaRecordFirDigitale } from './record-fir'

const mappa = validaMappa({
  ...mappaValida(),
  tenantId: T_PROVA,
  agganci: [{ partitaIva: '12345678903', dittaId: U2 }],
})

const DITTA = '0001|FISC|01234567897'
const ok = (): RecordFir => ({
  legacyKey: '0001|2026|FORMULARI|15',
  firNumber: 'A0001/26',
  stato: 'AWAITING_RECEIVER',
  dataTrasporto: '2026-03-05',
  dataFine: null,
  cerCode: '15 01 01',
  pericoloso: false,
  descrizione: 'Imballaggi',
  quantitaKg: 120.5,
  targa: 'AB123CD',
  operazione: 'DISPOSAL',
  produttore: {
    tipo: 'ditta',
    dittaKey: DITTA,
    dittaId: null,
    sedeKey: '0001|C|000001|0001',
    ruoloKey: '0001|C|000001',
  },
  trasportatore: null,
  destinatario: { tipo: 'propria', sedeId: U2 },
})
const conCampo = (campo: string, valore: unknown) => ({ ...ok(), [campo]: valore })

describe('validaRecordFir', () => {
  it('un record ben formato passa e viene restituito uguale', () => {
    expect(validaRecordFir(ok(), mappa)).toEqual(ok())
  })

  it('chiavi in piu o in meno: rifiutato (schema chiuso)', () => {
    expect(() => validaRecordFir({ ...ok(), extra: 1 }, mappa)).toThrow(PacchettoError)
    const { targa: _t, ...senza } = ok()
    expect(() => validaRecordFir(senza, mappa)).toThrow(PacchettoError)
    expect(() => validaRecordFir(null, mappa)).toThrow(PacchettoError)
  })

  it.each([
    ['legacyKey di un altro anno', 'legacyKey', '0001|2025|FORMULARI|15'],
    ['legacyKey di MOVIMENTI', 'legacyKey', '0001|2026|MOVIMENTI|15'],
    ['legacyKey di un altra ditta', 'legacyKey', '0002|2026|FORMULARI|15'],
    ['firNumber vuoto', 'firNumber', ''],
    ['firNumber con spazi ai bordi', 'firNumber', ' A1/26'],
    ['firNumber oltre 50 caratteri', 'firNumber', 'X'.repeat(51)],
    ['firNumber con controllo', 'firNumber', 'A\u0001'],
    ['stato non ammesso', 'stato', 'CANCELLED'],
    ['data non valida', 'dataTrasporto', '2026-02-30'],
    ['data non ISO', 'dataTrasporto', '05-03-2026'],
    ['dataFine non valida', 'dataFine', '2026-13-01'],
    ['cer senza spazi', 'cerCode', '150101'],
    ['quantita zero', 'quantitaKg', 0],
    ['quantita negativa', 'quantitaKg', -1],
    ['quantita non numerica', 'quantitaKg', '12'],
    ['quantita fuori da decimal(10,2)', 'quantitaKg', 100_000_000],
    ['targa minuscola', 'targa', 'ab123cd'],
    ['descrizione oltre 500', 'descrizione', 'x'.repeat(501)],
    ['operazione sconosciuta', 'operazione', 'ALTRO'],
    ['pericoloso non booleano', 'pericoloso', 'si'],
  ])('rifiuta: %s', (_n, campo, valore) => {
    expect(() => validaRecordFir(conCampo(campo, valore), mappa)).toThrow(PacchettoError)
  })

  it('COMPLETED richiede la data di fine; AWAITING_RECEIVER non la ammette', () => {
    expect(() => validaRecordFir({ ...ok(), stato: 'COMPLETED' }, mappa)).toThrow(PacchettoError)
    expect(
      validaRecordFir({ ...ok(), stato: 'COMPLETED', dataFine: '2026-03-06' }, mappa).dataFine
    ).toBe('2026-03-06')
    expect(() => validaRecordFir({ ...ok(), dataFine: '2026-03-06' }, mappa)).toThrow(
      PacchettoError
    )
  })

  it('le parti: ditta di un altra azienda, sede di un altra ditta, aggancio incoerente, sede propria fuori mappa', () => {
    const p = ok().produttore as Extract<RecordFir['produttore'], { tipo: 'ditta' }>
    const altraDitta = { ...p, dittaKey: '0002|FISC|01234567897' }
    expect(() => validaRecordFir({ ...ok(), produttore: altraDitta }, mappa)).toThrow(
      PacchettoError
    )
    const sedeAltra = { ...p, sedeKey: '0002|C|000001|0001' }
    expect(() => validaRecordFir({ ...ok(), produttore: sedeAltra }, mappa)).toThrow(PacchettoError)
    const ruoloAltro = { ...p, ruoloKey: '0001|C|000001|0001' }
    expect(() => validaRecordFir({ ...ok(), produttore: ruoloAltro }, mappa)).toThrow(
      PacchettoError
    )
    const agganciataSenzaMappa = { ...p, dittaId: '99999999-9999-4999-8999-999999999999' }
    expect(() => validaRecordFir({ ...ok(), produttore: agganciataSenzaMappa }, mappa)).toThrow(
      PacchettoError
    )
    const propriaFuoriMappa = { tipo: 'propria', sedeId: '99999999-9999-4999-8999-999999999999' }
    expect(() => validaRecordFir({ ...ok(), destinatario: propriaFuoriMappa }, mappa)).toThrow(
      PacchettoError
    )
    expect(() => validaRecordFir({ ...ok(), produttore: null }, mappa)).toThrow(PacchettoError)
    expect(() => validaRecordFir({ ...ok(), destinatario: { tipo: 'x' } }, mappa)).toThrow(
      PacchettoError
    )
  })

  it('il messaggio dell errore non riporta mai il valore', () => {
    expect.assertions(2)
    try {
      validaRecordFir(conCampo('firNumber', 'SEGRETO\u0001'), mappa)
    } catch (e) {
      expect(e).toBeInstanceOf(PacchettoError)
      expect((e as PacchettoError).message).not.toContain('SEGRETO')
    }
  })
})

describe('validaRecordFirDigitale', () => {
  const dig = () => ({
    legacyKey: '0001|2026|FORMULARI|20',
    numeroFir: 'ABCDE1234567',
    idRentri: 'id-rentri-1',
    unitaLocaleId: null,
  })

  it('valido, con idRentri e unita locale opzionali', () => {
    expect(validaRecordFirDigitale(dig(), mappa)).toEqual(dig())
    expect(validaRecordFirDigitale({ ...dig(), idRentri: null }, mappa).idRentri).toBeNull()
  })

  it.each([
    ['numero vuoto', 'numeroFir', ''],
    ['numero con spazi', 'numeroFir', 'AB CD'],
    ['numero che esce dal percorso', 'numeroFir', '../x'],
    ['numero con query', 'numeroFir', 'AB?x=1'],
    ['legacyKey di un altro anno', 'legacyKey', '0001|2025|FORMULARI|20'],
    ['idRentri con controllo', 'idRentri', 'a\u0000'],
    ['unita locale non UUID', 'unitaLocaleId', 'x'],
  ])('rifiuta: %s', (_n, campo, valore) => {
    expect(() => validaRecordFirDigitale({ ...dig(), [campo]: valore }, mappa)).toThrow(
      PacchettoError
    )
  })
})
