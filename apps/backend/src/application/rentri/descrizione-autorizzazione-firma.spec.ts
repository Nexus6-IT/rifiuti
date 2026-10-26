import { readFileSync } from 'fs'
import { join } from 'path'
import { descrizioneAutorizzazioneFirma } from './descrizione-autorizzazione-firma'

/**
 * Pattern e limiti di `CredentialsAuthorizeRequest.description`, LETTI dal
 * contratto (`docs/contracts/rentri/ca-rentri.yaml`) invece che copiati: se il
 * contratto cambia, questo spec se ne accorge.
 *
 * Il blocco della proprieta' si estrae dal testo del YAML (`js-yaml` non e'
 * una dipendenza del backend): le righe indentate sotto `description:` del
 * modello `CredentialsAuthorizeRequest`.
 */
function leggiVincoliDescrizione(): { pattern: RegExp; minLength: number; maxLength: number } {
  const radice = join(__dirname, '..', '..', '..', '..', '..')
  const percorso = join(radice, 'docs', 'contracts', 'rentri', 'ca-rentri.yaml')
  const yaml = readFileSync(percorso, 'utf8').replace(/\r\n/g, '\n')

  const inizioModello = yaml.indexOf('\n    CredentialsAuthorizeRequest:\n')
  if (inizioModello < 0) throw new Error('CredentialsAuthorizeRequest non trovato nel contratto')
  // Solo il blocco di questo modello: si taglia al modello successivo (stessa indentazione),
  // cosi' se `description` sparisse da qui lo spec fallisce invece di leggere quella di un altro.
  const dopo = yaml.slice(inizioModello + 1)
  const fineModello = dopo.search(/\n {4}\S[^\n]*:\n/)
  const modello = fineModello < 0 ? dopo : dopo.slice(0, fineModello + 1)
  const blocco = /\n {8}description:\n((?: {10}.*\n)+)/.exec(modello)
  if (!blocco) throw new Error('proprieta description non trovata nel contratto')

  const valore = (chiave: string): string => {
    const riga = new RegExp(`^ {10}${chiave}: (.*)$`, 'm').exec(blocco[1])
    if (!riga) throw new Error(`${chiave} di description non trovato nel contratto`)
    return riga[1].trim()
  }

  return {
    pattern: new RegExp(valore('pattern')),
    minLength: Number(valore('minLength')),
    maxLength: Number(valore('maxLength')),
  }
}

const {
  pattern: PATTERN_CONTRATTO,
  minLength: MIN_CONTRATTO,
  maxLength: MAX_CONTRATTO,
} = leggiVincoliDescrizione()

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
    expect(d.length).toBeGreaterThanOrEqual(MIN_CONTRATTO)
    expect(d.length).toBeLessThanOrEqual(MAX_CONTRATTO)
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
