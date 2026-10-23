import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RegistraMovimentoDto } from './registra-movimento.dto'

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

  it('accetta 2 decimali', async () => {
    expect(
      await validate(plainToInstance(RegistraMovimentoDto, { ...minimo, quantity: 1.01 }))
    ).toEqual([])
  })
})
