import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService as PrismaServiceDatabase } from './prisma.service'
import { PrismaModule as PrismaModuleDatabase } from './prisma.module'
import { PrismaService as PrismaServicePersistence } from '../persistence/prisma.service'
import { PrismaModule as PrismaModulePersistence } from '../persistence/prisma.module'

const SRC = join(__dirname, '..', '..')
const MODULO_AUTORIZZATO = ['infrastructure', 'persistence', 'prisma.module.ts'].join('/')

function moduliNest(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return moduliNest(percorso)
    return nome.endsWith('.module.ts') ? [percorso] : []
  })
}

/**
 * Elementi di primo livello dell'array `providers:` (o `exports:`) di un modulo:
 * gli identificatori annidati (es. `inject: [PrismaService]` dentro un provider
 * a factory) NON contano, perche' sono dipendenze e non registrazioni.
 */
function elementiPrimoLivello(sorgente: string, chiave: 'providers' | 'exports'): string[] {
  const senzaCommenti = sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const inizio = senzaCommenti.search(new RegExp(String.raw`\b${chiave}\s*:\s*\[`))
  if (inizio < 0) return []
  let profondita = 1
  let corrente = ''
  const elementi: string[] = []
  for (let i = senzaCommenti.indexOf('[', inizio) + 1; i < senzaCommenti.length; i++) {
    const c = senzaCommenti[i]
    if ('[{('.includes(c)) profondita++
    else if (']})'.includes(c)) profondita--
    else if (profondita === 1 && c === ',') {
      elementi.push(corrente.trim())
      corrente = ''
    } else if (profondita === 1) corrente += c
    if (profondita === 0) break
  }
  elementi.push(corrente.trim())
  return elementi
}

describe('PrismaService unico', () => {
  afterEach(() => jest.restoreAllMocks())

  // Garanzia a livello applicazione: compilare AppModule in un unit test richiede
  // database, Redis, Keycloak ecc., quindi si controlla il grafo in modo statico.
  // Un modulo che registra PrismaService tra i propri providers (o lo riesporta)
  // crea una seconda istanza e un secondo pool, come faceva CERModule.
  it('nessun modulo a parte il PrismaModule di persistence registra o riesporta PrismaService', () => {
    const colpevoli = moduliNest(SRC)
      .filter(f => relative(SRC, f).split(sep).join('/') !== MODULO_AUTORIZZATO)
      .filter(f => {
        const sorgente = readFileSync(f, 'utf8')
        return (['providers', 'exports'] as const).some(k =>
          elementiPrimoLivello(sorgente, k).includes('PrismaService')
        )
      })
      .map(f => relative(SRC, f).split(sep).join('/'))

    expect(colpevoli).toEqual([])
  })

  it('PrismaService di database e di persistence sono la stessa classe', () => {
    expect(PrismaServiceDatabase === PrismaServicePersistence).toBe(true)
  })

  it('un modulo che importa entrambi i PrismaModule riceve la stessa istanza', async () => {
    @Module({ imports: [PrismaModuleDatabase, PrismaModulePersistence] })
    class AppDiProva {}

    // Evita connessioni reali nel caso i lifecycle hook vengano eseguiti
    jest.spyOn(PrismaServicePersistence.prototype, 'onModuleInit').mockResolvedValue(undefined)
    jest.spyOn(PrismaServicePersistence.prototype, 'onModuleDestroy').mockResolvedValue(undefined)

    const moduleRef = await Test.createTestingModule({ imports: [AppDiProva] }).compile()

    const daDatabase = moduleRef.get(PrismaServiceDatabase, { strict: false })
    const daPersistence = moduleRef.get(PrismaServicePersistence, { strict: false })
    expect(daDatabase === daPersistence).toBe(true)
  })
})
