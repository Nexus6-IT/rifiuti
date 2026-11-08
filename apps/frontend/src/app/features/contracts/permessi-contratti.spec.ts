import { puoGestireContratti } from './permessi-contratti'

describe('puoGestireContratti', () => {
  it('SUPER_ADMIN, ADMIN e OPERATOR possono', () => {
    for (const r of ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']) {
      expect(puoGestireContratti(r)).withContext(r).toBeTrue()
    }
  })
  it('VIEWER, ruolo sconosciuto o assente no (fail-closed)', () => {
    for (const r of ['VIEWER', 'CONSULTANT', '', null, undefined]) {
      expect(puoGestireContratti(r)).withContext(String(r)).toBeFalse()
    }
  })
})
