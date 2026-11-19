import { descrizioneErroreSdi } from './codici-errore'

describe('descrizioneErroreSdi', () => {
  it('descrive i codici noti in italiano', () => {
    expect(descrizioneErroreSdi('00404')).toMatch(/duplicat/i)
    expect(descrizioneErroreSdi('00002')).toMatch(/nome file/i)
  })
  it('per un codice sconosciuto restituisce il codice stesso, mai un testo inventato', () => {
    expect(descrizioneErroreSdi('99999')).toBe('Codice SDI 99999')
  })
})
