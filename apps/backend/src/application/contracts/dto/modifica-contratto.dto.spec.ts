import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { ModificaContrattoDto } from './modifica-contratto.dto'

describe('ModificaContrattoDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  const valida = (corpo: object) =>
    pipe.transform(corpo, { type: 'body', metatype: ModificaContrattoDto })
  const messaggi = async (corpo: object) => {
    try {
      await valida(corpo)
    } catch (e: any) {
      return e.getResponse().message as string[]
    }
    return []
  }

  it('senza versione: errore su versione', async () => {
    expect((await messaggi({ description: 'x' })).join('|')).toMatch(/versione/)
  })
  it('versione 0: errore', async () => {
    expect((await messaggi({ versione: 0 })).join('|')).toMatch(/versione/)
  })
  it('pricingConfig nel corpo: rifiutato dalla whitelist', async () => {
    expect((await messaggi({ versione: 1, pricingConfig: {} })).join('|')).toMatch(/pricingConfig/)
  })
  it('status nel corpo: rifiutato', async () => {
    expect((await messaggi({ versione: 1, status: 'ACTIVE' })).join('|')).toMatch(/status/)
  })
  it('accetta null su endDate e lo conserva', async () => {
    const dto = (await valida({ versione: 2, endDate: null })) as ModificaContrattoDto
    expect(dto.endDate).toBeNull()
    expect(dto.versione).toBe(2)
  })
  it("endDate '2026-13-01': errore", async () => {
    expect((await messaggi({ versione: 1, endDate: '2026-13-01' })).join('|')).toMatch(/endDate/)
  })
})
