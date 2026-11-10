import { eUuid, normalizzaDatiRitiro, normalizzaMotivo, statiFirPerVisibile } from './ritiri.input'
import type { DatiRitiro } from './ritiri.tipi'

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const base = (
  extra: Partial<Omit<DatiRitiro, 'codiceOperazione'>> & { codiceOperazione?: string | null } = {}
): DatiRitiro => ({
  dataPrevista: '2026-12-01',
  produttoreId: U(1),
  produttoreSedeId: U(2),
  trasportatoreId: U(3),
  destinatarioId: U(4),
  destinatarioSedeId: U(5),
  cerCode: '20 03 01',
  descrizione: 'Rifiuti urbani',
  quantitaPresunta: '1250.5',
  codiceOperazione: 'R13',
  provenienza: 'SPECIALE',
  tipoTratta: 'TERRESTRE',
  ...(extra as Partial<DatiRitiro>),
})

describe('normalizzaDatiRitiro', () => {
  it('accetta dati validi e porta la quantità a due decimali', () => {
    const e = normalizzaDatiRitiro(base())
    expect(e.ok).toBe(true)
    if (e.ok) {
      expect(e.valori.quantitaPresunta).toBe('1250.50')
      expect(e.valori.unita).toBe('KG')
      expect(e.valori.tipoOperazione).toBe('RECOVERY')
    }
  })

  it.each([undefined, null, '', '  '])('rifiuta il codice operazione assente (%p)', c => {
    const e = normalizzaDatiRitiro(base({ codiceOperazione: c }))
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.messaggi.join(' ')).toContain('codice')
  })

  it.each([
    [{ provenienza: undefined }, 'provenienza'],
    [{ provenienza: null }, 'provenienza'],
    [{ tipoTratta: undefined }, 'tratta'],
    [{ tipoTratta: null }, 'tratta'],
  ])('rifiuta provenienza o tipo di tratta assenti (%j)', (extra, parola) => {
    const e = normalizzaDatiRitiro(base(extra as never))
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.messaggi.join(' ')).toContain(parola)
  })

  it.each(['X1', '10', 'RR'])('rifiuta il codice operazione %p che non comincia con D o R', c => {
    expect(normalizzaDatiRitiro(base({ codiceOperazione: c })).ok).toBe(false)
  })

  it.each(['0', '-1', '1,5', 'abc', '1.234', '', '123456789'])('rifiuta la quantità %p', q => {
    const e = normalizzaDatiRitiro(base({ quantitaPresunta: q }))
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.messaggi.join(' ')).toContain('quantità')
  })

  it('rifiuta data, ordine nel giro e identificativi non validi, tutti insieme', () => {
    const e = normalizzaDatiRitiro(
      base({ dataPrevista: '2026-02-30', ordineGiro: 0, produttoreId: 'x', automezzoId: 'y' })
    )
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.messaggi.length).toBe(4)
  })

  it('rifiuta una descrizione vuota o un CER troppo lungo', () => {
    const e = normalizzaDatiRitiro(base({ descrizione: '  ', cerCode: '1'.repeat(11) }))
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.messaggi.length).toBe(2)
  })

  it('deriva il tipo di operazione dalla lettera del codice, senza default', () => {
    const d = normalizzaDatiRitiro(base({ codiceOperazione: 'D10' }))
    const r = normalizzaDatiRitiro(base({ codiceOperazione: 'r13' }))
    expect(d.ok && d.valori.tipoOperazione).toBe('DISPOSAL')
    expect(r.ok && r.valori.tipoOperazione).toBe('RECOVERY')
    expect(r.ok && r.valori.codiceOperazione).toBe('R13')
  })

  it("rifiuta un'unità non supportata e normalizza il maiuscolo", () => {
    expect(normalizzaDatiRitiro(base({ unita: 'm3' })).ok).toBe(false)
    const e = normalizzaDatiRitiro(base({ unita: 'litri' }))
    expect(e.ok && e.valori.unita).toBe('LITRI')
  })

  it('i testi vuoti diventano null', () => {
    const e = normalizzaDatiRitiro(base({ annotazioni: '  ', noteInterne: '' }))
    expect(e.ok && e.valori.annotazioni).toBeNull()
    expect(e.ok && e.valori.noteInterne).toBeNull()
  })
})

describe('normalizzaMotivo', () => {
  it('richiede un motivo non vuoto di al massimo 500 caratteri', () => {
    expect(normalizzaMotivo('  ').ok).toBe(false)
    expect(normalizzaMotivo(undefined).ok).toBe(false)
    expect(normalizzaMotivo('x'.repeat(501)).ok).toBe(false)
    const ok = normalizzaMotivo('  cliente assente ')
    expect(ok.ok && ok.motivo).toBe('cliente assente')
  })
})

describe('statiFirPerVisibile', () => {
  it('segue la mappa di dominio', () => {
    expect(statiFirPerVisibile('FIR_BOZZA')).toEqual(['DRAFT', 'AWAITING_PRODUCER'])
    expect(statiFirPerVisibile('FIR_EMESSO')).toEqual(['AWAITING_CARRIER'])
    expect(statiFirPerVisibile('CONSEGNATO')).toEqual(['COMPLETED', 'SYNCED_TO_RENTRI'])
    expect(statiFirPerVisibile('DA_GENERARE')).toEqual([])
  })
})

describe('eUuid', () => {
  it('riconosce gli uuid', () => {
    expect(eUuid(U(1))).toBe(true)
    expect(eUuid('1; DROP')).toBe(false)
  })
})
