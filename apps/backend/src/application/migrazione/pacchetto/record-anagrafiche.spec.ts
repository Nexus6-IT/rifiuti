import { PacchettoError } from './errori-pacchetto'
import {
  validaRecordAutomezzo,
  validaRecordDestinatario,
  validaRecordProduttore,
  validaRecordSede,
  validaRecordTrasportatore,
} from './record-anagrafiche'
import { validaMappa } from './mappa-import'
import { mappaValida, U1, U2 } from '../../../test-support/migrazione/mappa-di-prova'
import { partitaIvaValida } from '../../../test-support/anagrafiche-di-test'

const PIVA = partitaIvaValida(7_100_001)
const mappa = validaMappa({
  ...mappaValida(),
  agganci: [{ partitaIva: PIVA, dittaId: U2 }],
})
const DITTA = `0001|FISC|${PIVA}`
const ALTRA = `0001|FISC|${partitaIvaValida(7_100_002)}`

const sede = (o: Record<string, unknown> = {}) => ({
  legacyKey: '0001|C|000001|SL',
  dittaKey: ALTRA,
  dittaId: null,
  denominazione: null,
  via: 'VIA ROMA',
  civico: '1',
  cap: '80100',
  comune: 'NAPOLI',
  provincia: 'NA',
  telefono: null,
  principale: true,
  ...o,
})
const prod = (o: Record<string, unknown> = {}) => ({
  legacyKey: '0001|C|000001',
  dittaKey: ALTRA,
  dittaId: null,
  sedeKey: '0001|C|000001|SL',
  ...o,
})
const tras = (o: Record<string, unknown> = {}) => ({
  ...prod(),
  numeroIscrizione: 'NA1234',
  scadenzaIscrizione: '2028-01-31',
  ...o,
})
const dest = (o: Record<string, unknown> = {}) => ({
  ...prod(),
  numeroAutorizzazione: 'AUT-1',
  scadenzaAutorizzazione: null,
  ...o,
})
const mezzo = (o: Record<string, unknown> = {}) => ({
  legacyKey: '0001|MEZ|000001.0001|0001',
  targa: 'AB123CD',
  trasportatoreKey: '0001|C|000001',
  taraKg: 7500,
  note: null,
  ...o,
})

function rifiuta(f: () => unknown, parte: string) {
  try {
    f()
  } catch (e) {
    expect(e).toBeInstanceOf(PacchettoError)
    expect((e as PacchettoError).codice).toBe('RIGA_NON_VALIDA')
    expect((e as PacchettoError).dettaglio).toContain(parte)
    // mai valori nel messaggio
    expect((e as PacchettoError).dettaglio).not.toContain('NAPOLI')
    return
  }
  throw new Error('atteso un errore')
}

describe('record sede', () => {
  it('accetta una sede valida', () => {
    expect(validaRecordSede(sede(), mappa).legacyKey).toBe('0001|C|000001|SL')
  })
  it.each([
    ['forma', { extra: 1 }, 'sede: FORMA'],
    ['chiave', { legacyKey: '0002|C|000001|SL' }, 'sede: CHIAVE'],
    ['chiave ditta', { dittaKey: '0001|FISC|zz zz' }, 'sede: DITTA'],
    ['indirizzo', { cap: '80' }, 'sede: INDIRIZZO'],
    ['telefono', { telefono: 'chiamami' }, 'sede: TELEFONO'],
    ['principale', { principale: 'si' }, 'sede: PRINCIPALE'],
    ['denominazione', { denominazione: 'a\u0000b' }, 'sede: DENOMINAZIONE'],
  ])('rifiuta %s', (_n, o, parte) => rifiuta(() => validaRecordSede(sede(o), mappa), parte))
  it('una ditta agganciata deve avere il suo id (e viceversa)', () => {
    rifiuta(
      () => validaRecordSede(sede({ dittaKey: DITTA, dittaId: null }), mappa),
      'sede: AGGANCIO'
    )
    rifiuta(() => validaRecordSede(sede({ dittaKey: ALTRA, dittaId: U2 }), mappa), 'sede: AGGANCIO')
    rifiuta(() => validaRecordSede(sede({ dittaKey: DITTA, dittaId: U1 }), mappa), 'sede: AGGANCIO')
    expect(
      validaRecordSede(sede({ dittaKey: DITTA, dittaId: U2, principale: false }), mappa).dittaId
    ).toBe(U2)
  })
})

describe('record ruoli', () => {
  it('accetta produttore, trasportatore e destinatario validi', () => {
    expect(validaRecordProduttore(prod(), mappa).sedeKey).toBe('0001|C|000001|SL')
    expect(validaRecordTrasportatore(tras(), mappa).numeroIscrizione).toBe('NA1234')
    expect(validaRecordDestinatario(dest(), mappa).scadenzaAutorizzazione).toBeNull()
  })
  it('la sede predefinita deve essere una sede dello stesso soggetto', () => {
    rifiuta(
      () => validaRecordProduttore(prod({ sedeKey: '0001|C|000002|SL' }), mappa),
      'ruolo: SEDE'
    )
    rifiuta(() => validaRecordProduttore(prod({ sedeKey: 'boh' }), mappa), 'ruolo: SEDE')
  })
  it.each([
    ['numero vuoto', { numeroIscrizione: ' ' }],
    ['numero troppo lungo', { numeroIscrizione: 'x'.repeat(51) }],
    ['scadenza inesistente', { scadenzaIscrizione: '2028-02-31' }],
    ['scadenza malformata', { scadenzaIscrizione: '31/01/2028' }],
  ])('trasportatore: %s', (_n, o) =>
    rifiuta(() => validaRecordTrasportatore(tras(o), mappa), 'ruolo:')
  )
  it('chiave del ruolo e forma', () => {
    rifiuta(
      () => validaRecordProduttore(prod({ legacyKey: '0001|X|000001' }), mappa),
      'ruolo: CHIAVE'
    )
    rifiuta(() => validaRecordProduttore({ ...prod(), altro: 1 }, mappa), 'ruolo: FORMA')
    rifiuta(() => validaRecordDestinatario(prod(), mappa), 'ruolo: FORMA')
  })
})

describe('record automezzo', () => {
  it('accetta un automezzo valido, con o senza trasportatore e tara', () => {
    expect(validaRecordAutomezzo(mezzo(), mappa).targa).toBe('AB123CD')
    const r = validaRecordAutomezzo(mezzo({ trasportatoreKey: null, taraKg: null }), mappa)
    expect(r.trasportatoreKey).toBeNull()
  })
  it.each([
    ['targa', { targa: 'a b' }, 'automezzo: TARGA'],
    ['tara', { taraKg: -5 }, 'automezzo: TARA'],
    ['tara decimale', { taraKg: 10.5 }, 'automezzo: TARA'],
    ['trasportatore', { trasportatoreKey: 'x' }, 'automezzo: TRASPORTATORE'],
    ['chiave', { legacyKey: '0001|XXX|a|b' }, 'automezzo: CHIAVE'],
    ['note', { note: 'x'.repeat(501) }, 'automezzo: NOTE'],
  ])('rifiuta %s', (_n, o, parte) => rifiuta(() => validaRecordAutomezzo(mezzo(o), mappa), parte))
})
