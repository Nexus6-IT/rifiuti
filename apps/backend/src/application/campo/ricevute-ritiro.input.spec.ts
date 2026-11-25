import { deflateSync } from 'zlib'
import { leggiPngSicuro } from '../../core/png-sicuro'
import { pngDiProva } from '../../test-support/png-di-prova'
import {
  chunkPng,
  pngBomba,
  pngConIdat,
  pngFiltroNonValido,
  pngIdatNonZlib,
} from '../../test-support/png-malevoli'
import { LIMITE_FIRMA_BYTE, mascheraEmail, normalizzaRicevutaCampo } from './ricevute-ritiro.input'

const base = (extra: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  ritiroId: '22222222-2222-4222-8222-222222222222',
  firmatarioNome: 'Mario Rossi',
  firmatoIl: '2026-12-01T08:30:00.000Z',
  firmaPng: pngDiProva().toString('base64'),
  ...extra,
})

describe('normalizzaRicevutaCampo', () => {
  it('accetta un corpo valido e decodifica la firma', () => {
    const r = normalizzaRicevutaCampo(base())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valori.firmatarioNome).toBe('Mario Rossi')
    expect(r.valori.firmaPng.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(r.valori.emailCliente).toBeNull()
    expect(r.valori.larghezza).toBe(300)
    expect(r.valori.altezza).toBe(120)
  })

  it('normalizza il nome (spazi) e rifiuta nomi troppo corti, lunghi o senza lettere', () => {
    const ok = normalizzaRicevutaCampo(base({ firmatarioNome: '  Mario   Rossi ' }))
    expect(ok.ok && ok.valori.firmatarioNome).toBe('Mario Rossi')
    for (const n of [
      '',
      ' ',
      'A',
      '12345',
      'x'.repeat(121),
      'Mario\u0000Rossi',
      'Mario\u202eRossi',
      'Mario\u2066Rossi',
      'Mario\u200bRossi',
      'Mario\u200fRossi',
      'Mario\ufeffRossi',
      'Mario\u2060Rossi',
      42,
    ]) {
      expect(normalizzaRicevutaCampo(base({ firmatarioNome: n })).ok).toBe(false)
    }
  })

  it('rifiuta id, ritiro e data non validi', () => {
    expect(normalizzaRicevutaCampo(base({ id: 'x' })).ok).toBe(false)
    expect(normalizzaRicevutaCampo(base({ ritiroId: 'x' })).ok).toBe(false)
    for (const d of ['2026-12-01', 'ieri', '1999-01-01T00:00:00Z', '2101-01-01T00:00:00Z', 5]) {
      expect(normalizzaRicevutaCampo(base({ firmatoIl: d })).ok).toBe(false)
    }
  })

  it('rifiuta una firma che non e un PNG, troppo grande, troncata o con dimensioni fuori scala', () => {
    const png = pngDiProva()
    const no = (firmaPng: unknown) => normalizzaRicevutaCampo(base({ firmaPng })).ok
    expect(no('')).toBe(false)
    expect(no(42)).toBe(false)
    expect(no('non è base64!')).toBe(false)
    expect(no(Buffer.from('<svg onload=alert(1)>').toString('base64'))).toBe(false)
    expect(
      no(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png.subarray(3)]).toString('base64'))
    ).toBe(false)
    expect(no(png.subarray(0, png.length - 12).toString('base64'))).toBe(false) // senza IEND
    expect(no(pngDiProva(5000, 100).toString('base64'))).toBe(false)
    expect(no(pngDiProva(300, 5).toString('base64'))).toBe(false)
    expect(no(Buffer.alloc(LIMITE_FIRMA_BYTE + 1, 1).toString('base64'))).toBe(false)
  })

  it('rifiuta i PNG che farebbero lanciare il motore PDF (IDAT non zlib, filtro 9, bomba)', () => {
    const no = (p: Buffer) => normalizzaRicevutaCampo(base({ firmaPng: p.toString('base64') })).ok
    expect(no(pngIdatNonZlib())).toBe(false)
    expect(no(pngFiltroNonValido())).toBe(false)
    expect(no(pngBomba())).toBe(false)
  })

  it('ammette solo 8 bit RGB/RGBA non interlacciato', () => {
    const vuoto = (w: number, h: number, bpp: number) =>
      deflateSync(Buffer.concat(Array.from({ length: h }, () => Buffer.alloc(1 + w * bpp))))
    const ok = (p: Buffer) => normalizzaRicevutaCampo(base({ firmaPng: p.toString('base64') })).ok
    expect(ok(pngConIdat(vuoto(300, 120, 3), 300, 120, 8, 2))).toBe(true)
    expect(ok(pngConIdat(vuoto(300, 120, 1), 300, 120, 8, 0))).toBe(false)
    expect(ok(pngConIdat(vuoto(300, 120, 8), 300, 120, 16, 6))).toBe(false)
  })

  it('consegna un PNG rigenerato dal server: i chunk accessori del client sono scartati', () => {
    const orig = pngDiProva()
    const conTesto = Buffer.concat([
      orig.subarray(0, 33),
      chunkPng('tEXt', Buffer.from('k\0v')),
      orig.subarray(33),
    ])
    const r = normalizzaRicevutaCampo(base({ firmaPng: conTesto.toString('base64') }))
    expect(r.ok && r.valori.firmaPng.includes(Buffer.from('tEXt'))).toBe(false)
    expect(r.ok && leggiPngSicuro(r.valori.firmaPng).ok).toBe(true)
  })

  it('email del cliente: facoltativa, validata, ripulita', () => {
    const ok = normalizzaRicevutaCampo(base({ emailCliente: '  Cliente@Esempio.IT ' }))
    expect(ok.ok && ok.valori.emailCliente).toBe('cliente@esempio.it')
    const vuota = normalizzaRicevutaCampo(base({ emailCliente: '' }))
    expect(vuota.ok && vuota.valori.emailCliente).toBeNull()
    for (const e of ['a@', 'senza chiocciola', 'a b@c.it', 'a@b', `${'a'.repeat(250)}@b.it`, 7]) {
      expect(normalizzaRicevutaCampo(base({ emailCliente: e })).ok).toBe(false)
    }
  })
})

describe('mascheraEmail', () => {
  it('lascia solo la prima lettera e il dominio', () => {
    expect(mascheraEmail('mario.rossi@ditta.it')).toBe('m***@ditta.it')
    expect(mascheraEmail('a@b.it')).toBe('a***@b.it')
  })
})
