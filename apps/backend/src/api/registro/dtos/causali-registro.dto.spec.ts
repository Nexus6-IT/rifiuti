import { BadRequestException, ValidationPipe } from '@nestjs/common'
import {
  ChiudiCausaleDto,
  CreaCausaleAziendaleDto,
  ListaCausaliQueryDto,
  ModificaCausaleAziendaleDto,
  NuovaVersioneCausaleDto,
} from './causali-registro.dto'

// La pipe di main.ts, non la sola `validate`: e' lei a trasformare (trim) e a respingere i campi in piu.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })

async function passa<T>(metatype: new () => T, corpo: object, type: 'body' | 'query' = 'body') {
  return (await pipe.transform(corpo, { type, metatype })) as T & Record<string, unknown>
}

async function messaggi(
  metatype: new () => unknown,
  corpo: object,
  type: 'body' | 'query' = 'body'
) {
  try {
    await pipe.transform(corpo, { type, metatype })
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException)
    return ((e as BadRequestException).getResponse() as { message: string[] }).message.join(' | ')
  }
  throw new Error('la validazione doveva fallire')
}

const valida = {
  codice: 'AZ_RESO_CLIENTE',
  verso: 'CARICO',
  descrizione: 'Reso da cliente',
  ruoloMud: 'RICEVUTO_DA_TERZI',
}

describe('CreaCausaleAziendaleDto', () => {
  it('accetta il minimo e il massimo dei campi', async () => {
    await expect(passa(CreaCausaleAziendaleDto, valida)).resolves.toMatchObject(valida)
    await expect(
      passa(CreaCausaleAziendaleDto, {
        ...valida,
        codiceRentri: 'T*',
        operazione: undefined,
        ordine: 9999,
        validaDal: '2026-02-28',
      })
    ).resolves.toMatchObject({ codiceRentri: 'T*', ordine: 9999 })
    await expect(
      passa(CreaCausaleAziendaleDto, {
        ...valida,
        verso: 'SCARICO',
        ruoloMud: 'AVVIATO',
        operazione: 'D',
        codiceRentri: 'aT',
        ordine: 0,
      })
    ).resolves.toBeDefined()
  })

  it('taglia gli spazi della descrizione e rifiuta quella vuota o oltre 200', async () => {
    const r = await passa(CreaCausaleAziendaleDto, { ...valida, descrizione: '  Reso  ' })
    expect(r.descrizione).toBe('Reso')
    expect(await messaggi(CreaCausaleAziendaleDto, { ...valida, descrizione: '   ' })).toMatch(
      /descrizione/
    )
    expect(
      await messaggi(CreaCausaleAziendaleDto, { ...valida, descrizione: 'x'.repeat(201) })
    ).toMatch(/descrizione/)
  })

  it.each([
    ['codice', 'RESO'],
    ['codice', 'AZ_a'],
    ['codice', 'AZ_X'],
    ['codice', 'AZ_' + 'A'.repeat(41)],
    ['verso', 'TR'],
    ['ruoloMud', 'ALTRO'],
    ['codiceRentri', 'TR'],
    ['codiceRentri', 'AT'],
    ['operazione', 'X'],
    ['ordine', -1],
    ['ordine', 10000],
    ['ordine', 1.5],
    ['validaDal', '2026-02-30'],
    ['validaDal', '28/10/2026'],
    ['validaDal', '2026-2-3'],
  ])('rifiuta %s = %p', async (campo, valore) => {
    expect(await messaggi(CreaCausaleAziendaleDto, { ...valida, [campo]: valore })).toMatch(
      new RegExp(campo)
    )
  })

  it('rifiuta i campi in piu e quelli mancanti', async () => {
    expect(await messaggi(CreaCausaleAziendaleDto, { ...valida, natura: 'PROPRIA' })).toMatch(
      /natura/
    )
    const { codice: _c, ...senza } = valida
    expect(await messaggi(CreaCausaleAziendaleDto, senza)).toMatch(/codice/)
  })
})

describe('ModificaCausaleAziendaleDto (PATCH: assente = invariato, null = azzera)', () => {
  it('un corpo vuoto resta vuoto: nessun campo compare', async () => {
    const r = await passa(ModificaCausaleAziendaleDto, {})
    expect(Object.keys(r)).toEqual([])
  })

  it('null arriva al servizio per codiceRentri e operazione, e un campo assente resta assente', async () => {
    const r = await passa(ModificaCausaleAziendaleDto, { codiceRentri: null, operazione: null })
    expect(r.codiceRentri).toBeNull()
    expect(r.operazione).toBeNull()
    expect('descrizione' in r).toBe(false)
    expect('ordine' in r).toBe(false)
    const solo = await passa(ModificaCausaleAziendaleDto, { operazione: 'R' })
    expect('codiceRentri' in solo).toBe(false)
    expect(solo.codiceRentri).toBeUndefined()
  })

  it.each(['descrizione', 'ordine', 'ruoloMud', 'validaDal'])(
    'null su %s e un 400',
    async campo => {
      expect(await messaggi(ModificaCausaleAziendaleDto, { [campo]: null })).toMatch(
        new RegExp(campo)
      )
    }
  )

  it('valida i valori presenti', async () => {
    expect(await messaggi(ModificaCausaleAziendaleDto, { codiceRentri: 'XX' })).toMatch(
      /codiceRentri/
    )
    expect(await messaggi(ModificaCausaleAziendaleDto, { operazione: 'Q' })).toMatch(/operazione/)
    expect(await messaggi(ModificaCausaleAziendaleDto, { descrizione: '  ' })).toMatch(
      /descrizione/
    )
    expect(await messaggi(ModificaCausaleAziendaleDto, { ordine: 10000 })).toMatch(/ordine/)
    expect(await messaggi(ModificaCausaleAziendaleDto, { validaDal: '2026-13-01' })).toMatch(
      /validaDal/
    )
    expect(await messaggi(ModificaCausaleAziendaleDto, { ruoloMud: 'X' })).toMatch(/ruoloMud/)
    expect(await messaggi(ModificaCausaleAziendaleDto, { codice: 'AZ_NUOVO' })).toMatch(/codice/)
  })
})

describe('NuovaVersioneCausaleDto, ChiudiCausaleDto, ListaCausaliQueryDto', () => {
  it('nuova versione: validaDal e ruoloMud obbligatori, il resto facoltativo', async () => {
    await expect(
      passa(NuovaVersioneCausaleDto, { validaDal: '2026-11-01', ruoloMud: 'ESCLUSO' })
    ).resolves.toBeDefined()
    expect(await messaggi(NuovaVersioneCausaleDto, { ruoloMud: 'ESCLUSO' })).toMatch(/validaDal/)
    expect(await messaggi(NuovaVersioneCausaleDto, { validaDal: '2026-11-01' })).toMatch(/ruoloMud/)
  })

  it.each(['descrizione', 'ordine'])('nuova versione: null su %s e un 400', async campo => {
    const base = { validaDal: '2026-11-01', ruoloMud: 'ESCLUSO' }
    expect(await messaggi(NuovaVersioneCausaleDto, { ...base, [campo]: null })).toMatch(
      new RegExp(campo)
    )
  })

  it('chiusura: data reale', async () => {
    await expect(passa(ChiudiCausaleDto, { validaAl: '2024-02-29' })).resolves.toBeDefined()
    expect(await messaggi(ChiudiCausaleDto, { validaAl: '2026-02-29' })).toMatch(/validaAl/)
    expect(await messaggi(ChiudiCausaleDto, {})).toMatch(/validaAl/)
  })

  it('query: tipo obbligatorio, data facoltativa e reale', async () => {
    await expect(passa(ListaCausaliQueryDto, { tipo: 'SCARICO' }, 'query')).resolves.toBeDefined()
    await expect(
      passa(ListaCausaliQueryDto, { tipo: 'CARICO', data: '2026-10-28' }, 'query')
    ).resolves.toBeDefined()
    expect(await messaggi(ListaCausaliQueryDto, {}, 'query')).toMatch(/tipo/)
    expect(
      await messaggi(ListaCausaliQueryDto, { tipo: 'CARICO', data: '2026-04-31' }, 'query')
    ).toMatch(/data/)
  })
})
