import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateRentriUnitaLocaleDto } from './update-rentri-unita-locale.dto'

async function errori(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateRentriUnitaLocaleDto, payload)
  const res = await validate(dto)
  return res.map(e => e.property)
}

describe('UpdateRentriUnitaLocaleDto — anagrafica della sede', () => {
  it('accetta un payload completo', async () => {
    expect(
      await errori({
        indirizzo: 'Via Roma',
        civico: '12/A',
        cap: '20121',
        comune: 'Milano',
        provincia: 'MI',
        numeroAddetti: 5,
      })
    ).toEqual([])
  })

  it('DTO: CAP vuoto ammesso e poi salvato come null', async () => {
    expect(await errori({ cap: '', provincia: '', indirizzo: '' })).toEqual([])
  })

  it('accetta null per cancellare un campo', async () => {
    expect(
      await errori({
        indirizzo: null,
        civico: null,
        cap: null,
        comune: null,
        provincia: null,
        numeroAddetti: null,
      })
    ).toEqual([])
  })

  it('accetta CAP e provincia con spazi ai bordi', async () => {
    expect(await errori({ cap: '20121 ', provincia: ' MI ' })).toEqual([])
  })

  it('rifiuta CAP non di 5 cifre', async () => {
    expect(await errori({ cap: '2012' })).toEqual(['cap'])
    expect(await errori({ cap: '2012A' })).toEqual(['cap'])
  })

  it('rifiuta provincia non di 2 lettere', async () => {
    expect(await errori({ provincia: 'MIL' })).toEqual(['provincia'])
    expect(await errori({ provincia: 'M1' })).toEqual(['provincia'])
  })

  it('rifiuta addetti negativi o non interi', async () => {
    expect(await errori({ numeroAddetti: -1 })).toEqual(['numeroAddetti'])
    expect(await errori({ numeroAddetti: 1.5 })).toEqual(['numeroAddetti'])
  })

  it('rifiuta lunghezze oltre il limite', async () => {
    expect(await errori({ indirizzo: 'x'.repeat(256) })).toEqual(['indirizzo'])
    expect(await errori({ civico: 'x'.repeat(21) })).toEqual(['civico'])
    expect(await errori({ comune: 'x'.repeat(101) })).toEqual(['comune'])
  })
})
