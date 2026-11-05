/**
 * Guardia statica (fase 4.3, Task 14): il legame segue il registro ma non lo scrive mai. Nessun
 * file di `application/legami-movimento` (escluse le spec) puo' creare, modificare o cancellare
 * righe di `waste_movements`, ne' con Prisma ne' con SQL grezzo. `entryHash` e RENTRI non cambiano.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

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

// ---------------------------------------------------------------------------------------------
// Fatturazione per periodo (fase 4.4, Q35, S5): come il legame, non scrive mai sul registro; in
// piu' non prende il lock del registro (consultivo, `pg_advisory_xact_lock`) ne' la riga di
// `impostazioni_fatturazione` FOR UPDATE (la tiene solo chi imposta «fatturazione da»): un ciclo
// di lock con la 4.3 sarebbe possibile solo se la 4.4 li prendesse.
// ---------------------------------------------------------------------------------------------

/** Lock consultivi di ogni forma (`pg_advisory_lock`, `pg_advisory_xact_lock`, `pg_try_...`). */
export const LOCK_CONSULTIVO = /\bpg_(try_)?advisory_(xact_)?lock(_shared)?\b/i

/** `impostazioni_fatturazione ... FOR UPDATE` nello stesso statement (fino a backtick o punto e virgola). */
export const IMPOSTAZIONI_FOR_UPDATE =
  /impostazioni_fatturazione[^`;]*?\bFOR\s+(NO\s+KEY\s+)?UPDATE\b/i

export function prendeLockVietati(sorgente: string): boolean {
  const codice = senzaCommenti(sorgente)
  return LOCK_CONSULTIVO.test(codice) || IMPOSTAZIONI_FOR_UPDATE.test(codice)
}

describe('guardia: la fatturazione non scrive sul registro e non prende i lock del registro', () => {
  const SRC = join(__dirname, '..', '..')
  // Cartelle (tutti i sorgenti non-spec) e file singoli (i due job, solo se esistono ancora).
  const CARTELLE = ['application/fatturazione', 'api/fatturazione']
  const FILE = [
    'infrastructure/queue/jobs/fatturazione.job.ts',
    'infrastructure/jobs/fatturazione-manutenzione.job.ts',
  ]
  const percorsi = [
    ...CARTELLE.filter(c => existsSync(join(SRC, c))).flatMap(c => sorgenti(join(SRC, c))),
    ...FILE.filter(f => existsSync(join(SRC, f))).map(f => join(SRC, f)),
  ]
  const nome = (f: string) => relative(SRC, f)

  it('la guardia trova i sorgenti della fatturazione (non e` vuota)', () => {
    expect(percorsi.length).toBeGreaterThanOrEqual(5)
    expect(percorsi.map(nome)).toEqual(
      expect.arrayContaining([
        'application/fatturazione/selezione-fatturazione.ts',
        'application/fatturazione/lock-fatturazione.ts',
      ])
    )
  })

  it('nessun sorgente della fatturazione scrive su waste_movements', () => {
    const colpevoli = percorsi.filter(f => scriveSuMovimenti(readFileSync(f, 'utf8')))
    expect(colpevoli.map(nome)).toEqual([])
  })

  it('nessun sorgente della fatturazione prende un lock consultivo o impostazioni_fatturazione FOR UPDATE', () => {
    const colpevoli = percorsi.filter(f => prendeLockVietati(readFileSync(f, 'utf8')))
    expect(colpevoli.map(nome)).toEqual([])
  })

  describe('la guardia dei lock riconosce le forme vietate (non e` cieca)', () => {
    const cattivi: Record<string, string> = {
      'advisory xact': 'SELECT pg_advisory_xact_lock(hashtext(${x}))',
      'advisory con due chiavi': "SELECT pg_advisory_xact_lock(hashtext('a'), hashtext('b'))",
      'advisory di sessione': 'SELECT pg_advisory_lock(1)',
      'advisory try': 'SELECT pg_try_advisory_xact_lock(1)',
      'impostazioni for update':
        'SELECT id FROM "impostazioni_fatturazione" WHERE tenant_id = $1 FOR UPDATE',
      'impostazioni for update a capo':
        'SELECT 1 FROM impostazioni_fatturazione\n WHERE tenant_id = $1\n FOR UPDATE',
      'impostazioni for no key update': 'FROM impostazioni_fatturazione FOR NO KEY UPDATE',
    }
    for (const [nomeCaso, src] of Object.entries(cattivi)) {
      it(nomeCaso, () => {
        expect(prendeLockVietati(src)).toBe(true)
      })
    }
    it('letture e lock su altre tabelle non fanno scattare la guardia', () => {
      for (const buono of [
        'SELECT fatturazione_da FROM impostazioni_fatturazione WHERE tenant_id = $1',
        'SELECT fatturazione_da FROM impostazioni_fatturazione WHERE tenant_id = $1 FOR SHARE',
        'SELECT id FROM numerazioni_fattura WHERE tenant_id = $1 FOR UPDATE',
        'SELECT id FROM contratti_cliente FOR SHARE',
        'const a = `SELECT 1 FROM impostazioni_fatturazione`; const b = `SELECT 1 FROM x FOR UPDATE`',
        '// pg_advisory_xact_lock nel commento\nconst a = 1',
        '/* impostazioni_fatturazione FOR UPDATE */ const a = 1',
      ]) {
        expect(prendeLockVietati(buono)).toBe(false)
      }
    })
  })
})
