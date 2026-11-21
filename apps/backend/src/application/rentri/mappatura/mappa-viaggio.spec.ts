import {
  mappaQuantitaRifiuto,
  mappaDatiTrasportoTerrestre,
  mappaTrasbordoTotale,
} from './mappa-viaggio'
import { DatoMancantePerRentriError } from './mappa-parti'
import { ValoreNonTraducibilePerRentriError } from './mappa-rifiuto'

// Il giudice e' il validatore del finto RENTRI, generato dal contratto (v. mappa-nuovo-formulario.spec).
const ORACOLO = '../../../../../../tools/rentri-fake/src/dominio/operazioni-viaggio'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validaQuantita, validaTrasportoTerrestre, validaTrasbordoTotale } = require(ORACOLO)

describe('mappaQuantitaRifiuto (POST /{numero_fir}/quantita)', () => {
  it("con i colli: quantita' convertita, colli come testo, niente rinfusa", () => {
    const corpo = mappaQuantitaRifiuto({
      valore: 1.5,
      unitaMisura: 't',
      numeroColli: 12,
      verificatoInPartenza: true,
    })
    expect(corpo).toEqual({
      quantita: { valore: 1500, unita_misura: 'kg' },
      numero_colli: '12',
      verificato_in_partenza: true,
    })
    expect(validaQuantita(corpo)).toBeNull()
  })

  it('alla rinfusa i colli non si inviano, nemmeno se presenti', () => {
    const corpo = mappaQuantitaRifiuto({
      valore: 800,
      unitaMisura: 'litri',
      rinfusa: true,
      numeroColli: 3,
    })
    expect(corpo).toEqual({ quantita: { valore: 800, unita_misura: 'l' }, rinfusa: true })
    expect(validaQuantita(corpo)).toBeNull()
  })

  it("senza colli e senza rinfusa e' un dato mancante (il contratto vuole l'uno o l'altra)", () => {
    expect(() => mappaQuantitaRifiuto({ valore: 10, unitaMisura: 'kg' })).toThrow(
      DatoMancantePerRentriError
    )
    expect(() => mappaQuantitaRifiuto({ valore: 10, unitaMisura: 'kg', rinfusa: false })).toThrow(
      /numero_colli/
    )
  })

  it("rifiuta colli oltre i 50 caratteri e quantita' non traducibili", () => {
    expect(() =>
      mappaQuantitaRifiuto({ valore: 10, unitaMisura: 'kg', numeroColli: 'x'.repeat(51) })
    ).toThrow(DatoMancantePerRentriError)
    expect(() => mappaQuantitaRifiuto({ valore: 0, unitaMisura: 'kg', rinfusa: true })).toThrow(
      ValoreNonTraducibilePerRentriError
    )
  })
})

describe('mappaDatiTrasportoTerrestre (POST /{numero_fir}/trasporto)', () => {
  const base = {
    conducenteNome: ' Mario ',
    conducenteCognome: 'De Rossi',
    targaAutomezzo: ' ab123cd ',
    dataOraInizioTrasporto: new Date('2026-11-18T08:30:00Z'),
  }

  it('conducente e targa ripuliti, data in ISO UTC, solo i campi presenti', () => {
    const corpo = mappaDatiTrasportoTerrestre(base)
    expect(corpo).toEqual({
      data_ora_inizio_trasporto: '2026-11-18T08:30:00.000Z',
      conducente: { nome: 'Mario', cognome: 'De Rossi' },
      targa_automezzo: 'AB123CD',
    })
    expect(validaTrasportoTerrestre(corpo)).toBeNull()
  })

  it('rimorchio, percorso e annotazioni compaiono solo se indicati', () => {
    const corpo = mappaDatiTrasportoTerrestre({
      ...base,
      targaRimorchio: 'xy987zw',
      percorso: 'Via Appia, poi A1',
      annotazioni: 'Carico fragile',
    })
    expect(corpo).toMatchObject({
      targa_rimorchio: 'XY987ZW',
      percorso: 'Via Appia, poi A1',
      annotazioni: 'Carico fragile',
    })
    expect(validaTrasportoTerrestre(corpo)).toBeNull()
  })

  it("la targa dell'automezzo puo' mancare se c'e' quella del rimorchio", () => {
    const corpo = mappaDatiTrasportoTerrestre({
      ...base,
      targaAutomezzo: undefined,
      targaRimorchio: 'XY987ZW',
    })
    expect(corpo).not.toHaveProperty('targa_automezzo')
    expect(validaTrasportoTerrestre(corpo)).toBeNull()
  })

  it("senza nessuna targa e' un dato mancante", () => {
    expect(() => mappaDatiTrasportoTerrestre({ ...base, targaAutomezzo: ' ' })).toThrow(/targa/)
  })

  it.each([
    { caso: 'nome vuoto', campo: 'conducenteNome', valore: '' },
    { caso: 'cognome di soli spazi', campo: 'conducenteCognome', valore: '   ' },
    { caso: 'nome oltre 50', campo: 'conducenteNome', valore: 'x'.repeat(51) },
    { caso: 'targa automezzo oltre 10', campo: 'targaAutomezzo', valore: 'ABCDEFGHIJK' },
    { caso: 'targa rimorchio oltre 10', campo: 'targaRimorchio', valore: 'ABCDEFGHIJK' },
    { caso: 'percorso oltre 250', campo: 'percorso', valore: 'p'.repeat(251) },
    { caso: 'annotazioni oltre 10000', campo: 'annotazioni', valore: 'a'.repeat(10001) },
  ])('rifiuta: $caso', ({ campo, valore }) => {
    expect(() => mappaDatiTrasportoTerrestre({ ...base, [campo]: valore })).toThrow(
      DatoMancantePerRentriError
    )
  })

  it('rifiuta una data non valida', () => {
    expect(() =>
      mappaDatiTrasportoTerrestre({ ...base, dataOraInizioTrasporto: new Date('non-una-data') })
    ).toThrow(DatoMancantePerRentriError)
  })
})

describe('mappaTrasbordoTotale (POST /{numero_fir}/trasbordo-totale)', () => {
  const base = {
    trasportatore: {
      ragioneSociale: ' Trasporti Verdi Srl ',
      partitaIva: '01234567890',
      numeroIscrizioneAlbo: 'MI/7490',
    },
    presaInCarico: {
      conducenteNome: 'Luca',
      conducenteCognome: 'Bianchi',
      targaAutomezzo: ' fg456hi ',
      dataOraInizioTrasporto: new Date('2026-11-18T12:00:00.000Z'),
    },
  }

  it('nuovo trasportatore terrestre dall\'anagrafica + presa in carico: valido per il contratto', () => {
    const corpo = mappaTrasbordoTotale(base)
    expect(corpo).toEqual({
      trasportatore: {
        denominazione: 'Trasporti Verdi Srl',
        codice_fiscale: '01234567890',
        tipo_trasporto: 'Terrestre',
        numero_iscrizione_albo: 'MI/007490',
      },
      presa_in_carico: {
        data_ora_inizio_trasporto: '2026-11-18T12:00:00.000Z',
        conducente: { nome: 'Luca', cognome: 'Bianchi' },
        targa_automezzo: 'FG456HI',
      },
    })
    expect(validaTrasbordoTotale(corpo)).toBeNull()
  })

  it('il flag del rimorchio precedente va nella presa in carico solo se indicato', () => {
    const corpo = mappaTrasbordoTotale({
      ...base,
      presaInCarico: { ...base.presaInCarico, presaInCaricoRimorchioPrecedente: true },
    })
    expect(corpo.presa_in_carico.presa_in_carico_rimorchio_precedente).toBe(true)
    expect(validaTrasbordoTotale(corpo)).toBeNull()
    expect(mappaTrasbordoTotale(base).presa_in_carico).not.toHaveProperty(
      'presa_in_carico_rimorchio_precedente'
    )
  })

  it('senza partita IVA usa il codice fiscale; senza nessuno dei due e\' un dato mancante', () => {
    const conCf = mappaTrasbordoTotale({
      ...base,
      trasportatore: { ragioneSociale: 'Mario Rossi', partitaIva: '', codiceFiscale: 'RSSMRA80A01H501U' },
    })
    expect(conCf.trasportatore.codice_fiscale).toBe('RSSMRA80A01H501U')
    expect(() =>
      mappaTrasbordoTotale({
        ...base,
        trasportatore: { ragioneSociale: 'Senza codici', partitaIva: '' },
      })
    ).toThrow(DatoMancantePerRentriError)
  })

  it('i dati del trasporto sono fail-closed come per /trasporto (conducente, targa)', () => {
    expect(() =>
      mappaTrasbordoTotale({
        ...base,
        presaInCarico: { ...base.presaInCarico, conducenteNome: '  ' },
      })
    ).toThrow(DatoMancantePerRentriError)
    expect(() =>
      mappaTrasbordoTotale({
        ...base,
        presaInCarico: { ...base.presaInCarico, targaAutomezzo: undefined },
      })
    ).toThrow(/targa/)
  })

  it('il numero di iscrizione all\'Albo non normalizzabile e\' un dato mancante', () => {
    expect(() =>
      mappaTrasbordoTotale({
        ...base,
        trasportatore: { ...base.trasportatore, numeroIscrizioneAlbo: 'boh' },
      })
    ).toThrow(DatoMancantePerRentriError)
  })
})
