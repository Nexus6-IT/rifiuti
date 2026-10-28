import { conColonnaSede, filtriRegistroExport, sedeDelMovimento } from './registro-export-sede'
import type { Movimento } from '../../features/registro/registro.service'

describe('export del registro: sede', () => {
  it('senza meta di sede (un solo registro) niente colonna e filtri identici a prima', () => {
    const meta = { filtroTipo: 'CARICO', filtroCer: '17 04 05' }
    expect(conColonnaSede(meta)).toBeFalse()
    expect(filtriRegistroExport(meta)).toEqual(['Tipo: CARICO', 'CER: 17 04 05'])
    expect(filtriRegistroExport({})).toEqual([])
  })

  it('con la sede filtrata la sede entra fra i filtri dell’intestazione', () => {
    expect(filtriRegistroExport({ sede: 'Sede di Milano (OP1)' })).toEqual([
      'Sede: Sede di Milano (OP1)',
    ])
  })

  it('con più registri senza filtro la colonna c’è e legge la sede del movimento', () => {
    const meta = { etichettaSede: (m: Movimento) => (m.registroId === 'b' ? 'Sede B' : 'Sede A') }
    expect(conColonnaSede(meta)).toBeTrue()
    expect(sedeDelMovimento(meta, { registroId: 'b' } as Movimento)).toBe('Sede B')
  })
})
