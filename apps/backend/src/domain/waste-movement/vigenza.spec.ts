import { WHERE_VIGENTE, sqlVigente } from './vigenza'

describe('vigenza', () => {
  it('WHERE_VIGENTE esclude gli annullamenti e le righe gia corrette', () => {
    expect(WHERE_VIGENTE).toEqual({
      tipoAnnotazione: { not: 'ANNULLAMENTO' },
      correzioni: { none: {} },
    })
  })

  it('sqlVigente usa l alias dato e una sottoquery con alias proprio', () => {
    const sql = sqlVigente('m')
    expect(sql.sql).toContain('m.tipo_annotazione')
    expect(sql.sql).toContain('c_vig.movimento_rettificato_id = m.id')
    expect(sql.values).toEqual([])
  })

  it.each(['m; DROP TABLE x', 'm m', '', 'M', '1m', 'm.x', "m'"])(
    'rifiuta l alias non semplice %j',
    alias => {
      expect(() => sqlVigente(alias)).toThrow('Alias SQL non valido')
    }
  )

  it('WHERE_VIGENTE e congelato, anche negli oggetti annidati', () => {
    expect(Object.isFrozen(WHERE_VIGENTE)).toBe(true)
    expect(Object.isFrozen(WHERE_VIGENTE.tipoAnnotazione)).toBe(true)
    expect(Object.isFrozen(WHERE_VIGENTE.correzioni)).toBe(true)
    expect(Object.isFrozen(WHERE_VIGENTE.correzioni.none)).toBe(true)
  })
})
