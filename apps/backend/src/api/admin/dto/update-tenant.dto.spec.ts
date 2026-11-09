import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateTenantDto } from './update-tenant.dto'

async function errori(plain: Record<string, unknown>) {
  return validate(plainToInstance(UpdateTenantDto, plain))
}

describe('UpdateTenantDto: ATECO e REA svuotabili', () => {
  it('accetta null per atecoCode e reaNumber (azzera il valore)', async () => {
    expect(await errori({ atecoCode: null, reaNumber: null })).toEqual([])
  })

  it('accetta i campi omessi', async () => {
    expect(await errori({})).toEqual([])
  })

  it('accetta valori pieni', async () => {
    expect(await errori({ atecoCode: '381100', reaNumber: '123456' })).toEqual([])
  })

  it('rifiuta la stringa vuota e i valori troppo lunghi', async () => {
    const e = await errori({ atecoCode: '', reaNumber: '1234567890' })
    expect(e.map(x => x.property).sort()).toEqual(['atecoCode', 'reaNumber'])
  })
})
