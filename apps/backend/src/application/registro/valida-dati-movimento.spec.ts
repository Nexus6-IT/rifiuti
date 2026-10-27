import { validaDatiMovimento } from './valida-dati-movimento'

const db = (esiste = true) => ({ cERCode: { count: jest.fn().mockResolvedValue(esiste ? 1 : 0) } })
const ok = {
  type: 'CARICO',
  causale: 'PRODUZIONE_INTERNA',
  cerCode: '200301',
  movementDate: new Date('2026-03-01T00:00:00Z'),
  registrationDate: new Date('2026-03-02T00:00:00Z'),
}

describe('validaDatiMovimento', () => {
  it('normalizza il CER', async () => {
    expect(await validaDatiMovimento(db() as never, ok)).toEqual({ cerCode: '20 03 01' })
  })
  it('causale incoerente col tipo, prima di leggere il catalogo', async () => {
    const d = db()
    const r = await validaDatiMovimento(d as never, { ...ok, causale: 'CESSIONE' })
    expect(r.errore).toContain('Causale non valida per CARICO')
    expect(d.cERCode.count).not.toHaveBeenCalled()
    const s = await validaDatiMovimento(db() as never, { ...ok, type: 'SCARICO' })
    expect(s.errore).toContain('Causale non valida per SCARICO')
  })
  it('CER fuori catalogo', async () => {
    expect((await validaDatiMovimento(db(false) as never, ok)).errore).toContain('CER non valido')
  })
  it('date nel futuro', async () => {
    const futuro = new Date(Date.now() + 5 * 86_400_000)
    expect(
      (await validaDatiMovimento(db() as never, { ...ok, movementDate: futuro })).errore
    ).toContain("data dell'operazione")
    expect(
      (await validaDatiMovimento(db() as never, { ...ok, registrationDate: futuro })).errore
    ).toContain('data di registrazione')
  })
})
