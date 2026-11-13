import { agenteInLinea, transizioneAmmessa } from './stato-agente'

describe('agenteInLinea', () => {
  const adesso = new Date('2026-11-13T10:00:00Z')
  it('in linea se l’ultimo contatto è di meno di 3 minuti fa', () => {
    expect(agenteInLinea(new Date('2026-11-13T09:57:30Z'), adesso)).toBe(true)
  })
  it('non in linea a 3 minuti esatti o più', () => {
    expect(agenteInLinea(new Date('2026-11-13T09:57:00Z'), adesso)).toBe(false)
    expect(agenteInLinea(new Date('2026-11-13T09:00:00Z'), adesso)).toBe(false)
  })
  it('mai contattato → non in linea', () => {
    expect(agenteInLinea(null, adesso)).toBe(false)
  })
  it('un contatto leggermente nel futuro (orologi sfasati) conta come in linea', () => {
    expect(agenteInLinea(new Date('2026-11-13T10:00:20Z'), adesso)).toBe(true)
  })
})

describe('transizioneAmmessa', () => {
  it('ammette IN_ATTESA→ATTIVO, IN_ATTESA→REVOCATO, ATTIVO→REVOCATO', () => {
    expect(transizioneAmmessa('IN_ATTESA', 'ATTIVO')).toBe(true)
    expect(transizioneAmmessa('IN_ATTESA', 'REVOCATO')).toBe(true)
    expect(transizioneAmmessa('ATTIVO', 'REVOCATO')).toBe(true)
  })
  it('rifiuta le altre', () => {
    expect(transizioneAmmessa('ATTIVO', 'IN_ATTESA')).toBe(false)
    expect(transizioneAmmessa('REVOCATO', 'ATTIVO')).toBe(false)
    expect(transizioneAmmessa('REVOCATO', 'IN_ATTESA')).toBe(false)
    expect(transizioneAmmessa('ATTIVO', 'ATTIVO')).toBe(false)
  })
})
