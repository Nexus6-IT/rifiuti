import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ImpostaProgressivoInizialeDto } from './progressivo-iniziale.dto'

describe('ImpostaProgressivoInizialeDto', () => {
  async function campiNonValidi(corpo: object): Promise<string[]> {
    const errori = await validate(plainToInstance(ImpostaProgressivoInizialeDto, corpo))
    return errori.map(e => e.property).sort()
  }

  it('accetta un numero intero da 1 a 9.999.999 e un motivo di almeno 5 caratteri', async () => {
    expect(await campiNonValidi({ primoProgressivo: 1, motivo: 'Migra' })).toEqual([])
    expect(await campiNonValidi({ primoProgressivo: 9999999, motivo: 'x'.repeat(500) })).toEqual([])
  })

  it('rifiuta zero, decimali, numeri oltre 9.999.999 e valori non numerici', async () => {
    for (const primoProgressivo of [0, -3, 812.5, 10000000, '812']) {
      expect(await campiNonValidi({ primoProgressivo, motivo: 'Migrazione' })).toEqual([
        'primoProgressivo',
      ])
    }
  })

  it('rifiuta un motivo assente, troppo corto o oltre 500 caratteri', async () => {
    for (const motivo of [undefined, 'abcd', 'x'.repeat(501), 42]) {
      expect(await campiNonValidi({ primoProgressivo: 812, motivo })).toEqual(['motivo'])
    }
  })
})
