import { PacchettoError } from './errori-pacchetto'
import { U1, U2, mappaValida } from '../../../test-support/migrazione/mappa-di-prova'
import { improntaMappa, validaMappa } from './mappa-import'

function rifiutata(json: unknown, codice = 'MAPPA_NON_VALIDA'): void {
  try {
    validaMappa(json)
  } catch (e) {
    expect(e).toBeInstanceOf(PacchettoError)
    expect((e as PacchettoError).codice).toBe(codice)
    return
  }
  throw new Error('la mappa doveva essere rifiutata')
}

describe('mappa di import', () => {
  it('accetta una mappa valida', () => {
    const m = validaMappa(mappaValida())
    expect(m.ditta).toBe('0001')
    expect(m.registri).toHaveLength(1)
  })

  it('rifiuta formato sconosciuto, chiavi mancanti e chiavi non previste', () => {
    rifiutata({ ...mappaValida(), formato: 'altro/1' }, 'FORMATO_SCONOSCIUTO')
    const senza: Record<string, unknown> = mappaValida()
    delete senza.causali
    rifiutata(senza)
    rifiutata({ ...mappaValida(), note: 'libero' })
  })

  it('rifiuta un codice fiscale ovunque compaia (dato personale)', () => {
    const m = mappaValida()
    m.registri = [{ legacy: 'RSSMRA80A01H501U', registroId: U1 }]
    rifiutata(m)
    const m2 = mappaValida()
    m2.causali = [{ oper: '10', causale: 'RSSMRA80A01H501U', verso: 'CARICO', confermata: true }]
    rifiutata(m2)
    const m3 = mappaValida()
    m3.agganci = [{ partitaIva: 'RSSMRA80A01H501U', dittaId: U2 }]
    rifiutata(m3)
  })

  it('rifiuta un e-mail, un telefono e una chiave aggiunta per nascondere un nome', () => {
    const m = mappaValida()
    m.unitaLocali = [{ legacy: 'mario@example.it', sedeId: U2, unitaLocaleId: null }]
    rifiutata(m)
    const m2 = mappaValida()
    m2.registri = [{ legacy: '3331234567', registroId: U1 }]
    rifiutata(m2)
    const m3 = mappaValida()
    m3.registri = [{ legacy: 'REG1', registroId: U1, referente: 'Mario Rossi' }]
    rifiutata(m3)
  })

  it('rifiuta partita IVA con cifra di controllo errata, duplicati e data inesistente', () => {
    const m = mappaValida()
    m.agganci = [{ partitaIva: '12345678901', dittaId: U2 }]
    rifiutata(m)
    const m2 = mappaValida()
    m2.registri = [
      { legacy: 'REG1', registroId: U1 },
      { legacy: 'REG1', registroId: U2 },
    ]
    rifiutata(m2)
    rifiutata({ ...mappaValida(), dataTaglio: '2026-02-30' })
  })

  it("l'impronta e' deterministica e non dipende dall'ordine delle chiavi", () => {
    const a = validaMappa(mappaValida())
    const rovesciata = Object.fromEntries(Object.entries(mappaValida()).reverse())
    const b = validaMappa(rovesciata)
    expect(improntaMappa(a)).toBe(improntaMappa(b))
    expect(improntaMappa(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(improntaMappa(validaMappa({ ...mappaValida(), dataTaglio: '2026-07-01' }))).not.toBe(
      improntaMappa(a)
    )
  })

  it('il tenant e obbligatorio e deve essere un UUID', () => {
    const senza: Record<string, unknown> = mappaValida()
    delete senza.tenantId
    rifiutata(senza)
    rifiutata({ ...mappaValida(), tenantId: 'non-uuid' })
  })

  it('una chiave non prevista e rifiutata senza ripetere il nome della chiave', () => {
    try {
      validaMappa({ ...mappaValida(), MarioRossi: 'x' })
    } catch (e) {
      expect((e as Error).message).not.toContain('MarioRossi')
      return
    }
    throw new Error('doveva essere rifiutata')
  })

  it('la data di taglio deve cadere nell anno della mappa', () => {
    rifiutata({ ...mappaValida(), dataTaglio: '2025-12-31' })
    rifiutata({ ...mappaValida(), anno: 2027 })
  })

  describe('codici unita locale proprie WinWaste (VERSIS XRENTRI:X<sede>.<ul>)', () => {
    const conUl = (legacy: string) => ({
      ...mappaValida(),
      unitaLocali: [{ legacy, sedeId: U2, unitaLocaleId: null }],
    })

    it('un codice UL lungo con la X davanti e accettato in unitaLocali[].legacy', () => {
      expect(() => validaMappa(conUl('X123456.0001'))).not.toThrow()
      expect(() => validaMappa(conUl('X90001.0001'))).not.toThrow()
    })

    it('un telefono vero nello stesso formato di lunghezza resta rifiutato nello stesso campo', () => {
      rifiutata(conUl('0612345678.0001'))
      rifiutata(conUl('06123456.0001'))
      rifiutata(conUl('+39061234567'))
    })

    it('negli altri campi liberi il formato X... lungo non e una scorciatoia', () => {
      rifiutata({
        ...mappaValida(),
        registri: [{ legacy: 'X123456.0001', registroId: U1 }],
      })
    })
  })
})
