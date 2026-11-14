import { hashDatiTracciato } from './comunicazioni-tracciato.service'
import {
  ConfermaVerificaRichiestaError,
  RichiestaComunicazioneNonValidaError,
} from './comunicazioni-tracciato.port'

describe('hashDatiTracciato', () => {
  it('stessi dati, stesso hash; dati diversi, hash diverso', () => {
    const a = { righe: [{ cer: '130205', kg: 100 }] }
    expect(hashDatiTracciato(a)).toBe(hashDatiTracciato({ righe: [{ cer: '130205', kg: 100 }] }))
    expect(hashDatiTracciato(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashDatiTracciato(a)).not.toBe(
      hashDatiTracciato({ righe: [{ cer: '130205', kg: 101 }] })
    )
  })
})

describe('errori del servizio generico', () => {
  it('la richiesta non valida porta l’elenco degli errori', () => {
    const e = new RichiestaComunicazioneNonValidaError(['a', 'b'])
    expect(e.errori).toEqual(['a', 'b'])
    expect(e.message).toContain('a; b')
  })
  it('la conferma richiesta nomina WinWaste e la verifica col consorzio', () => {
    const e = new ConfermaVerificaRichiestaError()
    expect(e.message).toMatch(/WinWaste/)
    expect(e.message).toMatch(/consorzio/)
  })
})
