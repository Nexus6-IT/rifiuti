import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { ScaglioneRigaDto } from './riga-addebito.dto'
import { ScontiContrattoDto } from './azioni-listino.dto'

async function messaggi(classe: new () => object, o: object) {
  const errori = await validate(plainToInstance(classe as never, o) as object)
  return errori.flatMap(e => Object.values(e.constraints ?? {}))
}

describe('IsTestoONumero: messaggio con il nome del campo (M17)', () => {
  it('un oggetto al posto di un importo: il messaggio dice quale campo', async () => {
    expect(await messaggi(ScaglioneRigaDto, { prezzo: { x: 1 } })).toEqual([
      'Il prezzo deve essere un testo o un numero.',
    ])
    expect(await messaggi(ScaglioneRigaDto, { sconto: true })).toEqual([
      'Lo sconto deve essere un testo o un numero.',
    ])
  })

  it('anche negli sconti dei contratti', async () => {
    expect(await messaggi(ScontiContrattoDto, { scontoNuovo: [] })).toContain(
      'Lo sconto nuovo deve essere un testo o un numero.'
    )
  })

  it('testo o numero finito passano', async () => {
    expect(await messaggi(ScaglioneRigaDto, { prezzo: '1,5', sconto: 10 })).toEqual([])
  })

  it('NaN e infinito sono rifiutati', async () => {
    expect(await messaggi(ScaglioneRigaDto, { prezzo: Infinity })).toHaveLength(1)
  })
})
