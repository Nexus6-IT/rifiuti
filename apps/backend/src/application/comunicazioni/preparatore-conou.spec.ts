import type { AnagraficaComunicazioniSede } from '@prisma/client'
import type { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type { ConfigurazioneConou } from '../../domain/comunicazioni/configurazione-sede'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import type { ContestoPreparazione } from './comunicazioni-tracciato.port'
import type { DettagliTracciato, FirDettaglio, SedeDettaglio } from './lettore-dettagli-tracciato'
import type { MovimentoOrso } from './lettore-movimenti-orso'
import { PreparatoreConou } from './preparatore-conou'

const prismaFinto = {
  istatComune: {
    findMany: jest.fn().mockResolvedValue([
      { code: '016024', name: 'Bergamo', provinciaSigla: 'BG', cap: '24100' },
      { code: '015146', name: 'Milano', provinciaSigla: 'MI', cap: '20100' },
    ]),
  },
  istatProvincia: {
    findMany: jest.fn().mockResolvedValue([
      { sigla: 'BG', code: '016', regione: 'Lombardia' },
      { sigla: 'MI', code: '015', regione: 'Lombardia' },
    ]),
  },
} as unknown as PrismaService
const preparatore = new PreparatoreConou(prismaFinto)

const anagrafica = (o: Partial<AnagraficaComunicazioniSede> = {}): AnagraficaComunicazioniSede =>
  ({
    id: 'a1',
    tenantId: 't',
    sedeDittaId: 's1',
    eComune: false,
    codiceIstatComune: null,
    codiceAteco: '45.20.10',
    codiceOrso: null,
    alboDataIscrizione: null,
    alboClassi: null,
    autorizzazioneData: null,
    legaleRappresentanteCognome: null,
    legaleRappresentanteNome: null,
    esclusaOrr: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as AnagraficaComunicazioniSede

const sede = (o: Partial<SedeDettaglio> = {}): SedeDettaglio => ({
  id: 's1',
  dittaId: 'd1',
  denominazione: null,
  via: 'VIA ROMA',
  civico: '12',
  cap: '24100',
  comune: 'Bergamo',
  provincia: 'BG',
  telefono: null,
  principale: true,
  ditta: {
    id: 'd1',
    ragioneSociale: 'OFFICINA ROSSI SRL',
    partitaIva: '01234567890',
    codiceFiscale: '01234567890',
  },
  anagrafica: anagrafica(),
  ...o,
})

const fir = (o: Partial<FirDettaglio> = {}): FirDettaglio => ({
  id: 'f1',
  firNumero: 'ABC123/26',
  transportDate: new Date('2026-05-09T08:00:00Z'),
  actualArrivalDate: null,
  producerSedeId: 's1',
  receiverSedeId: 's1',
  producerCodiceFiscale: '01234567890',
  carrierCodiceFiscale: '09876543210',
  receiverCodiceFiscale: '01234567890',
  producerPartitaIva: '01234567890',
  carrierPartitaIva: '09876543210',
  receiverPartitaIva: '01234567890',
  producerName: 'x',
  carrierName: 'y',
  receiverName: 'z',
  producerAddress: '',
  receiverAddress: '',
  carrierId: null,
  receiverId: null,
  carrierVehiclePlate: 'AB 123 CD',
  wasteOperationCode: null,
  trasportatore1: null,
  ...o,
})

const movimento = (o: Partial<MovimentoOrso> = {}): MovimentoOrso => ({
  id: 'm1',
  registroId: 'r1',
  tipo: 'CARICO',
  movementDate: new Date('2026-05-10T08:00:00Z'),
  cer: '130205',
  pericoloso: true,
  descrizione: null,
  quantita: 1500,
  unita: 'KG',
  kg: 1500,
  ruolo: 'RICEVUTO_DA_TERZI',
  operazione: 'R',
  origineOperazione: 'NON_INDICATA',
  operationCode: null,
  conFir: true,
  firId: 'f1',
  provinciaConferitore: null,
  provinciaDaIndirizzo: false,
  numero: '17/2026',
  radiceId: 'm1',
  causale: 'INGRESSO_ESTERNO',
  controparte: null,
  indirizzoControparte: null,
  firNumero: 'ABC123/26',
  ...o,
})

function ctx(
  movimenti: MovimentoOrso[],
  opzioni: {
    config?: Partial<ConfigurazioneConou>
    dati?: Record<string, unknown>
    sedi?: SedeDettaglio[]
    fir?: FirDettaglio[]
  } = {}
): ContestoPreparazione<ConfigurazioneConou> {
  const sedi = opzioni.sedi ?? [sede()]
  const dettagli: DettagliTracciato = {
    fir: new Map((opzioni.fir ?? [fir()]).map(f => [f.id, f])),
    sedi: new Map(sedi.map(s => [s.id, s])),
    sedeLegalePerDitta: new Map(sedi.filter(s => s.principale).map(s => [s.dittaId, s])),
    trasportatori: new Map(),
    destinatari: new Map(),
    datiTracciato: new Map(Object.entries(opzioni.dati ?? {}) as [string, never][]),
  }
  return {
    tenantId: 't',
    azienda: {
      partitaIva: '99999999999',
      codiceFiscale: null,
      ragioneSociale: 'NOI SRL',
      atecoCode: null,
      legaleRappresentanteCognome: null,
      legaleRappresentanteNome: null,
    },
    unita: {
      id: 'u1',
      denominazione: 'Sede',
      numIscrSito: 'X',
      indirizzo: null,
      civico: null,
      cap: null,
      comune: null,
      provincia: null,
      progressivoMud: null,
    },
    periodo: { da: '2026-05-01', a: '2026-05-31' },
    parametri: {},
    movimenti,
    dettagli,
    configurazione: {
      codiceDeposito: 'BG001',
      predefinitiPerCer: {},
      ...opzioni.config,
    } as ConfigurazioneConou,
    catalogo: {} as CatalogoCausali,
  }
}

const codici = (p: { avvisi: Array<{ codice: string; bloccante: boolean }> }) =>
  p.avvisi.filter(a => a.bloccante).map(a => a.codice)

describe('PreparatoreConou', () => {
  it('descrive il tracciato e il file', () => {
    expect(preparatore.consorzio).toBe('CONOU')
    expect(preparatore.versione).toBe('Movi2023-ww1')
    expect(preparatore.nomeTracciato()).toBe('Movi2023')
    expect(preparatore.nomeFile()).toBe('Movi.txt')
    expect(preparatore.selezione).toEqual({ tipo: 'MARCATI', consorzio: 'CONOU' })
  })

  it('il periodo deve stare nello stesso anno (come WinWaste)', () => {
    const r = { consorzio: 'CONOU', unitaLocaleId: 'u', da: '2026-12-01', a: '2027-01-31' }
    expect(preparatore.validaRichiesta(r)).toHaveLength(1)
    expect(preparatore.validaRichiesta({ ...r, a: '2026-12-31' })).toEqual([])
  })

  it('compone la riga: prodotto unico dalla tabella, percentuale dal predefinito della sede', async () => {
    const p = await preparatore.prepara(
      ctx([movimento()], {
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 84.99 } } },
      })
    )
    expect(codici(p)).toEqual([])
    expect(p.dati.righe).toHaveLength(1)
    expect(p.dati.righe[0]).toMatchObject({
      cfDetentore: '01234567890',
      ragioneSociale: 'OFFICINA ROSSI SRL',
      ateco: '45.20.10',
      istat: '003016024',
      codiceDeposito: 'BG001',
      dataRegistrazione: '2026-05-10',
      serie: 'ABC',
      numero: '123',
      anno: '2026',
      dataFormulario: '2026-05-09',
      cfTrasportatore: '09876543210',
      targa: 'AB123CD',
      cer: '130205',
      percentualeX100: 8499,
      protocollo: 17,
      quantitaKg: 1500,
      prodotto: 'A',
      causale: 'E',
    })
    expect(p.movimentiInFile).toHaveLength(1)
  })

  it('la correzione sul movimento vince sui predefiniti della sede', async () => {
    const p = await preparatore.prepara(
      ctx([movimento()], {
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 84.99 } } },
        dati: { m1: { prodotto: 'B', percentualeOlio: 70, causale: 'M' } },
      })
    )
    expect(p.dati.righe[0]).toMatchObject({ prodotto: 'B', percentualeX100: 7000, causale: 'M' })
    // B con CER 130205 (solo A ammesso): avviso informativo, non bloccante.
    expect(p.avvisi.find(a => a.codice === 'PRODOTTO_FUORI_TABELLA')?.bloccante).toBe(false)
  })

  it('scarico interno: quantita negativa, causale U, controparte dal destinatario', async () => {
    const m = movimento({ tipo: 'SCARICO', ruolo: 'AVVIATO' })
    const p = await preparatore.prepara(
      ctx([m], {
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } } },
        dati: { m1: { scaricoInterno: true } },
      })
    )
    expect(p.dati.righe[0]).toMatchObject({ quantitaKg: -1500, causale: 'U' })
  })

  it('formulario forzato sul movimento vince sul numero del FIR', async () => {
    const p = await preparatore.prepara(
      ctx([movimento()], {
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } } },
        dati: { m1: { formulario: { serie: 'XY', numero: '99', anno: '2026' } } },
      })
    )
    expect(p.dati.righe[0]).toMatchObject({ serie: 'XY', numero: '99', anno: '2026' })
  })

  it('bonifica: il detentore diventa il comune di raccolta indicato', async () => {
    const p = await preparatore.prepara(
      ctx([movimento()], {
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } } },
        dati: {
          m1: {
            causale: 'B',
            comuneRaccolta: { istat: '015146', indirizzo: 'PIAZZA DUOMO', civico: '1' },
          },
        },
      })
    )
    expect(codici(p)).toEqual([])
    expect(p.dati.righe[0]).toMatchObject({
      causale: 'B',
      // Come WinWaste: la ragione sociale resta quella del detentore.
      ragioneSociale: 'OFFICINA ROSSI SRL',
      indirizzo: 'PIAZZA DUOMO',
      civico: '1',
      cap: '20100',
      provincia: 'MI',
      comune: 'Milano',
      istat: '003015146',
    })
  })

  it('senza FIR: detentore non identificato, bloccante, con il movimento', async () => {
    const p = await preparatore.prepara(
      ctx([movimento({ firId: null, conFir: false })], {
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } } },
      })
    )
    expect(codici(p)).toContain('SOGGETTO_NON_IDENTIFICATO')
    const a = p.avvisi.find(x => x.codice === 'SOGGETTO_NON_IDENTIFICATO')
    expect(a?.movimentoIds).toEqual(['m1'])
    expect(a?.movimenti?.[0]).toMatchObject({
      data: '2026-05-10',
      numero: '17/2026',
      cer: '130205',
    })
  })

  it('segnala prodotto e percentuale mancanti, ATECO e ISTAT mancanti con il link alla sede', async () => {
    const s = sede({ anagrafica: null, comune: 'Inesistente' })
    const p = await preparatore.prepara(ctx([movimento({ cer: '130101' })], { sedi: [s] }))
    expect(codici(p)).toEqual(
      expect.arrayContaining([
        'PRODOTTO_MANCANTE',
        'PERCENTUALE_OLIO_MANCANTE',
        'ATECO_MANCANTE',
        'ISTAT_NON_TROVATO',
      ])
    )
    expect(p.avvisi.find(a => a.codice === 'ATECO_MANCANTE')?.correzione).toEqual({
      tipo: 'ANAGRAFICA_SEDE',
      sedeDittaId: 's1',
    })
    expect(p.avvisi.find(a => a.codice === 'PRODOTTO_MANCANTE')?.correzione).toEqual({
      tipo: 'MOVIMENTO',
    })
  })

  it('codice deposito mancante: un solo avviso di sede, con il link alla configurazione', async () => {
    const p = await preparatore.prepara(
      ctx([movimento(), movimento({ id: 'm2', radiceId: 'm2', numero: '18/2026' })], {
        config: {
          codiceDeposito: undefined,
          predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } },
        },
      })
    )
    const avvisi = p.avvisi.filter(a => a.codice === 'CODICE_DEPOSITO_MANCANTE')
    expect(avvisi).toHaveLength(1)
    expect(avvisi[0]).toMatchObject({
      bloccante: true,
      correzione: { tipo: 'CONFIGURAZIONE_SEDE' },
    })
    expect(codici(p).filter(c => c === 'RIGA_NON_VALIDA')).toEqual([])
  })

  it('privato (persona fisica senza partita IVA): ATECO 0000', async () => {
    const s = sede({
      anagrafica: null,
      ditta: {
        id: 'd1',
        ragioneSociale: 'MARIO ROSSI',
        partitaIva: null,
        codiceFiscale: 'RSSMRA80A01H501U',
      },
    })
    const p = await preparatore.prepara(
      ctx([movimento()], {
        sedi: [s],
        fir: [fir({ producerCodiceFiscale: 'RSSMRA80A01H501U', producerPartitaIva: '' })],
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } } },
      })
    )
    expect(codici(p)).toEqual([])
    expect(p.dati.righe[0].ateco).toBe('0000')
  })

  it('un FIR senza serie e senza trasportatore produce errori di riga per movimento', async () => {
    const p = await preparatore.prepara(
      ctx([movimento()], {
        fir: [
          fir({
            firNumero: '000123',
            carrierCodiceFiscale: null,
            carrierPartitaIva: '',
            carrierVehiclePlate: '',
          }),
        ],
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } } },
      })
    )
    const msg = p.avvisi.filter(a => a.codice === 'RIGA_NON_VALIDA').map(a => a.messaggio)
    expect(msg).toEqual(
      expect.arrayContaining([
        'Manca Serie Formulario',
        'Manca Codice Fiscale Trasportatore',
        'Manca Targa',
      ])
    )
  })

  it('dati del tracciato non validi: bloccante', async () => {
    const p = await preparatore.prepara(ctx([movimento()], { dati: { m1: { prodotto: 'Z' } } }))
    expect(codici(p)).toContain('DATI_TRACCIATO_NON_VALIDI')
  })

  it('ordina i movimenti per data e numero di registro, e il protocollo e il numero progressivo', async () => {
    const m2 = movimento({
      id: 'm2',
      radiceId: 'm2',
      numero: '9/2026',
      movementDate: new Date('2026-05-02T08:00:00Z'),
    })
    const p = await preparatore.prepara(
      ctx([movimento(), m2], {
        config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } } },
      })
    )
    expect(p.dati.righe.map(r => r.protocollo)).toEqual([9, 17])
    expect(p.dati.righe.map(r => r.riferimento)).toEqual(['9/2026', '17/2026'])
    expect(p.dati.righe.map(r => r.movimentoId)).toEqual(['m2', 'm1'])
  })

  it('stessi dati, stesso risultato (nessuna dipendenza dall ordine delle sedi)', async () => {
    const c = ctx([movimento()], {
      config: { predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 80 } } },
    })
    expect(JSON.stringify(await preparatore.prepara(c))).toBe(
      JSON.stringify(await preparatore.prepara(c))
    )
  })
})
