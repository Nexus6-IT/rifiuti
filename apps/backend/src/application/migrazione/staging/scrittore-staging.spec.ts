import { mkdtemp, readFile, rm } from 'fs/promises'
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
