import * as fs from 'fs'
import * as path from 'path'

// Guardiano del compose per il server infra-prod (docker-compose.infra-prod.yml):
// 1) il backend riceve le stesse variabili di docker-compose.prod.yml (nessuna deriva);
// 2) il file rispetta il contratto del controllo di hardening del repo infra-prod
//    (ruolo app_layout, tasks/compose_check.yml), qui in forma ridotta.

const RADICE_REPO = path.resolve(__dirname, '../../../../..')
const leggi = (rel: string): string =>
  fs.readFileSync(path.join(RADICE_REPO, rel), 'utf8').replace(/\r\n/g, '\n')

function blocco(compose: string, servizio: string): string[] {
  const righe = compose.split('\n')
  const inizio = righe.findIndex(r => r === `  ${servizio}:`)
  if (inizio === -1) throw new Error(`Servizio ${servizio} non trovato`)
  const out: string[] = []
  for (let i = inizio; i < righe.length; i++) {
    if (i > inizio && /^ {0,2}\S/.test(righe[i])) break
    out.push(righe[i])
  }
  return out
}

function chiaviAmbiente(compose: string, servizio: string): Set<string> {
  const b = blocco(compose, servizio)
  const inizio = b.findIndex(r => r === '    environment:')
  if (inizio === -1) throw new Error(`environment non trovato in ${servizio}`)
  const chiavi = new Set<string>()
  for (let i = inizio + 1; i < b.length; i++) {
    if (b[i].trim() === '' || b[i].trim().startsWith('#')) continue
    if (/^ {0,4}\S/.test(b[i])) break
    const m = /^ {6}([A-Z][A-Z0-9_]*):/.exec(b[i])
    if (m) chiavi.add(m[1])
  }
  return chiavi
}

const SERVIZI = ['postgres', 'redis', 'backend', 'frontend']
const ESENTI_CAP_DROP = ['postgres', 'redis']

describe('docker-compose.infra-prod.yml', () => {
  const nuovo = leggi('docker-compose.infra-prod.yml')
  const vecchio = leggi('docker-compose.prod.yml')

  it('il backend riceve ogni variabile che riceve docker-compose.prod.yml', () => {
    const nuove = chiaviAmbiente(nuovo, 'backend')
    const mancanti = [...chiaviAmbiente(vecchio, 'backend')].filter(k => !nuove.has(k))
    expect(mancanti).toEqual([])
  })

  it('non aggiunge al backend variabili assenti dal compose in esercizio', () => {
    const vecchie = chiaviAmbiente(vecchio, 'backend')
    // Uniche aggiunte: la protezione di /metrics, che sul VPS in esercizio isola nginx.
    const consentite = ['METRICS_TOKEN', 'METRICS_REQUIRE_TOKEN']
    const inPiu = [...chiaviAmbiente(nuovo, 'backend')].filter(k => !vecchie.has(k) && !consentite.includes(k))
    expect(inPiu).toEqual([])
  })

  it('redis: noeviction, maxmemory a non oltre meta\' del limite del container', () => {
    const t = blocco(nuovo, 'redis').join('\n')
    expect(t).toContain('--maxmemory-policy noeviction')
    const mm = Number(/--maxmemory (\d+)mb/.exec(t)?.[1])
    const lim = Number(/memory: (\d+)M\n\s+pids/.exec(t)?.[1])
    expect(mm).toBeGreaterThan(0)
    expect(mm * 2).toBeLessThanOrEqual(lim)
  })

  it('il backend esige METRICS_TOKEN e METRICS_REQUIRE_TOKEN=true', () => {
    const t = blocco(nuovo, 'backend').join('\n')
    expect(t).toMatch(/METRICS_TOKEN: \$\{METRICS_TOKEN:\?/)
    expect(t).toContain('METRICS_REQUIRE_TOKEN: "true"')
  })

  it.each(SERVIZI)('%s: limiti di memoria, CPU e pid, no-new-privileges, rotazione dei log', s => {
    const t = blocco(nuovo, s).join('\n')
    expect(t).toMatch(/memory: \S+/)
    expect(t).toMatch(/cpus: "[\d.]+"/)
    expect(t).toMatch(/pids: \d+/)
    expect(t).toContain('no-new-privileges:true')
    expect(t).toContain('logging: *logging')
  })

  it.each(SERVIZI.filter(s => !ESENTI_CAP_DROP.includes(s)))('%s: cap_drop ALL', s => {
    expect(blocco(nuovo, s).join('\n')).toMatch(/cap_drop:\n\s+- ALL/)
  })

  it('cap_add solo CHOWN, SETUID, SETGID e solo sul frontend', () => {
    for (const s of SERVIZI) {
      const t = blocco(nuovo, s).join('\n')
      if (s === 'frontend') expect(t).toMatch(/cap_add:\n\s+- CHOWN\n\s+- SETUID\n\s+- SETGID\n/)
      else expect(t).not.toContain('cap_add')
    }
  })

  it('porte solo su 127.0.0.1 nel blocco 3040-3049, nessuna su postgres e redis', () => {
    const porte = [...nuovo.matchAll(/^\s+- "([^"]*:\d+:\d+)"$/gm)].map(m => m[1])
    expect(porte.sort()).toEqual(['127.0.0.1:3040:3000', '127.0.0.1:3041:80'])
    for (const s of ['postgres', 'redis']) expect(blocco(nuovo, s).join('\n')).not.toContain('ports:')
  })

  it('nessuna rete external, nessun bind mount, nessun socket Docker', () => {
    expect(nuovo).not.toMatch(/external:\s*true/)
    expect(nuovo).not.toContain('docker.sock')
    expect(nuovo).not.toMatch(/^\s+- \.{0,2}\//m)
  })

  it('la rete rifiuti-prod ha la subnet fissa 10.250.30.0/24', () => {
    expect(nuovo).toMatch(/rifiuti-prod:\n\s+name: rifiuti-prod\n\s+driver: bridge\n(?:\s+#.*\n)*\s+ipam:\n\s+config:\n\s+- subnet: 10\.250\.30\.0\/24/)
  })

  it('nomi dei container adatti agli exporter di infra-prod', () => {
    expect(nuovo).toContain('container_name: rifiuti-postgres-prod')
    expect(nuovo).toContain('container_name: rifiuti-redis-prod')
  })

  it('TAG obbligatorio e nessun Keycloak nello stack', () => {
    expect(nuovo).toMatch(/rifiuti-backend:\$\{TAG:\?/)
    expect(nuovo).not.toMatch(/^ {2}keycloak:/m)
  })
})
