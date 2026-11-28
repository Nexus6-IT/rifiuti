import { RisolviNumeroVidimatoPerEmissione } from './risolvi-numero-vidimato-per-emissione'

const fir = (bloccato = false) => ({ bloccatoInvio: bloccato }) as any

function costruisci(
  opts: {
    moduli?: string[]
    modalita?: string
    certificato?: boolean
    sede?: Record<string, unknown> | null
  } = {}
) {
  const moduli = { moduliAttivi: jest.fn().mockResolvedValue(opts.moduli ?? ['rentri']) }
  const modalita = {
    getForTenant: jest.fn().mockResolvedValue({
      modalitaLegame: opts.modalita ?? 'AUTOMATICA',
      certificatoConfigurato: opts.certificato ?? true,
    }),
  }
  const sede = opts.sede === undefined ? { numIscrSito: 'SITO-1' } : opts.sede
  const unita = { getPrincipale: jest.fn().mockResolvedValue(sede) }
  return new RisolviNumeroVidimatoPerEmissione(moduli as any, modalita as any, unita as any)
}

describe('RisolviNumeroVidimatoPerEmissione', () => {
  it('AUTOMATICA con certificato: sede principale, senza blocco se non configurato', async () => {
    expect(await costruisci().perEmissione(fir(), 't1')).toEqual({ numIscrSito: 'SITO-1' })
  })

  it('IBRIDA: usa il blocco predefinito della sede', async () => {
    const r = await costruisci({
      modalita: 'IBRIDA',
      sede: { numIscrSito: 'SITO-1', codiceBloccoPredefinito: 'BLK-7' },
    }).perEmissione(fir(), 't1')
    expect(r).toEqual({ numIscrSito: 'SITO-1', codiceBlocco: 'BLK-7' })
  })

  it.each([
    ['modulo rentri non attivo', { moduli: ['fatturazione'] }],
    ['modalita MANUALE', { modalita: 'MANUALE' }],
    ['certificato mancante', { certificato: false }],
    ['nessuna sede principale', { sede: null }],
  ])('%s: nessun consumo di scorta', async (_nome, opts) => {
    expect(await costruisci(opts).perEmissione(fir(), 't1')).toBeNull()
  })

  it('FIR importato (bloccato all invio): nessun consumo, senza nemmeno leggere la configurazione', async () => {
    const moduli = { moduliAttivi: jest.fn() }
    const r = new RisolviNumeroVidimatoPerEmissione(moduli as any, {} as any, {} as any)
    expect(await r.perEmissione(fir(true), 't1')).toBeNull()
    expect(moduli.moduliAttivi).not.toHaveBeenCalled()
  })

  describe('perTenant (avviso preventivo: l emissione consumera la scorta?)', () => {
    it('stesse condizioni di perEmissione, senza un FIR', async () => {
      expect(await costruisci().perTenant('t1')).toEqual({ numIscrSito: 'SITO-1' })
    })

    it.each([
      ['modulo rentri non attivo', { moduli: ['fatturazione'] }],
      ['modalita MANUALE', { modalita: 'MANUALE' }],
      ['certificato mancante', { certificato: false }],
      ['nessuna sede principale', { sede: null }],
    ])('%s: null', async (_nome, opts) => {
      expect(await costruisci(opts).perTenant('t1')).toBeNull()
    })
  })
})
