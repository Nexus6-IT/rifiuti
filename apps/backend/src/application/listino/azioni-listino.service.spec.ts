import { AzioniListinoService } from './azioni-listino.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const E1 = 'dddddddd-0000-4000-8000-000000000004'
const E2 = 'eeeeeeee-0000-4000-8000-000000000005'
const C = 'cccccccc-0000-4000-8000-000000000003'

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

/** Le validazioni di forma avvengono prima di qualunque accesso al database. */
describe('AzioniListinoService — controlli prima del database', () => {
  const prisma = { $transaction: jest.fn() }
  const service = new AzioniListinoService(prisma as any)

  beforeEach(() => prisma.$transaction.mockReset())
  afterEach(() => expect(prisma.$transaction).not.toHaveBeenCalled())

  it('sostituisci-da su sé stesso: 400 con details.errori (R60)', async () => {
    const e = await errore(
      service.sostituisciDa(T, U, E1, { daElencoId: E1.toUpperCase(), versione: 1 })
    )
    expect(e.getStatus()).toBe(400)
    expect(e.getResponse()).toMatchObject({
      error: 'COPIA_ELENCO_NON_VALIDA',
      details: { errori: [{ campo: null, messaggio: 'Un elenco non si copia su sé stesso.' }] },
    })
  })

  it('id che non sono UUID: 404 (elenco, riga, contratto)', async () => {
    expect(
      (await errore(service.sostituisciDa(T, U, 'xx', { daElencoId: E2, versione: 1 }))).getStatus()
    ).toBe(404)
    expect(
      (await errore(service.sostituisciDa(T, U, E1, { daElencoId: 'xx', versione: 1 }))).getStatus()
    ).toBe(404)
    const riga = await errore(service.aggiungiRighe(T, U, E1, { righeIds: ['xx'], versione: 1 }))
    expect(riga.getResponse()).toMatchObject({ error: 'RIGA_ADDEBITO_NON_TROVATA' })
    expect((await errore(service.impostaProvvigioni(T, U, 'xx', {}))).getStatus()).toBe(404)
    expect((await errore(service.sostituisciSconto(T, U, 'xx', {}))).getStatus()).toBe(404)
  })

  it('sconto nuovo vuoto: messaggio di WinWaste', async () => {
    const e = await errore(
      service.sostituisciSconto(T, U, C, { scontoAttuale: '5', scontoNuovo: ' ' })
    )
    expect(e.getResponse().details.errori).toEqual([
      { campo: 'scontoNuovo', messaggio: 'Specificare entrambi gli sconti.' },
    ])
  })

  it('aggiungi-righe senza righe: 400', async () => {
    const e = await errore(service.aggiungiRighe(T, U, E1, { righeIds: [], versione: 1 }))
    expect(e.getStatus()).toBe(400)
  })

  it.each([
    ['provvigione assente', {}, ['provvigione']],
    [
      'formula con quattro termini',
      { provvigione: '1+2+3+4', tipoProvvigione: 'LORDO' },
      ['provvigione'],
    ],
    ['provvigione senza tipo', { provvigione: '5' }, ['tipoProvvigione']],
    ['tipo non ammesso', { provvigione: '5', tipoProvvigione: 'NETTO' }, ['tipoProvvigione']],
    ['termine oltre 99,99', { provvigione: '100', tipoProvvigione: 'LORDO' }, ['provvigione']],
  ])('provvigioni: %s → 400 con il campo', async (_nome, corpo, campi) => {
    const e = await errore(service.impostaProvvigioni(T, U, C, corpo))
    expect(e.getStatus()).toBe(400)
    expect(e.getResponse().details.errori.map((x: any) => x.campo)).toEqual(campi)
    expect(e.getResponse().message).toHaveLength(campi.length)
  })

  it.each([
    ['attuale vuoto', { scontoAttuale: '', scontoNuovo: '5' }, ['scontoAttuale']],
    ['nuovo vuoto', { scontoAttuale: '5', scontoNuovo: '' }, ['scontoNuovo']],
    ['nuovo null', { scontoAttuale: '5', scontoNuovo: null }, ['scontoNuovo']],
    ['nuovo assente', { scontoAttuale: '5' }, ['scontoNuovo']],
    ['nuovo non valido', { scontoAttuale: '5', scontoNuovo: '1++2' }, ['scontoNuovo']],
    [
      'entrambi non validi',
      { scontoAttuale: 'a', scontoNuovo: '1+2+3+4' },
      ['scontoAttuale', 'scontoNuovo'],
    ],
  ])('sconti: %s → 400 con il campo', async (_nome, corpo, campi) => {
    const e = await errore(service.sostituisciSconto(T, U, C, corpo))
    expect(e.getStatus()).toBe(400)
    expect(e.getResponse().details.errori.map((x: any) => x.campo)).toEqual(campi)
  })
})
