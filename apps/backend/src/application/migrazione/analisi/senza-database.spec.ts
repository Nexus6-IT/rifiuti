import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * Test d'architettura (D9 del piano Fase 3): l'analizzatore e tutto cio' che
 * porta alla CLI `migrazione:analizza` NON aprono il database: nessun import
 * di Prisma, dei servizi Prisma, di NestJS o dell'infrastruttura applicativa.
 * Vale anche per i decodificatori di dominio e per lo staging.
 */
const SRC = join(__dirname, '../../..')
const PERCORSI = [
  'application/migrazione/staging',
  'application/migrazione/analisi',
  'application/migrazione/estrazione',
  'domain/migrazione',
  'cli/migrazione-analizza.ts',
]
const VIETATI = [
  /@prisma\/client/,
  /PrismaService/,
  /PrismaSistemaService/,
  /@nestjs\//,
  /\/infrastructure\//,
]

function sorgenti(percorso: string): string[] {
  const p = join(SRC, percorso)
  if (statSync(p).isFile()) return [p]
  return readdirSync(p, { withFileTypes: true }).flatMap(d => {
    const figlio = join(percorso, d.name)
    if (d.isDirectory()) return sorgenti(figlio)
    return d.name.endsWith('.ts') && !d.name.endsWith('.spec.ts') ? [join(SRC, figlio)] : []
  })
}

describe('migrazione:analizza non apre il database', () => {
  const file = PERCORSI.flatMap(sorgenti)

  it('trova i sorgenti da controllare', () => {
    expect(file.length).toBeGreaterThan(20)
    expect(file.some(f => f.endsWith('cli/migrazione-analizza.ts'))).toBe(true)
  })

  it.each(file.map(f => [relative(SRC, f), f]))('%s', (_nome, f) => {
    const righeImport = readFileSync(f, 'utf8')
      .split('\n')
      .filter(
        l => /^\s*(import|export)\b.*\bfrom\b|require\(/.test(l) || /^\s*import\s+['"]/.test(l)
      )
    const colpite = righeImport.filter(l => VIETATI.some(re => re.test(l)))
    expect(colpite).toEqual([])
  })
})
