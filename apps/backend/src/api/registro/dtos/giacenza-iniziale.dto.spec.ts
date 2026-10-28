import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { DECORATORS } from '@nestjs/swagger/dist/constants'
import { CreaGiacenzaInizialeDto, ModificaGiacenzaInizialeDto } from './giacenza-iniziale.dto'

const valido = {
  cerCode: '15 01 10*',
  quantita: 1250.5,
  unita: 'KG',
  dataRiferimento: '2026-01-01',
}

async function campiNonValidi(classe: any, corpo: object): Promise<string[]> {
  const errori = await validate(plainToInstance(classe, corpo), {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  return errori.map(e => e.property).sort()
}

describe('CreaGiacenzaInizialeDto', () => {
  const controlla = (corpo: object) => campiNonValidi(CreaGiacenzaInizialeDto, corpo)

  it('accetta il corpo minimo e quello completo', async () => {
    expect(await controlla(valido)).toEqual([])
    expect(
      await controlla({
        ...valido,
        statoFisico: 'SOLIDO',
        note: 'x'.repeat(500),
        origini: [
          { anno: 2025, protocollo: 12, quantita: 100.25 },
          { anno: 2026, protocollo: 1 },
        ],
      })
    ).toEqual([])
  })

  it('cerCode e unita sono stringhe obbligatorie', async () => {
    expect(await controlla({ ...valido, cerCode: undefined })).toEqual(['cerCode'])
    expect(await controlla({ ...valido, unita: undefined })).toEqual(['unita'])
    expect(await controlla({ ...valido, unita: 'x'.repeat(11) })).toEqual(['unita'])
    expect(await controlla({ ...valido, unita: 5 })).toEqual(['unita'])
  })

  it('quantita: > 0, al più 2 decimali, al massimo 99.999.999,99, solo numeri', async () => {
    for (const quantita of [0, -1, 0.001, 1.234, 100000000, 99999999.995, '10', NaN, null]) {
      expect({ quantita, campi: await controlla({ ...valido, quantita }) }).toEqual({
        quantita,
        campi: ['quantita'],
      })
    }
    for (const quantita of [0.01, 10, 99999999.99]) {
      expect(await controlla({ ...valido, quantita })).toEqual([])
    }
  })

  it('dataRiferimento: solo AAAA-MM-GG di un giorno che esiste (niente ora, niente 30 febbraio)', async () => {
    for (const dataRiferimento of [
      '2026-01-01T00:00:00.000Z',
      '2026-01-01 10:00',
      '01/01/2026',
      '2026-1-1',
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '',
      undefined,
      20260101,
    ]) {
      expect({ dataRiferimento, campi: await controlla({ ...valido, dataRiferimento }) }).toEqual({
        dataRiferimento,
        campi: ['dataRiferimento'],
      })
    }
    expect(await controlla({ ...valido, dataRiferimento: '2024-02-29' })).toEqual([])
  })

  it('statoFisico oltre 50 caratteri e note oltre 500 sono rifiutati', async () => {
    expect(await controlla({ ...valido, statoFisico: 'x'.repeat(51) })).toEqual(['statoFisico'])
    expect(await controlla({ ...valido, note: 'x'.repeat(501) })).toEqual(['note'])
  })

  it('origini: array di voci valide, al più 200', async () => {
    const campi = (origini: unknown) => controlla({ ...valido, origini })
    expect(await campi('non un array')).toEqual(['origini'])
    expect(await campi([{ anno: 2025, protocollo: 0 }])).toEqual(['origini'])
    expect(await campi([{ anno: 1989, protocollo: 1 }])).toEqual(['origini'])
    expect(await campi([{ anno: 2025.5, protocollo: 1 }])).toEqual(['origini'])
    expect(await campi([{ anno: 2025, protocollo: 1, quantita: 0 }])).toEqual(['origini'])
    expect(await campi([{ anno: 2025, protocollo: 1, quantita: 1.234 }])).toEqual(['origini'])
    expect(await campi([{ anno: 2025 }])).toEqual(['origini'])
    expect(await campi([{ anno: 2025, protocollo: 1, extra: true }])).toEqual(['origini'])
    expect(await campi(['stringa'])).toEqual(['origini'])
    expect(
      await campi(Array.from({ length: 201 }, (_, i) => ({ anno: 2025, protocollo: i + 1 })))
    ).toEqual(['origini'])
    expect(
      await campi(Array.from({ length: 200 }, (_, i) => ({ anno: 2025, protocollo: i + 1 })))
    ).toEqual([])
  })

  it('rifiuta campi sconosciuti (tenant, registro, provenienza non si scrivono dal corpo)', async () => {
    expect(await controlla({ ...valido, tenantId: 'x' })).toEqual(['tenantId'])
    expect(await controlla({ ...valido, provenienza: 'IMPORTAZIONE' })).toEqual(['provenienza'])
  })
})

describe('ModificaGiacenzaInizialeDto (sostituzione completa)', () => {
  const controlla = (corpo: object) => campiNonValidi(ModificaGiacenzaInizialeDto, corpo)
  const { cerCode: _cer, ...senzaCer } = valido

  it('quantita, unita e dataRiferimento sono obbligatori', async () => {
    expect(await controlla({})).toEqual(['dataRiferimento', 'quantita', 'unita'])
    expect(await controlla(senzaCer)).toEqual([])
  })

  it('statoFisico, origini e note si possono omettere (il servizio li svuota)', async () => {
    const dto = plainToInstance(ModificaGiacenzaInizialeDto, senzaCer)
    expect(await validate(dto)).toEqual([])
    expect(dto.statoFisico).toBeUndefined()
    expect(dto.origini).toBeUndefined()
    expect(dto.note).toBeUndefined()
  })

  it('il CER non si modifica: cerCode nel corpo è rifiutato', async () => {
    expect(await controlla({ ...senzaCer, cerCode: '15 01 10*' })).toEqual(['cerCode'])
  })

  it('le regole di formato sono quelle della creazione', async () => {
    expect(await controlla({ ...senzaCer, quantita: 0 })).toEqual(['quantita'])
    expect(await controlla({ ...senzaCer, dataRiferimento: '2026-02-30' })).toEqual([
      'dataRiferimento',
    ])
    expect(await controlla({ ...senzaCer, origini: [{ anno: 2025 }] })).toEqual(['origini'])
  })

  it('Swagger documenta i tre campi facoltativi come "omesso = svuotato"', () => {
    for (const campo of ['statoFisico', 'origini', 'note']) {
      const meta = Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES,
        ModificaGiacenzaInizialeDto.prototype,
        campo
      )
      expect(meta.required).toBe(false)
      expect(meta.description).toContain('omesso = svuotato')
    }
    for (const campo of ['quantita', 'unita', 'dataRiferimento']) {
      const meta = Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES,
        ModificaGiacenzaInizialeDto.prototype,
        campo
      )
      expect(meta.required).not.toBe(false)
    }
  })
})
