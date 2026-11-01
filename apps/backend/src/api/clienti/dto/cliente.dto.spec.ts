import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreaClienteDto, ElencoClientiQueryDto, ModificaClienteDto } from './cliente.dto'

async function messaggi<T extends object>(classe: new () => T, corpo: object): Promise<string[]> {
  const errori = await validate(plainToInstance(classe, corpo), {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  return errori.flatMap(e => Object.values(e.constraints ?? {}))
}

const UUID = '7e7e7e7e-0000-4000-8000-000000000004'
const base = {
  ragioneSociale: 'Cliente Rossi',
  partitaIva: '12345678903',
  indirizzo: { via: 'Via Roma', civico: '1', cap: '00100', comune: 'Roma', provincia: 'RM' },
}

describe('ModificaClienteDto', () => {
  it('la versione è obbligatoria', async () => {
    expect((await messaggi(ModificaClienteDto, { note: 'x' })).length).toBeGreaterThan(0)
    expect(await messaggi(ModificaClienteDto, { versione: 1 })).toEqual([])
  })

  it('rifiuta gli identificativi della ditta e l’indirizzo (forbidNonWhitelisted)', async () => {
    expect(
      (await messaggi(ModificaClienteDto, { partitaIva: '12345678903', versione: 1 })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(ModificaClienteDto, { codiceFiscale: 'X', versione: 1 })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(ModificaClienteDto, { indirizzo: {}, versione: 1 })).length
    ).toBeGreaterThan(0)
  })

  it('null su iban e sugli altri campi fiscali è accettato (svuota)', async () => {
    const m = await messaggi(ModificaClienteDto, {
      iban: null,
      pecFatturazione: null,
      codiceDestinatario: null,
      contoCorrenteId: null,
      agenteId: null,
      ritenutaPercentuale: null,
      nome: null,
      versione: 1,
    })
    expect(m).toEqual([])
  })

  it('codice destinatario di 8 caratteri: errore di lunghezza', async () => {
    const m = await messaggi(ModificaClienteDto, { codiceDestinatario: 'ABCDEFGH', versione: 1 })
    expect(m.join(' ')).toMatch(/7 caratteri/)
  })

  it('ritenuta numerica rifiutata: deve essere una stringa col punto', async () => {
    expect(
      (await messaggi(ModificaClienteDto, { ritenutaPercentuale: 4.5, versione: 1 })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(ModificaClienteDto, { ritenutaPercentuale: '4,5', versione: 1 })).length
    ).toBeGreaterThan(0)
    expect(
      await messaggi(ModificaClienteDto, { ritenutaPercentuale: '4.50', versione: 1 })
    ).toEqual([])
  })

  it('riferimenti UUID, esigibilità ammessa, attivo booleano', async () => {
    expect(
      (await messaggi(ModificaClienteDto, { agenteId: 'x', versione: 1 })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(ModificaClienteDto, { esigibilitaIva: 'BOH', versione: 1 })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(ModificaClienteDto, { attivo: null, versione: 1 })).length
    ).toBeGreaterThan(0)
    expect(
      await messaggi(ModificaClienteDto, {
        agenteId: UUID,
        esigibilitaIva: 'SCISSIONE',
        attivo: false,
        sedeId: UUID,
        versione: 3,
      })
    ).toEqual([])
  })
})

describe('CreaClienteDto', () => {
  it('corpo minimo e corpo completo validi', async () => {
    expect(await messaggi(CreaClienteDto, base)).toEqual([])
    expect(
      await messaggi(CreaClienteDto, {
        ...base,
        codiceFiscale: null,
        denominazione: 'Sede',
        referente: 'Mario',
        email: 'a@b.it',
        codice: 'CL1',
        codiceDestinatario: 'ABCDEFG',
        iban: 'IT60X0542811101000000123456',
        esigibilitaIva: 'DIFFERITA',
        ritenutaPercentuale: '4.5',
        nome: 'Mario',
        cognome: 'Rossi',
        sedeId: UUID,
      })
    ).toEqual([])
  })

  it('rifiuta campi extra, codice destinatario lungo, ritenuta numerica', async () => {
    expect((await messaggi(CreaClienteDto, { ...base, tenantId: 'x' })).length).toBeGreaterThan(0)
    expect(
      (await messaggi(CreaClienteDto, { ...base, codiceDestinatario: 'ABCDEFGH' })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(CreaClienteDto, { ...base, ritenutaPercentuale: 4 })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(CreaClienteDto, { ...base, ragioneSociale: undefined })).length
    ).toBeGreaterThan(0)
  })
})

describe('ElencoClientiQueryDto', () => {
  it('booleano come stringa, numeri convertiti', async () => {
    const dto = plainToInstance(ElencoClientiQueryDto, { soloAttivi: 'true', pagina: '2' })
    expect(await validate(dto)).toEqual([])
    expect(dto.pagina).toBe(2)
    expect((await messaggi(ElencoClientiQueryDto, { soloAttivi: 'si' })).length).toBeGreaterThan(0)
  })
})
