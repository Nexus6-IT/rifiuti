import {
  anagraficaDichiarazione,
  attribuisciSedi,
  campiMancanti,
  codiceUnitaLocale,
  creaContestoSedi,
  dichiarazioneDelRegistro,
  dichiarazionePerAllegati,
  pacchettiPerExport,
  provinceDiverse,
  type MudUnitaLocaleAnagrafica,
} from './mud-dichiarazioni'

const ul = (
  id: string,
  extra: Partial<MudUnitaLocaleAnagrafica> = {}
): MudUnitaLocaleAnagrafica => ({
  id,
  denominazione: `Sede ${id}`,
  numIscrSito: `OP-${id}`,
  principale: false,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  indirizzo: null,
  civico: null,
  cap: null,
  comune: null,
  provincia: null,
  numeroAddetti: null,
  progressivoMud: null,
  ...extra,
})

const COMPLETA = {
  indirizzo: 'Via Roma',
  civico: '1',
  cap: '20100',
  comune: 'Milano',
  provincia: 'MI',
}

describe('mud-dichiarazioni', () => {
  it('D2: registro con sede', () => {
    const a = ul('A', { progressivoMud: 1, principale: true })
    const b = ul('B', { progressivoMud: 2 })
    const ctx = creaContestoSedi([a, b], new Map([['r1', 'B']]))
    expect(dichiarazioneDelRegistro('r1', ctx)).toEqual({
      tipo: 'dichiarazione',
      chiave: 'B',
      unitaLocale: b,
      senzaSede: false,
    })
  })

  it('D2: senza sede e senza unità locali → azienda, codice 1', () => {
    const ctx = creaContestoSedi([], new Map([['r1', null]]))
    expect(dichiarazioneDelRegistro('r1', ctx)).toEqual({
      tipo: 'dichiarazione',
      chiave: 'AZIENDA',
      unitaLocale: null,
      senzaSede: false,
    })
    const att = attribuisciSedi([{ registroId: 'r1' }], ctx)
    expect(att.gruppi).toHaveLength(1)
    expect(att.gruppi[0].codice).toBe('000000000000001')
    expect(att.senzaSede).toEqual([])
  })

  it('D2: senza sede con principale → principale', () => {
    const a = ul('A', { progressivoMud: 1 })
    const b = ul('B', { progressivoMud: 2, principale: true })
    const ctx = creaContestoSedi([a, b], new Map([['r1', null]]))
    expect(dichiarazioneDelRegistro('r1', ctx)).toMatchObject({
      tipo: 'dichiarazione',
      chiave: 'B',
      senzaSede: true,
    })
    const m = { registroId: 'r1', n: 1 }
    const att = attribuisciSedi([m], ctx)
    expect(att.gruppi.map(g => g.codice)).toEqual(['000000000000002'])
    expect(att.senzaSede).toEqual([m])
    expect(att.senzaPrincipale).toEqual([])
  })

  it('D2: senza sede senza principale → nessuna dichiarazione e mancanza segnalata', () => {
    const ctx = creaContestoSedi(
      [ul('A', { progressivoMud: 1 }), ul('B', { progressivoMud: 2 })],
      new Map([
        ['r1', null],
        ['r2', 'A'],
      ])
    )
    expect(dichiarazioneDelRegistro('r1', ctx)).toEqual({
      tipo: 'nessuna',
      motivo: 'SEDE_PRINCIPALE_MANCANTE',
    })
    const m1 = { registroId: 'r1' }
    const m2 = { registroId: 'r2' }
    const att = attribuisciSedi([m1, m2], ctx)
    expect(att.senzaPrincipale).toEqual([m1])
    expect(att.gruppi.map(g => g.chiave)).toEqual(['A'])
  })

  it('D2: registro sconosciuto come senza sede', () => {
    const p = ul('P', { progressivoMud: 1, principale: true })
    expect(dichiarazioneDelRegistro('boh', creaContestoSedi([p], new Map()))).toMatchObject({
      chiave: 'P',
      senzaSede: true,
    })
    expect(dichiarazioneDelRegistro('boh', creaContestoSedi([], new Map()))).toMatchObject({
      chiave: 'AZIENDA',
    })
  })

  it('D4: codici a 15 cifre e ripiego per NULL', () => {
    expect(codiceUnitaLocale(1)).toBe('000000000000001')
    expect(codiceUnitaLocale(123)).toBe('000000000000123')
    const ctx = creaContestoSedi(
      [
        ul('X', { createdAt: new Date('2025-03-01T00:00:00Z') }),
        ul('Y', { progressivoMud: 5, principale: true }),
        ul('Z', { createdAt: new Date('2025-02-01T00:00:00Z') }),
      ],
      new Map([
        ['rx', 'X'],
        ['ry', 'Y'],
        ['rz', 'Z'],
      ])
    )
    expect(ctx.progressivi.get('Y')).toEqual({ progressivo: 5, ripiego: false })
    expect(ctx.progressivi.get('Z')).toEqual({ progressivo: 6, ripiego: true })
    expect(ctx.progressivi.get('X')).toEqual({ progressivo: 7, ripiego: true })
    const att = attribuisciSedi(
      [{ registroId: 'rx' }, { registroId: 'rz' }, { registroId: 'ry' }],
      ctx
    )
    expect(att.gruppi.map(g => g.codice)).toEqual([
      '000000000000005',
      '000000000000006',
      '000000000000007',
    ])
  })

  it('D5: anagrafica della sede completa', () => {
    const s = ul('A', { ...COMPLETA, numeroAddetti: 7 })
    expect(anagraficaDichiarazione(s, false, { numeroAddetti: 50 })).toEqual({
      anagrafica: s,
      numeroAddetti: 7,
      principaleConIndirizzoAzienda: false,
      campiMancanti: [],
      addettiMancanti: false,
    })
    // altra sede senza indirizzo completo: elenca i campi mancanti, usa l'azienda
    const incompleta = ul('B', { indirizzo: 'Via Po', cap: '  ', numeroAddetti: 0 })
    expect(campiMancanti(incompleta)).toEqual(['CAP', 'comune', 'provincia'])
    expect(anagraficaDichiarazione(incompleta, false, {})).toMatchObject({
      anagrafica: null,
      numeroAddetti: 0,
      campiMancanti: ['CAP', 'comune', 'provincia'],
      addettiMancanti: false,
    })
  })

  it("D5: principale senza indirizzo usa l'azienda", () => {
    const p = ul('P', { principale: true, numeroAddetti: 3 })
    expect(anagraficaDichiarazione(p, false, {})).toMatchObject({
      anagrafica: null,
      principaleConIndirizzoAzienda: true,
      campiMancanti: [],
    })
    // una sola dichiarazione: nessun avviso, è l'indirizzo di sempre
    expect(anagraficaDichiarazione(p, true, {})).toMatchObject({
      anagrafica: null,
      principaleConIndirizzoAzienda: false,
    })
    // dichiarazione azienda
    expect(anagraficaDichiarazione(null, true, { numeroAddetti: 9 })).toEqual({
      anagrafica: null,
      numeroAddetti: 9,
      principaleConIndirizzoAzienda: false,
      campiMancanti: [],
      addettiMancanti: false,
    })
  })

  it('D5: addetti con una o più dichiarazioni', () => {
    const s = ul('A', { principale: true })
    expect(anagraficaDichiarazione(s, true, { numeroAddetti: 12 })).toMatchObject({
      numeroAddetti: 12,
      addettiMancanti: false,
    })
    expect(anagraficaDichiarazione(s, true, {})).toMatchObject({
      numeroAddetti: 0,
      addettiMancanti: false,
    })
    expect(anagraficaDichiarazione(s, false, { numeroAddetti: 12 })).toMatchObject({
      numeroAddetti: 0,
      addettiMancanti: true,
    })
    expect(
      anagraficaDichiarazione({ ...s, numeroAddetti: 4 }, false, { numeroAddetti: 12 })
    ).toMatchObject({ numeroAddetti: 4, addettiMancanti: false })
  })

  it('D6: province diverse', () => {
    expect(
      provinceDiverse([
        { denominazione: 'A', comuneCode: '015146', sigla: 'MI' },
        { denominazione: 'B', comuneCode: '015200', sigla: 'MI' },
      ])
    ).toEqual([])
    expect(
      provinceDiverse([
        { denominazione: 'A', comuneCode: '015146' },
        { denominazione: 'B', comuneCode: null },
      ])
    ).toEqual([])
    expect(
      provinceDiverse([
        { denominazione: 'Torino', comuneCode: '001272', sigla: 'TO' },
        { denominazione: 'Milano', comuneCode: '015146' },
      ])
    ).toEqual([
      { denominazione: 'Torino', codice: '001', etichetta: 'TO' },
      { denominazione: 'Milano', codice: '015', etichetta: '015' },
    ])
  })

  it('D7: AU alla principale', () => {
    const d = [
      { codice: '000000000000001', principale: false },
      { codice: '000000000000002', principale: true },
    ]
    const r = dichiarazionePerAllegati(d)
    expect(r.au).toBe(d[1])
    expect(r.arEInt).toBe(d[0])
  })

  it('D7: AU alla prima per codice se la principale non ha pacchetto', () => {
    const d = [
      { codice: '000000000000003', principale: false },
      { codice: '000000000000002', principale: false },
    ]
    const r = dichiarazionePerAllegati(d)
    expect(r.au).toBe(d[1])
    expect(dichiarazionePerAllegati([d[0]]).au).toBe(d[0])
    expect(dichiarazionePerAllegati([]).au).toBeUndefined()
  })

  it('D7: AR e INT al primo pacchetto', () => {
    const d = [
      { codice: '000000000000007', principale: true },
      { codice: '000000000000004', principale: false },
      { codice: '000000000000009', principale: false },
    ]
    expect(dichiarazionePerAllegati(d).arEInt).toBe(d[1])
  })
})

describe('pacchettiPerExport', () => {
  const azienda = { ragioneSociale: 'Acme', partitaIva: '1', numeroAddetti: 42, via: 'Via Roma' }
  const d = (codice: string, principale: boolean, extra: Record<string, unknown> = {}) => ({
    codice,
    progressivo: Number(codice),
    unitaLocale: { principale },
    anagrafica: null,
    numeroAddetti: 42,
    comuneCode: '058091',
    righe: [],
    ...extra,
  })

  it('AU sulla principale, AR e INT sul primo pacchetto, ciascuno una volta sola', () => {
    const p = pacchettiPerExport(
      [d('000000000000002', true), d('000000000000001', false)],
      azienda as never
    )
    expect(p.map(x => x.progressivoUnitaLocale)).toEqual([1, 2])
    expect(p.map(x => x.conAutorizzazioni)).toEqual([false, true])
    expect(p.map(x => x.conAllegatiAzienda)).toEqual([true, false])
  })

  it('elenco vuoto: nessun pacchetto', () => {
    expect(pacchettiPerExport([], azienda as never)).toEqual([])
  })

  it("anagrafica dell'azienda con gli stessi addetti: null; con addetti diversi: dati azienda e addetti della dichiarazione", () => {
    const [uguale] = pacchettiPerExport([d('000000000000001', true)], azienda as never)
    expect(uguale.unitaLocale).toBeNull()
    const [diverso] = pacchettiPerExport(
      [d('000000000000001', true, { numeroAddetti: 0 })],
      azienda as never
    )
    expect(diverso.unitaLocale).toMatchObject({ via: 'Via Roma', numeroAddetti: 0 })
  })

  it('sede con indirizzo: dati della sede, comune ISTAT e addetti della dichiarazione', () => {
    const sede = ul('b', {
      indirizzo: 'Via Sede',
      civico: ' ',
      cap: '30100',
      comune: 'Venezia',
      provincia: 'VE',
    })
    const [p] = pacchettiPerExport(
      [d('000000000000002', false, { anagrafica: sede, numeroAddetti: 7, comuneCode: '027042' })],
      azienda as never
    )
    expect(p.unitaLocale).toEqual({
      via: 'Via Sede',
      civico: undefined,
      cap: '30100',
      comune: 'Venezia',
      provincia: 'VE',
      comuneCode: '027042',
      numeroAddetti: 7,
    })
  })
})
