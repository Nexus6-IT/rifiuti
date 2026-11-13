import type { PayloadLettura } from './payload-lettura'
import {
  AVVISO_LETTURA_SIMULATA,
  MESSAGGI_RIFIUTO,
  MINUTI_DIFFERITA,
  MINUTI_SFASAMENTO,
  MINUTI_TOLLERANZA_OROLOGIO,
  ORE_VALIDITA_LETTURA,
  avvisiLettura,
  valutaLettura,
  type CodiceRifiuto,
  type ContestoValutazione,
} from './regole-lettura'

const AGENTE = '6f1c2f7e-3d5a-4b8e-9a41-0c2d7e5b9a10'
const STRUMENTO = 'a3b8d1b6-0b3b-4b3a-8a1a-5c1d2e3f4a5b'
const RICEZIONE = new Date('2026-11-13T09:16:00.000Z')
const min = (d: Date, m: number) => new Date(d.getTime() + m * 60_000)

function payload(extra: Partial<PayloadLettura> = {}): PayloadLettura {
  return {
    v: 1,
    agenteId: AGENTE,
    strumentoId: STRUMENTO,
    chiaveIdempotenza: '0b9c6f0e-8d2a-4c57-9e1b-7a3f5d2c4e68',
    sequenza: 1,
    pesoKg: '12340.00',
    pesoCentesimi: 1234000,
    unita: 'kg',
    stabile: true,
    alibiId: null,
    oraStrumento: null,
    oraAgente: new Date('2026-11-13T09:15:03.123Z'),
    driver: 'D800-MP',
    simulata: false,
    grezzo: null,
    ...extra,
  }
}

function ctx(extra: Partial<ContestoValutazione> = {}): ContestoValutazione {
  return {
    agenteId: AGENTE,
    strumento: { id: STRUMENTO, agenteId: AGENTE, attivo: true, portataMaxKg: 60000 },
    simulazioneAmmessa: false,
    ricezione: RICEZIONE,
    ...extra,
  }
}

describe('costanti', () => {
  it('hanno i valori del piano', () => {
    expect(ORE_VALIDITA_LETTURA).toBe(24)
    expect(MINUTI_TOLLERANZA_OROLOGIO).toBe(5)
    expect(MINUTI_DIFFERITA).toBe(15)
    expect(MINUTI_SFASAMENTO).toBe(10)
  })
})

describe('valutaLettura: rifiuti', () => {
  const rifiutata = (p: PayloadLettura, c: ContestoValutazione, codice: CodiceRifiuto) => {
    const e = valutaLettura(p, c)
    expect(e).toMatchObject({ esito: 'RIFIUTATA', codice })
    if (e.esito === 'RIFIUTATA') expect(e.messaggio).toBe(MESSAGGI_RIFIUTO[codice])
  }

  it('accetta una lettura regolare senza avvisi', () => {
    expect(valutaLettura(payload(), ctx())).toEqual({ esito: 'ACCETTABILE', avvisi: [] })
  })

  it('AGENTE_DIVERSO: il payload dichiara un altro agente', () => {
    rifiutata(
      payload({ agenteId: 'b1c2d3e4-0000-4000-8000-000000000000' }),
      ctx(),
      'AGENTE_DIVERSO'
    )
  })

  it('STRUMENTO_NON_ASSEGNATO: strumento ignoto (anche di un’altra azienda)', () => {
    rifiutata(payload(), ctx({ strumento: null }), 'STRUMENTO_NON_ASSEGNATO')
  })

  it('STRUMENTO_NON_ASSEGNATO: strumento assegnato a un altro agente o a nessuno', () => {
    const s = { id: STRUMENTO, attivo: true, portataMaxKg: 60000 }
    rifiutata(payload(), ctx({ strumento: { ...s, agenteId: 'altro' } }), 'STRUMENTO_NON_ASSEGNATO')
    rifiutata(payload(), ctx({ strumento: { ...s, agenteId: null } }), 'STRUMENTO_NON_ASSEGNATO')
  })

  it('STRUMENTO_NON_ATTIVO', () => {
    rifiutata(
      payload(),
      ctx({ strumento: { id: STRUMENTO, agenteId: AGENTE, attivo: false, portataMaxKg: 60000 } }),
      'STRUMENTO_NON_ATTIVO'
    )
  })

  it('PESO_INSTABILE', () => {
    rifiutata(payload({ stabile: false }), ctx(), 'PESO_INSTABILE')
  })

  it('PESO_NON_VALIDO: zero, oltre il massimo', () => {
    rifiutata(payload({ pesoKg: '0.00', pesoCentesimi: 0 }), ctx(), 'PESO_NON_VALIDO')
    rifiutata(
      payload({ pesoKg: '100000000.00', pesoCentesimi: 10_000_000_000 }),
      ctx({ strumento: { id: STRUMENTO, agenteId: AGENTE, attivo: true, portataMaxKg: null } }),
      'PESO_NON_VALIDO'
    )
  })

  it('FUORI_PORTATA: 60.000,00 passa, 60.000,01 no; senza portata non si controlla', () => {
    expect(
      valutaLettura(payload({ pesoKg: '60000.00', pesoCentesimi: 6_000_000 }), ctx()).esito
    ).toBe('ACCETTABILE')
    rifiutata(payload({ pesoKg: '60000.01', pesoCentesimi: 6_000_001 }), ctx(), 'FUORI_PORTATA')
    const senza = ctx({
      strumento: { id: STRUMENTO, agenteId: AGENTE, attivo: true, portataMaxKg: null },
    })
    expect(
      valutaLettura(payload({ pesoKg: '90000.00', pesoCentesimi: 9_000_000 }), senza).esito
    ).toBe('ACCETTABILE')
  })

  it('OROLOGIO_AVANTI: oraAgente a +6 min rifiutata, a +4 min accettabile', () => {
    rifiutata(payload({ oraAgente: min(RICEZIONE, 6) }), ctx(), 'OROLOGIO_AVANTI')
    expect(valutaLettura(payload({ oraAgente: min(RICEZIONE, 4) }), ctx()).esito).toBe(
      'ACCETTABILE'
    )
  })

  it('oraStrumento avanti (anche di un’ora): lettura accettata con l’avviso di sfasamento, non OROLOGIO_AVANTI', () => {
    const v = valutaLettura(
      payload({ oraAgente: min(RICEZIONE, -1), oraStrumento: min(RICEZIONE, 60) }),
      ctx()
    )
    expect(v.esito).toBe('ACCETTABILE')
    expect(v.esito === 'ACCETTABILE' && v.avvisi.join('|')).toContain('sfasato')
  })

  it('SIMULAZIONE_NON_AMMESSA e, con il permesso, accettata con avviso', () => {
    const sim = payload({ driver: 'SIMULATA', simulata: true })
    rifiutata(sim, ctx({ simulazioneAmmessa: false }), 'SIMULAZIONE_NON_AMMESSA')
    expect(valutaLettura(sim, ctx({ simulazioneAmmessa: true }))).toEqual({
      esito: 'ACCETTABILE',
      avvisi: [AVVISO_LETTURA_SIMULATA],
    })
  })

  it('ogni codice di rifiuto ha un messaggio in italiano (anche quelli decisi dal database)', () => {
    const codici: CodiceRifiuto[] = [
      'FIRMA_NON_VALIDA',
      'PAYLOAD_NON_VALIDO',
      'AGENTE_DIVERSO',
      'STRUMENTO_NON_ASSEGNATO',
      'STRUMENTO_NON_ATTIVO',
      'PESO_INSTABILE',
      'PESO_NON_VALIDO',
      'FUORI_PORTATA',
      'OROLOGIO_AVANTI',
      'SIMULAZIONE_NON_AMMESSA',
      'CHIAVE_RIUSATA',
      'SEQUENZA_GIA_USATA',
      'ALIBI_GIA_USATO',
    ]
    expect(Object.keys(MESSAGGI_RIFIUTO).sort()).toEqual([...codici].sort())
    for (const c of codici) expect(MESSAGGI_RIFIUTO[c].length).toBeGreaterThan(10)
  })
})

describe('avvisiLettura', () => {
  const base = { oraAgente: new Date('2026-11-13T09:00:00Z'), oraStrumento: null, simulata: false }

  it('differita: 16 min dopo la pesata sì, 14 min no, esattamente 15 no', () => {
    const a = new Date('2026-11-13T09:00:00Z')
    expect(avvisiLettura({ ...base, oraRicezione: min(a, 16) })).toEqual([
      'Trasmessa in differita (16 min dopo la pesata)',
    ])
    expect(avvisiLettura({ ...base, oraRicezione: min(a, 14) })).toEqual([])
    expect(avvisiLettura({ ...base, oraRicezione: min(a, 15) })).toEqual([])
  })

  it('orologio dello strumento sfasato oltre 10 min (in entrambi i sensi)', () => {
    const a = base.oraAgente
    expect(avvisiLettura({ ...base, oraRicezione: min(a, 1), oraStrumento: min(a, -11) })).toEqual([
      'Orologio dello strumento sfasato di 11 min rispetto al PC',
    ])
    expect(avvisiLettura({ ...base, oraRicezione: min(a, 1), oraStrumento: min(a, 11) })).toEqual([
      'Orologio dello strumento sfasato di 11 min rispetto al PC',
    ])
    expect(avvisiLettura({ ...base, oraRicezione: min(a, 1), oraStrumento: min(a, 9) })).toEqual([])
  })

  it('simulata', () => {
    expect(
      avvisiLettura({ ...base, oraRicezione: min(base.oraAgente, 1), simulata: true })
    ).toEqual([AVVISO_LETTURA_SIMULATA])
  })
})
