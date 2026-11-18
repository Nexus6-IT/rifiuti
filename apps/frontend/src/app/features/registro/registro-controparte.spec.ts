import {
  compattaTesto,
  indirizzoDaSede,
  sceltaDaAnagrafica,
  sceltaDaSedeScelta,
  sedeControparteDaInviare,
  SceltaControparte,
} from './registro-controparte'

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
  describe('sceltaDaAnagrafica (ordine: scelta esplicita > sede del FIR > predefinita)', () => {
    const nuova = { sedeId: 'predefinita', nome: 'Comune di Calliano', indirizzo: 'Via Roma 1' }

    it('nessuna scelta precedente: la predefinita, origine anagrafica', () => {
      expect(sceltaDaAnagrafica(null, nuova)).toEqual({ ...nuova, origine: 'anagrafica' })
    })

    it('sede del FIR della stessa ditta: resta quella del FIR, con nome e indirizzo nuovi', () => {
      const daFir: SceltaControparte = {
        sedeId: 'sede-fir',
        nome: ' comune di  calliano',
        indirizzo: 'Via FIR 9',
        origine: 'fir',
      }
      expect(sceltaDaAnagrafica(daFir, nuova)).toEqual({
        sedeId: 'sede-fir',
        nome: nuova.nome,
        indirizzo: nuova.indirizzo,
        origine: 'fir',
      })
    })

    it('sede scelta dall utente per la stessa ditta: resta quella scelta', () => {
      const utente: SceltaControparte = { ...nuova, sedeId: 'scelta', origine: 'utente' }
      expect(sceltaDaAnagrafica(utente, nuova).sedeId).toBe('scelta')
    })

    it('FIR di un altra ditta: vince la predefinita della nuova', () => {
      const daFir: SceltaControparte = {
        sedeId: 'sede-fir',
        nome: 'Altra ditta',
        indirizzo: 'x',
        origine: 'fir',
      }
      expect(sceltaDaAnagrafica(daFir, nuova)).toEqual({ ...nuova, origine: 'anagrafica' })
    })

    it('FIR senza sede: vince la predefinita', () => {
      const daFir: SceltaControparte = {
        sedeId: null,
        nome: nuova.nome,
        indirizzo: 'x',
        origine: 'fir',
      }
      expect(sceltaDaAnagrafica(daFir, nuova).sedeId).toBe('predefinita')
    })

    it('scelta precedente da anagrafica: la nuova predefinita sostituisce', () => {
      const prec: SceltaControparte = { ...nuova, sedeId: 'altra', origine: 'anagrafica' }
      expect(sceltaDaAnagrafica(prec, nuova).sedeId).toBe('predefinita')
    })
  })

  describe('sceltaDaSedeScelta / indirizzoDaSede', () => {
    const sede = {
      id: 's2',
      via: 'Via Dante',
      civico: '2',
      cap: '38122',
      citta: 'Trento',
      provincia: 'TN',
    }

    it('compone l indirizzo come quello della sede legale', () => {
      expect(indirizzoDaSede(sede)).toBe('Via Dante 2, 38122 Trento (TN)')
    })

    it('la sede scelta ha origine utente e porta nome e indirizzo della sede', () => {
      expect(sceltaDaSedeScelta('Comune di Calliano', sede)).toEqual({
        sedeId: 's2',
        nome: 'Comune di Calliano',
        indirizzo: 'Via Dante 2, 38122 Trento (TN)',
        origine: 'utente',
      })
    })
  })
})
