import { descrizioneAutorizzazioneFirma } from './descrizione-autorizzazione-firma'

/** Pattern e limiti di `CredentialsAuthorizeRequest.description`, copiati dal contratto (ca-rentri.yaml:2650). */
const PATTERN_CONTRATTO = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,;:!?\-()/€%&@]*$/

describe('descrizioneAutorizzazioneFirma', () => {
  const casi: Array<[string, string, string]> = [
    ['numero semplice', 'FIR 123/2026', 'accettazione'],
    ['numero con underscore', 'RT_2026_000123', 'annullamento'],
    ['trattino lungo e simboli', 'FIR—1 #7', 'operazione — speciale'],
    ['lettere accentate', 'FIR àèìòù ÀÈÌÒÙ ÿ', 'è già così'],
    ['emoji e caratteri fuori dal BMP', 'FIR 😀 1', 'x'],
    ['stringa molto lunga', 'A_'.repeat(2000), 'accettazione'],
    ['vuoti', '', ''],
  ]

  it.each(casi)('rispetta il pattern del contratto: %s', (_nome, numeroFir, tipo) => {
    const d = descrizioneAutorizzazioneFirma(numeroFir, tipo)

    expect(d).toMatch(PATTERN_CONTRATTO)
    expect(d.length).toBeGreaterThanOrEqual(1)
    expect(d.length).toBeLessThanOrEqual(1000)
  })

  it('forma attesa: gli underscore diventano trattini, il resto resta', () => {
    expect(descrizioneAutorizzazioneFirma('RT_2026_1', 'accettazione')).toBe(
      'Firma del formulario RT-2026-1 - operazione accettazione'
    )
  })

  it('rispetta il pattern del contratto: nessuna eccezione con ingressi non stringa', () => {
    expect(() => descrizioneAutorizzazioneFirma(undefined as never, null as never)).not.toThrow()
    expect(descrizioneAutorizzazioneFirma(undefined as never, null as never)).toMatch(
      PATTERN_CONTRATTO
    )
  })
})
