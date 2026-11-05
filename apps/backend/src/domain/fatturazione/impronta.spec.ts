import { improntaElaborazione } from './impronta'

const base = () => ({
  parametri: { dal: '2026-11-01', al: '2026-11-30', raggruppamento: 'PER_CONTRATTO' },
  legami: [
    { id: 'L1', versione: 1 },
    { id: 'L2', versione: 3 },
  ],
  contratti: [{ id: 'C1', versione: 2 }],
  elenchi: [{ id: 'E1', versione: 1 }],
  righeAddebito: [{ id: 'R1', versione: 1 }],
  codiciIva: [{ id: 'I1', versione: 1 }],
  clienti: [{ id: 'K1', versione: 1 }],
  anagrafiche: [{ id: 'K1:abc', versione: 0 }],
  registri: [{ id: 'G1:attivo', versione: 1 }],
  condizioniPagamento: [{ id: 'P1', versione: 1 }],
  speseAccessorie: [{ id: 'S1', versione: 1 }],
  contiCorrenti: [{ id: 'B1', versione: 1 }],
  cedente: { id: 'T1', versione: 1 } as { id: string; versione: number } | null,
  marcatori: [
    {
      rigaAddebitoId: 'R1',
      tipo: 'PERIODO_CANONE' as const,
      chiaveCompetenza: '2026-11-01/2026-11-30',
    },
    { rigaAddebitoId: 'R1', tipo: 'SCADENZA_FISSO' as const, chiaveCompetenza: '2026-06-30' },
  ],
})

describe('improntaElaborazione', () => {
  it('sha256 esadecimale di 64 caratteri', () => {
    expect(improntaElaborazione(base())).toMatch(/^[0-9a-f]{64}$/)
  })
  it('ordine degli id diverso: stessa impronta', () => {
    const b = base()
    expect(improntaElaborazione({ ...b, legami: [...b.legami].reverse() })).toBe(
      improntaElaborazione(b)
    )
  })
  it('una versione cambiata: impronta diversa', () => {
    const b = base()
    const x = { ...b, legami: [{ id: 'L1', versione: 2 }, b.legami[1]] }
    expect(improntaElaborazione(x)).not.toBe(improntaElaborazione(b))
  })
  it('parametri con chiavi in ordine diverso (anche annidati): stessa impronta', () => {
    const b = base()
    const x = {
      ...b,
      parametri: { raggruppamento: 'PER_CONTRATTO', al: '2026-11-30', dal: '2026-11-01' },
    }
    expect(improntaElaborazione(x)).toBe(improntaElaborazione(b))
    expect(improntaElaborazione({ ...b, parametri: { a: { x: 1, y: 2 }, b: [1, 2] } })).toBe(
      improntaElaborazione({ ...b, parametri: { b: [1, 2], a: { y: 2, x: 1 } } })
    )
  })
  it('un parametro cambiato: impronta diversa', () => {
    const b = base()
    expect(
      improntaElaborazione({ ...b, parametri: { ...b.parametri, al: '2026-11-29' } })
    ).not.toBe(improntaElaborazione(b))
  })
  it('stesso id con tipo diverso (legame e contratto): impronta diversa', () => {
    const vuoto = {
      parametri: {},
      legami: [],
      contratti: [],
      elenchi: [],
      righeAddebito: [],
      codiciIva: [],
      clienti: [],
      anagrafiche: [],
      registri: [],
      condizioniPagamento: [],
      speseAccessorie: [],
      contiCorrenti: [],
      cedente: null,
      marcatori: [],
    }
    const comeLegame = improntaElaborazione({ ...vuoto, legami: [{ id: 'X', versione: 1 }] })
    const comeContratto = improntaElaborazione({ ...vuoto, contratti: [{ id: 'X', versione: 1 }] })
    expect(comeLegame).not.toBe(comeContratto)
  })

  describe('voci della 4.4b (Q4)', () => {
    it('un marcatore in piu: impronta diversa; ordine dei marcatori diverso: uguale', () => {
      const b = base()
      const piu = {
        ...b,
        marcatori: [
          ...b.marcatori,
          {
            rigaAddebitoId: 'R2',
            tipo: 'PERIODO_CANONE' as const,
            chiaveCompetenza: '2026-11-01/2026-11-30',
          },
        ],
      }
      expect(improntaElaborazione(piu)).not.toBe(improntaElaborazione(b))
      expect(improntaElaborazione({ ...b, marcatori: [...b.marcatori].reverse() })).toBe(
        improntaElaborazione(b)
      )
    })
    it.each([
      ['cliente', (b: ReturnType<typeof base>) => ({ ...b, clienti: [{ id: 'K1', versione: 2 }] })],
      [
        'condizione di pagamento',
        (b: ReturnType<typeof base>) => ({
          ...b,
          condizioniPagamento: [{ id: 'P1', versione: 2 }],
        }),
      ],
      [
        'spesa accessoria',
        (b: ReturnType<typeof base>) => ({ ...b, speseAccessorie: [{ id: 'S1', versione: 2 }] }),
      ],
      [
        'conto corrente',
        (b: ReturnType<typeof base>) => ({ ...b, contiCorrenti: [{ id: 'B1', versione: 2 }] }),
      ],
      ['cedente', (b: ReturnType<typeof base>) => ({ ...b, cedente: { id: 'T1', versione: 2 } })],
      [
        'anagrafica del cliente (contenuto di ditta e sede)',
        (b: ReturnType<typeof base>) => ({ ...b, anagrafiche: [{ id: 'K1:def', versione: 0 }] }),
      ],
      [
        'registro (attivo o disattivo)',
        (b: ReturnType<typeof base>) => ({ ...b, registri: [{ id: 'G1:disattivo', versione: 1 }] }),
      ],
      ['cedente assente', (b: ReturnType<typeof base>) => ({ ...b, cedente: null })],
    ])('versione di %s cambiata: impronta diversa', (_nome, cambia) => {
      const b = base()
      expect(improntaElaborazione(cambia(b))).not.toBe(improntaElaborazione(b))
    })
    it('stesso id in tipi diversi (cliente e conto): impronta diversa', () => {
      const b = { ...base(), clienti: [], contiCorrenti: [] }
      const comeCliente = improntaElaborazione({ ...b, clienti: [{ id: 'X', versione: 1 }] })
      const comeConto = improntaElaborazione({ ...b, contiCorrenti: [{ id: 'X', versione: 1 }] })
      expect(comeCliente).not.toBe(comeConto)
    })
  })
})
