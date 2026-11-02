import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { traduciConflitto } from './conflitti-variazione'

const errPrisma = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta })

function lancia(err: unknown): any {
  try {
    traduciConflitto(err)
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

describe('traduciConflitto (R46)', () => {
  it('P2028 (timeout della transazione) → 409 OPERAZIONE_CONCORRENTE, "riprova"', () => {
    const e = lancia(errPrisma('P2028'))
    expect(e).toBeInstanceOf(ConflictException)
    expect(e.getResponse()).toMatchObject({
      error: 'OPERAZIONE_CONCORRENTE',
      message: 'L’operazione è stata interrotta da un’altra in corso: riprova.',
    })
  })

  it.each([
    ['P2034', errPrisma('P2034')],
    ['40P01 dal raw (deadlock)', errPrisma('P2010', { code: '40P01' })],
    ['55P03 dal raw (lock timeout)', errPrisma('P2010', { code: '55P03' })],
  ])('%s → 409 VARIAZIONE_SUPERATA, "rifai l’anteprima"', (_n, err) => {
    const e = lancia(err)
    expect(e).toBeInstanceOf(ConflictException)
    expect(e.getResponse()).toMatchObject({
      error: 'VARIAZIONE_SUPERATA',
      message: 'I prezzi sono cambiati dopo l’anteprima: rifai l’anteprima.',
    })
  })

  it('ogni altro errore passa com’è', () => {
    const altro = errPrisma('P2002')
    expect(lancia(altro)).toBe(altro)
    const generico = new Error('boom')
    expect(lancia(generico)).toBe(generico)
  })
})
