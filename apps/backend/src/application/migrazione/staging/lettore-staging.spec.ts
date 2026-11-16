import { mkdir, mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { TABELLE_DOCUMENTATE } from './colonne-documentate'
import { apriStaging, ElementoLettura } from './lettore-staging'
import { StagingError } from './manifest'
import { scriviStaging } from './scrittore-staging'

const META = { ditta: '0001', anno: 2026, estrattoIl: '2026-11-14T00:00:00.000Z' }

let radice: string

beforeEach(async () => {
  radice = await mkdtemp(join(tmpdir(), 'staging-test-'))
})
afterEach(async () => {
  await rm(radice, { recursive: true, force: true })
})

async function scrivi(
  righe: (string | null)[][],
  colonne: string[] = ['COD', 'CAUS', 'DES'],
  tabella = 'MOVIMENTI'
): Promise<string> {
  const { cartella } = await scriviStaging(radice, META, [{ nome: tabella, colonne, righe }])
  return cartella
}

async function codice(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof StagingError) return e.codice
    throw e
  }
  return 'NESSUN_ERRORE'
}

async function raccogli(it: AsyncIterable<ElementoLettura>): Promise<ElementoLettura[]> {
  const out: ElementoLettura[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('apriStaging', () => {
  it('legge uno staging scritto dallo scrittore e restituisce i valori per nome di colonna', async () => {
    const cartella = await scrivi([
      ['1', '01', 'prima'],
      ['2', '02', 'seconda'],
    ])
    const s = await apriStaging(cartella)
    expect(s.archivio).toBe('WW00012026')
    expect(s.tabelle()).toEqual(['MOVIMENTI'])
    expect(s.colonne('MOVIMENTI')).toEqual(['COD', 'CAUS', 'DES'])
    expect(s.hashManifest).toMatch(/^[0-9a-f]{64}$/)
    const el = await raccogli(s.leggi('MOVIMENTI'))
    expect(el).toHaveLength(2)
    expect(el[0]).toEqual({
      tipo: 'riga',
      riga: { numeroRiga: 1, campi: { COD: '1', CAUS: '01', DES: 'prima' } },
    })
  })

  it('l hash del manifest e lo SHA-256 dei byte di manifest.json', async () => {
    const cartella = await scrivi([['1', '01', 'x']])
    const s = await apriStaging(cartella)
    const byte = await readFile(join(cartella, 'manifest.json'))
    expect(s.hashManifest).toBe(createHash('sha256').update(byte).digest('hex'))
  })

  it('distingue null da stringa vuota', async () => {
    const cartella = await scrivi([['1', null, '']])
    const s = await apriStaging(cartella)
    const [e] = await raccogli(s.leggi('MOVIMENTI'))
    expect(e.tipo === 'riga' && e.riga.campi).toEqual({ COD: '1', CAUS: null, DES: '' })
  })

  it('conserva a capo, tabulazioni, accenti e il separatore di sottocampi', async () => {
    const valore = 'riga 1\nriga 2\tcon tab, à è § ù   fine'
    const cartella = await scrivi([['1', '§§', valore]])
    const s = await apriStaging(cartella)
    const [e] = await raccogli(s.leggi('MOVIMENTI'))
    expect(e.tipo === 'riga' && e.riga.campi.DES).toBe(valore)
    expect(e.tipo === 'riga' && e.riga.campi.CAUS).toBe('§§')
  })

  it('rifiuta una cartella inesistente o che non e una cartella', async () => {
    expect(await codice(apriStaging(join(radice, 'non-esiste')))).toBe('CARTELLA_NON_VALIDA')
    await writeFile(join(radice, 'file'), 'x')
    expect(await codice(apriStaging(join(radice, 'file')))).toBe('CARTELLA_NON_VALIDA')
  })

  it('rifiuta una cartella senza manifest', async () => {
    const cartella = join(radice, 'WW00012026')
    await mkdir(cartella)
    expect(await codice(apriStaging(cartella))).toBe('MANIFEST_ASSENTE')
  })

  it('rifiuta un manifest che non e JSON', async () => {
    const cartella = join(radice, 'WW00012026')
    await mkdir(cartella)
    await writeFile(join(cartella, 'manifest.json'), '{non json')
    expect(await codice(apriStaging(cartella))).toBe('MANIFEST_NON_VALIDO')
  })

  it('rifiuta un formato sconosciuto prima di leggere i file', async () => {
    const cartella = await scrivi([['1', '01', 'x']])
    const m = JSON.parse(await readFile(join(cartella, 'manifest.json'), 'utf8'))
    m.formato = 'altro/9'
    await writeFile(join(cartella, 'manifest.json'), JSON.stringify(m))
    expect(await codice(apriStaging(cartella))).toBe('FORMATO_SCONOSCIUTO')
  })

  it('rifiuta una ditta o un anno incoerenti con il nome della cartella', async () => {
    const cartella = await scrivi([['1', '01', 'x']])
    const m = JSON.parse(await readFile(join(cartella, 'manifest.json'), 'utf8'))
    m.anno = 2025
    await writeFile(join(cartella, 'manifest.json'), JSON.stringify(m))
    expect(await codice(apriStaging(cartella))).toBe('ARCHIVIO_INCOERENTE')
  })

  it('rifiuta un file la cui impronta non corrisponde', async () => {
    const cartella = await scrivi([['1', '01', 'x']])
    await writeFile(join(cartella, 'movimenti.jsonl'), '["1","01","y"]\n')
    expect(await codice(apriStaging(cartella))).toBe('HASH_NON_CORRISPONDE')
  })

  it('rifiuta un file mancante', async () => {
    const cartella = await scrivi([['1', '01', 'x']])
    await rm(join(cartella, 'movimenti.jsonl'))
    expect(await codice(apriStaging(cartella))).toBe('FILE_ASSENTE')
  })

  it('rifiuta righe dichiarate diverse da quelle lette (hash coerente col file)', async () => {
    const cartella = await scrivi([['1', '01', 'x']])
    const m = JSON.parse(await readFile(join(cartella, 'manifest.json'), 'utf8'))
    m.tabelle.MOVIMENTI.righe = 5
    await writeFile(join(cartella, 'manifest.json'), JSON.stringify(m))
    expect(await codice(apriStaging(cartella))).toBe('RIGHE_NON_CORRISPONDENTI')
  })

  it('segnala le colonne documentate mancanti e quelle non documentate come avvisi', async () => {
    const doc = TABELLE_DOCUMENTATE.find(t => t.nome === 'CAUSALI RIFIUTI')!
    const colonne = [...doc.colonne.map(c => c.nome).filter(c => c !== 'POSIZ'), 'NUOVA']
    const cartella = await scrivi([colonne.map(() => '')], colonne, 'CAUSALI RIFIUTI')
    const s = await apriStaging(cartella)
    expect(s.avvisi).toEqual(
      expect.arrayContaining([
        { codice: 'COLONNA_MANCANTE', tabella: 'CAUSALI RIFIUTI', colonna: 'POSIZ' },
        { codice: 'COLONNA_NON_DOCUMENTATA', tabella: 'CAUSALI RIFIUTI', colonna: 'NUOVA' },
      ])
    )
    expect(s.avvisi).toHaveLength(2)
  })

  it('segnala una tabella non documentata come avviso', async () => {
    const cartella = await scrivi([['1']], ['X'], 'TABELLA STRANA')
    const s = await apriStaging(cartella)
    expect(s.avvisi).toEqual([{ codice: 'TABELLA_NON_DOCUMENTATA', tabella: 'TABELLA STRANA' }])
    expect(s.ha('TABELLA STRANA')).toBe(true)
    expect(s.ha('MOVIMENTI')).toBe(false)
    expect(s.colonne('MOVIMENTI')).toEqual([])
  })

  it('fallisce leggendo una tabella che non e nel manifest', async () => {
    const s = await apriStaging(await scrivi([['1', '01', 'x']]))
    await expect(raccogli(s.leggi('ALTRA'))).rejects.toBeInstanceOf(StagingError)
  })
})

describe('leggi: righe illeggibili', () => {
  async function conFileGrezzo(contenuto: string) {
    const cartella = await scrivi([['1', '01', 'x']])
    const m = JSON.parse(await readFile(join(cartella, 'manifest.json'), 'utf8'))
    const t = m.tabelle.MOVIMENTI
    await writeFile(join(cartella, t.file), contenuto)
    t.sha256 = createHash('sha256').update(contenuto).digest('hex')
    t.righe = contenuto.split('\n').filter(l => l.trim().length > 0).length
    await writeFile(join(cartella, 'manifest.json'), JSON.stringify(m))
    return apriStaging(cartella)
  }

  it('scarta le righe malformate con il numero di riga e prosegue', async () => {
    const s = await conFileGrezzo(
      [
        '["1","a","b"]',
        '{non json',
        '"stringa"',
        '["1","a"]',
        '["1",2,"b"]',
        '',
        '["9","z","k"]',
      ].join('\r\n') + '\r\n'
    )
    const el = await raccogli(s.leggi('MOVIMENTI'))
    expect(
      el.map(e => (e.tipo === 'scarto' ? `${e.scarto.numeroRiga}:${e.scarto.codice}` : 'riga'))
    ).toEqual([
      'riga',
      '2:RIGA_JSON_MALFORMATA',
      '3:RIGA_NON_ARRAY',
      '4:RIGA_LUNGHEZZA',
      '5:VALORE_NON_STRINGA',
      'riga',
    ])
    const ultima = el[el.length - 1]
    expect(ultima.tipo === 'riga' && ultima.riga.numeroRiga).toBe(7)
  })
})

describe('leggi: streaming', () => {
  it('legge 50.000 righe senza tenerle in memoria (heap sotto 200 MB)', async () => {
    const colonne = ['COD', 'DES']
    function* righe(): Generator<(string | null)[]> {
      for (let i = 1; i <= 50_000; i++) yield [String(i), `descrizione numero ${i} `.repeat(4)]
    }
    const { cartella } = await scriviStaging(radice, META, [
      { nome: 'MOVIMENTI', colonne, righe: righe() },
    ])
    const s = await apriStaging(cartella)
    if (global.gc) global.gc()
    const base = process.memoryUsage().heapUsed
    let massimo = 0
    let n = 0
    let ultimo = ''
    for await (const e of s.leggi('MOVIMENTI')) {
      n++
      if (e.tipo === 'riga') ultimo = e.riga.campi.COD ?? ''
      if (n % 2000 === 0) massimo = Math.max(massimo, process.memoryUsage().heapUsed - base)
    }
    expect(n).toBe(50_000)
    expect(ultimo).toBe('50000')
    expect(massimo).toBeLessThan(200 * 1024 * 1024)
  })
})
