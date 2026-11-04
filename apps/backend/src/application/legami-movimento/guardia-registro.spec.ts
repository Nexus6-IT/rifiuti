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

const OPERAZIONI_PRISMA =
  'create|createMany|createManyAndReturn|update|updateMany|delete|deleteMany|upsert'

/** `wasteMovement.update`, `wasteMovement?.update`, `tx['wasteMovement'].update`. */
export const SCRITTURA_PRISMA = new RegExp(
  `\\bwasteMovement['"]?\\]?\\s*\\??\\s*\\.\\s*(${OPERAZIONI_PRISMA})\\b`
)

/** Scritture annidate tramite le relazioni del legame verso il movimento. */
export const SCRITTURA_ANNIDATA = new RegExp(
  `\\b(movimentoOriginale|movimentoVigente)\\s*:\\s*\\{\\s*(${OPERAZIONI_PRISMA}|connectOrCreate)\\b`
)

/** SQL con o senza schema (anche quotato), `ONLY`, `MERGE`, `TRUNCATE`. */
export const SCRITTURA_SQL =
  /\b(INSERT\s+INTO|UPDATE(\s+ONLY)?|DELETE\s+FROM(\s+ONLY)?|MERGE\s+INTO|TRUNCATE(\s+TABLE)?(\s+ONLY)?)\s+("?public"?\.)?"?waste_movements\b/i

export function scriveSuMovimenti(sorgente: string): boolean {
  const codice = senzaCommenti(sorgente)
  return (
    SCRITTURA_PRISMA.test(codice) || SCRITTURA_ANNIDATA.test(codice) || SCRITTURA_SQL.test(codice)
  )
}

describe('guardia: i legami non scrivono su waste_movements', () => {
  const file = sorgenti(CARTELLA)

  it('la cartella contiene sorgenti da controllare', () => {
    expect(file.length).toBeGreaterThanOrEqual(2)
  })

  it('nessun file di application/legami-movimento scrive su waste_movements', () => {
    const colpevoli = file.filter(f => scriveSuMovimenti(readFileSync(f, 'utf8')))
    expect(colpevoli.map(f => f.slice(CARTELLA.length + 1))).toEqual([])
  })

  describe('la guardia riconosce ogni forma di scrittura (non e` cieca)', () => {
    const cattivi: Record<string, string> = {
      'prisma update': 'tx.wasteMovement.update({ where: { id }, data: {} })',
      'prisma createMany': 'await this.prisma.wasteMovement.createMany({ data })',
      'prisma a capo': 'tx.wasteMovement\n  .deleteMany({})',
      'prisma optional chaining': 'tx.wasteMovement?.update({})',
      'prisma indice': "tx['wasteMovement'].update({})",
      'prisma upsert': 'tx.wasteMovement.upsert({})',
      'annidata vigente':
        'tx.legameMovimento.update({ data: { movimentoVigente: { update: { quantity: 1 } } } })',
      'annidata originale': 'data: { movimentoOriginale: {create: {}} }',
      'annidata connectOrCreate': 'data: { movimentoVigente: { connectOrCreate: {} } }',
      'sql update': 'await tx.$executeRaw`UPDATE waste_movements SET x = 1`',
      'sql insert quotato': 'INSERT INTO "waste_movements" (id) VALUES (1)',
      'sql delete minuscolo': 'delete  from waste_movements where id = 1',
      'sql con schema': 'UPDATE public.waste_movements SET x = 1',
      'sql con schema quotato': 'UPDATE "public"."waste_movements" SET x = 1',
      'sql ONLY': 'UPDATE ONLY waste_movements SET x = 1',
      'sql delete ONLY': 'DELETE FROM ONLY waste_movements',
      'sql MERGE': 'MERGE INTO waste_movements m USING x ON true',
      'sql TRUNCATE': 'TRUNCATE waste_movements',
      'sql TRUNCATE TABLE': 'TRUNCATE TABLE public.waste_movements',
    }
    for (const [nome, src] of Object.entries(cattivi)) {
      it(nome, () => {
        expect(scriveSuMovimenti(src)).toBe(true)
      })
    }
  })

  it('le letture e le scritture su altre tabelle non fanno scattare la guardia', () => {
    for (const buono of [
      'tx.wasteMovement.findMany({})',
      'tx.wasteMovement?.count({})',
      'SELECT id FROM waste_movements WHERE id = 1',
      'UPDATE legami_movimento SET stato = 1',
      'data: { movimentoVigente: { connect: { id } } }',
      'include: { movimentoVigente: { select: { id: true } } }',
    ]) {
      expect(scriveSuMovimenti(buono)).toBe(false)
    }
  })

  it('i commenti non fanno scattare la guardia; una // dentro una stringa toglie il resto della riga (limite noto)', () => {
    expect(senzaCommenti('// UPDATE waste_movements\nconst a = 1')).not.toMatch(/UPDATE/)
    expect(senzaCommenti('/* wasteMovement.update */ const a = 1')).not.toMatch(/update/)
    // Limite documentato: `'a//b'` e il codice che segue sulla stessa riga non si controllano.
    expect(senzaCommenti("const u = 'a//b'; tx.wasteMovement.update({})")).not.toMatch(/update/)
  })
})
