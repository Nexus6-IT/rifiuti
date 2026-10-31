import { MudAggregazioneService } from './mud-aggregazione.service'
import { MudAggregazioneOracoloA2bf11e } from './mud-aggregazione-a2bf11e.oracolo-spec'
import {
  creaPrismaFinto,
  type DatiPrismaFinto,
  type FirFinto,
  type MovimentoFinto,
} from './mud-prisma-finto.fixture-spec'

/**
 * Equivalenza unitaria (F2-8, D11): per ogni scenario il servizio e l'oracolo (copia di a2bf11e,
 * con le sole anagrafiche delegate al servizio) lavorano sullo STESSO prisma finto e devono dare
 * lo stesso risultato. Unica differenza ammessa: il messaggio di CAUSALE_ESCLUSA (D13).
 * Ogni scenario dichiara anche a mano un fatto che deve accadere, cosi l'uguaglianza non e
 * vuota (due risultati vuoti sarebbero uguali).
 */
describe('MudAggregazione: equivalenza con a2bf11e (versione 1)', () => {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const referenceData: any = { findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }) }

  const mov = (p: Partial<MovimentoFinto>): MovimentoFinto => ({
    registroId: 'reg-A',
    progressiveNumber: 1,
    progressiveYear: 2025,
    type: 'CARICO',
    causale: 'PRODUZIONE_INTERNA',
    causaleAziendaId: null,
    cerCode: '17 04 05',
    quantity: 100,
    unit: 'KG',
    operationCode: null,
    firId: null,
    firIdRicopia: null,
    ricopiaChiave: '',
    counterpartName: null,
    wastePhysicalState: null,
    movementDate: new Date('2025-06-10T08:00:00Z'),
    ...p,
  })
  const scarico = (p: Partial<MovimentoFinto>) =>
    mov({ type: 'SCARICO', causale: 'CONFERIMENTO_TRASPORTATORE', ...p })
  const fir = (p: Partial<FirFinto>): FirFinto => ({
    id: 'f1',
    firNumber: 'FIR-2025-000123',
    rentriNumeroFir: null,
    status: 'COMPLETED',
    rentriStatoFormulario: null,
    wasteOperationType: 'DISPOSAL',
    wasteOperationCode: null,
    receiverId: 'dest-1',
    receiverName: 'Recupero Metalli Srl',
    receiverPartitaIva: '33333333333',
    carrierId: 'car-1',
    carrierName: 'Trasporti Srl',
    carrierPartitaIva: '22222222222',
    ...p,
  })
  const dest1 = {
    id: 'dest-1',
    ragioneSocialeStorica: 'Recupero Metalli Srl',
    ditta: {
      ragioneSociale: 'Recupero Metalli Srl',
      partitaIva: '33333333333',
      codiceFiscale: null,
    },
    sede: { comune: 'Milano', provincia: 'MI', via: 'Via Roma', civico: '1', cap: '20100' },
  }
  const dataGiorno = (g: string) => new Date(`${g}T08:00:00Z`)
  const versioneAzienda = (p: Record<string, unknown>) => ({
    id: 'ver-1',
    natura: 'PROPRIA',
    codice: 'AZ_TEST',
    verso: 'CARICO',
    descrizione: 'Test',
    ruoloMud: 'PRODOTTO',
    codiceRentri: null,
    operazione: null,
    ordine: 100,
    validaDal: new Date('2025-01-01T00:00:00Z'),
    validaAl: null,
    ...p,
  })
  const firAnno1 = [{ id: 'f1', firNumber: 'FIR-2025-000123', rentriNumeroFir: null }]
  const firSenzaAnagrafica = fir({
    id: 'f1',
    receiverId: null,
    receiverPartitaIva: null,
    receiverName: 'Ecologia Srl',
  })

  /** Chiave canonica per confrontare i controlli come multiinsieme. */
  const chiave = (c: any): string =>
    JSON.stringify([
      c.codice,
      // D13: l'unica differenza ammessa
      c.codice === 'CAUSALE_ESCLUSA' ? '' : c.messaggio,
      c.gravita,
      c.movimenti ?? null,
      c.fir ?? null,
      c.integrazione ?? null,
      c.kgNonDichiarati ?? null,
    ])
  const normalizza = (a: any) => ({
    righe: a.righe,
    movimentiPerCer: a.movimentiPerCer,
    pericolosiPerCer: a.pericolosiPerCer,
    dichiarante: a.dichiarante,
    mudNonDovuto: a.mudNonDovuto,
    integrazioni: a.integrazioni,
    controlli: a.controlli.map(chiave).sort(),
  })

  interface Scenario {
    nome: string
    dati: DatiPrismaFinto
    /** codici di controllo che devono comparire (scritti a mano) */
    attesi: string[]
    righe?: number
    /** attese scritte a mano sul risultato di produzione (non ricavate dal codice) */
    verifica?: (attuale: any) => void
    /** attese scritte a mano sul risultato della versione 2 (giacenze scritte, D8 e D9) */
    verifica2?: (attuale: any) => void
  }

  const scenari: Scenario[] = [
    {
      nome: 'produzione e avvio a recupero e smaltimento con FIR collegabile',
      dati: {
        movimenti: [
          mov({ progressiveNumber: 1, quantity: 500 }),
          scarico({
            progressiveNumber: 2,
            quantity: 200,
            firId: 'f1',
            operationCode: 'R13',
            movementDate: dataGiorno('2025-07-01'),
          }),
          scarico({
            progressiveNumber: 3,
            quantity: 100,
            firId: 'f2',
            operationCode: 'D15',
            movementDate: dataGiorno('2025-07-02'),
          }),
        ],
        fir: [fir({ id: 'f1' }), fir({ id: 'f2', firNumber: 'FIR-2025-000124' })],
        firAnno: [
          { id: 'f1', firNumber: 'FIR-2025-000123', rentriNumeroFir: null },
          { id: 'f2', firNumber: 'FIR-2025-000124', rentriNumeroFir: null },
        ],
        destinatari: [dest1],
      },
      attesi: [],
      righe: 1,
      verifica2: attuale => {
        // saldo a mano: 500 di carico - 200 - 100 di scarichi = 200 kg; avviati 200 a recupero e
        // 100 a smaltimento → ripartita in proporzione: 133,333 kg a recupero, 66,667 a smaltimento
        expect(attuale.righe[0].giacenzaRecuperoKg).toBe(133.333)
        expect(attuale.righe[0].giacenzaSmaltimentoKg).toBe(66.667)
        expect(attuale.controlli.map((c: any) => c.codice)).toContain('GIACENZA_RIPARTITA')
      },
    },
    {
      nome: 'FIR annullato',
      dati: {
        movimenti: [scarico({ firId: 'f1', operationCode: 'R13' })],
        fir: [fir({ id: 'f1', status: 'CANCELLED' })],
        destinatari: [dest1],
      },
      attesi: ['FIR_ANNULLATO'],
    },
    {
      nome: 'FIR in bozza',
      dati: {
        movimenti: [scarico({ firId: 'f1', operationCode: 'R13' })],
        fir: [fir({ id: 'f1', status: 'DRAFT' })],
        destinatari: [dest1],
      },
      attesi: ['FIR_IN_BOZZA'],
    },
    {
      nome: 'FIR non trovato',
      dati: { movimenti: [scarico({ firId: 'f-che-non-esiste', operationCode: 'R13' })] },
      attesi: ['FIR_NON_TROVATO'],
    },
    {
      nome: 'doppio registrato a cavallo d anno',
      dati: {
        movimenti: [
          scarico({ progressiveNumber: 1, firId: 'f1', operationCode: 'R13', quantity: 50 }),
          scarico({ progressiveNumber: 2, firId: 'f1', operationCode: 'R13', quantity: 50 }),
          scarico({
            progressiveNumber: 9,
            progressiveYear: 2024,
            firId: 'f1',
            operationCode: 'R13',
            quantity: 50,
            movementDate: dataGiorno('2024-12-20'),
          }),
        ],
        fir: [fir({ id: 'f1' })],
        firAnno: firAnno1,
        destinatari: [dest1],
      },
      attesi: ['FIR_DOPPIO_ANNO_PRECEDENTE'],
    },
    {
      nome: 'doppio identico nello stesso anno',
      dati: {
        movimenti: [
          scarico({ progressiveNumber: 1, firId: 'f1', operationCode: 'R13', quantity: 50 }),
          scarico({ progressiveNumber: 2, firId: 'f1', operationCode: 'R13', quantity: 50 }),
        ],
        fir: [fir({ id: 'f1' })],
        firAnno: firAnno1,
        destinatari: [dest1],
      },
      attesi: ['FIR_DOPPIO_IDENTICO'],
    },
    {
      nome: 'FIR scaricato piu volte con quantita diverse',
      dati: {
        movimenti: [
          scarico({ progressiveNumber: 1, firId: 'f1', operationCode: 'R13', quantity: 50 }),
          scarico({
            progressiveNumber: 2,
            firId: 'f1',
            operationCode: 'R13',
            quantity: 70,
            movementDate: dataGiorno('2025-06-20'),
          }),
        ],
        fir: [fir({ id: 'f1' })],
        firAnno: firAnno1,
        destinatari: [dest1],
      },
      attesi: ['FIR_SCARICATO_PIU_VOLTE'],
    },
    {
      nome: 'unita non di massa senza peso specifico',
      dati: { movimenti: [mov({ quantity: 30, unit: 'LITRI' })] },
      attesi: ['UNITA_NON_DI_MASSA'],
    },
    {
      nome: 'unita non di massa con peso specifico',
      dati: {
        movimenti: [mov({ quantity: 30, unit: 'LITRI' })],
        reportData: {
          integrazioni: {
            destinatari: {},
            pesiSpecifici: {
              '170405|LITRI': { cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.2 },
            },
          },
        },
      },
      attesi: ['CONVERTITO_CON_PESO_SPECIFICO'],
      righe: 1,
    },
    {
      nome: 'unita vuota (vale kg)',
      dati: { movimenti: [mov({ quantity: 80, unit: null })] },
      attesi: [],
      righe: 1,
    },
    {
      nome: 'causale di sistema esclusa',
      dati: {
        movimenti: [
          mov({ progressiveNumber: 1 }),
          mov({ progressiveNumber: 2, quantity: 40, causale: 'ALTRO_CARICO' }),
        ],
      },
      attesi: ['CAUSALE_ESCLUSA'],
      righe: 1,
    },
    {
      nome: 'causale aziendale esclusa con descrizione',
      dati: {
        movimenti: [mov({ causale: 'AZ_TEST', causaleAziendaId: 'ver-1' })],
        causaliAzienda: [versioneAzienda({ ruoloMud: 'ESCLUSO', descrizione: 'Altro carico' })],
      },
      attesi: ['CAUSALE_ESCLUSA'],
    },
    {
      nome: 'carico ricevuto da terzi',
      dati: {
        movimenti: [
          mov({ progressiveNumber: 1 }),
          mov({ progressiveNumber: 2, quantity: 50, causale: 'INGRESSO_ESTERNO' }),
        ],
      },
      attesi: ['PROFILO_NON_SUPPORTATO'],
      verifica2: attuale => {
        // saldo a mano: 100 + 50 = 150 kg, ma il CER è anche ricevuto da terzi: non si scrive
        expect(attuale.righe[0].giacenzaRecuperoKg).toBeUndefined()
        expect(attuale.righe[0].giacenzaSmaltimentoKg).toBeUndefined()
        const c = attuale.controlli.find((x: any) => x.codice === 'GIACENZE_NON_DICHIARATE')
        expect(c.kgNonDichiarati).toBe(150)
        expect(c.messaggio).toContain('CER 17 04 05: 150 kg, ricevuto anche da terzi')
      },
    },
    {
      nome: 'destinatario senza anagrafica risolto dalle integrazioni',
      dati: {
        movimenti: [scarico({ firId: 'f1', operationCode: 'R13' })],
        fir: [firSenzaAnagrafica],
        firAnno: firAnno1,
        reportData: {
          integrazioni: {
            destinatari: {
              'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
            },
            pesiSpecifici: {},
          },
        },
      },
      attesi: [],
      righe: 1,
    },
    {
      nome: 'destinatario estero',
      dati: {
        movimenti: [scarico({ firId: 'f1', operationCode: 'R13' })],
        fir: [firSenzaAnagrafica],
        firAnno: firAnno1,
        reportData: {
          integrazioni: {
            destinatari: {
              'ECOLOGIA SRL': {
                ragioneSociale: 'Ecologia Srl',
                codiceFiscale: '',
                nazione: 'Germania',
              },
            },
            pesiSpecifici: {},
          },
        },
      },
      attesi: ['DESTINATARIO_ESTERO'],
    },
    {
      nome: 'stato fisico misto sullo stesso CER',
      dati: {
        movimenti: [
          mov({ progressiveNumber: 1, wastePhysicalState: 'LIQUIDO' }),
          mov({ progressiveNumber: 2, wastePhysicalState: 'SOLIDO_NON_POLVERULENTO' }),
        ],
      },
      attesi: ['STATO_FISICO_NON_UNIVOCO'],
      righe: 1,
    },
    {
      nome: 'aperture e saldi positivi a fine anno',
      dati: {
        movimenti: [
          mov({ progressiveNumber: 1, quantity: 300 }),
          scarico({ progressiveNumber: 2, quantity: 100, firId: 'f1', operationCode: 'R13' }),
          mov({ progressiveNumber: 3, cerCode: '20 03 04', quantity: 40 }),
        ],
        fir: [fir({ id: 'f1' })],
        firAnno: firAnno1,
        destinatari: [dest1],
        giacenzeIniziali: [
          {
            registroId: 'reg-A',
            cerCode: '17 04 05',
            quantita: 1,
            unita: 'T',
            dataRiferimento: new Date('2025-01-01T00:00:00Z'),
          },
        ],
      },
      attesi: [],
      righe: 2,
      verifica: attuale => {
        // saldo a mano: 17 04 05 = 1 T di apertura + 300 carico - 100 scarico = 1200 kg;
        // 20 03 04 = 40 kg; totale non dichiarato 1240 kg
        const giacenze = attuale.controlli.find((c: any) => c.codice === 'GIACENZE_NON_CALCOLATE')
        expect(giacenze.kgNonDichiarati).toBe(1240)
        expect(giacenze.messaggio).toContain('CER 17 04 05: 1.200 kg')
        expect(giacenze.messaggio).toContain('CER 20 03 04: 40 kg')
      },
      verifica2: attuale => {
        // 17 04 05: 1.200 kg con avvio solo a recupero (100) → tutto a recupero, nessun avviso;
        // 20 03 04: 40 kg prodotti e mai avviati → smaltimento, con l'avviso di destinazione
        const per = (cer: string) => attuale.righe.find((r: any) => r.cerCode === cer)
        expect(per('170405').giacenzaRecuperoKg).toBe(1200)
        expect('giacenzaSmaltimentoKg' in per('170405')).toBe(false)
        expect(per('200304').giacenzaSmaltimentoKg).toBe(40)
        expect('giacenzaRecuperoKg' in per('200304')).toBe(false)
        const codici = attuale.controlli.map((c: any) => c.codice)
        expect(codici).toContain('GIACENZA_DESTINAZIONE_NON_INDICATA')
        expect(codici).not.toContain('GIACENZE_NON_DICHIARATE')
      },
    },
    {
      nome: 'movimento non vigente',
      dati: {
        movimenti: [
          mov({ progressiveNumber: 1, quantity: 100 }),
          mov({ progressiveNumber: 2, quantity: 999, vigente: false }),
        ],
      },
      attesi: [],
      righe: 1,
      verifica: attuale => {
        // solo i 100 kg del movimento vigente: i 999 kg del non vigente non ci sono
        expect(attuale.righe[0].prodottoKg).toBe(100)
      },
    },
    {
      nome: 'due registri con la stessa numerazione',
      dati: {
        movimenti: [
          mov({ registroId: 'reg-A', progressiveNumber: 1, unit: 'LITRI' }),
          mov({ registroId: 'reg-B', progressiveNumber: 1, unit: 'LITRI' }),
        ],
        registri: [
          { id: 'reg-A', descrizione: 'Registro A', unitaLocale: { denominazione: 'Sede Nord' } },
          { id: 'reg-B', descrizione: 'Registro B', unitaLocale: null },
        ],
      },
      attesi: ['UNITA_NON_DI_MASSA'],
    },
    {
      nome: 'azienda senza ATECO',
      dati: {
        tenant: { city: 'Roma', province: 'RM', atecoCode: null },
        movimenti: [mov({})],
      },
      attesi: [],
      righe: 1,
    },
  ]

  it('ha almeno 12 scenari', () => {
    expect(scenari.length).toBeGreaterThanOrEqual(12)
  })

  it.each(scenari.map(s => [s.nome, s] as const))('%s', async (_nome, s) => {
    const prisma = creaPrismaFinto(s.dati)
    const servizio = new MudAggregazioneService(prisma, referenceData, logger)
    const oracolo = new MudAggregazioneOracoloA2bf11e(prisma, referenceData, logger, servizio)

    const attuale = await servizio.aggrega('t1', 2025, { versioneCalcolo: 1 })
    const storico = await oracolo.aggrega('t1', 2025)

    expect(normalizza(attuale)).toEqual(normalizza(storico))
    // non vuoto: i fatti scritti a mano
    const codici = attuale.controlli.map(c => c.codice)
    for (const atteso of s.attesi) expect(codici).toContain(atteso)
    if (s.righe !== undefined) expect(attuale.righe).toHaveLength(s.righe)
    s.verifica?.(attuale)
    // versione 1: una sola dichiarazione "fusa", codice 1, anagrafica dell'azienda
    expect(attuale.versioneCalcolo).toBe(1)
    expect(attuale.dichiarazioni).toHaveLength(1)
    expect(attuale.dichiarazioni[0]).toEqual(
      expect.objectContaining({ codice: '000000000000001', anagrafica: null })
    )
  })

  // Versione 2 con una sola sede (D11): il risultato e' quello dell'oracolo salvo i due campi di
  // giacenza delle righe, i controlli di giacenza (GIACENZE_NON_CALCOLATE dell'oracolo contro
  // GIACENZE_NON_DICHIARATE / GIACENZA_* della 2), PIU_UNITA_LOCALI (assente con una sede),
  // MOVIMENTI_SENZA_SEDE e il messaggio di CAUSALE_ESCLUSA. I kg delle giacenze scritte piu' quelli
  // non dichiarati sono quelli che l'oracolo non dichiara.
  describe('versione 2 con una sede', () => {
    const CODICI_GIACENZA = [
      'GIACENZE_NON_CALCOLATE',
      'GIACENZE_NON_DICHIARATE',
      'GIACENZA_RIPARTITA',
      'GIACENZA_DESTINAZIONE_NON_INDICATA',
    ]
    /** Il risultato senza i due campi di giacenza e senza i controlli di giacenza */
    const senzaGiacenze = (a: any) => ({
      ...a,
      righe: a.righe.map(({ giacenzaRecuperoKg: _r, giacenzaSmaltimentoKg: _s, ...r }: any) => r),
      controlli: a.controlli.filter((c: any) => !CODICI_GIACENZA.includes(c.codice)),
    })
    const grammi = (kg: number) => Math.round(kg * 1000)
    /** kg delle giacenze scritte nelle righe */
    const kgScritti = (a: any): number =>
      a.righe.reduce(
        (s: number, r: any) => s + (r.giacenzaRecuperoKg ?? 0) + (r.giacenzaSmaltimentoKg ?? 0),
        0
      )
    const kgDi = (a: any, codice: string): number =>
      a.controlli
        .filter((c: any) => c.codice === codice)
        .reduce((s: number, c: any) => s + (c.kgNonDichiarati ?? 0), 0)

    /** Ogni registro dei movimenti e' legato all'unica sede 'ul-1' */
    const conRegistriSullaSede = (dati: DatiPrismaFinto): DatiPrismaFinto => {
      const ids = [...new Set((dati.movimenti ?? []).map(m => m.registroId))]
      const registri = dati.registri ?? ids.map(id => ({ id, descrizione: `Registro ${id}` }))
      return { ...dati, registri: registri.map(r => ({ ...r, unitaLocaleId: 'ul-1' })) }
    }

    it.each(scenari.map(s => [s.nome, s] as const))('%s', async (_nome, s) => {
      const dati = conRegistriSullaSede(s.dati)
      const prisma = creaPrismaFinto(dati)
      const servizio = new MudAggregazioneService(prisma, referenceData, logger)
      const oracolo = new MudAggregazioneOracoloA2bf11e(prisma, referenceData, logger, servizio)

      const attuale = await servizio.aggrega('t1', 2025)
      const storico = await oracolo.aggrega('t1', 2025)

      expect(normalizza(senzaGiacenze(attuale))).toEqual(normalizza(senzaGiacenze(storico)))
      // giacenze scritte + kgNonDichiarati = kgNonDichiarati dell'oracolo
      expect(grammi(kgScritti(attuale) + kgDi(attuale, 'GIACENZE_NON_DICHIARATE'))).toBe(
        grammi(kgDi(storico, 'GIACENZE_NON_CALCOLATE'))
      )
      expect(storico.controlli.some(c => c.codice === 'GIACENZE_NON_DICHIARATE')).toBe(false)
      const codici = attuale.controlli.map(c => c.codice)
      for (const atteso of s.attesi) expect(codici).toContain(atteso)
      expect(codici).not.toContain('MOVIMENTI_SENZA_SEDE')
      expect(codici).not.toContain('GIACENZE_NON_CALCOLATE')
      if (s.righe !== undefined) expect(attuale.righe).toHaveLength(s.righe)
      // `verifica2` sostituisce `verifica` dove questa descrive le giacenze della versione 1
      if (s.verifica2) s.verifica2(attuale)
      else s.verifica?.(attuale)
      // una sede: nessun controllo porta la sede
      expect(attuale.controlli.every(c => c.sede === undefined)).toBe(true)
      expect(attuale.versioneCalcolo).toBe(2)
      expect(attuale.dichiarazioni).toHaveLength(attuale.righe.length > 0 ? 1 : 0)
      if (attuale.righe.length > 0) {
        expect(attuale.dichiarazioni[0].codice).toBe('000000000000001')
        expect(attuale.dichiarazioni[0].righe).toEqual(attuale.righe)
      }
    })

    it('senza registri legati alla sede i movimenti vanno sulla principale con MOVIMENTI_SENZA_SEDE', async () => {
      // lo stesso scenario senza legare il registro: oracolo + un solo avviso informativo
      const dati = scenari[0].dati
      const prisma = creaPrismaFinto(dati)
      const servizio = new MudAggregazioneService(prisma, referenceData, logger)
      const oracolo = new MudAggregazioneOracoloA2bf11e(prisma, referenceData, logger, servizio)

      const attuale = await servizio.aggrega('t1', 2025)
      const storico = await oracolo.aggrega('t1', 2025)

      const senzaAvviso = {
        ...attuale,
        controlli: attuale.controlli.filter(c => c.codice !== 'MOVIMENTI_SENZA_SEDE'),
      }
      expect(normalizza(senzaGiacenze(senzaAvviso))).toEqual(normalizza(senzaGiacenze(storico)))
      const avvisi = attuale.controlli.filter(c => c.codice === 'MOVIMENTI_SENZA_SEDE')
      expect(avvisi).toHaveLength(1)
      expect(avvisi[0].gravita).toBe('AVVISO')
      // tre movimenti dello scenario, tutti conteggiati
      expect(avvisi[0].movimenti).toHaveLength(3)
      // anche la giacenza del registro senza sede segue i movimenti sulla principale
      expect(grammi(kgScritti(attuale) + kgDi(attuale, 'GIACENZE_NON_DICHIARATE'))).toBe(
        grammi(kgDi(storico, 'GIACENZE_NON_CALCOLATE'))
      )
      expect(attuale.righe[0].giacenzaRecuperoKg).toBe(133.333)
    })
  })
})
