/**
 * Guardia statica (fase 4.3, Task 14): il legame segue il registro ma non lo scrive mai. Nessun
 * file di `application/legami-movimento` (escluse le spec) puo' creare, modificare o cancellare
 * righe di `waste_movements`, ne' con Prisma ne' con SQL grezzo. `entryHash` e RENTRI non cambiano.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const CARTELLA = __dirname

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) return sorgenti(p)
    return /\.ts$/.test(nome) && !/\.spec\.ts$/.test(nome) && !/\.postgres-spec\.ts$/.test(nome)
      ? [p]
      : []
  })
}

/** Toglie commenti di riga e di blocco: la guardia guarda il codice, non la prosa. */
export function senzaCommenti(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

export const SCRITTURA_PRISMA =
  /\bwasteMovement\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|delete|deleteMany|upsert)\b/
export const SCRITTURA_SQL = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?waste_movements\b/i

describe('guardia: i legami non scrivono su waste_movements', () => {
  const file = sorgenti(CARTELLA)

  it('la cartella contiene sorgenti da controllare', () => {
    expect(file.length).toBeGreaterThanOrEqual(2)
  })

  it('nessun file di application/legami-movimento scrive su waste_movements', () => {
    const colpevoli = file.filter(f => {
      const codice = senzaCommenti(readFileSync(f, 'utf8'))
      return SCRITTURA_PRISMA.test(codice) || SCRITTURA_SQL.test(codice)
    })
    expect(colpevoli.map(f => f.slice(CARTELLA.length + 1))).toEqual([])
  })

  it('la guardia riconosce le scritture (non e` cieca)', () => {
    for (const cattivo of [
      'tx.wasteMovement.update({ where: { id }, data: {} })',
      'await this.prisma.wasteMovement.createMany({ data })',
      'tx.wasteMovement\n  .deleteMany({})',
      'await tx.$executeRaw`UPDATE waste_movements SET x = 1`',
      'INSERT INTO "waste_movements" (id) VALUES (1)',
      'delete  from waste_movements where id = 1',
    ]) {
      expect(SCRITTURA_PRISMA.test(cattivo) || SCRITTURA_SQL.test(cattivo)).toBe(true)
    }
    for (const buono of [
      'tx.wasteMovement.findMany({})',
      'SELECT id FROM waste_movements WHERE id = 1 FOR KEY SHARE',
      'UPDATE legami_movimento SET stato = 1',
    ]) {
      expect(SCRITTURA_PRISMA.test(buono) || SCRITTURA_SQL.test(buono)).toBe(false)
    }
  })

  it('i commenti non fanno scattare la guardia', () => {
    expect(senzaCommenti('// UPDATE waste_movements\nconst a = 1')).not.toMatch(/UPDATE/)
    expect(senzaCommenti('/* wasteMovement.update */ const a = 1')).not.toMatch(/update/)
  })
})
