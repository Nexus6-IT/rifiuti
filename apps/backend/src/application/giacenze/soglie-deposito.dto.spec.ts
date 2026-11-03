import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { SoglieDepositoDto } from './soglie-deposito.dto'
import { SoglieNonValideError, SoglieDepositoService } from './soglie-deposito.service'

// La pipe di main.ts, non la sola `validate`: trasforma (trim) e respinge i campi in piu.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })

const valida = {
  criterio: 'TEMPORALE',
  giorniMax: 60,
  kgMaxTotale: 25000,
  kgMaxPericolosi: 8000,
  preavvisoGiorni: 10,
  preavvisoPercentuale: 75,
}

const passa = (corpo: object) =>
  pipe.transform(corpo, { type: 'body', metatype: SoglieDepositoDto }) as Promise<SoglieDepositoDto>

async function messaggi(corpo: object): Promise<string> {
  try {
    await passa(corpo)
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException)
    return ((e as BadRequestException).getResponse() as { message: string[] }).message.join(' | ')
  }
  throw new Error('la validazione doveva fallire')
}

describe('SoglieDepositoDto', () => {
  it('accetta un corpo completo; la nota viene ripulita dagli spazi', async () => {
    const dto = await passa({ ...valida, note: '  1 m3 = 800 kg  ' })
    expect(dto).toMatchObject({ ...valida, note: '1 m3 = 800 kg' })
  })

  it('giorniMax null accettato (nessuna soglia aggiuntiva)', async () => {
    await expect(passa({ ...valida, giorniMax: null })).resolves.toMatchObject({ giorniMax: null })
  })

  it('giorniMax assente: 400 (un PUT non lascia mai il valore precedente per dimenticanza)', async () => {
    const { giorniMax: _g, ...senza } = valida
    expect(await messaggi(senza)).toContain('giorniMax')
  })

  it('giorniMax 93 o 0 o non intero: 400 dal DTO; 92 e 1 passano', async () => {
    expect(await messaggi({ ...valida, giorniMax: 93 })).toContain('giorniMax')
    expect(await messaggi({ ...valida, giorniMax: 0 })).toContain('giorniMax')
    expect(await messaggi({ ...valida, giorniMax: 30.5 })).toContain('giorniMax')
    await expect(passa({ ...valida, giorniMax: 92, preavvisoGiorni: 0 })).resolves.toBeDefined()
    await expect(passa({ ...valida, giorniMax: 1, preavvisoGiorni: 0 })).resolves.toBeDefined()
  })

  it('campo sconosciuto: 400', async () => {
    expect(await messaggi({ ...valida, tenantId: 'x' })).toContain('tenantId')
  })

  it('criterio non valido, kg non positivi o con tre decimali, interi fuori scala: 400', async () => {
    expect(await messaggi({ ...valida, criterio: 'ALTRO' })).toContain('criterio')
    expect(await messaggi({ ...valida, kgMaxTotale: 0 })).toContain('kgMaxTotale')
    expect(await messaggi({ ...valida, kgMaxTotale: 10.123 })).toContain('Il limite totale in kg')
    expect(await messaggi({ ...valida, kgMaxPericolosi: -1 })).toContain('kgMaxPericolosi')
    expect(await messaggi({ ...valida, preavvisoGiorni: 89 })).toContain('preavvisoGiorni')
    expect(await messaggi({ ...valida, preavvisoPercentuale: 100 })).toContain(
      'preavvisoPercentuale'
    )
  })

  it('nota oltre 500 caratteri: 400', async () => {
    expect(await messaggi({ ...valida, note: 'x'.repeat(501) })).toContain('note')
  })

  it('un preavviso di 30 giorni con giorniMax 30 passa il DTO, ma il servizio risponde 400 col messaggio', async () => {
    const dto = await passa({ ...valida, giorniMax: 30, preavvisoGiorni: 30 })
    const servizio = new SoglieDepositoService({} as never)
    const p = servizio.imposta('t', 'u', null, dto)
    await expect(p).rejects.toBeInstanceOf(SoglieNonValideError)
    await p.catch(e => expect((e as SoglieNonValideError).messaggi.join(' ')).toMatch(/preavviso/i))
  })
})
