import { execFileSync } from 'child_process'
import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import {
  CODICI_FISCALI_INVENTATI,
  generaFixture,
} from '../../../../test/fixtures/winwaste/genera-fixture'

const RADICE_FIXTURE = join(__dirname, '../../../../test/fixtures/winwaste')
const CARTELLA_FIXTURE = join(RADICE_FIXTURE, 'WW00012026')

async function elenca(dir: string): Promise<string[]> {
  const voci = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const v of voci) {
    const p = join(dir, v.name)
    if (v.isDirectory()) out.push(...(await elenca(p)))
    else out.push(p)
  }
  return out
}

/** Controllo del codice fiscale di persona (16 caratteri), algoritmo ufficiale. */
function cfValido(cf: string): boolean {
  const dispari: Record<string, number> = {}
  const valoriDispari = [
    1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
  ]
  for (let i = 0; i < 10; i++) dispari[String(i)] = valoriDispari[i]
  for (let i = 0; i < 26; i++) dispari[String.fromCharCode(65 + i)] = valoriDispari[i]
  const pari = (c: string) => (/\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65)
  let somma = 0
  for (let i = 0; i < 15; i++) somma += i % 2 === 0 ? dispari[cf[i]] : pari(cf[i])
  return String.fromCharCode(65 + (somma % 26)) === cf[15]
}

describe('fixture WW00012026', () => {
  it('coincide byte per byte con l output del generatore (rigenerabile in modo deterministico)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'fixture-test-'))
    try {
      const generata = await generaFixture(tmp)
      const attesi = (await elenca(CARTELLA_FIXTURE))
        .map(p => relative(CARTELLA_FIXTURE, p))
        // i rapporti attesi dell'analizzatore sono committati accanto ma non generati qui
        .filter(n => !n.startsWith('rapporto-'))
        .sort()
      const prodotti = (await elenca(generata)).map(p => relative(generata, p)).sort()
      expect(prodotti).toEqual(attesi)
      for (const nome of prodotti) {
        expect(
          (await readFile(join(generata, nome))).equals(
            await readFile(join(CARTELLA_FIXTURE, nome))
          )
        ).toBe(true)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('non contiene codici fiscali con cifra di controllo valida fuori dall elenco dei codici inventati', async () => {
    const trovati = new Set<string>()
    for (const p of await elenca(RADICE_FIXTURE)) {
      const testo = await readFile(p, 'utf8')
      for (const m of testo.matchAll(/[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]/g)) {
        if (cfValido(m[0])) trovati.add(m[0])
      }
    }
    expect([...trovati].filter(cf => !CODICI_FISCALI_INVENTATI.includes(cf))).toEqual([])
    // l elenco dichiarato deve essere davvero valido, altrimenti la guardia non protegge nulla
    for (const cf of CODICI_FISCALI_INVENTATI) expect(cfValido(cf)).toBe(true)
  })

  it('il controllo del codice fiscale riconosce un codice errato', () => {
    expect(cfValido('RSSMRA80A01H501X')).toBe(false)
  })
})

describe('guardia .gitignore sui dati reali', () => {
  const gitIgnorato = (percorso: string): boolean => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', percorso], {
        cwd: join(__dirname, '../../../../../..'),
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }

  it.each([
    'apps/backend/staging-winwaste/WW00012026/manifest.json',
    'dati/staging-winwaste/WW00012026/movimenti.jsonl',
    'archivio.bak',
    'apps/backend/prova/WW00012026.bak',
  ])('ignora %s', p => {
    expect(gitIgnorato(p)).toBe(true)
  })

  it('non ignora la fixture sintetica', () => {
    expect(gitIgnorato('apps/backend/test/fixtures/winwaste/WW00012026/manifest.json')).toBe(false)
    expect(gitIgnorato('apps/backend/test/fixtures/winwaste/WW00012026/movimenti.jsonl')).toBe(
      false
    )
  })
})
