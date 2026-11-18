import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'

/**
 * Prova degli script per la consegna dei dati del cliente (`tools/import-winwaste/consegna/`).
 * Non serve SQL Server: lo script T-SQL si controlla come testo, `ripristina.sh` si esegue con un
 * `docker` finto che registra le chiamate. La prova vera (container SQL Server, `.bak` del `.mdf`
 * modello) e' opt-in: `docs/migrazione/consegna-dati-cliente.md` §Prove.
 */
const DIR = join(__dirname, '../../../../../../tools/import-winwaste/consegna')
const SQL = readFileSync(join(DIR, 'backup-copy-only.sql'), 'utf8')
const SH = join(DIR, 'ripristina.sh')

describe('backup-copy-only.sql (gira dal cliente: deve poter solo leggere e copiare)', () => {
  it('chiede COPY_ONLY e CHECKSUM, e fa un solo BACKUP DATABASE', () => {
    expect(SQL).toMatch(/BACKUP DATABASE/)
    expect(SQL.match(/BACKUP DATABASE/g)).toHaveLength(1)
    expect(SQL).toMatch(/COPY_ONLY/)
    expect(SQL).toMatch(/CHECKSUM/)
  })

  it.each([
    'RESTORE',
    'DROP',
    'ALTER',
    'CREATE',
    'DELETE',
    'UPDATE',
    'INSERT',
    'TRUNCATE',
    'GRANT',
    'sp_configure',
    'xp_cmdshell',
    'RECONFIGURE',
    'EXEC',
    'OPENROWSET',
    'SHUTDOWN',
    'KILL',
  ])('non contiene %s, nemmeno in un commento', parola => {
    expect(SQL.toUpperCase()).not.toContain(parola.toUpperCase())
  })

  it('ammette solo WW<ditta 4><anno 4> e ww<ditta 4>MU<aa 2> e rifiuta adminwwnet', () => {
    expect(SQL).toContain('WW[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')
    expect(SQL).toContain('ww[0-9][0-9][0-9][0-9]MU[0-9][0-9]')
    expect(SQL.toLowerCase()).toContain('adminwwnet')
    expect(SQL).toMatch(/THROW|RAISERROR/)
  })

  it('i parametri arrivano da variabili sqlcmd, mai scritti nel file', () => {
    expect(SQL).toContain('$(DATABASE)')
    expect(SQL).toContain('$(DESTINAZIONE)')
    expect(SQL).toMatch(/:on error exit/i)
  })

  it('non usa SQL dinamico: nome del database e percorso sono variabili del BACKUP', () => {
    expect(SQL).not.toMatch(/sp_executesql/i)
    expect(SQL).toMatch(/BACKUP DATABASE @/)
    expect(SQL).toMatch(/TO DISK = @/)
  })
})

describe('ripristina.sh', () => {
  let tmp: string
  let log: string
  let bak: string

  /** `docker` finto: registra gli argomenti, risponde "pronto" a ogni sqlcmd. */
  function preparaPath(): string {
    const bin = join(tmp, 'bin')
    mkdirSync(bin, { recursive: true })
    const docker = join(bin, 'docker')
    writeFileSync(
      docker,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
# con -i registra anche lo standard input (qui passano gli script SQL con la password del login)
case " $* " in *" -i "*) cat >> "${log}";; esac
for a in "$@"; do case "$a" in --env-file=*) cp "\${a#--env-file=}" "${tmp}/envfile.copia" 2>/dev/null;; esac; done
if [ "$1" = "inspect" ]; then echo "172.30.0.2"; fi
if [ "$1" = "exec" ]; then
  case "$*" in
    *FILELISTONLY*) printf 'WW00012026|C:\\\\x\\\\WW00012026.mdf|D|x\\nWW00012026_log|C:\\\\x\\\\WW00012026.ldf|L|x\\n';;
  esac
fi
if [ -n "$WASTEFLOW_TEST_FALLISCI_RESTORE" ] && grep -q "RESTORE DATABASE" "${log}"; then exit 1; fi
exit 0
`
    )
    for (const [nome, corpo] of [
      ['age', '#!/usr/bin/env bash\n# age -d -i IDENT -o USCITA ENTRATA\ncp "$6" "$5"\n'],
      [
        'npm',
        `#!/usr/bin/env bash\necho "npm $* pwd-presente=$([ -n "$WASTEFLOW_MSSQL_PASSWORD" ] && echo si || echo no)" >> "${log}"\n`,
      ],
    ]) {
      writeFileSync(join(bin, nome), corpo)
      chmodSync(join(bin, nome), 0o755)
    }
    chmodSync(docker, 0o755)
    return `${bin}:${process.env.PATH}`
  }

  const esegui = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [SH, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: preparaPath(), WASTEFLOW_CONSEGNA_TMP: tmp, ...env },
    })

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'consegna-test-'))
    log = join(tmp, 'docker.log')
    writeFileSync(log, '')
    bak = join(tmp, 'WW00012026_COPYONLY_202611180900.bak')
    writeFileSync(bak, 'finto')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('ha una sintassi bash valida', () => {
    const r = spawnSync('bash', ['-n', SH], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('senza argomenti stampa l uso ed esce con 64', () => {
    expect(esegui([]).status).toBe(64)
  })

  it('rifiuta un nome file che non e di un database WinWaste ammesso', () => {
    const adm = join(tmp, 'adminwwnet_COPYONLY_202611180900.bak')
    writeFileSync(adm, 'x')
    const r = esegui([adm])
    expect(r.status).toBe(64)
    expect(r.stderr).toMatch(/non ammesso/)
    expect(readFileSync(log, 'utf8')).toBe('')
  })

  it('rifiuta un file che non esiste', () => {
    expect(esegui([join(tmp, 'WW00012026_x.bak')]).status).toBe(64)
  })

  it('container su rete --internal senza porte pubblicate, telemetria spenta, tag fisso, password in env-file 0600', () => {
    const r = esegui([bak])
    expect(r.status).toBe(0)
    const chiamate = readFileSync(log, 'utf8')
    expect(chiamate).toMatch(/^network create --internal wasteflow-mssql-consegna-\w+-rete$/m)
    const run = chiamate.split('\n').find(l => l.startsWith('run '))!
    expect(run).toMatch(/--network wasteflow-mssql-consegna-\w+-rete/)
    expect(run).not.toMatch(/ -p |--publish|-P /)
    expect(run).toMatch(/--env-file=/)
    expect(run).not.toMatch(/MSSQL_SA_PASSWORD=/)
    expect(run).not.toMatch(/:latest/)
    expect(run).toMatch(/mssql\/server:2022-CU\d+-ubuntu-\d+\.\d+$/)
    const env = readFileSync(join(tmp, 'envfile.copia'), 'utf8')
    expect(env).toMatch(/^MSSQL_SA_PASSWORD=.{20,}$/m)
    expect(env).toMatch(/^MSSQL_TELEMETRY_ENABLED=FALSE$/m)
    const pwd = /MSSQL_SA_PASSWORD=(.+)/.exec(env)![1]
    expect(chiamate).not.toContain(pwd)
    expect(r.stdout + r.stderr).not.toContain(pwd)
    // la password di sa non va nemmeno negli argomenti di sqlcmd (-P): si usa SQLCMDPASSWORD
    expect(chiamate).not.toMatch(/sqlcmd[^\n]* -P /)
    expect(chiamate).toMatch(/SQLCMDPASSWORD=/)
    // pulizia: container (con i volumi anonimi) e rete
    expect(chiamate).toMatch(/rm -f -v /)
    expect(chiamate).toMatch(/network rm /)
  })

  it('ripristina con RESTORE FILELISTONLY, WITH MOVE e CHECKSUM', () => {
    esegui([bak])
    const chiamate = readFileSync(log, 'utf8')
    expect(chiamate).toMatch(/FILELISTONLY/)
    expect(chiamate).toMatch(/WITH CHECKSUM.*MOVE N'/)
    expect(chiamate).toMatch(/CHECKSUM/)
  })

  it('crea un login di sola lettura (db_datareader) e nient altro', () => {
    esegui([bak])
    const chiamate = readFileSync(log, 'utf8')
    expect(chiamate).toMatch(/db_datareader/)
    expect(chiamate).not.toMatch(/db_owner|db_datawriter|sysadmin|db_ddladmin/)
  })

  it('con SHA256SUMS accanto al file, un hash diverso blocca il ripristino prima di Docker', () => {
    writeFileSync(join(tmp, 'SHA256SUMS'), `${'0'.repeat(64)}  ${basename(bak)}\n`)
    const r = esegui([bak])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/impronta/i)
    expect(readFileSync(log, 'utf8')).toBe('')
  })

  it('un file .age richiede SHA256SUMS: senza, uscita 2 prima di Docker', () => {
    const cifrato = `${bak}.age`
    writeFileSync(cifrato, 'cifrato-finto')
    const ident = join(tmp, 'chiave.txt')
    writeFileSync(ident, 'x')
    const r = esegui(['--identita', ident, cifrato])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/obbligatorio/)
    expect(readFileSync(log, 'utf8')).toBe('')
  })

  it('un file .age si verifica sul .bak in chiaro: impronta giusta passa, sbagliata blocca', () => {
    const cifrato = `${bak}.age`
    writeFileSync(cifrato, 'cifrato-finto')
    const ident = join(tmp, 'chiave.txt')
    writeFileSync(ident, 'x')
    const nome = basename(bak)
    const hash = createHash('sha256').update(readFileSync(bak)).digest('hex')
    // l'age finto copia il file cifrato (contenuto 'cifrato-finto'): per avere un .bak in chiaro
    // uguale a quello dichiarato, il contenuto cifrato finto coincide con quello del .bak
    writeFileSync(cifrato, readFileSync(bak))
    writeFileSync(join(tmp, 'SHA256SUMS'), `${hash}  ${nome}\n`)
    expect(esegui(['--identita', ident, cifrato]).status).toBe(0)
    writeFileSync(join(tmp, 'SHA256SUMS'), `${'1'.repeat(64)}  ${nome}\n`)
    writeFileSync(log, '')
    const r = esegui(['--identita', ident, cifrato])
    expect(r.status).toBe(2)
    expect(readFileSync(log, 'utf8')).toBe('')
  })

  it('un nome di database in minuscolo (ww00002014) e accettato e ripristinato come WW00002014', () => {
    const minuscolo = join(tmp, 'ww00002014_COPYONLY_202611180900.bak')
    writeFileSync(minuscolo, 'x')
    expect(esegui([minuscolo]).status).toBe(0)
    expect(readFileSync(log, 'utf8')).toMatch(/RESTORE DATABASE \[WW00002014\]/)
  })

  it('a fine uso il container e rimosso anche se il ripristino fallisce', () => {
    const r = esegui([bak], { WASTEFLOW_TEST_FALLISCI_RESTORE: '1' })
    expect(readFileSync(log, 'utf8')).toMatch(/RESTORE DATABASE/)
    expect(r.status).not.toBe(0)
    expect(readFileSync(log, 'utf8')).toMatch(/rm -f /)
  })

  it('un file .age si decifra con la chiave indicata; senza chiave si rifiuta', () => {
    const cifrato = `${bak}.age`
    writeFileSync(cifrato, 'cifrato-finto')
    expect(esegui([cifrato]).status).toBe(64)
    const ident = join(tmp, 'chiave.txt')
    writeFileSync(ident, 'AGE-SECRET-KEY-FINTA')
    const hash = createHash('sha256').update('cifrato-finto').digest('hex')
    writeFileSync(join(tmp, 'SHA256SUMS'), `${hash}  ${basename(bak)}\n`)
    const r = esegui(['--identita', ident, cifrato])
    expect(r.status).toBe(0)
    expect(readFileSync(log, 'utf8')).toMatch(/cp .*COPYONLY_202611180900\.bak/)
  })

  it('--estrai-in lancia l estrattore con la password nell ambiente, non negli argomenti', () => {
    const r = esegui(['--estrai-in', join(tmp, 'out'), bak])
    expect(r.status).toBe(0)
    const chiamata = readFileSync(log, 'utf8')
      .split('\n')
      .find(l => l.startsWith('npm '))!
    expect(chiamata).toMatch(
      /--server 172\.30\.0\.2 --porta 1433 --database WW00012026 --utente lettore/
    )
    expect(chiamata).toMatch(/pwd-presente=si/)
    expect(chiamata).not.toMatch(/--password/)
  })

  it('--tieni lascia il container acceso e lo dice', () => {
    const r = esegui(['--tieni', bak])
    expect(r.status).toBe(0)
    expect(readFileSync(log, 'utf8')).not.toMatch(/rm -f /)
    expect(readFileSync(log, 'utf8')).not.toMatch(/network rm /)
    expect(r.stdout).toMatch(/docker rm -f -v/)
    expect(r.stdout).toMatch(/docker network rm/)
  })

  it('i file di lavoro stanno in una cartella 0700 che sparisce a fine uso', () => {
    esegui([bak])
    const residui = readdirSync(tmp).filter((n: string) => n.startsWith('consegna-lavoro-'))
    expect(residui).toEqual([])
    expect(existsSync(join(tmp, 'envfile.copia'))).toBe(true)
    expect(statSync(join(tmp, 'envfile.copia')).isFile()).toBe(true)
  })
})
