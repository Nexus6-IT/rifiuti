import * as fs from 'fs'
import * as path from 'path'

// Guardiano dell'infrastruttura di produzione: tiene allineato docker-compose.prod.yml
// con le variabili d'ambiente che il codice del backend legge davvero.

const RADICE_REPO = path.resolve(__dirname, '../../../../..')
const SRC_BACKEND = path.resolve(__dirname, '../..')

function leggiFile(relativo: string): string {
  return fs.readFileSync(path.join(RADICE_REPO, relativo), 'utf8').replace(/\r\n/g, '\n')
}

/** Righe del servizio: dalla riga `  <servizio>:` fino al servizio successivo. */
function bloccoServizio(compose: string, servizio: string): string[] {
  const righe = compose.split('\n')
  const inizio = righe.findIndex(r => r === `  ${servizio}:`)
  if (inizio === -1) throw new Error(`Servizio ${servizio} non trovato nel compose`)
  const blocco: string[] = []
  for (let i = inizio; i < righe.length; i++) {
    if (i > inizio && /^ {0,2}\S/.test(righe[i])) break
    blocco.push(righe[i])
  }
  return blocco
}

/** Chiave → valore grezzo del blocco `environment:` del servizio (solo forma mappa). */
function ambienteServizio(compose: string, servizio: string): Map<string, string> {
  const blocco = bloccoServizio(compose, servizio)
  const inizio = blocco.findIndex(r => r === '    environment:')
  if (inizio === -1) throw new Error(`Blocco environment non trovato nel servizio ${servizio}`)
  const env = new Map<string, string>()
  for (let i = inizio + 1; i < blocco.length; i++) {
    const riga = blocco[i]
    if (riga.trim() === '' || riga.trim().startsWith('#')) continue
    if (/^ {0,4}\S/.test(riga)) break
    if (/^ {6}- /.test(riga)) {
      throw new Error(`environment di ${servizio} in forma lista: usare la forma mappa`)
    }
    const m = /^ {6}([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(riga)
    if (m) env.set(m[1], m[2].trim().replace(/^(["'])(.*)\1$/, '$2'))
  }
  return env
}

function fileTsProduzione(dir: string): string[] {
  const out: string[] = []
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const percorso = path.join(dir, voce.name)
    if (voce.isDirectory()) out.push(...fileTsProduzione(percorso))
    else if (voce.name.endsWith('.ts') && !voce.name.endsWith('.spec.ts')) out.push(percorso)
  }
  return out
}

function variabiliLetteDalCodice(): Map<string, string[]> {
  const lette = new Map<string, string[]>()
  const aggiungi = (nome: string, file: string) => {
    const lista = lette.get(nome) ?? []
    if (!lista.includes(file)) lista.push(file)
    lette.set(nome, lista)
  }
  const reConfig = /\.(?:get|getOrThrow)\s*(?:<[^>()]*>)?\(\s*['"`]([A-Z][A-Z0-9_]+)['"`]/g
  const reEnv = /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*\])/g
  for (const file of fileTsProduzione(SRC_BACKEND)) {
    const testo = fs.readFileSync(file, 'utf8')
    const rel = path.relative(path.join(SRC_BACKEND, '..'), file).replace(/\\/g, '/')
    for (const m of testo.matchAll(reConfig)) aggiungi(m[1], rel)
    for (const m of testo.matchAll(reEnv)) aggiungi(m[1] ?? m[2], rel)
  }
  const schema = path.join(SRC_BACKEND, '..', 'prisma', 'schema.prisma')
  if (fs.existsSync(schema) && fs.readFileSync(schema, 'utf8').includes('env("DATABASE_URL")')) {
    aggiungi('DATABASE_URL', 'prisma/schema.prisma')
  }
  return lette
}

function variabiliConDefaultNelCodice(): Set<string> {
  const conDefault = new Set<string>()
  const re = /\.get\s*(?:<[^>()]*>)?\(\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*,/g
  for (const file of fileTsProduzione(SRC_BACKEND)) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(re)) conDefault.add(m[1])
  }
  return conDefault
}

const RENTRI_DEMO = "oggi vale il default demo; il passaggio all'ente reale è una decisione"

const NON_PASSATE: Record<string, string> = {
  API_PREFIX: "l'nginx del frontend e l'healthcheck dell'immagine presuppongono api/v1",
  CURRENT_TENANT_ID: 'solo job CLI e test (tenant-context.ts)',
  HOSTNAME: 'la imposta Docker',
  JWT_ACCESS_TOKEN_EXPIRATION: 'default nel codice (15m); passata vuota lo scavalcherebbe',
  JWT_REFRESH_TOKEN_EXPIRATION: 'default nel codice; passata vuota lo scavalcherebbe',
  JWT_AUDIENCE: 'default nel codice (wasteflow-api)',
  JWT_ISSUER: 'default nel codice (wasteflow.it)',
  REDIS_DB: 'default 0',
  REDIS_MODE: 'Redis standalone in produzione',
  REFDATA_SEED_ON_BOOT: 'default: seed se vuoto',
  SWAGGER_ENABLED: 'spento in produzione di proposito, si accende solo per diagnosi',
  SPID_STRICT_LEVEL_CHECK: 'Keycloak non è un IdP SPID: il controllo stretto bloccherebbe il login',
  SPID_ENTRY_POINT: 'alias di SPID_IDP_ENTRY_POINT, già passata',
  SPID_ISSUER: 'alias di SPID_ENTITY_ID, già passata',
  SPID_PRIVATE_KEY: 'richieste SAML verso Keycloak non firmate',
  SPID_PUBLIC_CERT: 'richieste SAML verso Keycloak non firmate',
  SAML_CALLBACK_URL: 'KeycloakSamlStrategy non registrata in alcun modulo',
  SAML_CERT: 'KeycloakSamlStrategy non registrata in alcun modulo',
  SAML_ISSUER: 'KeycloakSamlStrategy non registrata in alcun modulo',
  QES_QTSP_ENDPOINT: 'nessun contratto QTSP: da passare con SIGNATURE_PROVIDER=qes',
  QES_CLIENT_CERT: 'nessun contratto QTSP: da passare con SIGNATURE_PROVIDER=qes',
  QES_CLIENT_KEY: 'nessun contratto QTSP: da passare con SIGNATURE_PROVIDER=qes',
  TSA_URL: 'nessuna TSA accreditata: da passare con TSA_PROVIDER=rfc3161',
  STRIPE_SECRET_KEY: 'billing non attivo in produzione',
  STRIPE_WEBHOOK_SECRET: 'billing non attivo in produzione',
  STRIPE_PRICE_ID_PROFESSIONAL: 'billing non attivo in produzione',
  STRIPE_PRICE_ID_ENTERPRISE: 'billing non attivo in produzione',
  RENTRI_API_URL: RENTRI_DEMO,
  RENTRI_AUDIENCE: RENTRI_DEMO,
  RENTRI_CERTIFICATE_PEM: RENTRI_DEMO,
  RENTRI_CLIENT_ID: RENTRI_DEMO,
  RENTRI_ENV_TENANT_ID:
    'vale solo con le credenziali RENTRI da env, che in produzione non sono passate: ogni azienda carica il proprio certificato',
  RENTRI_JWT_ALG: RENTRI_DEMO,
  RENTRI_JWT_TTL_SECONDS: RENTRI_DEMO,
  RENTRI_PRIVATE_KEY_PEM: RENTRI_DEMO,
  RENTRI_SIGNATURE_AUDIENCE: RENTRI_DEMO,
  RENTRI_SYNC_CONCURRENCY: RENTRI_DEMO,
}

describe('docker-compose.prod.yml: variabili del backend', () => {
  const compose = leggiFile('docker-compose.prod.yml')
  const env = ambienteServizio(compose, 'backend')

  it('passa al container ogni variabile letta dal codice, o ne dichiara il motivo', () => {
    const mancanti = [...variabiliLetteDalCodice().entries()]
      .filter(([nome]) => !env.has(nome) && !(nome in NON_PASSATE))
      .map(([nome, file]) => `${nome} (${file.join(', ')})`)
    expect(mancanti).toEqual([])
  })

  it('NON_PASSATE non contiene variabili già nel compose né variabili che il codice non legge più', () => {
    const lette = variabiliLetteDalCodice()
    const giaNelCompose = Object.keys(NON_PASSATE).filter(nome => env.has(nome))
    const nonPiuLette = Object.keys(NON_PASSATE).filter(nome => !lette.has(nome))
    expect({ giaNelCompose, nonPiuLette }).toEqual({ giaNelCompose: [], nonPiuLette: [] })
  })

  it('non passa nuda una variabile che il codice legge con un default', () => {
    const nude = [...variabiliConDefaultNelCodice()]
      .filter(nome => env.has(nome) && env.get(nome) === `\${${nome}}`)
      .sort()
    expect(nude).toEqual([])
  })

  it('passa SENTRY_DSN e APP_VERSION', () => {
    expect(env.get('SENTRY_DSN')).toBe('${SENTRY_DSN:-}')
    expect(env.get('APP_VERSION')).toBe('${TAG:-latest}')
  })

  it('rende obbligatoria PERMISSION_CACHE_HMAC_SECRET', () => {
    expect(env.get('PERMISSION_CACHE_HMAC_SECRET')).toMatch(/^\$\{PERMISSION_CACHE_HMAC_SECRET:\?/)
  })

  it.each(['backend', 'postgres'])(
    '%s non monta più ./backups (endpoint /backup rimossi in ddac487)',
    servizio => {
      expect(bloccoServizio(compose, servizio).join('\n')).not.toContain('./backups')
    }
  )
})

describe('docker-compose.prod.yml: fuso orario', () => {
  it('nessun servizio di produzione imposta TZ (il tempo italiano sta in core/time)', () => {
    const compose = leggiFile('docker-compose.prod.yml')
    for (const s of ['backend', 'postgres']) {
      expect(ambienteServizio(compose, s).has('TZ')).toBe(false)
    }
  })
})

describe('docker-compose.prod.yml: log', () => {
  const compose = leggiFile('docker-compose.prod.yml')
  it('definisce una rotazione json-file da 50m x 3', () => {
    expect(compose).toMatch(
      /^x-logging: &logging\n {2}driver: json-file\n {2}options:\n {4}max-size: "50m"\n {4}max-file: "3"$/m
    )
  })
  it.each(['postgres', 'redis', 'backend', 'frontend'])('%s usa la rotazione comune', servizio => {
    expect(bloccoServizio(compose, servizio)).toContain('    logging: *logging')
  })
})

describe('deploy.yml: rilascio in produzione', () => {
  const deploy = leggiFile('.gitea/workflows/deploy.yml')
  const BACKUP =
    'BACKUP_MODALITA=predeploy WASTEFLOW_COMPOSE_FILE="$PWD/docker-compose.prod.yml" bash ops/backup-offsite.sh'

  it('il deploy esegue il backup prima delle migration', () => {
    const iReset = deploy.indexOf('git reset --hard origin/master')
    const iBackup = deploy.indexOf(BACKUP)
    const iMigrate = deploy.indexOf('npx prisma migrate deploy')
    expect(iReset).toBeGreaterThan(-1)
    expect(iBackup).toBeGreaterThan(iReset)
    expect(iMigrate).toBeGreaterThan(iBackup)
  })

  it('un passo fallito ferma lo script remoto', () => {
    expect(deploy).toContain('script_stop: true')
    expect(deploy).toMatch(/script: \|\n\s+set -e\n/)
  })

  it('il passo SSH ha un command_timeout che copre pull, backup, migration e smoke test', () => {
    // Il default di appleboy/ssh-action e' 10 minuti; il job ha timeout-minutes: 30.
    expect(deploy).toMatch(/command_timeout: 25m/)
  })

  it('lo smoke test interroga /api/v1/health/db, che fallisce se il database non risponde', () => {
    expect(deploy).toContain('curl -fsS http://127.0.0.1:3017/api/v1/health/db')
  })
})
