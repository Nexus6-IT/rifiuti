import {
  formattaDecimaleCanonico,
  improntaPesata,
  improntaRettifica,
  type CampiImprontaPesata,
  type CampiImprontaRettifica,
} from './impronta-pesata'

const base: CampiImprontaPesata = {
  tenantId: 't1',
  accessoId: 'a1',
  ordine: 1,
  fonte: 'MANUALE',
  strumentoId: 's1',
  strumentoEsterno: 'Bilancia cliente',
  alibiId: 'AL-1',
  pesoKg: 12340,
  stabile: true,
  oraStrumento: new Date('2026-10-31T08:00:00.000Z'),
  oraRicezione: new Date('2026-10-31T08:00:05.000Z'),
  operatoreId: 'u1',
  allegatoSha256: 'ab'.repeat(32),
  automezzoId: 'm1',
  taraAggiornataIl: new Date('2026-10-01T08:00:00.000Z'),
  chiaveIdempotenza: 'k1',
}

const varianti: [string, Partial<CampiImprontaPesata>][] = [
  ['tenantId', { tenantId: 't2' }],
  ['accessoId', { accessoId: 'a2' }],
  ['ordine', { ordine: 2 }],
  ['fonte', { fonte: 'FILE' }],
  ['strumentoId', { strumentoId: 's2' }],
  ['strumentoEsterno', { strumentoEsterno: 'Altra' }],
  ['alibiId', { alibiId: 'AL-2' }],
  ['pesoKg', { pesoKg: 12340.01 }],
  ['stabile', { stabile: false }],
  ['oraStrumento', { oraStrumento: new Date('2026-10-31T08:00:01.000Z') }],
  ['oraRicezione', { oraRicezione: new Date('2026-10-31T08:00:06.000Z') }],
  ['operatoreId', { operatoreId: 'u2' }],
  ['allegatoSha256', { allegatoSha256: 'cd'.repeat(32) }],
  ['automezzoId', { automezzoId: 'm2' }],
  ['taraAggiornataIl', { taraAggiornataIl: new Date('2026-10-02T08:00:00.000Z') }],
  ['chiaveIdempotenza', { chiaveIdempotenza: 'k2' }],
]

describe('improntaPesata', () => {
  it('è deterministica, esadecimale di 64 caratteri', () => {
    expect(improntaPesata(base)).toBe(improntaPesata({ ...base }))
    expect(improntaPesata(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each(varianti)('cambia se cambia %s', (_nome, diff) => {
    expect(improntaPesata({ ...base, ...diff })).not.toBe(improntaPesata(base))
  })

  describe('versione 2 (fonti STRUMENTO e SIMULATA)', () => {
    const daLettura: CampiImprontaPesata = {
      ...base,
      fonte: 'STRUMENTO',
      strumentoEsterno: null,
      letturaId: 'l1',
      firmaAgente: 'FIRMA',
    }

    it('cambia se cambia letturaId o firmaAgente', () => {
      const a = improntaPesata(daLettura)
      expect(improntaPesata({ ...daLettura, letturaId: 'l2' })).not.toBe(a)
      expect(improntaPesata({ ...daLettura, firmaAgente: 'ALTRA' })).not.toBe(a)
      expect(improntaPesata({ ...daLettura, fonte: 'SIMULATA' })).not.toBe(a)
    })

    it('per le altre fonti letturaId e firmaAgente non entrano: l’impronta p1 resta quella di prima', () => {
      expect(improntaPesata({ ...base, letturaId: 'x', firmaAgente: 'y' })).toBe(
        improntaPesata(base)
      )
    })

    it('MANUALE, FILE e TARA_ANAGRAFICA restano p1: valori fissati (non cambiano senza una nuova versione)', () => {
      expect(improntaPesata(base)).toBe(
        '7137fc894b5e7a6625165250b0ca9ef297b406fc4dfb5634b455503926ffb0b0'
      )
    })
  })

  it("pesoKg 12340, '12340.00' e '12340' danno la stessa impronta", () => {
    expect(improntaPesata({ ...base, pesoKg: '12340.00' })).toBe(improntaPesata(base))
    expect(improntaPesata({ ...base, pesoKg: '12340' })).toBe(improntaPesata(base))
  })

  it('campi facoltativi null e undefined sono equivalenti', () => {
    const a = {
      ...base,
      strumentoId: null,
      strumentoEsterno: null,
      alibiId: null,
      oraStrumento: null,
      operatoreId: null,
      allegatoSha256: null,
      automezzoId: null,
      taraAggiornataIl: null,
    }
    const b = {
      ...base,
      strumentoId: undefined,
      strumentoEsterno: undefined,
      alibiId: undefined,
      oraStrumento: undefined,
      operatoreId: undefined,
      allegatoSha256: undefined,
      automezzoId: undefined,
      taraAggiornataIl: undefined,
    }
    expect(improntaPesata(a)).toBe(improntaPesata(b))
  })

  it('la codifica non è ambigua: separatore dentro un campo di testo libero', () => {
    expect(improntaPesata({ ...base, strumentoEsterno: 'Bil|', alibiId: 'X' })).not.toBe(
      improntaPesata({ ...base, strumentoEsterno: 'Bil', alibiId: '|X' })
    )
  })

  it('stringa vuota e null sono distinti (ma null e undefined no)', () => {
    expect(improntaPesata({ ...base, alibiId: '' })).not.toBe(
      improntaPesata({ ...base, alibiId: null })
    )
    expect(improntaPesata({ ...base, alibiId: null })).toBe(
      improntaPesata({ ...base, alibiId: undefined })
    )
  })

  it('un campo vuoto non si confonde con uno spostato (separatore)', () => {
    expect(improntaPesata({ ...base, strumentoId: null, strumentoEsterno: 'x' })).not.toBe(
      improntaPesata({ ...base, strumentoId: 'x', strumentoEsterno: null })
    )
  })
})

describe('improntaRettifica', () => {
  const r: CampiImprontaRettifica = {
    tenantId: 't1',
    pesataId: 'p1',
    numero: 1,
    pesoPrecedenteKg: 12340,
    pesoNuovoKg: 12350,
    motivo: 'Errore di trascrizione',
    autoreId: 'u1',
    allegatoSha256: null,
    createdAt: new Date('2026-10-31T09:00:00.000Z'),
  }
  const varR: [string, Partial<CampiImprontaRettifica>][] = [
    ['tenantId', { tenantId: 't2' }],
    ['pesataId', { pesataId: 'p2' }],
    ['numero', { numero: 2 }],
    ['pesoPrecedenteKg', { pesoPrecedenteKg: 1 }],
    ['pesoNuovoKg', { pesoNuovoKg: 12351 }],
    ['motivo', { motivo: 'Altro' }],
    ['autoreId', { autoreId: 'u2' }],
    ['allegatoSha256', { allegatoSha256: 'ab'.repeat(32) }],
    ['createdAt', { createdAt: new Date('2026-10-31T09:00:01.000Z') }],
  ]

  it.each(varR)('cambia se cambia %s', (_n, diff) => {
    expect(improntaRettifica({ ...r, ...diff })).not.toBe(improntaRettifica(r))
  })

  it('la codifica non è ambigua: motivo e autore con il separatore', () => {
    expect(improntaRettifica({ ...r, motivo: 'M|a', autoreId: 'b' })).not.toBe(
      improntaRettifica({ ...r, motivo: 'M', autoreId: 'a|b' })
    )
  })

  it('allegato null e stringa vuota sono distinti', () => {
    expect(improntaRettifica({ ...r, allegatoSha256: '' })).not.toBe(
      improntaRettifica({ ...r, allegatoSha256: null })
    )
  })

  it('pesata e rettifica con gli stessi valori non collidono (prefissi p1| e r1|)', () => {
    const p = improntaPesata({
      ...base,
      tenantId: 'x',
      accessoId: 'y',
      ordine: 1,
      fonte: 'FILE',
      strumentoId: null,
      strumentoEsterno: null,
      alibiId: null,
      pesoKg: 1,
      stabile: true,
      oraStrumento: null,
      oraRicezione: new Date(0),
      operatoreId: null,
      allegatoSha256: null,
      automezzoId: null,
      taraAggiornataIl: null,
      chiaveIdempotenza: 'z',
    })
    expect(p).not.toBe(improntaRettifica(r))
  })
})

describe('formattaDecimaleCanonico', () => {
  it.each([
    [12340, '12340.00'],
    ['12340.00', '12340.00'],
    ['12340.5', '12340.50'],
    [0.1 + 0.2, '0.30'],
    [1000.05, '1000.05'],
  ])('%p → %p', (n, atteso) => {
    expect(formattaDecimaleCanonico(n)).toBe(atteso)
  })
  it('più di 2 decimali → errore esplicito, non arrotondamento', () => {
    expect(() => formattaDecimaleCanonico(12.345)).toThrow(/decimali/)
    expect(() => formattaDecimaleCanonico('12.345')).toThrow(/decimali/)
    expect(formattaDecimaleCanonico('12340.000')).toBe('12340.00')
  })
  it('non numerico → errore', () => {
    expect(() => formattaDecimaleCanonico(NaN)).toThrow()
    expect(() => formattaDecimaleCanonico('abc')).toThrow()
  })
})
