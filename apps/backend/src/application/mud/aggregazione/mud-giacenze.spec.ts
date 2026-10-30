import type { MudRifiutoLine } from '../export/mud-export.types'
import {
  creaContestoSedi,
  type MudDichiarazione,
  type MudUnitaLocaleAnagrafica,
} from './mud-dichiarazioni'
import { giacenzeDelleDichiarazioni, type SaldoRegistro } from './mud-giacenze'
import { INTEGRAZIONI_VUOTE, type IntegrazioniMud } from './mud-integrazioni'

const sede = (p: Partial<MudUnitaLocaleAnagrafica>): MudUnitaLocaleAnagrafica => ({
  id: 'ul-1',
  denominazione: 'Sede',
  numIscrSito: 'OP1',
  principale: true,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  indirizzo: null,
  civico: null,
  cap: null,
  comune: null,
  provincia: null,
  numeroAddetti: null,
  progressivoMud: 1,
  ...p,
})

const riga = (p: Partial<MudRifiutoLine>): MudRifiutoLine => ({
  cerCode: '170405',
  prodottoKg: 0,
  recuperoKg: 0,
  smaltimentoKg: 0,
  ...p,
})

const saldo = (p: Partial<SaldoRegistro>): SaldoRegistro => ({
  registroId: 'reg-A',
  cerCode6: '17 04 05',
  kg: 300,
  pericoloso: false,
  ...p,
})

const dich = (
  ul: MudUnitaLocaleAnagrafica | null,
  righe: MudRifiutoLine[]
): Pick<MudDichiarazione, 'unitaLocale' | 'righe'> => ({
  unitaLocale: ul
    ? {
        id: ul.id,
        denominazione: ul.denominazione,
        numIscrSito: ul.numIscrSito,
        principale: ul.principale,
      }
    : { id: null, denominazione: 'Azienda', numIscrSito: null, principale: false },
  righe,
})

const ul1 = sede({})
const ul2 = sede({
  id: 'ul-2',
  denominazione: 'Deposito',
  numIscrSito: 'OP2',
  principale: false,
  progressivoMud: 2,
})
const contesto = creaContestoSedi(
  [ul1, ul2],
  new Map<string, string | null>([
    ['reg-A', 'ul-1'],
    ['reg-B', 'ul-2'],
    ['reg-X', null],
  ])
)

const conIntegrazioni = (destinazioniGiacenza: IntegrazioniMud['destinazioniGiacenza']) => ({
  ...INTEGRAZIONI_VUOTE,
  destinazioniGiacenza,
})

describe('mud-giacenze: giacenze al 31/12 per dichiarazione (D8)', () => {
  it('D8: saldo scritto nella riga della stessa sede', () => {
    const rigaDeposito = riga({ recuperoKg: 100 })
    const rigaSede = riga({ recuperoKg: 40 })
    const e = giacenzeDelleDichiarazioni(
      [saldo({ registroId: 'reg-B', kg: 300 })],
      contesto,
      [dich(ul1, [rigaSede]), dich(ul2, [rigaDeposito])],
      [],
      INTEGRAZIONI_VUOTE
    )
    expect(e.righe.get('ul-2')).toEqual([riga({ recuperoKg: 100, giacenzaRecuperoKg: 300 })])
    // l'altra sede non riceve nulla
    expect(e.righe.get('ul-1')).toEqual([riga({ recuperoKg: 40 })])
    expect('giacenzaRecuperoKg' in (e.righe.get('ul-1') as MudRifiutoLine[])[0]).toBe(false)
    // le righe dell'aggregato non si mutano
    expect(rigaDeposito).toEqual(riga({ recuperoKg: 100 }))
    expect(e.righe.get('ul-2')![0]).not.toBe(rigaDeposito)
    expect(e.nonDichiarate).toEqual([])
    expect(e.kgScritti).toBe(300)
  })

  it('D8: più registri della stessa sede si sommano prima della soglia', () => {
    const contestoDue = creaContestoSedi(
      [ul1],
      new Map<string, string | null>([
        ['reg-A', 'ul-1'],
        ['reg-A2', 'ul-1'],
      ])
    )
    const e = giacenzeDelleDichiarazioni(
      [saldo({ registroId: 'reg-A', kg: 500 }), saldo({ registroId: 'reg-A2', kg: -200 })],
      contestoDue,
      [dich(ul1, [riga({ smaltimentoKg: 10 })])],
      [],
      INTEGRAZIONI_VUOTE
    )
    expect(e.righe.get('ul-1')).toEqual([riga({ smaltimentoKg: 10, giacenzaSmaltimentoKg: 300 })])
  })

  it('D8: saldo di un registro senza sede sulla principale', () => {
    // I8: il registro reg-X non ha sede, la giacenza va con i suoi movimenti sulla principale
    const e = giacenzeDelleDichiarazioni(
      [saldo({ registroId: 'reg-X', kg: 75.5 })],
      contesto,
      [dich(ul1, [riga({ recuperoKg: 5 })]), dich(ul2, [riga({ recuperoKg: 5 })])],
      [],
      INTEGRAZIONI_VUOTE
    )
    expect(e.righe.get('ul-1')).toEqual([riga({ recuperoKg: 5, giacenzaRecuperoKg: 75.5 })])
    expect(e.righe.get('ul-2')).toEqual([riga({ recuperoKg: 5 })])
  })

  it('D8: CER senza riga → non dichiarata', () => {
    const e = giacenzeDelleDichiarazioni(
      [
        saldo({ cerCode6: '20 03 01', kg: 40 }),
        saldo({ cerCode6: '15 01 10*', kg: 12.5, pericoloso: true }),
      ],
      contesto,
      [dich(ul1, [riga({ recuperoKg: 5 })])],
      [],
      INTEGRAZIONI_VUOTE
    )
    expect(e.righe.get('ul-1')).toEqual([riga({ recuperoKg: 5 })])
    expect(e.nonDichiarate).toHaveLength(1)
    expect(e.nonDichiarate[0].chiave).toBe('ul-1')
    expect(e.nonDichiarate[0].voci).toEqual([
      { cerCode: '15 01 10*', kg: 12.5, motivo: 'NESSUN_MOVIMENTO' },
      { cerCode: '20 03 01', kg: 40, motivo: 'NESSUN_MOVIMENTO' },
    ])
    expect(e.kgScritti).toBe(0)
  })

  it('D8: la giacenza di una sede senza pacchetto è non dichiarata, con la sua sede', () => {
    const e = giacenzeDelleDichiarazioni(
      [saldo({ registroId: 'reg-B', kg: 90 })],
      contesto,
      [dich(ul1, [riga({ recuperoKg: 5 })])],
      [],
      INTEGRAZIONI_VUOTE
    )
    expect(e.nonDichiarate).toEqual([
      {
        chiave: 'ul-2',
        unitaLocale: ul2,
        voci: [{ cerCode: '17 04 05', kg: 90, motivo: 'NESSUN_MOVIMENTO' }],
      },
    ])
  })

  it('D8: ricevuto da terzi → non dichiarata', () => {
    const e = giacenzeDelleDichiarazioni(
      [saldo({ kg: 120 })],
      contesto,
      [dich(ul1, [riga({ recuperoKg: 5 })])],
      [{ registroId: 'reg-A', cerCode: '17 04 05' }],
      INTEGRAZIONI_VUOTE
    )
    expect(e.righe.get('ul-1')).toEqual([riga({ recuperoKg: 5 })])
    expect(e.nonDichiarate[0].voci).toEqual([
      { cerCode: '17 04 05', kg: 120, motivo: 'RICEVUTO_DA_TERZI' },
    ])
    // un ricevuto di un'altra sede non toglie la giacenza di questa
    const altra = giacenzeDelleDichiarazioni(
      [saldo({ kg: 120 })],
      contesto,
      [dich(ul1, [riga({ recuperoKg: 5 })])],
      [{ registroId: 'reg-B', cerCode: '170405' }],
      INTEGRAZIONI_VUOTE
    )
    expect(altra.righe.get('ul-1')![0].giacenzaRecuperoKg).toBe(120)
    expect(altra.nonDichiarate).toEqual([])
  })

  it('D8: saldo sotto mezzo grammo ignorato', () => {
    const e = giacenzeDelleDichiarazioni(
      [saldo({ kg: 0.0004 }), saldo({ cerCode6: '20 03 01', kg: -3 })],
      contesto,
      [dich(ul1, [riga({ recuperoKg: 5 })])],
      [],
      INTEGRAZIONI_VUOTE
    )
    expect(e.righe.get('ul-1')).toEqual([riga({ recuperoKg: 5 })])
    expect(e.nonDichiarate).toEqual([])
    expect(e.ripartizioni).toEqual([])
    expect(e.kgScritti).toBe(0)
  })

  it('D8: componente nulla assente dalla riga, mai 0', () => {
    const e = giacenzeDelleDichiarazioni(
      [saldo({ kg: 60 })],
      contesto,
      [dich(ul1, [riga({ recuperoKg: 5 })])],
      [],
      INTEGRAZIONI_VUOTE
    )
    const scritta = e.righe.get('ul-1')![0]
    expect(scritta.giacenzaRecuperoKg).toBe(60)
    expect('giacenzaSmaltimentoKg' in scritta).toBe(false)
    expect(Object.keys(scritta)).not.toContain('giacenzaSmaltimentoKg')
  })
})

describe('mud-giacenze: recupero o smaltimento (D9)', () => {
  const unaSede = (r: Partial<MudRifiutoLine>, kg: number, integrazioni = INTEGRAZIONI_VUOTE) =>
    giacenzeDelleDichiarazioni([saldo({ kg })], contesto, [dich(ul1, [riga(r)])], [], integrazioni)

  it('D9: integrazione R vince', () => {
    const integrazioni = conIntegrazioni({
      'ul-1|170405': { cerCode: '170405', unitaLocaleId: 'ul-1', destinazione: 'R' },
    })
    // la riga avrebbe dato smaltimento: l'integrazione vince e non c'è avviso
    const e = unaSede({ smaltimentoKg: 50 }, 80, integrazioni)
    const r = e.righe.get('ul-1')![0]
    expect(r.giacenzaRecuperoKg).toBe(80)
    expect('giacenzaSmaltimentoKg' in r).toBe(false)
    expect(e.ripartizioni).toEqual([])
    // integrazione D: stessa cosa sul verso opposto, anche con entrambi gli avvii
    const d = unaSede(
      { recuperoKg: 10, smaltimentoKg: 10 },
      80,
      conIntegrazioni({
        'ul-1|170405': { cerCode: '170405', unitaLocaleId: 'ul-1', destinazione: 'D' },
      })
    )
    expect(d.righe.get('ul-1')![0].giacenzaSmaltimentoKg).toBe(80)
    expect('giacenzaRecuperoKg' in d.righe.get('ul-1')![0]).toBe(false)
    expect(d.ripartizioni).toEqual([])
  })

  it('D9: solo recupero', () => {
    const e = unaSede({ recuperoKg: 200 }, 80)
    const r = e.righe.get('ul-1')![0]
    expect(r.giacenzaRecuperoKg).toBe(80)
    expect('giacenzaSmaltimentoKg' in r).toBe(false)
    expect(e.ripartizioni).toEqual([])
  })

  it('D9: solo smaltimento', () => {
    const e = unaSede({ smaltimentoKg: 200 }, 80)
    const r = e.righe.get('ul-1')![0]
    expect(r.giacenzaSmaltimentoKg).toBe(80)
    expect('giacenzaRecuperoKg' in r).toBe(false)
    expect(e.ripartizioni).toEqual([])
  })

  it('D9: entrambi, proporzione al grammo e somma esatta', () => {
    // 100,001 kg con avvii 1 : 2 → recupero 33,3336... → 33,334 kg; smaltimento 100,001 - 33,334 = 66,667
    const e = unaSede({ recuperoKg: 1, smaltimentoKg: 2 }, 100.001)
    const r = e.righe.get('ul-1')![0]
    expect(r.giacenzaRecuperoKg).toBe(33.334)
    expect(r.giacenzaSmaltimentoKg).toBe(66.667)
    expect(
      Math.round(((r.giacenzaRecuperoKg as number) + (r.giacenzaSmaltimentoKg as number)) * 1000)
    ).toBe(100001)
    expect(e.ripartizioni).toEqual([
      {
        tipo: 'RIPARTITA',
        chiave: 'ul-1',
        unitaLocale: ul1,
        cer6: '170405',
        cerCode: '17 04 05',
        kg: 100.001,
        recuperoKg: 33.334,
        smaltimentoKg: 66.667,
      },
    ])
    // un caso in cui s - R non è esatto in virgola mobile: 0,3 = 0,1 + 0,2 con avvii 1 : 1
    const f = unaSede({ recuperoKg: 1, smaltimentoKg: 1 }, 0.3)
    expect(f.righe.get('ul-1')![0].giacenzaRecuperoKg).toBe(0.15)
    expect(f.righe.get('ul-1')![0].giacenzaSmaltimentoKg).toBe(0.15)
  })

  it("D9: l'arrotondamento al grammo dà tutto a una componente → nessuna ripartizione (F4)", () => {
    // 0,001 kg con avvii 1 : 1 → recupero 0,0005 → 0,001; smaltimento 0: niente "0 kg a smaltimento"
    const e = unaSede({ recuperoKg: 1, smaltimentoKg: 1 }, 0.001)
    const r = e.righe.get('ul-1')![0]
    expect(r.giacenzaRecuperoKg).toBe(0.001)
    expect('giacenzaSmaltimentoKg' in r).toBe(false)
    expect(e.ripartizioni).toEqual([])
  })

  it('D9: nessun avvio → smaltimento', () => {
    const e = unaSede({ prodottoKg: 500 }, 80)
    const r = e.righe.get('ul-1')![0]
    expect(r.giacenzaSmaltimentoKg).toBe(80)
    expect('giacenzaRecuperoKg' in r).toBe(false)
    expect(e.ripartizioni).toEqual([
      {
        tipo: 'DESTINAZIONE_NON_INDICATA',
        chiave: 'ul-1',
        unitaLocale: ul1,
        cer6: '170405',
        cerCode: '17 04 05',
        kg: 80,
        recuperoKg: 0,
        smaltimentoKg: 80,
      },
    ])
  })

  it("D9: integrazione di un'altra sede non vale", () => {
    // l'integrazione dice R per il deposito: la principale, con solo smaltimento, resta D
    const integrazioni = conIntegrazioni({
      'ul-2|170405': { cerCode: '170405', unitaLocaleId: 'ul-2', destinazione: 'R' },
    })
    const e = unaSede({ smaltimentoKg: 50 }, 80, integrazioni)
    const r = e.righe.get('ul-1')![0]
    expect(r.giacenzaSmaltimentoKg).toBe(80)
    expect('giacenzaRecuperoKg' in r).toBe(false)
  })
})
