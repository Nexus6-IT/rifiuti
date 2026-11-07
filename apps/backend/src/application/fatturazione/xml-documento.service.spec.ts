import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type { DocumentiFatturaService } from './documenti-fattura.service'
import {
  progressivoBase36,
  TETTO_DOCUMENTI_XML_ZIP,
  XmlDocumentoService,
} from './xml-documento.service'

describe('progressivoBase36', () => {
  it.each([
    [1, '00001'],
    [9, '00009'],
    [10, '0000A'],
    [35, '0000Z'],
    [36, '00010'],
    [36 ** 5 - 1, 'ZZZZZ'],
  ])('%d -> %s', (n, atteso) => {
    expect(progressivoBase36(n)).toBe(atteso)
  })

  it.each([0, -1, 1.5, 36 ** 5, Number.NaN])('%s: errore', n => {
    expect(() => progressivoBase36(n)).toThrow(RangeError)
  })
})

describe('XmlDocumentoService, controlli prima del database', () => {
  const servizio = new XmlDocumentoService({} as PrismaService, {} as DocumentiFatturaService)
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

  it('zip di 501 documenti: 400 TROPPI_DOCUMENTI senza toccare il database', async () => {
    const ids = Array.from({ length: TETTO_DOCUMENTI_XML_ZIP + 1 }, (_, i) => uuid(i))
    const errore = await servizio
      .zip('t', 'u', ids, { confermaEmissione: true })
      .catch((e: unknown) => e)
    expect(errore).toBeInstanceOf(BadRequestException)
    expect((errore as BadRequestException).getResponse()).toMatchObject({
      error: 'TROPPI_DOCUMENTI',
      details: { massimo: 500 },
    })
  })

  it('identificativi doppi contano una volta sola (500 + doppioni non e un eccesso)', async () => {
    const ids = [...Array.from({ length: TETTO_DOCUMENTI_XML_ZIP }, (_, i) => uuid(i)), uuid(0)]
    // Passa il tetto e arriva al database finto: l'errore e quello del finto, non TROPPI_DOCUMENTI.
    const errore = await servizio
      .zip('t', 'u', ids, { confermaEmissione: true })
      .catch((e: unknown) => e)
    expect(errore).not.toBeInstanceOf(BadRequestException)
  })

  it('xml con un id non valido: 404 DOCUMENTO_NON_TROVATO', async () => {
    await expect(
      servizio.xml('t', 'u', 'non-un-uuid', { confermaEmissione: true })
    ).rejects.toMatchObject({
      response: { error: 'DOCUMENTO_NON_TROVATO' },
    })
  })
})
