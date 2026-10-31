import { SedeDitta, chiaveIndirizzo } from './sede-ditta'
import { Indirizzo } from '../value-objects/indirizzo'
import { SedeNonModificabileError } from '../../../core/domain/errors'

const indirizzo = (over: Partial<Parameters<typeof Indirizzo.create>[0]> = {}) =>
  Indirizzo.create({
    via: 'Via Roma',
    civico: '1',
    cap: '00100',
    citta: 'Roma',
    provincia: 'RM',
    ...over,
  })

const sede = (principale = false) =>
  SedeDitta.crea({ dittaId: 'd1', indirizzo: indirizzo(), principale })

describe('chiaveIndirizzo (stessa normalizzazione della migration D5.4)', () => {
  it('lower e spazi compressi di via, civico e comune; CAP tagliato; provincia maiuscola', () => {
    const a = chiaveIndirizzo(indirizzo())
    const b = chiaveIndirizzo(
      indirizzo({ via: '  VIA   ROMA ', civico: ' 1', citta: ' ROMA  ', provincia: 'rm' })
    )
    expect(a).toBe('via roma|1|roma|00100|RM')
    expect(b).toBe(a)
  })

  it('esempi della migration: "  VIA   GARIBALDI " civico 3 come "Via Garibaldi"', () => {
    const x = chiaveIndirizzo(
      indirizzo({
        via: 'Via Garibaldi',
        civico: '3',
        citta: 'Milano',
        cap: '20100',
        provincia: 'MI',
      })
    )
    const y = chiaveIndirizzo(
      indirizzo({
        via: '  VIA   GARIBALDI ',
        civico: '3',
        citta: 'MILANO',
        cap: '20100',
        provincia: 'MI',
      })
    )
    expect(y).toBe(x)
  })

  it('via diversa o civico diverso danno chiavi diverse', () => {
    expect(chiaveIndirizzo(indirizzo({ civico: '2' }))).not.toBe(chiaveIndirizzo(indirizzo()))
    expect(chiaveIndirizzo(indirizzo({ via: "Via dell'Industria" }))).not.toBe(
      chiaveIndirizzo(indirizzo())
    )
  })

  it('SedeDitta.chiaveIndirizzo() usa la stessa funzione', () => {
    expect(sede().chiaveIndirizzo()).toBe(chiaveIndirizzo(indirizzo()))
  })
})

describe('SedeDitta', () => {
  it('nasce attiva; i contatti vuoti diventano null', () => {
    const s = SedeDitta.crea({
      dittaId: 'd1',
      indirizzo: indirizzo(),
      email: '  ',
      telefono: ' 06 123 ',
      principale: true,
    })
    expect(s.attiva).toBe(true)
    expect(s.principale).toBe(true)
    expect(s.email).toBeNull()
    expect(s.telefono).toBe('06 123')
  })

  it('aggiorna: undefined lascia, null svuota', () => {
    const s = SedeDitta.crea({
      dittaId: 'd1',
      indirizzo: indirizzo(),
      email: 'a@b.it',
      pec: 'p@pec.it',
    })
    s.aggiorna({ email: undefined, pec: null, referente: 'Mario' })
    expect(s.email).toBe('a@b.it')
    expect(s.pec).toBeNull()
    expect(s.referente).toBe('Mario')
  })

  describe('disattiva (D4)', () => {
    it('disattiva una sede qualunque', () => {
      const s = sede()
      s.disattiva([])
      expect(s.attiva).toBe(false)
    })

    it('rifiuta la principale (409)', () => {
      expect(() => sede(true).disattiva([])).toThrow(SedeNonModificabileError)
    })

    it('rifiuta la predefinita di un ruolo, con il nome del ruolo e senza id', () => {
      const s = sede()
      try {
        s.disattiva(['DESTINATARIO'])
        throw new Error('non ha lanciato')
      } catch (e) {
        expect(e).toBeInstanceOf(SedeNonModificabileError)
        expect((e as Error).message).toBe(
          "È la sede predefinita del destinatario: scegline un'altra prima"
        )
        expect((e as Error).message).not.toContain(s.id)
      }
    })

    it('una sede gia disattiva resta tale senza errori', () => {
      const s = sede()
      s.disattiva([])
      expect(() => s.disattiva(['PRODUTTORE'])).not.toThrow()
    })
  })

  it('una sede disattivata non puo diventare principale; riattivata si', () => {
    const s = sede()
    s.disattiva([])
    expect(() => s.rendiPrincipale()).toThrow(SedeNonModificabileError)
    s.riattiva()
    s.rendiPrincipale()
    expect(s.principale).toBe(true)
    s.togliPrincipale()
    expect(s.principale).toBe(false)
  })
})
