import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import {
  CambiaStatoContrattoClienteDto,
  CreaContrattoClienteDto,
  ElencoContrattiClienteQueryDto,
  ModificaContrattoClienteDto,
  ProrogaScadenzeDto,
  RinnovaContrattoClienteDto,
} from './contratto-cliente.dto'

async function messaggi<T extends object>(classe: new () => T, corpo: object): Promise<string[]> {
  const errori = await validate(plainToInstance(classe, corpo), {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  const tutti = (e: (typeof errori)[number]): string[] => [
    ...Object.values(e.constraints ?? {}),
    ...(e.children ?? []).flatMap(tutti),
  ]
  return errori.flatMap(tutti)
}

const UUID = '7e7e7e7e-0000-4000-8000-000000000004'
const base = {
  numero: 'CC-2026-001',
  descrizione: 'Contratto di prova',
  clienteId: UUID,
  dataInizio: '2026-01-01',
}

describe('CreaContrattoClienteDto', () => {
  it('il corpo minimo è valido', async () => {
    expect(await messaggi(CreaContrattoClienteDto, base)).toEqual([])
  })

  it('un corpo completo è valido (decimali stringa, periodi, annotazioni, null ammessi)', async () => {
    expect(
      await messaggi(CreaContrattoClienteDto, {
        ...base,
        clienteFatturazioneId: null,
        sedeId: UUID,
        categoriaId: UUID,
        tipoId: null,
        dataFine: '2026-12-31',
        dataStipula: '2025-12-20',
        validitaQuantita: 12,
        validitaUnita: 'M',
        esigibilitaIva: 'SCISSIONE',
        ritenutaPercentuale: '4.50',
        codiceDestinatario: 'ABCDEFG',
        codiceCig: 'ABCDE12345',
        sogliaDal: '2026-03-01',
        sogliaImporto: '1500.00',
        sogliaIvaEsclusa: true,
        rinnovoAutomatico: true,
        codiceRinnovo: 'S',
        incrementoIstat: false,
        commessa: 'COMM-1',
        annotazioni: ['a', 'b', 'c'],
        periodi: [{ giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 }],
      })
    ).toEqual([])
  })

  it.each(['numero', 'descrizione', 'clienteId', 'dataInizio'])('%s è obbligatorio', async c => {
    const corpo: Record<string, unknown> = { ...base }
    delete corpo[c]
    expect((await messaggi(CreaContrattoClienteDto, corpo)).length).toBeGreaterThan(0)
  })

  it('stato nel corpo: rifiutato (un contratto nasce in bozza)', async () => {
    const m = await messaggi(CreaContrattoClienteDto, { ...base, stato: 'ATTIVO' })
    expect(m.join(' ')).toMatch(/stato/)
  })

  it.each([
    ['30 febbraio', '2026-02-30'],
    ['formato italiano', '31/12/2026'],
    ['istante', '2026-12-31T10:00:00Z'],
    ['mese 13', '2026-13-01'],
    ['non stringa', 20261231],
  ])('data di fine %s: errore', async (_n, dataFine) => {
    expect((await messaggi(CreaContrattoClienteDto, { ...base, dataFine })).length).toBeGreaterThan(
      0
    )
  })

  it('data di inizio 2026-02-30: errore', async () => {
    const m = await messaggi(CreaContrattoClienteDto, { ...base, dataInizio: '2026-02-30' })
    expect(m.join(' ')).toMatch(/data/i)
  })

  it('13 periodi: errore in italiano; 12 vanno bene', async () => {
    const p = { giornoInizio: 1, meseInizio: 1, giornoFine: 2, meseFine: 1 }
    const m = await messaggi(CreaContrattoClienteDto, {
      ...base,
      periodi: Array.from({ length: 13 }, () => p),
    })
    expect(m.join(' ')).toContain('Al massimo 12 periodi')
    expect(
      await messaggi(CreaContrattoClienteDto, {
        ...base,
        periodi: Array.from({ length: 12 }, () => p),
      })
    ).toEqual([])
  })

  it.each([
    ['giorno 0', { giornoInizio: 0 }],
    ['giorno 32', { giornoFine: 32 }],
    ['mese 13', { meseInizio: 13 }],
    ['mese 0', { meseFine: 0 }],
    ['giorno decimale', { giornoInizio: 1.5 }],
    ['giorno testo', { giornoInizio: '1' }],
    ['campo extra', { x: 1 }],
  ])('periodo con %s: errore', async (_n, extra) => {
    const periodo = { giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3, ...extra }
    expect(
      (await messaggi(CreaContrattoClienteDto, { ...base, periodi: [periodo] })).length
    ).toBeGreaterThan(0)
  })

  it.each([
    ['ritenuta numerica', { ritenutaPercentuale: 4.5 }],
    ['ritenuta con la virgola', { ritenutaPercentuale: '4,5' }],
    ['ritenuta oltre due cifre intere', { ritenutaPercentuale: '100.00' }],
    ['soglia numerica', { sogliaImporto: 1500 }],
    ['soglia con tre decimali', { sogliaImporto: '1.234' }],
  ])('%s: errore', async (_n, extra) => {
    expect((await messaggi(CreaContrattoClienteDto, { ...base, ...extra })).length).toBeGreaterThan(
      0
    )
  })

  it('4 annotazioni: errore in italiano; una da 46 caratteri: errore', async () => {
    const m = await messaggi(CreaContrattoClienteDto, {
      ...base,
      annotazioni: ['a', 'b', 'c', 'd'],
    })
    expect(m.join(' ')).toContain('Al massimo 3 annotazioni')
    expect(
      (await messaggi(CreaContrattoClienteDto, { ...base, annotazioni: ['x'.repeat(46)] })).length
    ).toBeGreaterThan(0)
    expect(
      await messaggi(CreaContrattoClienteDto, { ...base, annotazioni: ['x'.repeat(45)] })
    ).toEqual([])
  })

  it('annotazioni non array o con elementi non stringa: errore', async () => {
    expect(
      (await messaggi(CreaContrattoClienteDto, { ...base, annotazioni: 'a' })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(CreaContrattoClienteDto, { ...base, annotazioni: [1] })).length
    ).toBeGreaterThan(0)
  })

  it.each([
    ['validitaUnita sconosciuta', { validitaUnita: 'X' }],
    ['codiceRinnovo sconosciuto', { codiceRinnovo: 'X' }],
    ['esigibilità sconosciuta', { esigibilitaIva: 'BOH' }],
    ['durata 0', { validitaQuantita: 0 }],
    ['durata 1000', { validitaQuantita: 1000 }],
    ['durata decimale', { validitaQuantita: 1.5 }],
    ['codice destinatario di 8 caratteri', { codiceDestinatario: 'ABCDEFGH' }],
    ['id non UUID', { agenteId: 'x' }],
    ['booleano come testo', { rinnovoAutomatico: 'si' }],
    ['campo extra', { tenantId: 'x' }],
  ])('%s: errore', async (_n, extra) => {
    expect((await messaggi(CreaContrattoClienteDto, { ...base, ...extra })).length).toBeGreaterThan(
      0
    )
  })

  it.each(['A', 'S', 'M', 'G'])('validitaUnita %s: ammessa', async validitaUnita => {
    expect(
      await messaggi(CreaContrattoClienteDto, { ...base, validitaUnita, validitaQuantita: 1 })
    ).toEqual([])
  })
})

describe('ModificaContrattoClienteDto', () => {
  it('la versione è obbligatoria; il resto è facoltativo', async () => {
    expect(
      (await messaggi(ModificaContrattoClienteDto, { descrizione: 'x' })).length
    ).toBeGreaterThan(0)
    expect(await messaggi(ModificaContrattoClienteDto, { versione: 1 })).toEqual([])
  })

  it('null svuota (date, riferimenti, decimali, elenchi)', async () => {
    expect(
      await messaggi(ModificaContrattoClienteDto, {
        dataFine: null,
        agenteId: null,
        ritenutaPercentuale: null,
        sogliaImporto: null,
        validitaUnita: null,
        validitaQuantita: null,
        versione: 3,
      })
    ).toEqual([])
  })

  it('stato nel corpo: rifiutato', async () => {
    expect(
      (await messaggi(ModificaContrattoClienteDto, { stato: 'ANNULLATO', versione: 1 })).length
    ).toBeGreaterThan(0)
  })

  it('le stesse regole di forma della creazione', async () => {
    expect(
      (await messaggi(ModificaContrattoClienteDto, { dataFine: '2026-02-30', versione: 1 })).length
    ).toBeGreaterThan(0)
    expect(
      (await messaggi(ModificaContrattoClienteDto, { ritenutaPercentuale: 4.5, versione: 1 }))
        .length
    ).toBeGreaterThan(0)
    expect(
      (
        await messaggi(ModificaContrattoClienteDto, {
          annotazioni: ['a', 'b', 'c', 'd'],
          versione: 1,
        })
      ).length
    ).toBeGreaterThan(0)
  })

  it('versione 0 o non intera: errore', async () => {
    for (const versione of [0, 1.5, '1']) {
      expect((await messaggi(ModificaContrattoClienteDto, { versione })).length).toBeGreaterThan(0)
    }
  })
})

describe('CambiaStatoContrattoClienteDto', () => {
  it('stato e versione; motivo e codice facoltativi', async () => {
    expect(
      await messaggi(CambiaStatoContrattoClienteDto, { stato: 'SOSPESO', versione: 1 })
    ).toEqual([])
    expect(
      await messaggi(CambiaStatoContrattoClienteDto, {
        stato: 'ANNULLATO',
        versione: 2,
        motivoAnnulloId: UUID,
        motivo: 'Disdetta',
      })
    ).toEqual([])
    expect(
      await messaggi(CambiaStatoContrattoClienteDto, {
        stato: 'ANNULLATO',
        versione: 2,
        motivoAnnulloId: null,
        motivo: null,
      })
    ).toEqual([])
  })

  it.each([
    ['stato sconosciuto', { stato: 'CHISSA' }],
    ['stato mancante', { stato: undefined }],
    ['versione mancante', { versione: undefined }],
    ['motivoAnnulloId non UUID', { motivoAnnulloId: 'x' }],
    ['motivo di 256 caratteri', { motivo: 'x'.repeat(256) }],
    ['campo extra', { x: 1 }],
  ])('%s: errore', async (_n, extra) => {
    expect(
      (await messaggi(CambiaStatoContrattoClienteDto, { stato: 'SOSPESO', versione: 1, ...extra }))
        .length
    ).toBeGreaterThan(0)
  })

  it('motivo di 255 caratteri: ammesso', async () => {
    expect(
      await messaggi(CambiaStatoContrattoClienteDto, {
        stato: 'ANNULLATO',
        versione: 1,
        motivo: 'x'.repeat(255),
      })
    ).toEqual([])
  })
})

describe('RinnovaContrattoClienteDto', () => {
  it('solo la versione', async () => {
    expect(await messaggi(RinnovaContrattoClienteDto, { versione: 4 })).toEqual([])
    expect((await messaggi(RinnovaContrattoClienteDto, {})).length).toBeGreaterThan(0)
    expect(
      (await messaggi(RinnovaContrattoClienteDto, { versione: 1, x: 1 })).length
    ).toBeGreaterThan(0)
  })
})

describe('ProrogaScadenzeDto', () => {
  it('solo la data è obbligatoria; flag e filtri facoltativi (default di D11 nel controller)', async () => {
    expect(await messaggi(ProrogaScadenzeDto, { scadutiEntro: '2026-12-31' })).toEqual([])
    expect(
      await messaggi(ProrogaScadenzeDto, {
        scadutiEntro: '2026-12-31',
        soloRinnovoAutomatico: false,
        ancheSospesi: true,
        clienteId: UUID,
        categoriaId: UUID,
      })
    ).toEqual([])
  })

  it.each([
    ['data mancante', {}],
    ['30 febbraio', { scadutiEntro: '2026-02-30' }],
    ['formato italiano', { scadutiEntro: '31/12/2026' }],
    ['flag non booleano', { scadutiEntro: '2026-12-31', ancheSospesi: 'si' }],
    ['categoria non UUID', { scadutiEntro: '2026-12-31', categoriaId: 'x' }],
    ['cliente non UUID', { scadutiEntro: '2026-12-31', clienteId: 'x' }],
    ['campo extra', { scadutiEntro: '2026-12-31', tenantId: 'x' }],
  ])('%s: errore', async (_n, corpo) => {
    expect((await messaggi(ProrogaScadenzeDto, corpo)).length).toBeGreaterThan(0)
  })
})

describe('ElencoContrattiClienteQueryDto', () => {
  it('query vuota valida; numeri convertiti da stringa', async () => {
    expect(await messaggi(ElencoContrattiClienteQueryDto, {})).toEqual([])
    const dto = plainToInstance(ElencoContrattiClienteQueryDto, {
      pagina: '2',
      dimensione: '10',
      inScadenzaEntroGiorni: '30',
    })
    expect(dto).toMatchObject({ pagina: 2, dimensione: 10, inScadenzaEntroGiorni: 30 })
  })

  it.each([
    ['clienteId non UUID (R43)', { clienteId: 'x' }],
    ['categoriaId non UUID', { categoriaId: 'x' }],
    ['tipoId non UUID', { tipoId: 'x' }],
    ['stato sconosciuto', { stato: 'X' }],
    ['inScadenzaEntroGiorni negativo (R43)', { inScadenzaEntroGiorni: '-1' }],
    ['inScadenzaEntroGiorni non numerico', { inScadenzaEntroGiorni: 'a' }],
    ['inScadenzaEntroGiorni decimale', { inScadenzaEntroGiorni: '1.5' }],
    ['pagina 0', { pagina: '0' }],
    ['dimensione 101', { dimensione: '101' }],
    ['parametro sconosciuto', { x: '1' }],
  ])('%s: errore', async (_n, query) => {
    expect((await messaggi(ElencoContrattiClienteQueryDto, query)).length).toBeGreaterThan(0)
  })

  it('inScadenzaEntroGiorni 0 è ammesso', async () => {
    expect(await messaggi(ElencoContrattiClienteQueryDto, { inScadenzaEntroGiorni: '0' })).toEqual(
      []
    )
  })
})
