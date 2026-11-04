import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common'
import {
  AnnullaMovimentoDto,
  RettificaMovimentoDto,
  VerificaCatenaQueryDto,
} from './correggi-movimento.dto'

/** La stessa ValidationPipe di main.ts: whitelist, forbidNonWhitelisted, transform. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
const comeCorpo = (metatype: new () => unknown): ArgumentMetadata => ({ type: 'body', metatype })
const comeQuery = (metatype: new () => unknown): ArgumentMetadata => ({ type: 'query', metatype })

const rettifica = {
  movementDate: '2026-03-01',
  causale: 'PRODUZIONE_INTERNA',
  cerCode: '20 03 01',
  quantity: 100,
  motivo: 'Quantità errata',
}

async function messaggi(valore: unknown, meta: ArgumentMetadata): Promise<string[]> {
  try {
    await pipe.transform(valore, meta)
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException)
    const risposta = (e as BadRequestException).getResponse() as { message: string[] }
    return risposta.message
  }
  return []
}

describe('RettificaMovimentoDto', () => {
  it('accetta il corpo completo con motivo e conferma', async () => {
    const dto = (await pipe.transform(
      { ...rettifica, confermaAnnoPresentato: true, unit: 'KG', notes: 'x' },
      comeCorpo(RettificaMovimentoDto)
    )) as RettificaMovimentoDto
    expect(dto).toBeInstanceOf(RettificaMovimentoDto)
    expect(dto.confermaAnnoPresentato).toBe(true)
  })

  it('accetta il blocco legame (4.3b) e lo respinge se l’azione non è valida', async () => {
    const dto = (await pipe.transform(
      {
        ...rettifica,
        legame: {
          azione: 'CONFERMA',
          righe: [{ rigaAddebitoId: '11111111-1111-4111-8111-111111111111', quantita: '5' }],
        },
      },
      comeCorpo(RettificaMovimentoDto)
    )) as RettificaMovimentoDto
    expect(dto.legame?.azione).toBe('CONFERMA')
    const errori = await messaggi(
      { ...rettifica, legame: { azione: 'BOH' } },
      comeCorpo(RettificaMovimentoDto)
    )
    expect(errori.join(' ')).toMatch(/azione/)
  })

  it.each(['type', 'registroId', 'firId', 'registrationDate'])(
    '%s nel corpo è respinto (forbidNonWhitelisted)',
    async campo => {
      const valore =
        campo === 'type'
          ? 'CARICO'
          : campo === 'registrationDate'
            ? '2026-03-01'
            : '11111111-1111-4111-8111-111111111111'
      const errori = await messaggi(
        { ...rettifica, [campo]: valore },
        comeCorpo(RettificaMovimentoDto)
      )
      expect(errori).toEqual([`property ${campo} should not exist`])
    }
  )

  it('conserva le regole di RegistraMovimentoDto (quantità, data, causale, CER)', async () => {
    for (const cattivo of [
      { quantity: 0 },
      { quantity: 1.005 },
      { movementDate: 'ieri' },
      { causale: 'pippo' },
      { causale: '' },
      { cerCode: '' },
    ]) {
      const errori = await messaggi({ ...rettifica, ...cattivo }, comeCorpo(RettificaMovimentoDto))
      expect({ cattivo, rifiutato: errori.length > 0 }).toEqual({ cattivo, rifiutato: true })
    }
  })

  it('il motivo è obbligatorio, 1..500 dopo il trim', async () => {
    const { motivo: _m, ...senza } = rettifica
    expect((await messaggi(senza, comeCorpo(RettificaMovimentoDto))).length).toBeGreaterThan(0)
    for (const m of ['', '   ', 'a'.repeat(501), 7]) {
      const errori = await messaggi({ ...rettifica, motivo: m }, comeCorpo(RettificaMovimentoDto))
      expect({ m, rifiutato: errori.length > 0 }).toEqual({ m, rifiutato: true })
    }
    const dto = (await pipe.transform(
      { ...rettifica, motivo: `  ${'a'.repeat(500)}  ` },
      comeCorpo(RettificaMovimentoDto)
    )) as RettificaMovimentoDto
    expect(dto.motivo).toBe('a'.repeat(500))
  })

  it('confermaAnnoPresentato deve essere booleano', async () => {
    const errori = await messaggi(
      { ...rettifica, confermaAnnoPresentato: 'true' },
      comeCorpo(RettificaMovimentoDto)
    )
    expect(errori).toEqual(['confermaAnnoPresentato must be a boolean value'])
  })
})

describe('AnnullaMovimentoDto', () => {
  it('accetta motivo (con trim) e conferma facoltativa', async () => {
    const dto = (await pipe.transform(
      { motivo: '  Registrato per errore ' },
      comeCorpo(AnnullaMovimentoDto)
    )) as AnnullaMovimentoDto
    expect(dto.motivo).toBe('Registrato per errore')
    expect(dto.confermaAnnoPresentato).toBeUndefined()
  })

  it('rifiuta motivo vuoto o solo spazi, troppo lungo, e qualunque altro campo', async () => {
    for (const corpo of [
      {},
      { motivo: '' },
      { motivo: '  ' },
      { motivo: 'a'.repeat(501) },
      { motivo: 'x', quantity: 5 },
      { motivo: 'x', tenantId: 'altra' },
    ]) {
      const errori = await messaggi(corpo, comeCorpo(AnnullaMovimentoDto))
      expect({ corpo, rifiutato: errori.length > 0 }).toEqual({ corpo, rifiutato: true })
    }
  })
})

describe('VerificaCatenaQueryDto', () => {
  it('anno intero da 2000 (stringa della query convertita), registroId facoltativo uuid', async () => {
    const dto = (await pipe.transform(
      { anno: '2026', registroId: '11111111-1111-4111-8111-111111111111' },
      comeQuery(VerificaCatenaQueryDto)
    )) as VerificaCatenaQueryDto
    expect(dto.anno).toBe(2026)
    expect(
      (
        (await pipe.transform(
          { anno: '2000' },
          comeQuery(VerificaCatenaQueryDto)
        )) as VerificaCatenaQueryDto
      ).anno
    ).toBe(2000)
  })

  it('rifiuta anno mancante, non intero, prima del 2000; registroId non uuid; campi estranei', async () => {
    for (const q of [
      {},
      { anno: '' },
      { anno: 'abc' },
      { anno: '2026.5' },
      { anno: '1999' },
      { anno: '-1' },
      { anno: '2026', registroId: 'x' },
      { anno: '2026', altro: '1' },
    ]) {
      const errori = await messaggi(q, comeQuery(VerificaCatenaQueryDto))
      expect({ q, rifiutato: errori.length > 0 }).toEqual({ q, rifiutato: true })
    }
  })
})
