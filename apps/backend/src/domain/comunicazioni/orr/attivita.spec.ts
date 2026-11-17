import {
  attivitaDelMovimento,
  inCampania,
  siglaInCampania,
  tipoDetentore,
  tipoImpiantoDestinatario,
  trasportoDaComunicare,
} from './attivita'

const ricevuto = (operazione: 'R' | 'D' = 'R') =>
  ({ tipo: 'CARICO', ruolo: 'RICEVUTO_DA_TERZI', operazione }) as const

describe('inCampania / siglaInCampania', () => {
  it('061-065 sono Campania, a 3 o a 6 cifre', () => {
    for (const p of ['061', '062', '063', '064', '065']) expect(inCampania(p)).toBe(true)
    expect(inCampania('063049')).toBe(true)
    expect(inCampania('060')).toBe(false)
    expect(inCampania('066')).toBe(false)
    expect(inCampania('015146')).toBe(false)
    expect(inCampania(null)).toBe(false)
    expect(inCampania('')).toBe(false)
    expect(inCampania('NA')).toBe(false)
  })
  it('sigle AV BN CE NA SA', () => {
    for (const s of ['AV', 'bn', 'CE', 'NA', 'SA']) expect(siglaInCampania(s)).toBe(true)
    expect(siglaInCampania('MI')).toBe(false)
    expect(siglaInCampania(undefined)).toBe(false)
  })
})

describe('trasportoDaComunicare (file T)', () => {
  it('basta una delle due parti in Campania', () => {
    expect(trasportoDaComunicare('063049', '015146')).toBe(true)
    expect(trasportoDaComunicare('015146', '065116')).toBe(true)
    expect(trasportoDaComunicare('015146', '015146')).toBe(false)
    expect(trasportoDaComunicare(null, null)).toBe(false)
  })
})

describe('attivitaDelMovimento (D13)', () => {
  it('trasportatore: TRA; ricevuto da terzi: attivita di impianto; entrambi: due file', () => {
    expect(attivitaDelMovimento(ricevuto(), 'STO', false, null)).toEqual(['STO'])
    expect(attivitaDelMovimento(ricevuto(), 'STO', true, null)).toEqual(['TRA', 'STO'])
    expect(
      attivitaDelMovimento(
        { tipo: 'SCARICO', ruolo: 'AVVIATO', operazione: 'R' },
        'STO',
        true,
        null
      )
    ).toEqual(['TRA'])
  })
  it('un movimento non ricevuto da terzi e non trasportato da noi non entra in nessun file', () => {
    expect(
      attivitaDelMovimento(
        { tipo: 'CARICO', ruolo: 'PRODOTTO', operazione: 'R' },
        'STO',
        false,
        null
      )
    ).toEqual([])
    expect(
      attivitaDelMovimento(
        { tipo: 'SCARICO', ruolo: 'AVVIATO', operazione: 'D' },
        'SMA',
        false,
        null
      )
    ).toEqual([])
  })
  it('STO, SMA e REC non dipendono dall operazione', () => {
    expect(attivitaDelMovimento(ricevuto('D'), 'STO', false, null)).toEqual(['STO'])
    expect(attivitaDelMovimento(ricevuto('R'), 'SMA', false, null)).toEqual(['SMA'])
    expect(attivitaDelMovimento(ricevuto('D'), 'REC', false, null)).toEqual(['REC'])
  })
  it('R/S, AUT, ROT e FRA si dividono per operazione D/R', () => {
    for (const t of ['R/S', 'AUT', 'ROT', 'FRA'] as const) {
      expect(attivitaDelMovimento(ricevuto('D'), t, false, null)).toEqual(['SMA'])
      expect(attivitaDelMovimento(ricevuto('R'), t, false, null)).toEqual(['REC'])
    }
  })
  it('il flag FRA/ROT/AUT del movimento ha la precedenza sul tipo impianto', () => {
    expect(attivitaDelMovimento(ricevuto('R'), 'REC', false, { attivita: 'FRA' })).toEqual(['FRA'])
    expect(attivitaDelMovimento(ricevuto('D'), 'SMA', false, { attivita: 'ROT' })).toEqual(['ROT'])
    expect(attivitaDelMovimento(ricevuto('D'), undefined, false, { attivita: 'AUT' })).toEqual([
      'AUT',
    ])
  })
  it('senza tipo impianto e senza flag il lato impianto non si decide (lo segnala il preparatore)', () => {
    expect(attivitaDelMovimento(ricevuto(), undefined, false, null)).toEqual([])
    expect(attivitaDelMovimento(ricevuto(), undefined, true, null)).toEqual(['TRA'])
  })
})

describe('tipoDetentore (c13)', () => {
  it('STO solo se il produttore e un impianto di stoccaggio, altrimenti PRO', () => {
    expect(tipoDetentore('STO')).toBe('STO')
    expect(tipoDetentore('SMA')).toBe('PRO')
    expect(tipoDetentore('R/S')).toBe('PRO')
    expect(tipoDetentore(undefined)).toBe('PRO')
  })
})

describe('tipoImpiantoDestinatario (e13)', () => {
  it('trasportatore: D -> SMA, R -> REC, R13 e D15 -> STO', () => {
    expect(tipoImpiantoDestinatario('TRA', undefined, 'D10', 'D', undefined)).toBe('SMA')
    expect(tipoImpiantoDestinatario('TRA', undefined, 'R3', 'R', undefined)).toBe('REC')
    expect(tipoImpiantoDestinatario('TRA', undefined, 'R13', 'R', undefined)).toBe('STO')
    expect(tipoImpiantoDestinatario('TRA', undefined, 'D15', 'D', undefined)).toBe('STO')
    expect(tipoImpiantoDestinatario('TRA', undefined, null, 'D', undefined)).toBe('SMA')
  })
  it('trasportatore: il flag AUT/ROT/FRA ha la precedenza', () => {
    expect(tipoImpiantoDestinatario('TRA', undefined, 'R13', 'R', 'FRA')).toBe('FRA')
  })
  it("altri dichiaranti: tipo impianto della sede, oppure l'attivita se R/S o assente", () => {
    expect(tipoImpiantoDestinatario('STO', 'STO', 'R13', 'R', undefined)).toBe('STO')
    expect(tipoImpiantoDestinatario('SMA', 'R/S', 'D1', 'D', undefined)).toBe('SMA')
    expect(tipoImpiantoDestinatario('REC', 'R/S', 'R3', 'R', undefined)).toBe('REC')
    expect(tipoImpiantoDestinatario('FRA', 'FRA', 'R3', 'R', undefined)).toBe('FRA')
    expect(tipoImpiantoDestinatario('FRA', 'STO', 'R3', 'R', undefined)).toBe('FRA')
    expect(tipoImpiantoDestinatario('ROT', 'REC', 'R3', 'R', undefined)).toBe('ROT')
    expect(tipoImpiantoDestinatario('REC', undefined, 'R3', 'R', undefined)).toBe('REC')
  })
})
