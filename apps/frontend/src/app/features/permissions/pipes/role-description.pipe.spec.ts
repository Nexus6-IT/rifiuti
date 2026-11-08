import { RoleDescriptionPipe } from './role-description.pipe'

/** Task 15: i ruoli si leggono in italiano, in sentence case, mai come codici inglesi. */
describe('RoleDescriptionPipe', () => {
  const pipe = new RoleDescriptionPipe()
  /** Elenco chiuso: i ruoli di sistema del backend (system-roles.ts) + SUPER_ADMIN + gli alias storici. */
  const RUOLI_NOTI = [
    'SUPER_ADMIN',
    'ADMIN',
    'OPERATOR',
    'VIEWER',
    'CONSULTANT',
    'COMPLIANCE_OFFICER',
    'SYSTEM_ADMIN',
    'FACILITY_MANAGER',
    'FIELD_OPERATOR',
    'ENVIRONMENTAL_CONSULTANT',
    'UNKNOWN',
  ]
  const PAROLE_INGLESI =
    /\b(system|administrator|manager|operator|viewer|consultant|officer|access|full|read-only|read only|field|facility|the|and|with|who|their|for|custom role|unknown)\b/i

  it('non restituisce mai una stringa inglese per i ruoli noti, in nessuno dei tre formati', () => {
    for (const ruolo of RUOLI_NOTI) {
      for (const modo of ['name', 'short', 'long'] as const) {
        const testo = pipe.transform(ruolo, modo)
        expect(testo).withContext(`${ruolo}/${modo}: «${testo}»`).not.toMatch(PAROLE_INGLESI)
        expect(testo.length).toBeGreaterThan(3)
      }
    }
  })

  it('traduce i nomi principali in sentence case', () => {
    expect(pipe.transform('ADMIN', 'name')).toBe('Amministratore')
    expect(pipe.transform('SUPER_ADMIN', 'name')).toBe('Super amministratore')
    expect(pipe.transform('OPERATOR', 'name')).toBe('Operatore')
    expect(pipe.transform('VIEWER', 'name')).toBe('Visualizzatore')
    expect(pipe.transform('CONSULTANT', 'name')).toBe('Consulente ambientale')
    expect(pipe.transform('COMPLIANCE_OFFICER', 'name')).toBe('Responsabile della conformità')
    expect(pipe.transform('ADMIN', 'short')).toBe('Accesso completo al sistema')
  })

  it('i nomi non sono mai in maiuscolo continuo (sentence case)', () => {
    for (const ruolo of RUOLI_NOTI) {
      const nome = pipe.transform(ruolo, 'name')
      expect(nome).not.toBe(nome.toUpperCase())
      expect(nome.charAt(0)).toBe(nome.charAt(0).toUpperCase())
      expect(nome.slice(1)).toBe(nome.slice(1).toLowerCase())
    }
  })

  it('un ruolo personalizzato resta leggibile, in italiano e in sentence case', () => {
    expect(pipe.transform('RESPONSABILE_MAGAZZINO', 'name')).toBe('Responsabile magazzino')
    expect(pipe.transform('RESPONSABILE_MAGAZZINO', 'short')).toBe(
      'Ruolo personalizzato: Responsabile magazzino'
    )
    expect(pipe.transform('RESPONSABILE_MAGAZZINO', 'long')).toContain('ruolo personalizzato')
  })

  it('un valore vuoto non rompe la pagina', () => {
    expect(pipe.transform('')).toBe('Ruolo sconosciuto')
  })
})
