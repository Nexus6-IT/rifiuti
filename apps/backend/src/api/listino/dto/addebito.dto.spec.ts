import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { CreaAddebitoDto, ModificaAddebitoDto } from './addebito.dto'

const base = { descrizione: 'x', gruppoId: '00000000-0000-4000-8000-000000000001' }
const lis = (numero: number) => ({ numero, prezzo: '1.00' })

async function messaggi(classe: typeof CreaAddebitoDto | typeof ModificaAddebitoDto, o: object) {
  const errori = await validate(plainToInstance(classe as never, o) as object)
  return errori.flatMap(e => [
    ...Object.values(e.constraints ?? {}),
    ...(e.children ?? []).flatMap(c =>
      (c.children ?? []).flatMap(f => Object.values(f.constraints ?? {}))
    ),
  ])
}

describe.each([
  ['CreaAddebitoDto', CreaAddebitoDto],
  ['ModificaAddebitoDto', ModificaAddebitoDto],
])('%s: listini', (_nome, classe) => {
  it('accetta i sei listini', async () => {
    const m = await messaggi(classe, { ...base, versione: 1, listini: [1, 2, 3, 4, 5, 6].map(lis) })
    expect(m.filter(x => /listin/i.test(x))).toEqual([])
  })

  it('numero 0 o 7: errore in italiano', async () => {
    for (const n of [0, 7]) {
      const m = await messaggi(classe, { ...base, versione: 1, listini: [lis(n)] })
      expect(m).toContain('Il numero del listino deve essere compreso fra 1 e 6.')
    }
  })

  it('più di sei listini: errore in italiano', async () => {
    const m = await messaggi(classe, {
      ...base,
      versione: 1,
      listini: [1, 2, 3, 4, 5, 6, 1].map(lis),
    })
    expect(m).toContain('I listini non possono essere più di sei.')
  })

  it('numeri duplicati: errore in italiano', async () => {
    const m = await messaggi(classe, { ...base, versione: 1, listini: [lis(2), lis(2)] })
    expect(m).toContain('Ogni listino può comparire una sola volta.')
  })
})
