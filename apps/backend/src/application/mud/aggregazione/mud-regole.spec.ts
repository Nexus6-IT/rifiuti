import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import type { MudModuloGestione, MudRifiutoLine } from '../export/mud-export.types'
import { CatalogoCausali } from '../../../domain/waste-movement/catalogo-causali'
import type { RigaCausaleAzienda } from '../../../domain/waste-movement/catalogo-causali'
import { righeCausaliSistema } from '../../registro/causali/catalogo-causali.fixture'
import {
  classificaMovimento,
  hashAggregato,
  hashCalcoloMud,
  hashDichiarante,
  hashDichiaranteMud,
  hashDichiarazioni,
  limitiAnnoMud,
  operazioneDaCatalogo,
  operazioneDaCodice,
  statoFisicoMud,
  type MovimentoClassificabile,
  type RuoloMovimento,
} from './mud-regole'

// ORACOLO: la vecchia implementazione, copiata VERBATIM da mud-regole.ts:28-57 di master
// 5b6f661 (mappe RUOLO_CARICO/RUOLO_SCARICO, classificaMovimento, operazioneDaCausale). NON va
// modificata: serve a dimostrare che il catalogo di sistema dà gli stessi risultati di prima.
const RUOLO_CARICO: Record<string, RuoloMovimento> = {
  PRODUZIONE_INTERNA: 'PRODOTTO',
  RECUPERO_PARZIALE: 'PRODOTTO',
  INGRESSO_ESTERNO: 'RICEVUTO_DA_TERZI',
}

const RUOLO_SCARICO: Record<string, RuoloMovimento> = {
  CONFERIMENTO_TRASPORTATORE: 'AVVIATO',
  AVVIO_RECUPERO: 'AVVIATO',
  AVVIO_SMALTIMENTO: 'AVVIATO',
  CESSIONE: 'AVVIATO',
}

function vecchiaClassificazione(type: 'CARICO' | 'SCARICO', causale: string): RuoloMovimento {
  const mappa = type === 'CARICO' ? RUOLO_CARICO : RUOLO_SCARICO
  return Object.prototype.hasOwnProperty.call(mappa, causale) ? mappa[causale] : 'ESCLUSO'
}

function vecchiaOperazione(causale: string): 'R' | 'D' | undefined {
  if (causale === 'AVVIO_RECUPERO') return 'R'
  if (causale === 'AVVIO_SMALTIMENTO') return 'D'
  return undefined
}
// FINE ORACOLO

const catalogoSistema = () => new CatalogoCausali(righeCausaliSistema(), [])
const movimento = (p: Partial<MovimentoClassificabile>): MovimentoClassificabile => ({
  type: 'CARICO',
  causale: 'PRODUZIONE_INTERNA',
  causaleAziendaId: null,
  movementDate: new Date('2025-06-10T08:00:00Z'),
  ...p,
})
const versione = (p: Partial<RigaCausaleAzienda>): RigaCausaleAzienda => ({
  id: 'ver-1',
  natura: 'PROPRIA',
  codice: 'AZ_TEST',
  verso: 'CARICO',
  descrizione: 'Test',
  ruoloMud: 'PRODOTTO',
  codiceRentri: null,
  operazione: null,
  ordine: 100,
  validaDal: '2025-01-01',
  validaAl: null,
  ...p,
})

describe('limitiAnnoMud', () => {
  it("limitiAnnoMud usa l'anno solare italiano", () => {
    const { inizio, fine } = limitiAnnoMud(2025)
    expect(inizio.toISOString()).toBe('2024-12-31T23:00:00.000Z')
    expect(fine.toISOString()).toBe('2025-12-31T23:00:00.000Z')
    const dentro = (d: Date) => d >= inizio && d < fine
    expect(dentro(new Date('2025-12-31T22:30:00Z'))).toBe(true) // 31/12 23:30 a Roma
    expect(dentro(new Date('2025-12-31T23:30:00Z'))).toBe(false) // 1/1/2026 00:30 a Roma
    expect(dentro(new Date('2024-12-31T23:00:00Z'))).toBe(true) // 1/1/2025 00:00 a Roma
  })
  it.each([2024, 2025, 2026, 2030])('limitiAnnoMud coincide con annoSolareItaliano (%i)', anno => {
    const { inizio, fine } = limitiAnnoMud(anno)
    expect(annoSolareItaliano(inizio)).toBe(anno)
    expect(annoSolareItaliano(new Date(inizio.getTime() - 1))).toBe(anno - 1)
    expect(annoSolareItaliano(new Date(fine.getTime() - 1))).toBe(anno)
    expect(annoSolareItaliano(fine)).toBe(anno + 1)
  })
})

describe('classificaMovimento', () => {
  it.each([
    ['CARICO', 'PRODUZIONE_INTERNA', 'PRODOTTO'],
    ['CARICO', 'RECUPERO_PARZIALE', 'PRODOTTO'],
    ['CARICO', 'INGRESSO_ESTERNO', 'RICEVUTO_DA_TERZI'],
    ['CARICO', 'RICLASSIFICAZIONE', 'ESCLUSO'],
    ['CARICO', 'ALTRO_CARICO', 'ESCLUSO'],
    ['SCARICO', 'CONFERIMENTO_TRASPORTATORE', 'AVVIATO'],
    ['SCARICO', 'AVVIO_RECUPERO', 'AVVIATO'],
    ['SCARICO', 'AVVIO_SMALTIMENTO', 'AVVIATO'],
    ['SCARICO', 'CESSIONE', 'AVVIATO'],
    ['SCARICO', 'RICLASSIFICAZIONE', 'ESCLUSO'],
    ['SCARICO', 'ALTRO_SCARICO', 'ESCLUSO'],
    ['SCARICO', 'CAUSALE_SCONOSCIUTA', 'ESCLUSO'],
  ])('%s %s → %s', (type, causale, atteso) => {
    expect(classificaMovimento(catalogoSistema(), movimento({ type, causale }))).toBe(atteso)
  })

  const CODICI = [
    ...new Set(righeCausaliSistema().map(r => r.codice)),
    'SCONOSCIUTA',
    '',
    'constructor',
  ]
  it('i codici di sistema sono i 10 di oggi', () => {
    expect(CODICI.slice(0, -3)).toHaveLength(10)
  })
  it.each(
    (['CARICO', 'SCARICO'] as const).flatMap(type =>
      CODICI.map(causale => [type, causale] as const)
    )
  )('equivale alla vecchia implementazione: %s %j', (type, causale) => {
    expect(classificaMovimento(catalogoSistema(), movimento({ type, causale }))).toBe(
      vecchiaClassificazione(type, causale)
    )
  })

  it('una causale aziendale PRODOTTO conta nel prodotto', () => {
    const c = new CatalogoCausali(righeCausaliSistema(), [versione({})])
    expect(
      classificaMovimento(c, movimento({ causale: 'AZ_TEST', causaleAziendaId: 'ver-1' }))
    ).toBe('PRODOTTO')
  })
  it('ESCLUSO, RICEVUTO_DA_TERZI e AVVIATO dalle causali aziendali', () => {
    const c = new CatalogoCausali(righeCausaliSistema(), [
      versione({ id: 'e', codice: 'AZ_E', ruoloMud: 'ESCLUSO' }),
      versione({ id: 'r', codice: 'AZ_R', ruoloMud: 'RICEVUTO_DA_TERZI' }),
      versione({ id: 'a', codice: 'AZ_A', verso: 'SCARICO', ruoloMud: 'AVVIATO' }),
    ])
    expect(classificaMovimento(c, movimento({ causale: 'AZ_E', causaleAziendaId: 'e' }))).toBe(
      'ESCLUSO'
    )
    expect(classificaMovimento(c, movimento({ causale: 'AZ_R', causaleAziendaId: 'r' }))).toBe(
      'RICEVUTO_DA_TERZI'
    )
    expect(
      classificaMovimento(c, movimento({ type: 'SCARICO', causale: 'AZ_A', causaleAziendaId: 'a' }))
    ).toBe('AVVIATO')
  })
  it('due versioni con ruoli diversi: conta la versione del movimento, anche se chiusa', () => {
    const c = new CatalogoCausali(righeCausaliSistema(), [
      versione({ id: 'v1', ruoloMud: 'PRODOTTO', validaAl: '2025-06-30' }),
      versione({ id: 'v2', ruoloMud: 'ESCLUSO', validaDal: '2025-07-01' }),
    ])
    const dopo = new Date('2025-12-01T08:00:00Z')
    // il movimento porta v1 (chiusa al 30/06) ma la data cade nella v2: vale v1
    expect(
      classificaMovimento(
        c,
        movimento({ causale: 'AZ_TEST', causaleAziendaId: 'v1', movementDate: dopo })
      )
    ).toBe('PRODOTTO')
    expect(
      classificaMovimento(
        c,
        movimento({ causale: 'AZ_TEST', causaleAziendaId: 'v2', movementDate: dopo })
      )
    ).toBe('ESCLUSO')
  })
  it('una versione di un altro verso non vale: ESCLUSO', () => {
    const c = new CatalogoCausali(righeCausaliSistema(), [versione({})])
    expect(
      classificaMovimento(
        c,
        movimento({ type: 'SCARICO', causale: 'AZ_TEST', causaleAziendaId: 'ver-1' })
      )
    ).toBe('ESCLUSO')
  })
})

describe('operazione R/D', () => {
  it('dal codice operazione', () => {
    expect(operazioneDaCodice('R13')).toBe('R')
    expect(operazioneDaCodice(' d15')).toBe('D')
    expect(operazioneDaCodice('')).toBeUndefined()
    expect(operazioneDaCodice(null)).toBeUndefined()
    expect(operazioneDaCodice('X1')).toBeUndefined()
  })
  it('dal catalogo', () => {
    const op = (causale: string) =>
      operazioneDaCatalogo(catalogoSistema(), movimento({ type: 'SCARICO', causale }))
    expect(op('AVVIO_RECUPERO')).toBe('R')
    expect(op('AVVIO_SMALTIMENTO')).toBe('D')
    expect(op('CONFERIMENTO_TRASPORTATORE')).toBeUndefined()
  })
  // Gli scarichi sono l'unico caso raggiungibile: un CARICO con causale di scarico è ESCLUSO
  // prima di arrivare alla scelta R/D (il vecchio codice guardava la sola causale).
  it.each(['AVVIO_RECUPERO', 'AVVIO_SMALTIMENTO', 'CESSIONE', 'ALTRO_SCARICO', 'SCONOSCIUTA', ''])(
    'equivale alla vecchia implementazione sugli scarichi: %j',
    causale => {
      expect(operazioneDaCatalogo(catalogoSistema(), movimento({ type: 'SCARICO', causale }))).toBe(
        vecchiaOperazione(causale)
      )
    }
  )
  it('una causale aziendale con operazione R', () => {
    const c = new CatalogoCausali(righeCausaliSistema(), [
      versione({ verso: 'SCARICO', ruoloMud: 'AVVIATO', operazione: 'R' }),
    ])
    expect(
      operazioneDaCatalogo(
        c,
        movimento({ type: 'SCARICO', causale: 'AZ_TEST', causaleAziendaId: 'ver-1' })
      )
    ).toBe('R')
  })
})

describe('hashAggregato', () => {
  const riga = (cer: string, kg: number) => ({
    cerCode: cer,
    prodottoKg: kg,
    recuperoKg: 0,
    smaltimentoKg: kg,
    dr: [],
    te: [],
  })
  it("non dipende dall'ordine delle righe", () => {
    expect(hashAggregato([riga('170405', 1), riga('150101', 2)])).toBe(
      hashAggregato([riga('150101', 2), riga('170405', 1)])
    )
  })
  it('cambia se cambia una quantità', () => {
    expect(hashAggregato([riga('170405', 1)])).not.toBe(hashAggregato([riga('170405', 1.001)]))
  })
  it("non dipende dall'ordine di dr e te", () => {
    const a = { codiceFiscale: '111', ragioneSociale: 'A', quantitaKg: 1 }
    const b = { codiceFiscale: '222', ragioneSociale: 'B', quantitaKg: 2 }
    const t1 = { codiceFiscale: '333', ragioneSociale: 'C' }
    const t2 = { codiceFiscale: '333', ragioneSociale: 'D' }
    const base = { cerCode: '170405', prodottoKg: 3, recuperoKg: 0, smaltimentoKg: 3 }
    expect(hashAggregato([{ ...base, dr: [a, b], te: [t1, t2] }])).toBe(
      hashAggregato([{ ...base, dr: [b, a], te: [t2, t1] }])
    )
  })
  it("non dipende dall'ordine di rt, re, mg e dei dr a parità di chiave", () => {
    const base = { cerCode: '170405', prodottoKg: 3, recuperoKg: 0, smaltimentoKg: 3, te: [] }
    const dr = [
      { codiceFiscale: '111', ragioneSociale: 'A', quantitaKg: 1 },
      { codiceFiscale: '111', ragioneSociale: 'A', quantitaKg: 2 },
    ]
    const rt = [
      { codiceFiscale: '222', ragioneSociale: 'B', quantitaKg: 1 },
      { codiceFiscale: '111', ragioneSociale: 'C', quantitaKg: 5 },
    ]
    const re = [
      { istatProvincia: '001', istatComune: '002', quantitaKg: 1 },
      { istatProvincia: '001', istatComune: '002', quantitaKg: 4 },
    ]
    const mg = [{ tipologiaImpianto: 21 }, { tipologiaImpianto: 22 }] as MudModuloGestione[]
    const invertita = {
      ...base,
      dr: [...dr].reverse(),
      rt: [...rt].reverse(),
      re: [...re].reverse(),
      mg: [...mg].reverse(),
    }
    expect(hashAggregato([{ ...base, dr, rt, re, mg }])).toBe(hashAggregato([invertita]))
  })
  it('righe con lo stesso cerCode: ordine di lettura irrilevante', () => {
    const a = riga('170405', 1)
    const b = riga('170405', 2)
    expect(hashAggregato([a, b])).toBe(hashAggregato([b, a]))
  })
  it('ignora le differenze oltre il terzo decimale', () => {
    expect(hashAggregato([riga('170405', 1.0001)])).toBe(hashAggregato([riga('170405', 1)]))
  })
  it('è un SHA-256 esadecimale', () => {
    expect(hashAggregato([])).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('statoFisicoMud', () => {
  it.each([
    ['Solido', 'SOLIDO_NON_POLVERULENTO'],
    ['  LIQUIDO ', 'LIQUIDO'],
    ['Polvere', 'SOLIDO_POLVERULENTO'],
    ['polverulento', 'SOLIDO_POLVERULENTO'],
    ['Fangoso', 'FANGOSO_PALABILE'],
    ['Gassoso', 'AERIFORME'],
    ['Misto', 'ALTRO'],
    ['Vischioso', 'VISCHIOSO_SCIROPPOSO'],
    ['vischioso sciropposo', 'VISCHIOSO_SCIROPPOSO'],
    ['Viscoso-sciropposo', 'VISCHIOSO_SCIROPPOSO'],
    ['Aeriforme', 'AERIFORME'],
    ['Solido polverulento', 'SOLIDO_POLVERULENTO'],
    ['In polvere o pulverulento', 'SOLIDO_POLVERULENTO'],
    ['Solido non polverulento', 'SOLIDO_NON_POLVERULENTO'],
    ['FANGOSO_PALABILE', 'FANGOSO_PALABILE'],
    ['Fangoso palabile', 'FANGOSO_PALABILE'],
    ['Altro', 'ALTRO'],
    ['Rifiuto strano', 'NON_RICONOSCIUTO'],
    ['', null],
    [null, null],
    [undefined, null],
  ])('statoFisicoMud(%j) -> %j', (valore, atteso) => {
    expect(statoFisicoMud(valore)).toBe(atteso)
  })
})

// Valori scritti a mano: calcolati con il codice PRIMA della modifica del Task 5b
// (hashAggregato e hashDichiarante di mud-regole.ts di bb4d136) con
// `npx ts-node -T -O '{"module":"commonjs","moduleResolution":"node"}' <script>` da apps/backend.
describe('hash invariati (Task 5b)', () => {
  const righeFisse = [
    {
      cerCode: '170405',
      prodottoKg: 100,
      recuperoKg: 80,
      smaltimentoKg: 20,
      dr: [
        {
          codiceFiscale: '33333333333',
          ragioneSociale: 'Recupero Metalli Srl',
          quantitaKg: 100,
        },
      ],
      te: [{ codiceFiscale: '22222222222', ragioneSociale: 'Trasporti Srl' }],
    },
    { cerCode: '150101', prodottoKg: 5.5, recuperoKg: 5.5, smaltimentoKg: 0 },
  ] as unknown as MudRifiutoLine[]

  it('hashAggregato invariato su un caso fisso', () => {
    expect(hashAggregato(righeFisse)).toBe(
      '750e1c4a0536d793f7da5bf6d9f63bb4cb4edeb1b59c48748a3f04c518fd64d6'
    )
  })

  it('hashDichiarante senza unitaLocali ha il valore di oggi', () => {
    const d = {
      azienda: {
        ragioneSociale: 'Acme Spa',
        partitaIva: '12345678901',
        comune: 'Roma',
        comuneCode: '058091',
        numeroAddetti: 42,
      },
      autorizzazioni: [],
    } as unknown as Parameters<typeof hashDichiarante>[0]
    expect(hashDichiarante(d)).toBe(
      'beb62b153a20b9e479de381aed4b054cd5e805778d311d9d11453f4b2bde8f1f'
    )
    expect(hashDichiarante({ ...d, unitaLocali: [] })).not.toBe(hashDichiarante(d))
  })
})

describe('hashDichiarazioni e hashCalcoloMud (D10)', () => {
  const riga = (cer: string, kg: number): MudRifiutoLine => ({
    cerCode: cer,
    prodottoKg: kg,
    recuperoKg: 0,
    smaltimentoKg: kg,
    dr: [],
    te: [],
  })
  const dich = (codice: string, righe: MudRifiutoLine[]) => ({
    codice,
    righe,
    progressivo: Number(codice),
    unitaLocale: { principale: codice === '000000000000001' },
    anagrafica: null,
    numeroAddetti: 3,
    comuneCode: '058091',
  })

  it("una dichiarazione di codice 2 entra in hashDichiarazioni e cambia l'hash", () => {
    const righe = [riga('170405', 1)]
    expect(hashDichiarazioni([dich('000000000000001', righe)])).not.toBe(
      hashDichiarazioni([dich('000000000000002', righe)])
    )
    expect(hashDichiarazioni([dich('000000000000002', righe)])).not.toBe(hashAggregato(righe))
    expect(
      hashCalcoloMud({
        versioneCalcolo: 2,
        righe,
        dichiarazioni: [dich('000000000000002', righe)],
      })
    ).toBe(hashDichiarazioni([dich('000000000000002', righe)]))
  })

  it("due dichiarazioni: hash indipendente dall'ordine di lettura", () => {
    const a = dich('000000000000001', [riga('170405', 1), riga('150101', 2)])
    const b = dich('000000000000002', [riga('170405', 3)])
    const invertita = dich('000000000000001', [riga('150101', 2), riga('170405', 1)])
    expect(hashDichiarazioni([a, b])).toBe(hashDichiarazioni([b, invertita]))
  })

  it('due dichiarazioni con le stesse righe in sedi diverse hanno un hash diverso', () => {
    const righe = [riga('170405', 1)]
    expect(
      hashDichiarazioni([dich('000000000000001', righe), dich('000000000000002', [])])
    ).not.toBe(hashDichiarazioni([dich('000000000000001', []), dich('000000000000002', righe)]))
  })

  it('una dichiarazione di codice 1 senza giacenze: hashCalcoloMud = hashAggregato', () => {
    const righe = [riga('170405', 1), riga('150101', 2)]
    const aggregato = {
      versioneCalcolo: 2 as const,
      righe,
      dichiarazioni: [dich('000000000000001', righe)],
    }
    expect(hashCalcoloMud(aggregato)).toBe(hashAggregato(righe))
  })

  it('versione 1 e aggregato senza dichiarazioni: hashAggregato delle righe', () => {
    const righe = [riga('170405', 1)]
    expect(
      hashCalcoloMud({
        versioneCalcolo: 1,
        righe,
        dichiarazioni: [dich('000000000000002', [])],
      })
    ).toBe(hashAggregato(righe))
    expect(hashCalcoloMud({ righe })).toBe(hashAggregato(righe))
  })

  it('hashDichiaranteMud: valore di oggi con la sola azienda, cambia con le sedi', () => {
    const d = {
      azienda: { ragioneSociale: 'Acme', partitaIva: '1', numeroAddetti: 3 },
      autorizzazioni: [],
    } as unknown as Parameters<typeof hashDichiarante>[0]
    const righe = [riga('170405', 1)]
    const unica = {
      versioneCalcolo: 2 as const,
      righe,
      dichiarazioni: [dich('000000000000001', righe)],
    }
    expect(hashDichiaranteMud(d, unica)).toBe(hashDichiarante(d))
    expect(hashDichiaranteMud(d, {})).toBe(hashDichiarante(d))
    const sede = {
      versioneCalcolo: 2 as const,
      righe,
      dichiarazioni: [
        dich('000000000000001', righe),
        {
          ...dich('000000000000002', []),
          anagrafica: {
            id: 'ul-2',
            denominazione: 'Sede 2',
            numIscrSito: 'X',
            principale: false,
            createdAt: new Date(0),
            indirizzo: 'Via Sede',
            civico: null,
            cap: '00100',
            comune: 'Roma',
            provincia: 'RM',
            numeroAddetti: 5,
            progressivoMud: 2,
          },
          numeroAddetti: 5,
        },
      ],
    }
    expect(hashDichiaranteMud(d, sede)).not.toBe(hashDichiarante(d))
  })
})
