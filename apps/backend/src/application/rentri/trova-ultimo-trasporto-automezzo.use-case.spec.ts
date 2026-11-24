import { DatiViaggioFirInMemoria } from './dati-viaggio-fir.in-memoria'
import { TrovaUltimoTrasportoAutomezzoUseCase } from './trova-ultimo-trasporto-automezzo.use-case'

describe('TrovaUltimoTrasportoAutomezzoUseCase', () => {
  const ambiente = () => {
    const dati = new DatiViaggioFirInMemoria()
    dati.ultimiPerTarga.set('AB123CD', {
      conducenteNome: 'Mario',
      conducenteCognome: 'Rossi',
      targaRimorchio: null,
    })
    return { dati, useCase: new TrovaUltimoTrasportoAutomezzoUseCase(dati) }
  }

  it('la targa si cerca ripulita e in maiuscolo', async () => {
    const { useCase } = ambiente()
    expect(await useCase.execute('t1', ' ab123cd ')).toEqual({
      conducenteNome: 'Mario',
      conducenteCognome: 'Rossi',
      targaRimorchio: null,
    })
  })

  it('targa sconosciuta: null', async () => {
    expect(await ambiente().useCase.execute('t1', 'ZZ999ZZ')).toBeNull()
  })

  it('targa vuota: null, e il repository non viene interrogato', async () => {
    const { dati, useCase } = ambiente()
    const spy = jest.spyOn(dati, 'ultimoTrasportoPerTarga')
    expect(await useCase.execute('t1', '   ')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
