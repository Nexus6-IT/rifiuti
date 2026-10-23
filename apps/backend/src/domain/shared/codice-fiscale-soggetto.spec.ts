import { codiceFiscaleSoggettoValido } from './codice-fiscale-soggetto'

describe('codiceFiscaleSoggettoValido', () => {
  it.each([
    ['12345678903', true], // partita IVA, cifra di controllo giusta
    ['12345678901', false], // cifra di controllo sbagliata
    ['IT12345678903', true], // partita IVA con il prefisso del paese
    ['RSSMRA80A01H501U', true], // CF di persona
    ['rssmra80a01h501u', true], // minuscolo: si normalizza
    [' RSSMRA80A01H501U ', true], // spazi esterni
    ['RSSMRA80A01H501X', false], // carattere di controllo sbagliato
    ['RSSMRA80A01H50MM', true], // omocodia (1 → M) con il carattere di controllo ricalcolato
    ['RSSMRA80A01H50MU', false], // omocodia con il carattere di controllo non ricalcolato
    ['RSSMRA80Z01H501U', false], // mese inesistente (Z)
    ['1234567890', false],
    ['', false],
  ])('codiceFiscaleSoggettoValido(%s) = %p', (valore, atteso) => {
    expect(codiceFiscaleSoggettoValido(valore)).toBe(atteso)
  })

  it('non accetta valori assenti', () => {
    expect(codiceFiscaleSoggettoValido(undefined as unknown as string)).toBe(false)
    expect(codiceFiscaleSoggettoValido(null as unknown as string)).toBe(false)
  })
})
