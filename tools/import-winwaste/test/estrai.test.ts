import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { dentroUnRepository, destinazioneAmmessa } from '../src/destinazione'

describe('destinazione dello staging', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'estrai-dest-'))
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('fuori da un repository va bene', () => {
    expect(dentroUnRepository(tmp)).toBe(false)
    expect(destinazioneAmmessa(join(tmp, 'qualunque'))).toBe(true)
  })

  it('dentro un repository e vietata, salvo una cartella staging-winwaste', () => {
    mkdirSync(join(tmp, '.git'))
    expect(dentroUnRepository(join(tmp, 'a', 'b'))).toBe(true)
    expect(destinazioneAmmessa(join(tmp, 'dati'))).toBe(false)
    expect(destinazioneAmmessa(join(tmp, 'staging-winwaste'))).toBe(true)
    expect(destinazioneAmmessa(join(tmp, 'x', 'staging-winwaste', 'y'))).toBe(true)
  })
})
