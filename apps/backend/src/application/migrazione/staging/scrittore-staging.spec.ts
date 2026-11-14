import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { nomeFileTabella, scriviStaging, serializzaRiga } from './scrittore-staging'

describe('scrittore dello staging', () => {
  let radice: string
  beforeEach(async () => {
    radice = await mkdtemp(join(tmpdir(), 'scrittore-test-'))
  })
  afterEach(async () => {
    await rm(radice, { recursive: true, force: true })
  })

  const meta = { ditta: '0007', anno: 2025, estrattoIl: '2026-01-01T00:00:00.000Z' }

  it('scrive file e manifest con righe e impronta corretti', async () => {
    const { cartella, manifest } = await scriviStaging(radice, meta, [
      {
        nome: 'TABELLA STRANA',
        colonne: ['A', 'B'],
        righe: [
          ['1', null],
          ['2', 'à\n'],
        ],
      },
    ])
    expect(cartella.endsWith('WW00072025')).toBe(true)
    const t = manifest.tabelle['TABELLA STRANA']
    expect(t.file).toBe('tabella-strana.jsonl')
    expect(t.righe).toBe(2)
    const byte = await readFile(join(cartella, t.file))
    expect(t.sha256).toBe(createHash('sha256').update(byte).digest('hex'))
    expect(byte.toString('utf8')).toBe('["1",null]\n["2","à\\n"]\n')
  })

  const unaTabella = [{ nome: 'T', colonne: ['A'], righe: [['1']] }]

  it('cartella 0700 e file (dati, manifest) 0600', async () => {
    const { cartella } = await scriviStaging(radice, meta, unaTabella)
    expect((await stat(cartella)).mode & 0o777).toBe(0o700)
    for (const f of await readdir(cartella)) {
      expect((await stat(join(cartella, f))).mode & 0o777).toBe(0o600)
    }
  })

  it('rifiuta una cartella di destinazione non vuota', async () => {
    const { cartella } = await scriviStaging(radice, meta, unaTabella)
    await writeFile(join(cartella, 'vecchio.jsonl'), 'x')
    await expect(scriviStaging(radice, meta, unaTabella)).rejects.toThrow(/CARTELLA_NON_VUOTA/)
    expect(await readdir(cartella)).toContain('vecchio.jsonl')
  })

  it('con svuota: rimuove i file precedenti e stringe i permessi della cartella', async () => {
    const { cartella } = await scriviStaging(radice, meta, unaTabella)
    await writeFile(join(cartella, 'vecchio.jsonl'), 'x')
    await chmod(cartella, 0o755)
    await scriviStaging(radice, meta, unaTabella, { svuota: true })
    expect((await readdir(cartella)).sort()).toEqual(['manifest.json', 't.jsonl'])
    expect((await stat(cartella)).mode & 0o777).toBe(0o700)
  })

  it('una cartella esistente ma vuota va bene', async () => {
    const { cartella } = await scriviStaging(radice, meta, unaTabella)
    await rm(cartella, { recursive: true })
    await scriviStaging(radice, meta, unaTabella)
    expect(await readdir(cartella)).toContain('manifest.json')
  })

  it('usa il nome di file documentato per le tabelle note', () => {
    expect(nomeFileTabella('GIACENZE RIFIUTI')).toBe('giacenze-rifiuti.jsonl')
    expect(nomeFileTabella('Altra Tabella_X')).toBe('altra-tabella-x.jsonl')
  })

  it('rifiuta una riga con un numero di valori diverso dalle colonne', async () => {
    await expect(
      scriviStaging(radice, meta, [{ nome: 'T', colonne: ['A', 'B'], righe: [['1']] }])
    ).rejects.toThrow(/riga 1 con 1 valori/)
  })

  it('serializza una riga su una sola linea', () => {
    expect(serializzaRiga(['a\nb', null])).toBe('["a\\nb",null]')
  })

  it('escapa U+2028 e U+2029, che readline tratterebbe come fine riga', () => {
    expect(serializzaRiga(['a\u2028b\u2029c'])).toBe('["a\\u2028b\\u2029c"]')
  })

  it('accetta anche righe asincrone', async () => {
    async function* righe() {
      yield ['1']
    }
    const { manifest } = await scriviStaging(radice, meta, [
      { nome: 'T', colonne: ['A'], righe: righe() },
    ])
    expect(manifest.tabelle['T'].righe).toBe(1)
  })
})
