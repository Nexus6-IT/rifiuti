import { logoLeggibile } from './logo-leggibile'

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const FIRMA_PNG = Buffer.from('89504e470d0a1a0a', 'hex')

describe('logoLeggibile', () => {
  it('un PNG vero e leggibile', async () => {
    expect(await logoLeggibile(`data:image/png;base64,${PNG_1X1}`)).toBe(true)
  })

  it('firma PNG seguita da byte casuali: non leggibile', async () => {
    const rotto = Buffer.concat([FIRMA_PNG, Buffer.alloc(100, 7)]).toString('base64')
    expect(await logoLeggibile(`data:image/png;base64,${rotto}`)).toBe(false)
  })

  it('PNG troncato dopo l’intestazione: non leggibile', async () => {
    const troncato = Buffer.from(PNG_1X1, 'base64').subarray(0, 40).toString('base64')
    expect(await logoLeggibile(`data:image/png;base64,${troncato}`)).toBe(false)
  })

  it('JPEG con la sola firma: non leggibile', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]).toString('base64')
    expect(await logoLeggibile(`data:image/jpeg;base64,${jpeg}`)).toBe(false)
  })
})
