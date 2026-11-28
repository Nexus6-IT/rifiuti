import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  eseguiCli,
  leggiArgomenti,
  validaGiacenzeAttese,
  validaRapportoSorgente,
} from './migrazione-riconcilia'

const T = '33333333-3333-4333-8333-333333333333'
const L = 'AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const base = ['--tenant', T, '--rapporto-sorgente', '/r/sorgente.json']

const sorgenteValida = {
  formato: 'winwaste-rapporto-sorgente/1',
  archivio: 'WW00012026',
  confronto1: { movimentiPerOper: [], formulariPerStato: [] },
  confronto2: { righe: [] },
  confronto4: { registri: [] },
  confronto5: { renRegistrazioni: { presente: false } },
}

describe('migrazione:riconcilia, argomenti', () => {
  it('forma minima: tenant e rapporto sorgente', () => {
    expect(leggiArgomenti(base)).toMatchObject({ tenant: T, rapportoSorgente: '/r/sorgente.json' })
  })
  it('--lotti: elenco di UUID normalizzati in minuscolo', () => {
    expect(leggiArgomenti([...base, '--lotti', `${L},${T}`])?.lotti).toEqual([L.toLowerCase(), T])
  })
  it.each([
    ['senza tenant', ['--rapporto-sorgente', '/x']],
    ['tenant non UUID', ['--tenant', 'abc', '--rapporto-sorgente', '/x']],
    ['senza rapporto sorgente', ['--tenant', T]],
    ['lotto non UUID', [...base, '--lotti', 'abc']],
    ['ripetuto', [...base, '--tenant', T]],
    ['campione negativo', [...base, '--campione', '-1']],
    ['campione zero', [...base, '--campione', '0']],
    ['campione non intero', [...base, '--campione', '2.5']],
    ['ricalcolo con lotti', [...base, '--rapporto', L, '--lotti', T]],
    ['opzione sconosciuta', [...base, '--forza']],
  ])('uso errato: %s', (_n, argv) => {
    expect(leggiArgomenti(argv as string[])).toBeNull()
  })
})

describe('migrazione:riconcilia, input non fidato', () => {
  it('il rapporto sorgente deve avere formato e campi letti dai confronti', () => {
    expect(validaRapportoSorgente(sorgenteValida).archivio).toBe('WW00012026')
    expect(() => validaRapportoSorgente({ ...sorgenteValida, formato: 'altro' })).toThrow(
      /non valido/
    )
    expect(() => validaRapportoSorgente({ ...sorgenteValida, confronto2: {} })).toThrow(
      /non valido/
    )
    expect(() => validaRapportoSorgente(null)).toThrow(/non valido/)
  })
  it('le giacenze attese sono [{cer, kg}]', () => {
    expect(validaGiacenzeAttese([{ cer: '15 01 01', kg: 1.5 }])).toHaveLength(1)
    expect(() => validaGiacenzeAttese([{ cer: '15 01 01', kg: 'x' }])).toThrow(/non valide/)
    expect(() => validaGiacenzeAttese({})).toThrow(/non valide/)
  })
})

describe('migrazione:riconcilia, esecuzione', () => {
  const uscita = () => {
    const out: string[] = []
    const err: string[] = []
    return {
      out,
      err,
      u: { scrivi: (m: string) => out.push(m), errore: (m: string) => err.push(m) },
    }
  }
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ric-cli-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('uso errato: 64, senza toccare il servizio', async () => {
    const servizio = { genera: jest.fn(), lottiCompletati: jest.fn() }
    const o = uscita()
    expect(await eseguiCli(['--tenant', 'x'], o.u, servizio)).toBe(64)
    expect(servizio.genera).not.toHaveBeenCalled()
  })

  it('file illeggibile o JSON rotto: 2, con messaggio fisso', async () => {
    const servizio = { genera: jest.fn(), lottiCompletati: jest.fn() }
    const o = uscita()
    expect(await eseguiCli(base, o.u, servizio)).toBe(2)
    expect(o.err.join()).toMatch(/file non leggibile/)
    const rotto = join(dir, 'rotto.json')
    await writeFile(rotto, '{ non json')
    const o2 = uscita()
    expect(await eseguiCli(['--tenant', T, '--rapporto-sorgente', rotto], o2.u, servizio)).toBe(2)
    expect(o2.err.join()).toMatch(/JSON valido/)
  })

  it('senza lotti completati per l archivio: 2', async () => {
    const f = join(dir, 'sorgente.json')
    await writeFile(f, JSON.stringify(sorgenteValida))
    const servizio = { genera: jest.fn(), lottiCompletati: jest.fn().mockResolvedValue([]) }
    const o = uscita()
    expect(await eseguiCli(['--tenant', T, '--rapporto-sorgente', f], o.u, servizio)).toBe(2)
    expect(o.err.join()).toMatch(/nessun lotto COMPLETATO per l archivio WW00012026/)
    expect(servizio.genera).not.toHaveBeenCalled()
  })

  it('un errore imprevisto stampa solo il nome della classe, mai il messaggio', async () => {
    const f = join(dir, 'sorgente2.json')
    await writeFile(f, JSON.stringify(sorgenteValida))
    const servizio = {
      genera: jest.fn().mockRejectedValue(new TypeError('valore riservato del cliente')),
      lottiCompletati: jest.fn().mockResolvedValue([L]),
    }
    const o = uscita()
    expect(await eseguiCli(['--tenant', T, '--rapporto-sorgente', f], o.u, servizio)).toBe(1)
    expect(o.err.join()).toBe('errore imprevisto: TypeError')
  })
})
