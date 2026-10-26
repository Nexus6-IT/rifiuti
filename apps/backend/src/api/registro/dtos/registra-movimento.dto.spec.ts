import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RegistraMovimentoDto, ListMovimentiDto } from './registra-movimento.dto'
import { RegistroIdQueryDto } from './registro-id-query.dto'

describe('RegistraMovimentoDto', () => {
  const minimo = {
    type: 'CARICO',
    movementDate: '2026-03-01',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '20 03 01',
    quantity: 100,
  }

  it('rifiuta una quantità con più di 2 decimali', async () => {
    const errori = await validate(
      plainToInstance(RegistraMovimentoDto, { ...minimo, quantity: 1.005 })
    )
    expect(errori.map(e => e.property)).toContain('quantity')
  })

  it('registroId: facoltativo, uuid se presente (movimento, lista e query del progressivo)', async () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    for (const classe of [RegistraMovimentoDto, ListMovimentiDto, RegistroIdQueryDto]) {
      const base = classe === RegistraMovimentoDto ? minimo : {}
      expect(await validate(plainToInstance(classe as any, { ...base }))).toEqual([])
      expect(await validate(plainToInstance(classe as any, { ...base, registroId: uuid }))).toEqual(
        []
      )
      const errori = await validate(plainToInstance(classe as any, { ...base, registroId: 'x' }))
      expect(errori.map(e => e.property)).toEqual(['registroId'])
    }
  })

  it('accetta 2 decimali', async () => {
    expect(
      await validate(plainToInstance(RegistraMovimentoDto, { ...minimo, quantity: 1.01 }))
    ).toEqual([])
  })
})
