import { costruisciManifest, type DatiManifest } from './manifest'

const base: DatiManifest = {
  consorzio: 'CONOU',
  tracciato: 'Movi2023',
  versione: 'Movi2023-ww1',
  affidabilita: 'RICAVATO_WINWASTE',
  notaAffidabilita: 'Tracciato ricavato da WinWaste.',
  codifica: 'windows-1252',
  nomeFile: 'Movi.txt',
  hashDati: 'abc123',
  periodoDa: '2026-01-01',
  periodoA: '2026-03-31',
  sede: 'Sede di Napoli',
  numeroRecord: 3,
  generataIl: '2026-04-02T08:00:00.000Z',
  stato: 'GENERATA',
  modificataDopoInvio: false,
  avvisi: [],
  differenzeDaWinWaste: [],
  inferenze: [],
}

describe('costruisciManifest', () => {
  it('un tracciato ricavato da WinWaste lo dichiara in testa e nei campi', () => {
    const t = costruisciManifest(base)
    expect(t).toContain('tracciato ricavato da WinWaste, da confermare con un file reale')
    expect(t).toContain("Affidabilita':    RICAVATO_WINWASTE")
    expect(t).toContain('Versione:         Movi2023-ww1')
    expect(t).toContain('Record nel file:  3')
    expect(t).toContain('Hash dei dati:    abc123')
    expect(t).toContain('dal 2026-01-01 al 2026-03-31')
    expect(t).toContain('Stato:            GENERATA')
  })

  it('un tracciato ufficiale non porta l’avviso «da confermare»', () => {
    const t = costruisciManifest({ ...base, affidabilita: 'UFFICIALE' })
    expect(t).not.toContain('da confermare')
  })

  it('elenca avvisi con i movimenti, differenze e inferenze; «nessuno» se vuoti', () => {
    const vuoto = costruisciManifest(base)
    expect(vuoto).toContain('Avvisi non bloccanti:\n  nessuno')
    expect(vuoto).toContain('Differenze volute rispetto a WinWaste:\n  nessuna')
    const t = costruisciManifest({
      ...base,
      avvisi: [{ codice: 'X', messaggio: 'm', movimenti: ['2026-01-05 3/2026 130205'] }],
      differenzeDaWinWaste: ['trasportatore: cognome e nome del legale rappresentante'],
      inferenze: ['CODIFICA_CONOU = windows-1252'],
    })
    expect(t).toContain('  - X: m [2026-01-05 3/2026 130205]')
    expect(t).toContain('  - trasportatore: cognome e nome del legale rappresentante')
    expect(t).toContain('  - CODIFICA_CONOU = windows-1252')
  })

  it('inviata: riporta data e, se ricavato, la conferma esplicita; modificata dopo l’invio lo segnala', () => {
    const t = costruisciManifest({
      ...base,
      stato: 'INVIATA',
      inviataIl: '2026-04-03T09:00:00.000Z',
      modificataDopoInvio: true,
    })
    expect(t).toContain('INVIATA il 2026-04-03T09:00:00.000Z')
    expect(t).toContain('Ho verificato che il consorzio accetta questo file')
    expect(t).toContain('i dati sono cambiati dopo l’invio')
    const uff = costruisciManifest({
      ...base,
      affidabilita: 'UFFICIALE',
      stato: 'INVIATA',
      inviataIl: 'x',
    })
    expect(uff).not.toContain('Ho verificato')
  })

  it('numero di record non disponibile se i dati sono cambiati', () => {
    expect(costruisciManifest({ ...base, numeroRecord: null })).toContain(
      'Record nel file:  non disponibile'
    )
  })

  it('e’ deterministico', () => {
    expect(costruisciManifest(base)).toBe(costruisciManifest({ ...base }))
  })
})
