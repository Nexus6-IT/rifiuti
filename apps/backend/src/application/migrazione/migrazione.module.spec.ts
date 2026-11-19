/**
 * Pezzo I2, T6: test d'architettura. Il caricamento di un pacchetto gira SOLO col client
 * applicativo (RLS): ne' il modulo, ne' i file di migrazione e della CLI toccano il client di sistema.
 */
import { MODULE_METADATA } from '@nestjs/common/constants'
import { Test } from '@nestjs/testing'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { senzaCommenti } from '../../test-support/sorgenti-controller'
import { CaricaPacchettoService } from './caricamento/carica-pacchetto.service'
import { MigrazioneModule } from './migrazione.module'

const SRC = join(__dirname, '..', '..')
const ACCESSO_AL_SISTEMA =
  /\b(PrismaSistemaService|risolviUrlSistema|DATABASE_URL_SISTEMA|PrismaModule)\b|prisma-sistema\.service|url-sistema|prisma\.module/

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return sorgenti(p)
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : []
  })
}

describe('migrazione: solo il client applicativo', () => {
  it('il modulo non importa PrismaModule (che espone anche il client di sistema)', () => {
    const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, MigrazioneModule) ?? []
    expect(imports).not.toContain(PrismaModule)
  })

  it('compilato da solo, il modulo fornisce il client applicativo e NON quello di sistema', async () => {
    const ref = await Test.createTestingModule({ imports: [MigrazioneModule] }).compile()
    expect(ref.get(CaricaPacchettoService)).toBeDefined()
    expect(ref.get(PrismaService, { strict: false })).toBeDefined()
    expect(() => ref.get(PrismaSistemaService, { strict: false })).toThrow()
    await ref.close()
  })

  it('nessun file di application/migrazione, della CLI o del modulo nomina il client di sistema', () => {
    const file = [
      ...sorgenti(join(SRC, 'application', 'migrazione')),
      ...sorgenti(join(SRC, 'cli')),
      ...sorgenti(join(SRC, 'test-support', 'migrazione')),
    ]
    expect(file.length).toBeGreaterThan(10)
    const colpevoli = file.filter(f => ACCESSO_AL_SISTEMA.test(senzaCommenti(readFileSync(f, 'utf8'))))
    expect(colpevoli).toEqual([])
  })
})
