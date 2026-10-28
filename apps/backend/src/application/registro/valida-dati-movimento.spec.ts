import { validaDatiMovimento } from './valida-dati-movimento'
import { righeCausaliSistema } from './causali/catalogo-causali.fixture'

const TENANT = '00000000-0000-4000-8000-000000000001'
const VERSIONE_1 = '00000000-0000-4000-8000-0000000000a1'
const VERSIONE_2 = '00000000-0000-4000-8000-0000000000a2'

function propria(over: Record<string, unknown>) {
  return {
    id: VERSIONE_1,
    natura: 'PROPRIA',
    codice: 'AZ_PROVA',
    verso: 'SCARICO',
    descrizione: 'Prova aziendale',
    ruoloMud: 'ESCLUSO',
    codiceRentri: null,
    operazione: null,
    ordine: 500,
    validaDal: new Date('2026-01-01T00:00:00Z'),
    validaAl: null,
    ...over,
  }
}

function db(opts: { cer?: boolean; azienda?: unknown[]; disattivate?: string[] } = {}) {
  const disattivazioni = (opts.disattivate ?? []).map(codice => ({
    id: `d-${codice}`,
    natura: 'DISATTIVAZIONE',
    codice,
    verso: 'SCARICO',
    descrizione: null,
    ruoloMud: null,
    codiceRentri: null,
    operazione: null,
    ordine: 0,
    validaDal: null,
    validaAl: null,
  }))
  return {
    cERCode: {
      count: jest.fn().mockResolvedValue(opts.cer === false ? 0 : 1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    causaleRegistro: { findMany: jest.fn().mockResolvedValue(righeCausaliSistema()) },
    causaleRegistroAzienda: {
      findMany: jest.fn().mockResolvedValue([...(opts.azienda ?? []), ...disattivazioni]),
    },
  }
}
const ok = {
  tenantId: TENANT,
  type: 'CARICO',
  causale: 'PRODUZIONE_INTERNA',
  cerCode: '200301',
  movementDate: new Date('2026-03-01T00:00:00Z'),
  registrationDate: new Date('2026-03-02T00:00:00Z'),
}

describe('validaDatiMovimento', () => {
  it('causale di sistema valida: CER normalizzato, nessuna versione, descrizione del catalogo', async () => {
    expect(await validaDatiMovimento(db(), ok)).toEqual({
      cerCode: '20 03 01',
      causaleAziendaId: null,
      causaleDescrizione: 'Produzione interna',
    })
  })
  it('legge il catalogo dell azienda indicata', async () => {
    const d = db()
    await validaDatiMovimento(d, ok)
    expect(d.causaleRegistroAzienda.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT } })
  })
  it('causale del verso sbagliato: stesso messaggio di sempre, prima di leggere il CER', async () => {
    const d = db()
    const r = await validaDatiMovimento(d, { ...ok, causale: 'CESSIONE' })
    expect(r.errore).toBe(
      'Causale non valida per CARICO: CESSIONE. Valori: PRODUZIONE_INTERNA, INGRESSO_ESTERNO, ' +
        'RICLASSIFICAZIONE, RECUPERO_PARZIALE, ALTRO_CARICO'
    )
    expect(d.cERCode.count).not.toHaveBeenCalled()
    const s = await validaDatiMovimento(db(), { ...ok, type: 'SCARICO' })
    expect(s.errore).toContain('Causale non valida per SCARICO: PRODUZIONE_INTERNA')
    expect(s.errore).toContain('Valori: CONFERIMENTO_TRASPORTATORE, AVVIO_RECUPERO')
  })
  it('causale sconosciuta', async () => {
    const r = await validaDatiMovimento(db(), { ...ok, causale: 'NON_ESISTE' })
    expect(r.errore).toContain('Causale non valida per CARICO: NON_ESISTE. Valori: ')
  })
  it('causale di sistema disattivata per l azienda: lo dice e non la elenca fra i valori', async () => {
    const r = await validaDatiMovimento(db({ disattivate: ['CESSIONE'] }), {
      ...ok,
      type: 'SCARICO',
      causale: 'CESSIONE',
    })
    expect(r.errore).toContain("CESSIONE (non è attiva per l'azienda)")
    expect(r.errore).not.toMatch(/Valori:.*CESSIONE/)
  })
  it('causale propria fuori validità alla data dell operazione', async () => {
    const r = await validaDatiMovimento(db({ azienda: [propria({})] }), {
      ...ok,
      type: 'SCARICO',
      causale: 'AZ_PROVA',
      movementDate: new Date('2025-12-31T00:00:00Z'),
    })
    expect(r.errore).toContain("AZ_PROVA (non è valida alla data dell'operazione)")
  })
  it('causale propria valida: restituisce id della versione e descrizione', async () => {
    const r = await validaDatiMovimento(db({ azienda: [propria({})] }), {
      ...ok,
      type: 'SCARICO',
      causale: 'AZ_PROVA',
    })
    expect(r).toEqual({
      cerCode: '20 03 01',
      causaleAziendaId: VERSIONE_1,
      causaleDescrizione: 'Prova aziendale',
    })
  })
  it('causale propria con due versioni: sceglie quella valida alla data dell operazione', async () => {
    const azienda = [
      propria({ validaAl: new Date('2026-02-28T00:00:00Z') }),
      propria({
        id: VERSIONE_2,
        descrizione: 'Prova v2',
        validaDal: new Date('2026-03-01T00:00:00Z'),
      }),
    ]
    const base = { ...ok, type: 'SCARICO', causale: 'AZ_PROVA' }
    const retro = await validaDatiMovimento(db({ azienda }), {
      ...base,
      movementDate: new Date('2026-02-10T00:00:00Z'),
    })
    expect(retro.errore).toBeUndefined()
    expect((retro as { causaleAziendaId: string }).causaleAziendaId).toBe(VERSIONE_1)
    const oggi = await validaDatiMovimento(db({ azienda }), base)
    expect((oggi as { causaleAziendaId: string }).causaleAziendaId).toBe(VERSIONE_2)
  })
  it('rettifica che non cambia causale: una causale disattivata nel frattempo non impedisce di correggere', async () => {
    const r = await validaDatiMovimento(db({ disattivate: ['CESSIONE'] }), {
      ...ok,
      type: 'SCARICO',
      causale: 'CESSIONE',
      causaleAttuale: { codice: 'CESSIONE', versioneId: null },
    })
    expect(r.errore).toBeUndefined()
  })
  it('rettifica che cambia causale: vale la selezionabilità', async () => {
    const r = await validaDatiMovimento(db({ disattivate: ['CESSIONE'] }), {
      ...ok,
      type: 'SCARICO',
      causale: 'CESSIONE',
      causaleAttuale: { codice: 'ALTRO_SCARICO', versioneId: null },
    })
    expect(r.errore).toContain('non è attiva')
  })
  it('CER fuori catalogo', async () => {
    expect((await validaDatiMovimento(db({ cer: false }), ok)).errore).toContain('CER non valido')
  })
  it('date nel futuro', async () => {
    const futuro = new Date(Date.now() + 5 * 86_400_000)
    expect((await validaDatiMovimento(db(), { ...ok, movementDate: futuro })).errore).toContain(
      "data dell'operazione"
    )
    expect((await validaDatiMovimento(db(), { ...ok, registrationDate: futuro })).errore).toContain(
      'data di registrazione'
    )
  })
})
