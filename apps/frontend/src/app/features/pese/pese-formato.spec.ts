import {
  dataItalianaDa,
  formattaKg,
  messaggioErrorePese,
  normalizzaTarga,
  taraVecchia,
  verificazioneScaduta,
  badgePesata,
  etichettaFonte,
  etichettaQualita,
  oraLocaleInIso,
  ridimensionaImmagine,
  preparaAllegato,
  MSG_TIPO_ALLEGATO,
  MSG_ALLEGATO_GRANDE,
  LIMITE_ALLEGATO_BYTE,
  SOGLIA_RIDIMENSIONAMENTO_BYTE,
  type MotoreImmagine,
  uuidV4,
} from './pese-formato'
import type { PesataVista } from './pese.service'

function pesata(parziale: Partial<PesataVista> = {}): PesataVista {
  return {
    id: 'p1',
    ordine: 1,
    fonte: 'MANUALE',
    pesoOriginaleKg: 100,
    pesoEffettivoKg: 100,
    rettifiche: [],
    strumento: null,
    strumentoEsterno: null,
    alibiId: null,
    oraStrumento: null,
    oraRicezione: '2026-10-31T10:00:00.000Z',
    operatore: null,
    motivo: 'Strumento guasto',
    allegato: null,
    integra: true,
    avvisi: [],
    ...parziale,
  }
}

describe('oraLocaleInIso', () => {
  it('25/10/2026 01:30 e 03:30 cadono in ore legali diverse (fine ora legale)', () => {
    expect(oraLocaleInIso(new Date(2026, 9, 25), '01:30')).toBe('2026-10-25T01:30:00+02:00')
    expect(oraLocaleInIso(new Date(2026, 9, 25), '03:30')).toBe('2026-10-25T03:30:00+01:00')
  })

  it('31/03/2026 12:00 e inverno', () => {
    expect(oraLocaleInIso(new Date(2026, 2, 31), '12:00')).toBe('2026-03-31T12:00:00+02:00')
    expect(oraLocaleInIso(new Date(2026, 0, 15), '08:05')).toBe('2026-01-15T08:05:00+01:00')
  })

  it('ora inesistente (29/03 02:30) prende +01:00; ora ripetuta (25/10 02:30) la seconda occorrenza', () => {
    expect(oraLocaleInIso(new Date(2026, 2, 29), '02:30')).toBe('2026-03-29T02:30:00+01:00')
    expect(oraLocaleInIso(new Date(2026, 9, 25), '02:30')).toBe('2026-10-25T02:30:00+01:00')
  })

  it('rifiuta un orario non valido', () => {
    expect(() => oraLocaleInIso(new Date(2026, 0, 15), '25:00')).toThrowError()
    expect(() => oraLocaleInIso(new Date(2026, 0, 15), 'ciao')).toThrowError()
  })
})

describe('etichette e badge', () => {
  it('etichette di fonte e qualita', () => {
    expect(etichettaFonte('MANUALE')).toBe('Manuale')
    expect(etichettaFonte('STRUMENTO')).toBe('Strumento')
    expect(etichettaFonte('TARA_ANAGRAFICA')).toBe('Tara dichiarata')
    expect(etichettaQualita('DUE_PESATE')).toBe('Due pesate')
    expect(etichettaQualita('TARA_DICHIARATA')).toBe('Tara dichiarata')
    expect(etichettaQualita('PESATA_SINGOLA')).toBe('Pesata singola')
    expect(etichettaQualita(null)).toBe('')
  })

  it('pesata MANUALE senza allegato: Manuale e Senza prova documentale', () => {
    expect(badgePesata(pesata())).toEqual(['Manuale', 'Senza prova documentale'])
  })

  it('con allegato non e senza prova; rettificata aggiunge Rettificato', () => {
    const p = pesata({
      allegato: { id: 'a', nomeFile: 'x.pdf', mimeType: 'application/pdf', dimensioneByte: 10 },
      rettifiche: [
        {
          id: 'r',
          numero: 1,
          pesoPrecedenteKg: 100,
          pesoNuovoKg: 90,
          motivo: 'm',
          autore: null,
          createdAt: '2026-10-31T10:00:00Z',
          allegato: null,
          integra: true,
        },
      ],
    })
    expect(badgePesata(p)).toEqual(['Manuale', 'Rettificato'])
  })

  it('integra false aggiunge Dato alterato; tara anagrafica da Tara dichiarata', () => {
    expect(badgePesata(pesata({ integra: false }))).toContain('Dato alterato')
    expect(badgePesata(pesata({ fonte: 'TARA_ANAGRAFICA' }))).toEqual(['Tara dichiarata'])
    expect(badgePesata(pesata({ fonte: 'STRUMENTO' }))).toEqual([])
  })
})

describe('ridimensionaImmagine', () => {
  const file = (tipo: string, byte: number) =>
    new File([new Uint8Array(byte)], 'foto', { type: tipo })

  it('sotto soglia e i PDF non si toccano', async () => {
    const motore = jasmine.createSpyObj<MotoreImmagine>('motore', ['ridimensiona'])
    const piccolo = file('image/jpeg', 100)
    expect(await ridimensionaImmagine(piccolo, motore)).toBe(piccolo)
    const pdf = file('application/pdf', SOGLIA_RIDIMENSIONAMENTO_BYTE + 10)
    expect(await ridimensionaImmagine(pdf, motore)).toBe(pdf)
    expect(motore.ridimensiona).not.toHaveBeenCalled()
  })

  it('oltre 1,5 MB chiede lato lungo 2000 px e JPEG 0,85', async () => {
    const out = new Blob(['x'], { type: 'image/jpeg' })
    const motore = jasmine.createSpyObj<MotoreImmagine>('motore', ['ridimensiona'])
    motore.ridimensiona.and.resolveTo(out)
    const grande = file('image/png', SOGLIA_RIDIMENSIONAMENTO_BYTE + 1)
    expect(await ridimensionaImmagine(grande, motore)).toBe(out)
    expect(motore.ridimensiona).toHaveBeenCalledWith(grande, 2000, 0.85)
  })
})

describe('targa, verificazione, tara vecchia, messaggi', () => {
  it('normalizzaTarga come il backend', () => {
    expect(normalizzaTarga('ab 123-cd')).toBe('AB123CD')
    expect(normalizzaTarga('a')).toBeNull()
    expect(normalizzaTarga('AB/123')).toBeNull()
  })
  it('verificazione scaduta oltre 3 anni', () => {
    expect(verificazioneScaduta('2023-10-31', '2026-10-31')).toBeFalse()
    expect(verificazioneScaduta('2023-10-30', '2026-10-31')).toBeTrue()
  })
  it('tara vecchia oltre 365 giorni', () => {
    const adesso = new Date('2026-10-31T10:00:00Z')
    expect(taraVecchia('2025-11-01T00:00:00Z', adesso)).toBeFalse()
    expect(taraVecchia('2025-10-01T00:00:00Z', adesso)).toBeTrue()
    expect(taraVecchia(null, adesso)).toBeFalse()
  })
  it('formati it-IT e messaggio del backend verbatim', () => {
    expect(formattaKg(12340.5)).toBe('12.340,5 kg')
    expect(dataItalianaDa('2026-03-10')).toBe('10/03/2026')
    expect(messaggioErrorePese({ error: { message: 'Targa non valida.' } })).toBe(
      'Targa non valida.'
    )
    expect(messaggioErrorePese({ error: { message: ['a', 'b'] } })).toBe('a · b')
    expect(messaggioErrorePese({})).toBe('Operazione non riuscita.')
  })
})

describe('preparaAllegato', () => {
  const file = (tipo: string, byte: number, nome = 'foto.png') =>
    new File([new Uint8Array(byte)], nome, { type: tipo })

  it('rifiuta subito i tipi non ammessi con messaggio italiano', async () => {
    await expectAsync(preparaAllegato(file('image/webp', 10, 'a.webp'))).toBeRejectedWithError(
      MSG_TIPO_ALLEGATO
    )
    await expectAsync(preparaAllegato(file('text/plain', 10))).toBeRejectedWithError(
      MSG_TIPO_ALLEGATO
    )
  })

  it('un PDF oltre 4 MiB e rifiutato, uno piccolo passa col suo nome', async () => {
    await expectAsync(
      preparaAllegato(file('application/pdf', LIMITE_ALLEGATO_BYTE + 1, 'a.pdf'))
    ).toBeRejectedWithError(MSG_ALLEGATO_GRANDE)
    const r = await preparaAllegato(file('application/pdf', 100, 'bolla.pdf'))
    expect(r.nomeFile).toBe('bolla.pdf')
  })

  it('una foto grande ricodificata in JPEG prende estensione .jpg', async () => {
    const motore = jasmine.createSpyObj<MotoreImmagine>('m', ['ridimensiona'])
    motore.ridimensiona.and.resolveTo(new Blob(['x'], { type: 'image/jpeg' }))
    const r = await preparaAllegato(
      file('image/png', SOGLIA_RIDIMENSIONAMENTO_BYTE + 1, 'scheda.png'),
      motore
    )
    expect(r.nomeFile).toBe('scheda.jpg')
  })

  it('se anche dopo la ricodifica supera 4 MiB, errore', async () => {
    const motore = jasmine.createSpyObj<MotoreImmagine>('m', ['ridimensiona'])
    motore.ridimensiona.and.resolveTo(new Blob([new Uint8Array(LIMITE_ALLEGATO_BYTE + 1)]))
    await expectAsync(
      preparaAllegato(file('image/jpeg', SOGLIA_RIDIMENSIONAMENTO_BYTE + 1), motore)
    ).toBeRejectedWithError(MSG_ALLEGATO_GRANDE)
  })
})

describe('uuidV4', () => {
  it('senza randomUUID (contesto non sicuro) produce un UUID v4 valido e diverso a ogni chiamata', () => {
    const motore = {
      getRandomValues: <T extends ArrayBufferView>(a: T) => crypto.getRandomValues(a),
    }
    const a = uuidV4(motore)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(uuidV4(motore)).not.toBe(a)
  })
  it('con randomUUID lo usa', () => {
    expect(uuidV4({ getRandomValues: a => a, randomUUID: () => 'x' })).toBe('x')
  })
})
