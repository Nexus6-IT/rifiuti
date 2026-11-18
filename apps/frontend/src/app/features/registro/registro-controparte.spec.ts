import { compattaTesto, sedeControparteDaInviare, SceltaControparte } from './registro-controparte'

describe('registro-controparte', () => {
  const scelta: SceltaControparte = {
    sedeId: 'sede-1',
    nome: 'Comune di Calliano',
    indirizzo: 'Via Roma 1, 38060 Calliano (TN)',
  }

  describe('compattaTesto', () => {
    it('toglie gli spazi ai bordi, riduce quelli interni a uno e ignora le maiuscole', () => {
      expect(compattaTesto('  Via   Roma  1 ')).toBe('via roma 1')
      expect(compattaTesto(null)).toBe('')
      expect(compattaTesto(undefined)).toBe('')
    })
  })

  describe('sedeControparteDaInviare', () => {
    it('nessuna scelta: undefined', () => {
      expect(sedeControparteDaInviare(null, 'x', 'y')).toBeUndefined()
    })

    it('testi identici a quelli della scelta: la sede', () => {
      expect(sedeControparteDaInviare(scelta, scelta.nome, scelta.indirizzo)).toBe('sede-1')
    })

    it('maiuscole e spazi diversi: la sede', () => {
      expect(
        sedeControparteDaInviare(
          scelta,
          '  COMUNE  di calliano ',
          'via roma 1,  38060 Calliano (TN)'
        )
      ).toBe('sede-1')
    })

    it('nome cambiato a mano: undefined', () => {
      expect(sedeControparteDaInviare(scelta, 'Comune di Trento', scelta.indirizzo)).toBeUndefined()
    })

    it('indirizzo cambiato a mano: undefined', () => {
      expect(sedeControparteDaInviare(scelta, scelta.nome, 'Via Dante 2')).toBeUndefined()
    })

    it('sedeId assente nella scelta: undefined', () => {
      expect(
        sedeControparteDaInviare({ ...scelta, sedeId: null }, scelta.nome, scelta.indirizzo)
      ).toBeUndefined()
      expect(
        sedeControparteDaInviare({ ...scelta, sedeId: undefined }, scelta.nome, scelta.indirizzo)
      ).toBeUndefined()
    })

    it('testi correnti vuoti (null) e scelta con testi vuoti: la sede', () => {
      const vuota: SceltaControparte = { sedeId: 's', nome: '', indirizzo: '' }
      expect(sedeControparteDaInviare(vuota, null, undefined)).toBe('s')
    })
  })
})
