import { normalizzaEventoCampo } from './eventi-campo.input'

const ID = '11111111-1111-4111-8111-111111111111'
const RITIRO = '22222222-2222-4222-8222-222222222222'
const base = {
  id: ID,
  ritiroId: RITIRO,
  tipo: 'RITIRO_ESEGUITO',
  versioneVista: 3,
  dataVista: '2026-12-01',
  sedeVista: '33333333-3333-4333-8333-333333333333',
  rilevatoIl: '2026-12-01T08:30:00.000Z',
}

describe('normalizzaEventoCampo', () => {
  it('accetta un esito eseguito, anche con nota facoltativa', () => {
    const r = normalizzaEventoCampo({ ...base, dati: { nota: '  cancello aperto ' } })
    expect(r).toEqual({
      ok: true,
      valori: {
        id: ID,
        ritiroId: RITIRO,
        tipo: 'RITIRO_ESEGUITO',
        versioneVista: 3,
        dataVista: '2026-12-01',
        sedeVista: '33333333-3333-4333-8333-333333333333',
        rilevatoIl: new Date('2026-12-01T08:30:00.000Z'),
        dati: { nota: 'cancello aperto' },
      },
    })
  })

  it('il non eseguito vuole il motivo, al massimo 500 caratteri', () => {
    const senza = normalizzaEventoCampo({ ...base, tipo: 'RITIRO_NON_ESEGUITO', dati: {} })
    expect(senza).toMatchObject({ ok: false, messaggi: ['Il motivo è obbligatorio.'] })
    const lungo = normalizzaEventoCampo({
      ...base,
      tipo: 'RITIRO_NON_ESEGUITO',
      dati: { motivo: 'x'.repeat(501) },
    })
    expect(lungo).toMatchObject({ ok: false })
    const ok = normalizzaEventoCampo({
      ...base,
      tipo: 'RITIRO_NON_ESEGUITO',
      dati: { motivo: ' Cliente assente ' },
    })
    expect(ok).toMatchObject({ ok: true, valori: { dati: { motivo: 'Cliente assente' } } })
  })

  it('rifiuta campi estranei in dati (whitelist per tipo)', () => {
    expect(normalizzaEventoCampo({ ...base, dati: { motivo: 'x' } })).toMatchObject({ ok: false })
    expect(
      normalizzaEventoCampo({
        ...base,
        tipo: 'RITIRO_NON_ESEGUITO',
        dati: { motivo: 'x', foto: 'y' },
      })
    ).toMatchObject({ ok: false })
    expect(normalizzaEventoCampo({ ...base, dati: ['x'] as never })).toMatchObject({ ok: false })
    expect(normalizzaEventoCampo({ ...base, dati: { nota: 5 } as never })).toMatchObject({
      ok: false,
    })
  })

  it.each([
    ['id', { id: 'x' }],
    ['ritiro', { ritiroId: '' }],
    ['tipo', { tipo: 'ALTRO' }],
    ['data vista', { dataVista: '1/12/2026' }],
    ['sede vista', { sedeVista: 'x' }],
    ['versione zero', { versioneVista: 0 }],
    ['versione decimale', { versioneVista: 1.5 }],
    ['versione stringa', { versioneVista: '3' }],
    ['data non valida', { rilevatoIl: 'ieri' }],
    ['data senza ora', { rilevatoIl: '2026-12-01' }],
    ['data fuori scala', { rilevatoIl: '1970-01-01T00:00:00.000Z' }],
  ])('rifiuta %s', (_n, extra) => {
    expect(normalizzaEventoCampo({ ...base, ...(extra as object) })).toMatchObject({ ok: false })
  })

  it('porta in minuscolo gli uuid e accetta dati assenti', () => {
    const r = normalizzaEventoCampo({ ...base, id: ID.toUpperCase() })
    expect(r).toMatchObject({ ok: true, valori: { id: ID, dati: {} } })
  })
  describe('posizione al momento dell evento (P5, facoltativa)', () => {
    const pos = { lat: 45.4642035, lon: 9.189982, accuratezza: 12.4 }

    it.each(['RITIRO_ESEGUITO', 'RITIRO_NON_ESEGUITO'])(
      'accetta la posizione su %s e la arrotonda (6 decimali, accuratezza al metro)',
      tipo => {
        const dati = tipo === 'RITIRO_NON_ESEGUITO' ? { motivo: 'Assente' } : {}
        const r = normalizzaEventoCampo({ ...base, tipo, dati: { ...dati, posizione: pos } })
        expect(r).toMatchObject({
          ok: true,
          valori: { dati: { posizione: { lat: 45.464204, lon: 9.189982, accuratezza: 12 } } },
        })
      }
    )

    it('senza posizione l evento e valido come prima (app gia installate)', () => {
      expect(normalizzaEventoCampo({ ...base, dati: {} })).toMatchObject({
        ok: true,
        valori: { dati: {} },
      })
    })

    it.each([
      ['latitudine fuori scala', { lat: 91, lon: 9, accuratezza: 5 }],
      ['longitudine fuori scala', { lat: 45, lon: -181, accuratezza: 5 }],
      ['accuratezza negativa', { lat: 45, lon: 9, accuratezza: -1 }],
      ['accuratezza enorme', { lat: 45, lon: 9, accuratezza: 1_000_000 }],
      ['lat stringa', { lat: '45', lon: 9, accuratezza: 5 }],
      ['senza accuratezza', { lat: 45, lon: 9 }],
      ['NaN', { lat: NaN, lon: 9, accuratezza: 5 }],
      ['campo in piu', { lat: 45, lon: 9, accuratezza: 5, quota: 100 }],
    ])('una posizione malformata (%s) si scarta senza rifiutare il fatto', (_n, p) => {
      const r = normalizzaEventoCampo({ ...base, dati: { nota: 'ok', posizione: p } })
      expect(r).toMatchObject({ ok: true, valori: { dati: { nota: 'ok' } } })
      expect((r as { valori: { dati: object } }).valori.dati).not.toHaveProperty('posizione')
    })

    it('una posizione non oggetto si scarta', () => {
      const r = normalizzaEventoCampo({ ...base, dati: { posizione: 'qui' } })
      expect(r).toMatchObject({ ok: true, valori: { dati: {} } })
    })
  })
})
