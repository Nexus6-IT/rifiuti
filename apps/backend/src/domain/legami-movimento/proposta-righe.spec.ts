import { quantitaPerRiga, rigaVCombacia, scegliRighe, type RigaCandidata } from './proposta-righe'

let n = 0
const riga = (o: Partial<RigaCandidata> = {}): RigaCandidata => ({
  id: `r${++n}`,
  tipo: 'CER',
  cerCode: '20 03 01',
  riferimento: null,
  addebitoCodice: null,
  cerProposta: [],
  addebitiProposti: [],
  tipoQuantita: 'PESO_NETTO',
  unitaMisura: 'KG',
  ...o,
})
const riV = (o: Partial<RigaCandidata> = {}): RigaCandidata =>
  riga({ tipo: 'V', cerCode: null, addebitoCodice: 'TRASP', ...o })

describe('scegliRighe: riga CER (decisione 12)', () => {
  it('il riferimento vuoto vince su "?"', () => {
    const vuota = riga({ riferimento: null })
    const e = scegliRighe([riga({ riferimento: '?' }), vuota], '20 03 01')
    expect(e.principale).toBe(vuota)
    expect(e.motivo).toBeNull()
  })
  it('solo "?": quella', () => {
    const q = riga({ riferimento: '?' })
    expect(scegliRighe([q, riga({ riferimento: 'A1' })], '20 03 01').principale).toBe(q)
  })
  it('solo riferimenti specifici: RIGA_AMBIGUA con le candidate', () => {
    const a = riga({ riferimento: 'A1' })
    const b = riga({ riferimento: 'B2' })
    const e = scegliRighe([a, b], '20 03 01')
    expect(e.principale).toBeNull()
    expect(e.motivo).toBe('RIGA_AMBIGUA')
    expect(e.candidateCer).toEqual([a, b])
  })
  it('due righe con riferimento vuoto: ambigua', () => {
    expect(scegliRighe([riga(), riga()], '20 03 01').motivo).toBe('RIGA_AMBIGUA')
  })
  it('nessuna riga CER: SENZA_RIGA_CER', () => {
    const e = scegliRighe([riV(), riga({ cerCode: '15 01 01' })], '20 03 01')
    expect(e.motivo).toBe('SENZA_RIGA_CER')
    expect(e.principale).toBeNull()
  })
  it('il CER si confronta con chiaveConfrontoCer', () => {
    const r = riga({ cerCode: '200301' })
    expect(scegliRighe([r], '20 03 01').principale).toBe(r)
  })
  it('il CER con asterisco non combacia con quello senza', () => {
    expect(scegliRighe([riga({ cerCode: '20 01 21*' })], '20 01 21').motivo).toBe('SENZA_RIGA_CER')
    expect(scegliRighe([riga({ cerCode: '20 01 21' })], '20 01 21*').motivo).toBe('SENZA_RIGA_CER')
  })
})

describe('righe V proposte', () => {
  const cer = '20 03 01'
  it.each([
    ['20 03 01/', true],
    ['20 03 01/*', true],
    ['20 03 01', true],
    ['20 03 01/A1', false],
    ['15 01 01/', false],
    ['20 03 01*/', false],
  ])('cerProposta %s -> %s', (el, atteso) => {
    expect(rigaVCombacia(riV({ cerProposta: [el] }), cer)).toBe(atteso)
  })
  it('"/" e "/*" sulla stessa riga V: una proposta sola', () => {
    const v = riV({ cerProposta: ['20 03 01/', '20 03 01/*'] })
    const e = scegliRighe([riga(), v], cer)
    expect(e.proposte).toEqual([v])
  })
  it('V il cui addebitoCodice e in addebitiProposti della riga CER: proposta', () => {
    const v = riV({ addebitoCodice: 'TRASP' })
    const e = scegliRighe([riga({ addebitiProposti: ['TRASP'] }), v], cer)
    expect(e.proposte).toEqual([v])
  })
  it('V non proposta da nessuno: non compare', () => {
    const e = scegliRighe([riga({ addebitiProposti: ['ALTRO'] }), riV()], cer)
    expect(e.proposte).toEqual([])
  })
  it.each(['T', 'F', 'N', 'M'])('tipo %s non si propone', tipo => {
    const r = riga({ tipo, cerCode: null, cerProposta: ['20 03 01/'], addebitoCodice: 'TRASP' })
    expect(rigaVCombacia(r, cer)).toBe(false)
    expect(scegliRighe([riga({ addebitiProposti: ['TRASP'] }), r], cer).proposte).toEqual([])
  })
})

describe('quantitaPerRiga', () => {
  const q = (
    tipoQuantita: RigaCandidata['tipoQuantita'],
    unitaMisura: string,
    quantity: string,
    unit: string
  ) => quantitaPerRiga({ tipoQuantita, unitaMisura }, { quantity, unit })
  it('PESO_NETTO su 6000 KG, riga KG', () =>
    expect(q('PESO_NETTO', 'KG', '6000', 'KG')).toBe('6000'))
  it('6000 KG con riga TON', () => expect(q('PESO_NETTO', 'TON', '6000', 'KG')).toBe('6'))
  it('6 T con riga KG', () => expect(q('PESO_NETTO', 'KG', '6', 'T')).toBe('6000'))
  it('quantity 0.50 con TON', () => expect(q('PESO_NETTO', 'TON', '0.50', 'KG')).toBe('0.0005'))
  it.each(['NR', 'L'])('PESO_NETTO su unita %s: null', u =>
    expect(q('PESO_NETTO', 'KG', '5', u)).toBeNull()
  )
  it('PESO_LORDO: null', () => expect(q('PESO_LORDO', 'KG', '5', 'KG')).toBeNull())
  it('UNO: "1"', () => expect(q('UNO', 'NR', '5', 'KG')).toBe('1'))
  it('ALTRO: null', () => expect(q('ALTRO', 'KG', '5', 'KG')).toBeNull())
  it('tipoQuantita null: null', () => expect(q(null, 'KG', '5', 'KG')).toBeNull())
  it('VOLUME con unit L', () => {
    expect(q('VOLUME', 'LT', '500', 'L')).toBe('500')
    expect(q('VOLUME', 'MC', '500', 'L')).toBe('0.5')
  })
  it('VOLUME con unit MC', () => expect(q('VOLUME', 'LT', '2', 'MC')).toBe('2000'))
  it('VOLUME con unit KG: null', () => expect(q('VOLUME', 'LT', '5', 'KG')).toBeNull())
  it('quantity non numerica o negativa: null', () => {
    expect(q('PESO_NETTO', 'KG', 'abc', 'KG')).toBeNull()
    expect(q('PESO_NETTO', 'KG', '-3', 'KG')).toBeNull()
  })
})
