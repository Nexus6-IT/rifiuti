import {
  proponiCliente,
  proponiContratto,
  proponiElenco,
  type ContrattoCandidato,
  type ElencoCandidato,
} from './proposta-contratto'

const c = (id: string, o: Partial<ContrattoCandidato> = {}): ContrattoCandidato => ({
  id,
  clienteId: 'cl',
  stato: 'ATTIVO',
  dataInizio: '2026-01-01',
  dataFine: null,
  sedeId: null,
  ...o,
})
const ids = (l: readonly { id: string }[]) => l.map(x => x.id).sort()

describe('proponiCliente', () => {
  it('FIR con cliente attivo: clienteId, fonte FIR, nessun motivo', () => {
    expect(proponiCliente({ firPresente: true, clienteDaFir: { id: 'c1', attivo: true } })).toEqual(
      { clienteId: 'c1', fonte: 'FIR', motivi: [], avvisi: [] }
    )
  })
  it('FIR il cui produttore non è cliente: SENZA_CLIENTE + avviso CLIENTE_NON_DA_FIR', () => {
    expect(proponiCliente({ firPresente: true, clienteDaFir: null })).toEqual({
      clienteId: null,
      fonte: null,
      motivi: ['SENZA_CLIENTE'],
      avvisi: ['CLIENTE_NON_DA_FIR'],
    })
  })
  it('cliente disattivato: SENZA_CLIENTE', () => {
    const r = proponiCliente({ firPresente: true, clienteDaFir: { id: 'c1', attivo: false } })
    expect(r.clienteId).toBeNull()
    expect(r.motivi).toEqual(['SENZA_CLIENTE'])
    expect(r.avvisi).toEqual(['CLIENTE_NON_DA_FIR'])
  })
  it('nessun FIR: SENZA_CLIENTE senza avviso', () => {
    expect(proponiCliente({ firPresente: false, clienteDaFir: null })).toEqual({
      clienteId: null,
      fonte: null,
      motivi: ['SENZA_CLIENTE'],
      avvisi: [],
    })
  })
})

describe('proponiContratto', () => {
  const D = '2026-06-15'
  it('stessa sede del FIR vince sul senza sede', () => {
    const r = proponiContratto([c('a', { sedeId: 's1' }), c('b')], D, 's1')
    expect(r.contratto?.id).toBe('a')
    expect(r.motivo).toBeNull()
  })
  it('nessuno della sede: il senza sede', () => {
    const r = proponiContratto([c('a', { sedeId: 's2' }), c('b')], D, 's1')
    expect(r.contratto?.id).toBe('b')
  })
  it('solo contratti di altre sedi: nessuna proposta, SEDE_SENZA_CONTRATTO', () => {
    const r = proponiContratto([c('a', { sedeId: 's2' })], D, 's1')
    expect(r.contratto).toBeNull()
    expect(r.motivo).toBe('SEDE_SENZA_CONTRATTO')
  })
  it('due nella stessa sede: CONTRATTO_AMBIGUO con la lista', () => {
    const r = proponiContratto(
      [c('a', { sedeId: 's1' }), c('b', { sedeId: 's1' }), c('z')],
      D,
      's1'
    )
    expect(r.contratto).toBeNull()
    expect(r.motivo).toBe('CONTRATTO_AMBIGUO')
    expect(ids(r.candidati)).toEqual(['a', 'b'])
  })
  it('BOZZA e ANNULLATO mai proposti', () => {
    const r = proponiContratto(
      [c('a', { stato: 'BOZZA' }), c('b', { stato: 'ANNULLATO' })],
      D,
      null
    )
    expect(r.contratto).toBeNull()
    expect(r.motivo).toBe('SENZA_CONTRATTO')
  })
  it('unico SOSPESO: CONTRATTO_NON_ATTIVO', () => {
    for (const stato of ['SOSPESO', 'SOSPESO_MOVIMENTI'] as const) {
      const r = proponiContratto([c('a', { stato })], D, null)
      expect(r.contratto).toBeNull()
      expect(r.motivo).toBe('CONTRATTO_NON_ATTIVO')
    }
  })
  it('nessun contratto: SENZA_CONTRATTO', () => {
    const r = proponiContratto([], D, 's1')
    expect(r).toEqual({ contratto: null, candidati: [], motivo: 'SENZA_CONTRATTO' })
  })
  it('sedeId null e solo contratti senza sede, uno: proposto', () => {
    expect(proponiContratto([c('a')], D, null).contratto?.id).toBe('a')
  })
  it('sedeId null e solo contratti con sede: CONTRATTO_AMBIGUO con la lista', () => {
    const r = proponiContratto([c('a', { sedeId: 's1' }), c('b', { sedeId: 's2' })], D, null)
    expect(r.contratto).toBeNull()
    expect(r.motivo).toBe('CONTRATTO_AMBIGUO')
    expect(ids(r.candidati)).toEqual(['a', 'b'])
  })
  it('sedeId null: i senza sede valgono, anche se esistono contratti con sede', () => {
    expect(proponiContratto([c('a', { sedeId: 's1' }), c('b')], D, null).contratto?.id).toBe('b')
  })
  it('dataFine null = aperto', () => {
    expect(proponiContratto([c('a', { dataFine: null })], '2099-12-31', null).contratto?.id).toBe(
      'a'
    )
  })
  it('data = dataFine: valido, data = dataFine+1: non valido', () => {
    const k = c('a', { dataFine: '2026-06-30' })
    expect(proponiContratto([k], '2026-06-30', null).contratto?.id).toBe('a')
    const r = proponiContratto([k], '2026-07-01', null)
    expect(r.contratto).toBeNull()
    expect(r.motivo).toBe('CONTRATTO_NON_ATTIVO')
  })
  it('data = dataInizio: valido', () => {
    expect(proponiContratto([c('a')], '2026-01-01', null).contratto?.id).toBe('a')
  })
  it('movimento retrodatato prima di dataInizio: CONTRATTO_NON_ATTIVO, mai eccezione', () => {
    let r!: ReturnType<typeof proponiContratto>
    expect(() => {
      r = proponiContratto([c('a')], '2025-12-31', null)
    }).not.toThrow()
    expect(r.contratto).toBeNull()
    expect(r.motivo).toBe('CONTRATTO_NON_ATTIVO')
  })
  it('un contratto valido e uno non ancora iniziato: propone il valido', () => {
    const r = proponiContratto([c('a'), c('b', { dataInizio: '2027-01-01' })], D, null)
    expect(r.contratto?.id).toBe('a')
  })
})

describe('proponiElenco', () => {
  const e = (id: string, o: Partial<ElencoCandidato> = {}): ElencoCandidato => ({
    id,
    validoDal: null,
    validoAl: null,
    predefinito: false,
    ...o,
  })
  const D = '2026-06-15'
  it('unico valido: quello', () => {
    const r = proponiElenco([e('a')], D)
    expect(r.elenco?.id).toBe('a')
    expect(r.motivo).toBeNull()
  })
  it('due validi e un predefinito valido: il predefinito', () => {
    expect(proponiElenco([e('a'), e('b', { predefinito: true })], D).elenco?.id).toBe('b')
  })
  it('due validi senza predefinito: nessuno, SENZA_ELENCO', () => {
    const r = proponiElenco([e('a'), e('b')], D)
    expect(r.elenco).toBeNull()
    expect(r.motivo).toBe('SENZA_ELENCO')
    expect(ids(r.validi)).toEqual(['a', 'b'])
  })
  it('validoDal dopo la data: escluso (non ancora iniziato)', () => {
    const r = proponiElenco([e('a', { validoDal: '2026-06-16' }), e('b')], D)
    expect(r.elenco?.id).toBe('b')
    expect(ids(r.validi)).toEqual(['b'])
  })
  it('movimento retrodatato prima di validoDal: SENZA_ELENCO, mai eccezione', () => {
    const r = proponiElenco([e('a', { validoDal: '2026-06-16' })], D)
    expect(r.elenco).toBeNull()
    expect(r.motivo).toBe('SENZA_ELENCO')
  })
  it('validoDal = data: valido', () => {
    expect(proponiElenco([e('a', { validoDal: D })], D).elenco?.id).toBe('a')
  })
  it('tutti scaduti: ELENCO_SCADUTO', () => {
    const r = proponiElenco([e('a', { validoAl: '2026-06-14' })], D)
    expect(r.elenco).toBeNull()
    expect(r.motivo).toBe('ELENCO_SCADUTO')
  })
  it('validoAl = data: ancora valido', () => {
    expect(proponiElenco([e('a', { validoAl: D })], D).elenco?.id).toBe('a')
  })
  it('nessun elenco: SENZA_ELENCO', () => {
    expect(proponiElenco([], D)).toEqual({ elenco: null, validi: [], motivo: 'SENZA_ELENCO' })
  })
})
