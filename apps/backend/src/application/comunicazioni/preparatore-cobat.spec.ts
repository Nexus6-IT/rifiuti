import type { AnagraficaComunicazioniSede } from '@prisma/client'
import type { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type { ConfigurazioneCobat } from '../../domain/comunicazioni/configurazione-sede'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import type { ContestoPreparazione } from './comunicazioni-tracciato.port'
import type { DettagliTracciato, FirDettaglio, SedeDettaglio } from './lettore-dettagli-tracciato'
import type { MovimentoOrso } from './lettore-movimenti-orso'
import { PreparatoreCobat } from './preparatore-cobat'

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
const preparatore = new PreparatoreCobat(prismaFinto)

const anagrafica = (o: Partial<AnagraficaComunicazioniSede> = {}): AnagraficaComunicazioniSede =>
  ({
    id: 'a',
    tenantId: 't',
    sedeDittaId: 's',
    eComune: false,
    codiceIstatComune: null,
    codiceAteco: '45.20.10',
    codiceOrso: null,
    alboDataIscrizione: null,
    alboClassi: null,
    autorizzazioneData: null,
    legaleRappresentanteCognome: 'VERDI',
    legaleRappresentanteNome: 'LUCA',
    esclusaOrr: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as AnagraficaComunicazioniSede

const sede = (
  id: string,
  dittaId: string,
  nome: string,
  cf: string,
  o: Partial<SedeDettaglio> = {}
): SedeDettaglio => ({
  id,
  dittaId,
  denominazione: null,
  via: 'VIA ROMA',
  civico: '12',
  cap: '20100',
  comune: 'Milano',
  provincia: 'MI',
  telefono: '02111222',
  principale: true,
  ditta: { id: dittaId, ragioneSociale: nome, partitaIva: cf, codiceFiscale: cf },
  anagrafica: anagrafica(),
  ...o,
})

const produttore = sede('s1', 'd1', 'AUTORICAMBI VERDI SNC', '05555555555')
const vettore = sede('s2', 'd2', 'TRASPORTI RAPIDI SRL', '09876543210')
const destinatarioEsterno = sede('s3', 'd3', 'COBAT RECUPERI SPA', '11122233344', {
  comune: 'Bergamo',
  provincia: 'BG',
})

const fir = (o: Partial<FirDettaglio> = {}): FirDettaglio => ({
  id: 'f1',
  firNumero: 'ABC123/26',
  transportDate: new Date('2026-04-01T08:00:00Z'),
  actualArrivalDate: new Date('2026-04-02T08:00:00Z'),
  producerSedeId: 's1',
  producerId: null,
  receiverSedeId: null,
  producerCodiceFiscale: '05555555555',
  carrierCodiceFiscale: '09876543210',
  receiverCodiceFiscale: '99999999999',
  producerPartitaIva: '05555555555',
  carrierPartitaIva: '09876543210',
  receiverPartitaIva: '99999999999',
  producerName: 'x',
  carrierName: 'TRASPORTI RAPIDI SRL',
  receiverName: 'NOI SRL',
  producerAddress: '',
  receiverAddress: '',
  carrierId: 'c1',
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
  movementDate: new Date('2026-04-02T08:00:00Z'),
  cer: '160601',
  pericoloso: true,
  descrizione: null,
  quantita: 1250,
  unita: 'KG',
  kg: 1250,
  ruolo: 'RICEVUTO_DA_TERZI',
  operazione: 'R',
  origineOperazione: 'NON_INDICATA',
  operationCode: 'R13',
  conFir: true,
  firId: 'f1',
  provinciaConferitore: null,
  provinciaDaIndirizzo: false,
  numero: '12/2026',
  radiceId: 'm1',
  causale: 'INGRESSO_ESTERNO',
  controparte: null,
  indirizzoControparte: null,
  firNumero: 'ABC123/26',
  ...o,
})

function ctx(
  movimenti: MovimentoOrso[],
  o: {
    config?: Partial<ConfigurazioneCobat>
    dati?: Record<string, unknown>
    fir?: FirDettaglio[]
    sedi?: SedeDettaglio[]
    comuneUnita?: string
  } = {}
): ContestoPreparazione<ConfigurazioneCobat> {
  const sedi = o.sedi ?? [produttore, vettore, destinatarioEsterno]
  const dettagli: DettagliTracciato = {
    fir: new Map((o.fir ?? [fir()]).map(f => [f.id, f])),
    sedi: new Map(sedi.map(s => [s.id, s])),
    sedeLegalePerDitta: new Map(sedi.filter(s => s.principale).map(s => [s.dittaId, s])),
    trasportatori: new Map([
      ['c1', { id: 'c1', sedeId: 's2', dittaId: 'd2', numeroIscrizione: 'NA/1' }],
    ]),
    destinatari: new Map(),
    datiTracciato: new Map(Object.entries(o.dati ?? {}) as [string, never][]),
    produttori: new Map(),
    sediPerControparte: new Map(),
  }
  return {
    tenantId: 't',
    azienda: {
      partitaIva: '99999999999',
      codiceFiscale: '99999999999',
      ragioneSociale: 'RICICLO BATTERIE SRL',
      atecoCode: '38.32.00',
      legaleRappresentanteCognome: 'BIANCHI',
      legaleRappresentanteNome: 'MARIO',
    },
    unita: {
      id: 'u1',
      denominazione: 'Sede',
      numIscrSito: 'X',
      indirizzo: 'VIA DELLE OFFICINE',
      civico: '5',
      cap: '24100',
      comune: o.comuneUnita ?? 'Bergamo',
      provincia: 'BG',
      progressivoMud: null,
    },
    periodo: { da: '2026-04-01', a: '2026-04-30' },
    parametri: {},
    movimenti,
    dettagli,
    configurazione: {
      campagnaPredefinita: { codice: '00', descrizione: '' },
      pgfPerCer: { '160601': 'A' },
      ...o.config,
    } as ConfigurazioneCobat,
    catalogo: {} as CatalogoCausali,
  }
}

const bloccanti = (p: { avvisi: Array<{ codice: string; bloccante: boolean }> }) =>
  p.avvisi.filter(a => a.bloccante).map(a => a.codice)

describe('PreparatoreCobat', () => {
  it('descrive il tracciato e il file', () => {
    expect(preparatore.consorzio).toBe('COBAT')
    expect(preparatore.versione).toBe('Movcob-ww1')
    expect(preparatore.nomeTracciato()).toBe('Movcob')
    expect(preparatore.nomeFile()).toBe('Movcob.txt')
    expect(preparatore.selezione).toEqual({ tipo: 'MARCATI', consorzio: 'COBAT' })
  })

  it('periodo libero entro un anno', () => {
    const r = { consorzio: 'COBAT', unitaLocaleId: 'u', da: '2026-01-01', a: '2026-12-31' }
    expect(preparatore.validaRichiesta(r)).toEqual([])
    expect(preparatore.validaRichiesta({ ...r, a: '2027-01-02' })).toHaveLength(1)
  })

  it('carico da terzi con trasportatore esterno: tipmov 6, causa 5, codazi = trasportatore (il destinatario siamo noi)', async () => {
    const p = await preparatore.prepara(ctx([movimento()]))
    expect(bloccanti(p)).toEqual([])
    expect(p.dati.record).toHaveLength(1)
    const r = p.dati.record[0]
    expect(r.movimentoId).toBe('m1')
    expect(r).toMatchObject({
      dataRegistrazione: '2026-04-02',
      progressivo: '000012',
      codazi: '09876543210',
      tipoMovimento: 6,
      causa: 5,
      targa: 'AB123CD',
      bolla: 'ABC123/26',
      dataFormulario: '2026-04-01',
      dataConferimento: '2026-04-02',
      cer: '160601',
      pgf: 'A',
      quam3: 0,
      quaton: 1.25,
      campagnaCodice: '00',
    })
    expect(r.produttore?.sedeLegale).toMatchObject({
      descrizione: 'AUTORICAMBI VERDI SNC',
      codreg: 'D',
      codcom: '015146',
      comune: 'N',
    })
    expect(r.produttore?.unitaLocale).toMatchObject({ codiceAttivita: '452010' })
    // Difetto di WinWaste corretto: cognome e nome del legale rappresentante del trasportatore.
    expect(r.trasportatore?.sedeLegale).toMatchObject({
      descrizione: 'TRASPORTI RAPIDI SRL',
      legaleRappresentanteCognome: 'VERDI',
      legaleRappresentanteNome: 'LUCA',
    })
    // Il destinatario siamo noi: sede legale dall'azienda e dall'unita'.
    expect(r.smaltitore?.sedeLegale).toMatchObject({
      descrizione: 'RICICLO BATTERIE SRL',
      codreg: 'D',
      codcom: '016024',
      legaleRappresentanteCognome: 'BIANCHI',
    })
    expect(r.smaltitore?.unitaLocale.codiceAttivita).toBe('383200')
    expect(r.intermediario).toBeNull()
    expect(p.avvisi.find(a => a.codice === 'CAMPI_NON_DISPONIBILI')?.bloccante).toBe(false)
  })

  it('scarico a destinatario esterno: tipmov 4, causa da D15 = 1, codazi = destinatario, nessun trasportatore', async () => {
    const m = movimento({ tipo: 'SCARICO', ruolo: 'AVVIATO', operationCode: 'D15' })
    const f = fir({
      producerSedeId: null,
      producerCodiceFiscale: '99999999999',
      producerPartitaIva: '99999999999',
      receiverSedeId: 's3',
      receiverCodiceFiscale: '11122233344',
      receiverPartitaIva: '11122233344',
      carrierName: '',
      carrierCodiceFiscale: null,
      carrierPartitaIva: '',
    })
    const p = await preparatore.prepara(ctx([m], { fir: [f] }))
    expect(bloccanti(p)).toEqual([])
    expect(p.dati.record[0]).toMatchObject({ tipoMovimento: 4, causa: 1, codazi: '11122233344' })
    expect(p.dati.record[0].trasportatore).toBeNull()
    expect(p.dati.record[0].smaltitore?.sedeLegale.codreg).toBe('D')
  })

  it('un trasportatore esterno su uno scarico da` tipmov 7', async () => {
    const m = movimento({ tipo: 'SCARICO', ruolo: 'AVVIATO' })
    const f = fir({
      producerSedeId: null,
      producerCodiceFiscale: '99999999999',
      producerPartitaIva: '99999999999',
      receiverSedeId: 's3',
      receiverCodiceFiscale: '11122233344',
      receiverPartitaIva: '11122233344',
    })
    const p = await preparatore.prepara(ctx([m], { fir: [f] }))
    expect(p.dati.record[0].tipoMovimento).toBe(7)
  })

  it('la forzatura sul movimento vince su tipmov e causa; pgf e campagna dai dati del movimento', async () => {
    const p = await preparatore.prepara(
      ctx([movimento()], {
        dati: {
          m1: {
            tipoMovimento: 3,
            causa: 2,
            pgf: 'C',
            campagna: { codice: '01', descrizione: 'Prova' },
          },
        },
      })
    )
    expect(p.dati.record[0]).toMatchObject({
      tipoMovimento: 3,
      causa: 2,
      pgf: 'C',
      campagnaCodice: '01',
      campagnaDescrizione: 'Prova',
    })
  })

  it('movimento in cui tutte le parti siamo noi: escluso con avviso informativo', async () => {
    const m = movimento({ firId: null, conFir: false, ruolo: 'PRODOTTO' })
    const p = await preparatore.prepara(ctx([m]))
    expect(p.dati.record).toHaveLength(0)
    expect(p.movimentiInFile).toHaveLength(0)
    expect(p.avvisi).toEqual([
      expect.objectContaining({
        codice: 'MOVIMENTO_INTERNO_ESCLUSO',
        bloccante: false,
        movimentoIds: ['m1'],
      }),
    ])
  })

  it('scarico senza FIR: destinatario non identificato, bloccante', async () => {
    const p = await preparatore.prepara(
      ctx([movimento({ tipo: 'SCARICO', ruolo: 'AVVIATO', firId: null, conFir: false })])
    )
    expect(bloccanti(p)).toContain('SOGGETTO_NON_IDENTIFICATO')
  })

  it('ISTAT non trovato: bloccante con il link alla sede della controparte', async () => {
    const p = await preparatore.prepara(
      ctx([movimento()], {
        sedi: [{ ...produttore, comune: 'Inesistente' }, vettore, destinatarioEsterno],
      })
    )
    const a = p.avvisi.find(x => x.codice === 'ISTAT_NON_TROVATO')
    expect(a?.bloccante).toBe(true)
    expect(a?.correzione).toEqual({ tipo: 'ANAGRAFICA_SEDE', sedeDittaId: 's1' })
  })

  it('se la sede propria non ha il comune risolvibile si rimanda alla configurazione', async () => {
    const p = await preparatore.prepara(ctx([movimento()], { comuneUnita: 'Sconosciuto' }))
    expect(p.avvisi.find(x => x.codice === 'ISTAT_NON_TROVATO')?.correzione).toEqual({
      tipo: 'CONFIGURAZIONE_SEDE',
    })
  })

  it('progressivo oltre 999 999: bloccante con il movimento', async () => {
    const p = await preparatore.prepara(ctx([movimento({ numero: '1000000/2026' })]))
    expect(bloccanti(p)).toContain('PROGRESSIVO_NON_VALIDO')
  })

  it('due registri nello stesso file: progressivi 1..n nell ordine del file', async () => {
    const m1 = movimento({ numero: '7/2026' })
    const m2 = movimento({
      id: 'm2',
      radiceId: 'm2',
      registroId: 'r2',
      numero: '7/2026',
      movementDate: new Date('2026-04-03T08:00:00Z'),
    })
    const p = await preparatore.prepara(ctx([m2, m1]))
    expect(p.dati.record.map(r => r.progressivo)).toEqual(['000001', '000002'])
  })

  it('il progressivo e quello del registro se il registro e uno solo', async () => {
    const m2 = movimento({
      id: 'm2',
      radiceId: 'm2',
      numero: '30/2026',
      movementDate: new Date('2026-04-03T08:00:00Z'),
    })
    const p = await preparatore.prepara(ctx([movimento(), m2]))
    expect(p.dati.record.map(r => r.progressivo)).toEqual(['000012', '000030'])
  })

  it('peso non convertibile: bloccante', async () => {
    const p = await preparatore.prepara(ctx([movimento({ kg: null, unita: 'PZ' })]))
    expect(bloccanti(p)).toContain('QUANTITA_NON_VALIDA')
  })

  it('PGF mancante: avviso informativo, campo vuoto', async () => {
    const p = await preparatore.prepara(ctx([movimento()], { config: { pgfPerCer: {} } }))
    expect(p.dati.record[0].pgf).toBe('')
    expect(p.avvisi.find(a => a.codice === 'PGF_NON_INDICATO')?.bloccante).toBe(false)
  })

  describe('punto di correzione degli errori di record (D14)', () => {
    const trova = (p: { avvisi: Array<{ codice: string }> }, codice: string) =>
      p.avvisi.find(a => a.codice === codice) as
        | { codice: string; campo?: string; correzione?: unknown; bloccante: boolean }
        | undefined

    it('emoji nella ragione sociale della controparte: anagrafica della sede, campo e codice uniforme', async () => {
      const prod = sede('s1', 'd1', 'AUTORICAMBI 😀 SNC', '05555555555')
      const p = await preparatore.prepara(
        ctx([movimento()], { sedi: [prod, vettore, destinatarioEsterno] })
      )
      const a = trova(p, 'CARATTERI_NON_RAPPRESENTABILI')
      expect(a).toMatchObject({
        bloccante: true,
        campo: 'descrizione produttore',
        correzione: { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: 's1' },
      })
      expect(trova(p, 'RECORD_NON_VALIDO')).toBeUndefined()
    })

    it('emoji nella via del trasportatore: anagrafica del trasportatore', async () => {
      const vet = sede('s2', 'd2', 'TRASPORTI RAPIDI SRL', '09876543210', { via: 'VIA 😀' })
      const p = await preparatore.prepara(
        ctx([movimento()], { sedi: [produttore, vet, destinatarioEsterno] })
      )
      expect(trova(p, 'CARATTERI_NON_RAPPRESENTABILI')).toMatchObject({
        campo: 'via trasportatore',
        correzione: { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: 's2' },
      })
    })

    it('emoji nella descrizione della campagna predefinita: configurazione della sede', async () => {
      const p = await preparatore.prepara(
        ctx([movimento()], {
          config: { campagnaPredefinita: { codice: '01', descrizione: 'ESTATE 😀' } },
        })
      )
      expect(trova(p, 'CARATTERI_NON_RAPPRESENTABILI')).toMatchObject({
        campo: 'campagna',
        correzione: { tipo: 'CONFIGURAZIONE_SEDE' },
      })
    })

    it('campagna indicata sul movimento con emoji: si corregge il movimento', async () => {
      const p = await preparatore.prepara(
        ctx([movimento()], { dati: { m1: { campagna: { codice: '01', descrizione: 'X 😀' } } } })
      )
      expect(trova(p, 'CARATTERI_NON_RAPPRESENTABILI')).toMatchObject({
        correzione: { tipo: 'MOVIMENTO' },
      })
    })

    it('errore proprio del movimento (CER): resta sul movimento con codice RECORD_NON_VALIDO', async () => {
      const p = await preparatore.prepara(ctx([movimento({ cer: '1606' })]))
      expect(trova(p, 'RECORD_NON_VALIDO')).toMatchObject({ correzione: { tipo: 'MOVIMENTO' } })
    })
  })
})
