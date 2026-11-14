/**
 * Prova d'integrazione dell'estrattore contro un SQL Server vero.
 *
 * OPT-IN: gira solo con `WASTEFLOW_TEST_MSSQL=1` (l'immagine pesa ~1,5 GB e il
 * container chiede ~1,5-2 GB di RAM: troppo per un job CI sul runner da 6 GB).
 * I test di unita' del nucleo (`apps/backend/.../estrazione`) girano sempre.
 *
 *   WASTEFLOW_TEST_MSSQL=1 npm test
 *   (opz.) WASTEFLOW_MDF_DIR=<cartella dei .mdf modello>   default ~/Progetti/winwaste/estratto
 *
 * Cosa fa: container usa e getta `wasteflow-mssql-import` su 127.0.0.1 (porta
 * libera diversa da 4200, password casuale in un env-file temporaneo 0600
 * cancellato subito, mai in file tracciati), attach FOR ATTACH_REBUILD_LOG di
 * COPIE del .mdf modello dell'installer (dati demo, non fidati: non si esegue
 * nulla da li'), login `lettore` di sola lettura. A fine prova rimuove
 * container e copie.
 */
import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import * as sql from 'mssql'
import { analizzaArchivio } from '../../../apps/backend/src/application/migrazione/analisi/analizza-archivio'
import { eScrittura, estraiStaging } from '../../../apps/backend/src/application/migrazione/estrazione/estrai-staging'
import { apriStaging } from '../../../apps/backend/src/application/migrazione/staging/lettore-staging'
import { apriSorgente } from '../src/adattatore-mssql'

const ABILITATO = process.env.WASTEFLOW_TEST_MSSQL === '1'
const descrivi = ABILITATO ? describe : describe.skip

const IMMAGINE = 'mcr.microsoft.com/mssql/server:2022-latest'
const CONTAINER = 'wasteflow-mssql-import'
const MDF = '005_ww00002014_data.mdf'
const DIR_MDF = process.env.WASTEFLOW_MDF_DIR ?? join(homedir(), 'Progetti/winwaste/estratto')
const FIXTURE = join(__dirname, '../../../apps/backend/test/fixtures/winwaste/WW00012026')
const TABELLE = [
  'MOVIMENTI',
  'FORMULARI',
  'GIACENZE RIFIUTI',
  'CAUSALI RIFIUTI',
  'REGISTRI RIFIUTI',
  'VERSIS',
  'RENregistrazioni',
]
const FILE: Record<string, string> = {
  MOVIMENTI: 'movimenti',
  FORMULARI: 'formulari',
  'GIACENZE RIFIUTI': 'giacenze-rifiuti',
  'CAUSALI RIFIUTI': 'causali-rifiuti',
  'REGISTRI RIFIUTI': 'registri-rifiuti',
  VERSIS: 'versis',
  RENregistrazioni: 'renregistrazioni',
}

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

async function portaLibera(): Promise<number> {
  for (;;) {
    const porta = await new Promise<number>((ok, ko) => {
      const s = createServer()
      s.once('error', ko)
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port
        s.close(() => ok(p))
      })
    })
    if (porta !== 4200) return porta
  }
}

/** Maschera un valore (cifre -> 9, lettere -> A) per descriverne la forma senza riportarlo. */
const forma = (v: string | null): string =>
  v === null ? '<NULL>' : v === '' ? '<vuoto>' : v.replace(/\d/g, '9').replace(/[A-Za-z]/g, 'A').slice(0, 60)

/** Frequenza delle forme di alcune colonne chiave: serve a verificare i formati documentati sui dati veri. */
async function formeDeiValori(staging: Awaited<ReturnType<typeof apriStaging>>): Promise<string> {
  const colonne: Record<string, string[]> = {
    MOVIMENTI: ['CAUS', 'OPER', 'POSI', 'DATR', 'DTUK', 'PROD', 'TRAS', 'SMAL', 'CER', 'TIPOL', 'FISI', 'NETTO', 'VOLU', 'UM', 'MAG1', 'REG1', 'PROT1', 'STATO', 'KGNUM', 'GIASCAR', 'NFATT', 'LEGAME', 'RELAZ', 'C4', 'C7', 'DATD'],
    FORMULARI: ['DATR', 'DATD', 'DTUK', 'FORMU', 'OPER', 'CER', 'TIPOL', 'NETTO', 'UM', 'KGNUM', 'STATO', 'RELAZ', 'C4', 'C6', 'C7'],
  }
  const out: string[] = []
  for (const [tab, cols] of Object.entries(colonne)) {
    const conta: Record<string, Map<string, number>> = {}
    for (const c of cols) conta[c] = new Map()
    for await (const el of staging.leggi(tab)) {
      if (el.tipo !== 'riga') continue
      for (const c of cols) {
        let f = forma(el.riga.campi[c] ?? null)
        if (c === 'RELAZ' || c === 'C4') f = `len=${(el.riga.campi[c] ?? '').length};${f.slice(0, 12)}`
        conta[c].set(f, (conta[c].get(f) ?? 0) + 1)
      }
    }
    for (const c of cols) {
      out.push(`${tab}.${c}: ${[...conta[c].entries()].map(([f, n]) => `${f} x${n}`).join(' | ')}`)
    }
  }
  return out.join('\n')
}

const attesa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

descrivi('estrattore contro SQL Server (container usa e getta)', () => {
  let tmp: string
  let porta: number
  const passwordSa = `Aa1!${randomBytes(18).toString('hex')}`
  const passwordLettore = `Bb2#${randomBytes(18).toString('hex')}`
  let admin: sql.ConnectionPool
  let uscita: string

  const connetti = async (database: string, utente: string, password: string) => {
    const pool = new sql.ConnectionPool({
      server: '127.0.0.1',
      port: porta,
      database,
      user: utente,
      password,
      options: { encrypt: true, trustServerCertificate: true },
    })
    await pool.connect()
    return pool
  }

  async function attacca(nomeDb: string, copia: string): Promise<void> {
    docker('cp', copia, `${CONTAINER}:/var/opt/mssql/data/${nomeDb}.mdf`)
    docker('exec', '-u', '0', CONTAINER, 'chown', 'mssql:root', `/var/opt/mssql/data/${nomeDb}.mdf`)
    await admin
      .request()
      .batch(
        `CREATE DATABASE [${nomeDb}] ON (FILENAME = N'/var/opt/mssql/data/${nomeDb}.mdf') FOR ATTACH_REBUILD_LOG`
      )
    const db = await connetti(nomeDb, 'sa', passwordSa)
    try {
      await db.request().batch(`CREATE USER [lettore] FOR LOGIN [lettore]; ALTER ROLE db_datareader ADD MEMBER [lettore];`)
    } finally {
      await db.close()
    }
  }

  beforeAll(async () => {
    const sorgenteMdf = join(DIR_MDF, MDF)
    if (!existsSync(sorgenteMdf)) throw new Error(`file modello non trovato: ${sorgenteMdf}`)
    tmp = mkdtempSync(join(tmpdir(), 'wasteflow-mssql-'))
    uscita = join(tmp, 'staging')
    porta = await portaLibera()
    const envFile = join(tmp, 'sa.env')
    writeFileSync(envFile, `MSSQL_SA_PASSWORD=${passwordSa}\n`, { mode: 0o600 })
    try {
      docker('rm', '-f', CONTAINER)
    } catch {
      /* non esisteva */
    }
    docker(
      'run', '-d', '--name', CONTAINER,
      '-p', `127.0.0.1:${porta}:1433`,
      '--env-file', envFile,
      '-e', 'ACCEPT_EULA=Y',
      '-e', 'MSSQL_MEMORY_LIMIT_MB=1536',
      IMMAGINE
    )
    rmSync(envFile)
    // attesa del server
    const limite = Date.now() + 180_000
    for (;;) {
      try {
        admin = await connetti('master', 'sa', passwordSa)
        break
      } catch (e) {
        if (Date.now() > limite) throw e
        await attesa(3000)
      }
    }
    await admin.request().batch(`CREATE LOGIN [lettore] WITH PASSWORD = N'${passwordLettore}', CHECK_POLICY = OFF`)
    // due COPIE del modello: una per i dati demo, una da riempire con la fixture
    const copia1 = join(tmp, 'copia1.mdf')
    const copia2 = join(tmp, 'copia2.mdf')
    copyFileSync(sorgenteMdf, copia1)
    copyFileSync(sorgenteMdf, copia2)
    await attacca('WW00002014', copia1)
    await attacca('WW00012026', copia2)
  })

  afterAll(async () => {
    try {
      await admin?.close()
    } catch {
      /* gia' chiuso */
    }
    try {
      docker('rm', '-f', CONTAINER)
    } catch {
      /* gia' rimosso */
    }
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  const cfg = (database: string, utente: string, password: string) => ({
    server: '127.0.0.1',
    porta,
    database,
    utente,
    password,
    fidatiDelCertificato: true,
  })

  it('rifiuta un login con permessi di scrittura (sa) senza leggere nulla', async () => {
    const s = await apriSorgente(cfg('WW00002014', 'sa', passwordSa))
    try {
      expect((await s.permessiEffettivi()).filter(eScrittura).length).toBeGreaterThan(0)
      await expect(estraiStaging(s, uscita)).rejects.toMatchObject({ codice: 'LOGIN_CON_SCRITTURA' })
    } finally {
      await s.chiudi()
    }
  })

  it('il login di sola lettura non ha permessi di scrittura e non puo scrivere', async () => {
    const s = await apriSorgente(cfg('WW00002014', 'lettore', passwordLettore))
    try {
      const permessi = await s.permessiEffettivi()
      expect(permessi).toContain('SELECT')
      expect(permessi.filter(eScrittura)).toEqual([])
    } finally {
      await s.chiudi()
    }
    const db = await connetti('WW00002014', 'lettore', passwordLettore)
    try {
      await expect(db.request().batch(`DELETE FROM [dbo].[CAUSALI RIFIUTI]`)).rejects.toThrow(/permission/i)
    } finally {
      await db.close()
    }
  })

  it('estrae il database modello (dati demo): staging valido per lettore e analizzatore', async () => {
    const s = await apriSorgente(cfg('WW00002014', 'lettore', passwordLettore))
    try {
      const { cartella, manifest, tabelleAssenti } = await estraiStaging(
        s,
        process.env.WASTEFLOW_MSSQL_SALVA_STAGING ?? uscita
      )
      expect(tabelleAssenti).toEqual([])
      expect(manifest.tabelle.MOVIMENTI.righe).toBe(16)
      expect(manifest.tabelle.FORMULARI.righe).toBe(4)
      expect(manifest.tabelle['CAUSALI RIFIUTI'].righe).toBe(14)
      expect(manifest.tabelle['REGISTRI RIFIUTI'].righe).toBe(4)
      const staging = await apriStaging(cartella)
      // le colonne del catalogo documentato coincidono con quelle reali dei modelli
      expect(staging.avvisi).toEqual([])
      const rapporto = await analizzaArchivio(staging)
      for (const t of rapporto.confronto1.perTabella) {
        expect(t.righeLette).toBe(t.righeDichiarate)
      }
      const riepilogo = {
        scarti: rapporto.scartiPerCodice,
        avvisi: rapporto.avvisiPerCodice,
        confronto1: rapporto.confronto1.perTabella.map((t) => `${t.tabella}: ${t.record}/${t.righeLette}`),
      }
      process.stdout.write(`\n[mssql] dati demo del modello: ${JSON.stringify(riepilogo)}\n`)
      process.stdout.write(`[mssql] forme dei valori:\n${await formeDeiValori(staging)}\n`)
    } finally {
      await s.chiudi()
    }
  })

  it('roundtrip: le righe della fixture (con §, accenti, tab, a capo, NULL) escono identiche', async () => {
    // riempie la copia 2 con la fixture, come proprietario
    const staging = await apriStaging(FIXTURE)
    const db = await connetti('WW00012026', 'sa', passwordSa)
    try {
      for (const tab of TABELLE) {
        await db.request().batch(`DELETE FROM [dbo].[${tab}]`)
        const colonne = staging.colonne(tab)
        const elenco = colonne.map((c) => `[${c}]`).join(', ')
        const identity = tab === 'MOVIMENTI' || tab === 'FORMULARI'
        for await (const el of staging.leggi(tab)) {
          if (el.tipo !== 'riga') continue
          const req = db.request()
          colonne.forEach((c, i) => req.input(`p${i}`, sql.NVarChar(sql.MAX), el.riga.campi[c]))
          const valori = colonne.map((_, i) => `@p${i}`).join(', ')
          const insert = `INSERT INTO [dbo].[${tab}] (${elenco}) VALUES (${valori})`
          await req.query(
            identity
              ? `SET IDENTITY_INSERT [dbo].[${tab}] ON; ${insert}; SET IDENTITY_INSERT [dbo].[${tab}] OFF`
              : insert
          )
        }
      }
    } finally {
      await db.close()
    }

    const s = await apriSorgente(cfg('WW00012026', 'lettore', passwordLettore))
    try {
      const { cartella } = await estraiStaging(s, join(tmp, 'roundtrip'), {
        estrattoIl: '2026-11-14T00:00:00.000Z',
      })
      for (const tab of TABELLE) {
        const atteso = readFileSync(join(FIXTURE, `${FILE[tab]}.jsonl`), 'utf8').trim().split('\n')
        const ottenuto = readFileSync(join(cartella, `${FILE[tab]}.jsonl`), 'utf8').trim().split('\n')
        if (tab === 'VERSIS') {
          // il database ha i segreti dell'hub: l'estrattore li oscura
          const attesoRedatto = atteso.map((l) => {
            const v = JSON.parse(l) as (string | null)[]
            return /^HUBRW|^FIRMARENTRI/i.test(v[0] ?? '') ? JSON.stringify([v[0], v[1], v[2], v[3], '', '', '', '', '']) : l
          })
          expect([...ottenuto].sort()).toEqual([...attesoRedatto].sort())
        } else {
          expect([...ottenuto].sort()).toEqual([...atteso].sort())
        }
      }
      expect(readFileSync(join(cartella, 'versis.jsonl'), 'utf8')).not.toContain('PASSWORD-CIFRATA-FINTA')
      // analizzatore: stesso rapporto delle fixture
      const rapporto = JSON.parse(JSON.stringify(await analizzaArchivio(await apriStaging(cartella))))
      const atteso = JSON.parse(readFileSync(join(FIXTURE, 'rapporto-atteso.json'), 'utf8'))
      delete rapporto.hashManifest
      delete atteso.hashManifest
      expect(rapporto).toEqual(atteso)
    } finally {
      await s.chiudi()
    }
  })

  it('e ripetibile: due estrazioni dello stesso database danno file identici', async () => {
    const s = await apriSorgente(cfg('WW00012026', 'lettore', passwordLettore))
    try {
      const a = await estraiStaging(s, join(tmp, 'rip-a'), { estrattoIl: '2026-11-14T00:00:00.000Z' })
      const b = await estraiStaging(s, join(tmp, 'rip-b'), { estrattoIl: '2026-11-14T00:00:00.000Z' })
      expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest))
    } finally {
      await s.chiudi()
    }
  })
})
