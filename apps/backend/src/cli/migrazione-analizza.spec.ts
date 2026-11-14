import { cp, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { eseguiCli, UscitaCli } from './migrazione-analizza'

const FIXTURE = join(__dirname, '../../test/fixtures/winwaste/WW00012026')

describe('CLI migrazione:analizza', () => {
  let radice: string
  let cartella: string
  let out: string[]
  let err: string[]
  const uscita: UscitaCli = {
    scrivi: m => out.push(m),
    errore: m => err.push(m),
  }

  beforeEach(async () => {
    radice = await mkdtemp(join(tmpdir(), 'cli-analizza-'))
    cartella = join(radice, 'WW00012026')
    await cp(FIXTURE, cartella, { recursive: true })
    out = []
    err = []
  })
  afterEach(async () => {
    await rm(radice, { recursive: true, force: true })
  })

  it('scrive il rapporto accanto allo staging, uguale a quello atteso; esce con 0 anche con scarti', async () => {
    expect(await eseguiCli([cartella], uscita)).toBe(0)
    const json = JSON.parse(await readFile(join(cartella, 'rapporto-sorgente.json'), 'utf8'))
    const atteso = JSON.parse(await readFile(join(FIXTURE, 'rapporto-atteso.json'), 'utf8'))
    expect(json).toEqual(atteso)
    expect(await readFile(join(cartella, 'rapporto-sorgente.md'), 'utf8')).toContain(
      '# Rapporto sorgente WW00012026'
    )
    expect(out.join('\n')).toContain('righe scartate: 6')
    expect(err).toEqual([])
  })

  it('non sovrascrive un rapporto esistente senza --forza', async () => {
    expect(await eseguiCli([cartella], uscita)).toBe(0)
    await writeFile(join(cartella, 'rapporto-sorgente.json'), 'NON TOCCARE')
    expect(await eseguiCli([cartella], uscita)).toBe(1)
    expect(await readFile(join(cartella, 'rapporto-sorgente.json'), 'utf8')).toBe('NON TOCCARE')
    expect(err.join('\n')).toContain('--forza')
    expect(await eseguiCli([cartella, '--forza'], uscita)).toBe(0)
    expect(await readFile(join(cartella, 'rapporto-sorgente.json'), 'utf8')).not.toBe('NON TOCCARE')
  })

  it('esce con 2 se il lettore rifiuta lo staging (impronta, cartella o manifest)', async () => {
    await writeFile(join(cartella, 'movimenti.jsonl'), 'manomesso\n')
    expect(await eseguiCli([cartella], uscita)).toBe(2)
    expect(err.join('\n')).toContain('HASH_NON_CORRISPONDE')
    err.length = 0
    expect(await eseguiCli([join(radice, 'non-esiste')], uscita)).toBe(2)
    expect(await readFile(join(FIXTURE, 'manifest.json'), 'utf8')).toContain('winwaste-staging/1')
  })

  it('esce con 2 se manca una colonna indispensabile al parser', async () => {
    const m = JSON.parse(await readFile(join(cartella, 'manifest.json'), 'utf8'))
    // stessa tabella, senza la colonna RELAZ, con file e impronta coerenti
    const t = m.tabelle.VERSIS
    t.colonne = ['IDSIS', 'VERSIS']
    const { createHash } = await import('crypto')
    const contenuto = '["a","b"]\n'
    await writeFile(join(cartella, t.file), contenuto)
    t.righe = 1
    t.sha256 = createHash('sha256').update(contenuto).digest('hex')
    await writeFile(join(cartella, 'manifest.json'), JSON.stringify(m))
    expect(await eseguiCli([cartella], uscita)).toBe(2)
    expect(err.join('\n')).toContain('COLONNA_OBBLIGATORIA_ASSENTE')
  })

  it.each([[[]], [['a', 'b']], [['x', '--strana']]])('uso errato %p -> 64', async argv => {
    expect(await eseguiCli(argv, uscita)).toBe(64)
    expect(err.join('\n')).toContain('uso:')
  })
})
