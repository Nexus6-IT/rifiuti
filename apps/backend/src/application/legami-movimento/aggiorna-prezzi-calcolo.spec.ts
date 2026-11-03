import type { LegameLetto, ListinoAttuale, RigaLegameLetta } from './aggiorna-prezzi-calcolo'
import { calcolaAggiornamento } from './aggiorna-prezzi-calcolo'

const listino = (o: Partial<ListinoAttuale> = {}): ListinoAttuale => ({
  tipo: 'CER',
  prezzoSpeciale: false,
  prezzo: '12.000000',
  sconto: null,
  codiceIvaId: 'iva22',
  aliquota: '22.00',
  natura: null,
  cerCoerente: true,
  ...o,
})

const riga = (o: Partial<RigaLegameLetta> = {}): RigaLegameLetta => ({
  id: 'r1',
  rigaAddebitoId: 'ra1',
  tipo: 'CER',
  prezzoSpeciale: false,
  prezzoManuale: false,
  prezzo: '10.000000',
  sconto: null,
  quantita: '100.000',
  codiceIvaId: 'iva22',
  aliquotaIva: '22.00',
  naturaIva: null,
  listino: listino(),
  ...o,
})

const legame = (o: Partial<LegameLetto> = {}): LegameLetto => ({
  id: 'l1',
  versione: 1,
  stato: 'CONFERMATO',
  movimentoVigenteId: 'm1',
  clienteId: 'c',
  contrattoId: 'k',
  elencoId: 'e',
  motivi: [],
  avvisi: [],
  righe: [riga()],
  ...o,
})

describe('calcolaAggiornamento', () => {
  it('prezzo cambiato: una riga da scrivere, il legame resta CONFERMATO', () => {
    const c = calcolaAggiornamento([legame()], 'p')
    expect(c.daScrivere).toHaveLength(1)
    expect(c.daScrivere[0].stato).toBe('CONFERMATO')
    expect(c.daScrivere[0].righe[0]).toMatchObject({
      prezzoPrima: '10.000000',
      prezzoDopo: '12.000000',
    })
    expect(c.invariati).toBe(0)
  })

  it('confronto numerico: 12 e 12.000000 sono lo stesso prezzo', () => {
    const c = calcolaAggiornamento(
      [legame({ righe: [riga({ prezzo: '12', listino: listino({ prezzo: '12.000000' }) })] })],
      'p'
    )
    expect(c.invariati).toBe(1)
    expect(c.daScrivere).toEqual([])
  })

  it('cambia solo l’IVA: la riga si riscrive', () => {
    const c = calcolaAggiornamento(
      [
        legame({
          righe: [
            riga({
              prezzo: '12.000000',
              listino: listino({ codiceIvaId: 'n61', aliquota: '0.00', natura: 'N6.1' }),
            }),
          ],
        }),
      ],
      'p'
    )
    expect(c.daScrivere[0].righe[0]).toMatchObject({
      codiceIvaId: 'n61',
      aliquotaIva: '0.00',
      naturaIva: 'N6.1',
    })
  })

  it.each(['FATTURATO', 'IMPORTATO_FATTURATO', 'ESCLUSO', 'ANNULLATO'] as const)(
    '%s: solo contato, fuori dalla firma',
    stato => {
      const c = calcolaAggiornamento([legame({ stato, righe: [] })], 'p')
      expect(c.legamiSaltati[stato]).toBe(1)
      expect(c.scrivibili.size).toBe(0)
      expect(c.daScrivere).toEqual([])
    }
  )

  it('la firma non dipende dall’ordine di ingresso e cambia con il perimetro e con i dati', () => {
    const a = legame({ id: 'a' })
    const b = legame({ id: 'b' })
    expect(calcolaAggiornamento([a, b], 'p').firma).toBe(calcolaAggiornamento([b, a], 'p').firma)
    expect(calcolaAggiornamento([a, b], 'p').firma).not.toBe(
      calcolaAggiornamento([a, b], 'q').firma
    )
    const b2 = legame({ id: 'b', righe: [riga({ prezzoManuale: true })] })
    expect(calcolaAggiornamento([a, b2], 'p').firma).not.toBe(
      calcolaAggiornamento([a, b], 'p').firma
    )
    const b3 = legame({ id: 'b', righe: [riga({ listino: listino({ prezzo: '13.000000' }) })] })
    expect(calcolaAggiornamento([a, b3], 'p').firma).not.toBe(
      calcolaAggiornamento([a, b], 'p').firma
    )
  })

  it('riga a prezzo speciale: contata e mai riscritta', () => {
    const c = calcolaAggiornamento(
      [legame({ righe: [riga({ prezzoSpeciale: true, prezzo: null })] })],
      'p'
    )
    expect(c.righeSpeciali).toBe(1)
    expect(c.invariati).toBe(1)
  })

  it('riga manuale: contata, non riscritta, avviso PREZZO_MANUALE non toccato', () => {
    const c = calcolaAggiornamento(
      [
        legame({
          avvisi: ['PREZZO_MANUALE'],
          righe: [riga({ prezzoManuale: true, prezzo: '5.000000' })],
        }),
      ],
      'p'
    )
    expect(c.righeManuali).toBe(1)
    expect(c.daScrivere).toEqual([])
    expect(c.invariati).toBe(1)
  })

  it('manuale + non manuale: solo la seconda si scrive e l’avviso resta', () => {
    const c = calcolaAggiornamento(
      [
        legame({
          avvisi: ['PREZZO_MANUALE'],
          righe: [
            riga({ prezzoManuale: true, prezzo: '5.000000' }),
            riga({ id: 'r2', rigaAddebitoId: 'ra2' }),
          ],
        }),
      ],
      'p'
    )
    expect(c.daScrivere[0].righe.map(r => r.rigaId)).toEqual(['r2'])
    expect(c.daScrivere[0].avvisi).toEqual(['PREZZO_MANUALE'])
  })

  it('famiglia cambiata (tipo): DA_COLLEGARE con SENZA_RIGA_CER, confermato azzerato dal servizio', () => {
    const c = calcolaAggiornamento(
      [legame({ righe: [riga({ listino: listino({ tipo: 'V' }) })] })],
      'p'
    )
    expect(c.daScrivere[0]).toMatchObject({
      stato: 'DA_COLLEGARE',
      motivi: ['SENZA_RIGA_CER'],
      righe: [],
    })
    expect(c.daCollegare).toBe(1)
  })

  it('CER non piu’ coerente solo per le righe CER, non per le V', () => {
    const v = calcolaAggiornamento(
      [
        legame({
          righe: [riga({ tipo: 'V', listino: listino({ tipo: 'V', cerCoerente: false }) })],
        }),
      ],
      'p'
    )
    expect(v.daScrivere[0].stato).toBe('CONFERMATO')
    const cer = calcolaAggiornamento(
      [legame({ righe: [riga({ listino: listino({ cerCoerente: false }) })] })],
      'p'
    )
    expect(cer.daScrivere[0].stato).toBe('DA_COLLEGARE')
  })

  it('riga di listino mancante vale come famiglia cambiata; seconda esecuzione senza novita’', () => {
    const l = legame({ righe: [riga({ listino: null })] })
    expect(calcolaAggiornamento([l], 'p').daScrivere[0].motivi).toEqual(['SENZA_RIGA_CER'])
    const gia = legame({
      stato: 'DA_COLLEGARE',
      motivi: ['SENZA_RIGA_CER'],
      righe: [riga({ listino: null })],
    })
    const c = calcolaAggiornamento([gia], 'p')
    expect(c.invariati).toBe(1)
    expect(c.daCollegare).toBe(0)
  })

  it('listino a prezzo speciale: SENZA_PREZZO; poi tornato il prezzo, DA_COLLEGARE torna PROPOSTO', () => {
    const tolto = calcolaAggiornamento(
      [legame({ righe: [riga({ listino: listino({ prezzoSpeciale: true, prezzo: null }) })] })],
      'p'
    )
    expect(tolto.daScrivere[0]).toMatchObject({ stato: 'DA_COLLEGARE', motivi: ['SENZA_PREZZO'] })
    const tornato = calcolaAggiornamento(
      [
        legame({
          stato: 'DA_COLLEGARE',
          motivi: ['SENZA_PREZZO'],
          righe: [riga({ prezzo: null })],
        }),
      ],
      'p'
    )
    expect(tornato.daScrivere[0]).toMatchObject({ stato: 'PROPOSTO', motivi: [] })
    expect(tornato.daCollegare).toBe(0)
  })

  it('legame incompleto (senza elenco) con motivi altrui resta DA_COLLEGARE e tiene i suoi motivi', () => {
    const c = calcolaAggiornamento(
      [
        legame({
          stato: 'DA_COLLEGARE',
          elencoId: null,
          motivi: ['SENZA_ELENCO'],
          righe: [riga({ prezzo: null })],
        }),
      ],
      'p'
    )
    expect(c.daScrivere[0]).toMatchObject({ stato: 'DA_COLLEGARE', motivi: ['SENZA_ELENCO'] })
  })
})
