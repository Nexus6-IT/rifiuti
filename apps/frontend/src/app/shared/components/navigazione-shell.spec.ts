import { TITOLI_FUORI_MENU, rottaVoceAttiva, titoloShell, VoceShell } from './navigazione-shell'

describe('rottaVoceAttiva', () => {
  it("sceglie il prefisso piu' lungo per segmenti", () => {
    expect(rottaVoceAttiva('/clienti/fatturazione', ['/clienti', '/clienti/fatturazione'])).toBe(
      '/clienti/fatturazione'
    )
    expect(
      rottaVoceAttiva('/contratti-clienti/42/listino', ['/contratti', '/contratti-clienti'])
    ).toBe('/contratti-clienti')
  })

  it('una rotta uguale al percorso vale', () => {
    expect(rottaVoceAttiva('/clienti', ['/clienti'])).toBe('/clienti')
  })

  it('un prefisso che non finisce su un segmento non conta', () => {
    expect(rottaVoceAttiva('/clientiX', ['/clienti'])).toBeNull()
    expect(rottaVoceAttiva('/nulla', ['/clienti'])).toBeNull()
  })
})

describe('titoloShell', () => {
  const voci: VoceShell[] = [
    { label: 'Clienti', route: '/clienti' },
    { label: 'Fatturazione da', route: '/clienti/fatturazione' },
    { label: 'Contratti clienti', route: '/contratti-clienti' },
  ]

  it('prima le voci di menu', () => {
    expect(titoloShell('/clienti/fatturazione', voci)).toBe('Fatturazione da')
    expect(titoloShell('/contratti-clienti/42/listino', voci)).toBe('Contratti clienti')
  })

  it('poi le pagine fuori menu', () => {
    expect(titoloShell('/notifications', voci)).toBe('Notifiche')
    expect(titoloShell('/permissions/my-permissions', voci)).toBe('Permessi')
    expect(titoloShell('/permissions/denied', voci)).toBe('Accesso non consentito')
    expect(titoloShell('/permissions/consultant-dashboard', voci)).toBe('Dashboard consulente')
    expect(titoloShell('/fir/abc', voci)).toBe('FIR')
    expect(titoloShell('/rentri/formulari', voci)).toBe('RENTRI')
    expect(titoloShell('/rentri/sedi', voci)).toBe('RENTRI')
    expect(titoloShell('/giacenze/abbinamenti', voci)).toBe('Giacenze')
  })

  it('una pagina sconosciuta e /legal non hanno titolo di pagina', () => {
    expect(titoloShell('/nulla', voci)).toBe('WasteFlow')
    expect(TITOLI_FUORI_MENU.some(v => v.route === '/legal')).toBeFalse()
  })
})
