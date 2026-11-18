/**
 * Un errore sollevato al COMMIT da un vincolo `DEFERRABLE INITIALLY DEFERRED` arriva
 * all'applicazione? Ticket 2026-11-14-prisma-errore-commit-vincolo-differito.
 *
 * Caso A: `PrismaClient` nudo. Caso B: client applicativo (`creaPrismaServiceApplicativo`,
 * estensione tenant per transazione) e suo `.db` (estensione RLS), dentro `TenantContext.run`.
 * Tabella, funzione e trigger si creano qui e si rimuovono alla fine.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { PrismaClient } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { creaPrismaServiceApplicativo } from './prisma.service'
import { confermaVincoliDifferiti } from './prisma-tenant-transazione'

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'

const nudo = new PrismaClient()
const applicativo = creaPrismaServiceApplicativo()

type Cliente = {
  $transaction: (...args: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  $executeRaw: (...args: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

const contaRighe = async (): Promise<number> => {
  const r = await nudo.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM t_diff_commit`
  return Number(r[0].n)
}

/** Esegue `fn` e restituisce l'errore sollevato (o null se nessuno). */
const errore = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn()
    return null
  } catch (e) {
    return e
  }
}

const FORME: Array<[string, (c: Cliente) => Promise<unknown>]> = [
  [
    'interattiva',
    c =>
      c.$transaction(async (tx: Cliente) => tx.$executeRaw`INSERT INTO t_diff_commit VALUES (1)`),
  ],
  [
    'interattiva Serializable',
    c =>
      c.$transaction(async (tx: Cliente) => tx.$executeRaw`INSERT INTO t_diff_commit VALUES (1)`, {
        isolationLevel: 'Serializable',
      }),
  ],
  ['batch (array)', c => c.$transaction([c.$executeRaw`INSERT INTO t_diff_commit VALUES (1)`])],
]

describe('Errore del COMMIT di un vincolo differito (Postgres reale)', () => {
  beforeAll(async () => {
    await nudo.$executeRawUnsafe(`DROP TABLE IF EXISTS t_diff_commit CASCADE`)
    await nudo.$executeRawUnsafe(`DROP FUNCTION IF EXISTS t_diff_commit_ko()`)
    await nudo.$executeRawUnsafe(`CREATE TABLE t_diff_commit (id int)`)
    await nudo.$executeRawUnsafe(`
      CREATE FUNCTION t_diff_commit_ko() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'ko al commit' USING ERRCODE = 'integrity_constraint_violation'; END $$`)
    await nudo.$executeRawUnsafe(`
      CREATE CONSTRAINT TRIGGER t_diff_commit_chk AFTER INSERT ON t_diff_commit
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION t_diff_commit_ko()`)
  })

  beforeEach(async () => {
    await nudo.$executeRawUnsafe(`ALTER TABLE t_diff_commit DISABLE TRIGGER t_diff_commit_chk`)
    await nudo.$executeRawUnsafe(`DELETE FROM t_diff_commit`)
    await nudo.$executeRawUnsafe(`ALTER TABLE t_diff_commit ENABLE TRIGGER t_diff_commit_chk`)
  })

  afterAll(async () => {
    await nudo.$executeRawUnsafe(`DROP TABLE IF EXISTS t_diff_commit CASCADE`)
    await nudo.$executeRawUnsafe(`DROP FUNCTION IF EXISTS t_diff_commit_ko()`)
    await nudo.$disconnect()
    await applicativo.$disconnect()
  })

  describe('A: PrismaClient nudo (comportamento di Prisma 5.22, non nostro)', () => {
    it("interattiva: NESSUN errore, ma la transazione e' annullata (scritture perse in silenzio)", async () => {
      for (const [nome, esegui] of FORME.filter(([n]) => n !== 'batch (array)')) {
        const e = await errore(() => esegui(nudo as unknown as Cliente))
        expect({ nome, e }).toEqual({ nome, e: null })
        expect(await contaRighe()).toBe(0)
      }
    })

    it("batch: l'errore arriva", async () => {
      const e = await errore(() => FORME[2][1](nudo as unknown as Cliente))
      expect(String(e)).toContain('ko al commit')
      expect(await contaRighe()).toBe(0)
    })

    it("contromisura: confermaVincoliDifferiti come ultimo statement fa arrivare l'errore", async () => {
      const e = await errore(() =>
        nudo.$transaction(async tx => {
          await tx.$executeRaw`INSERT INTO t_diff_commit VALUES (1)`
          await confermaVincoliDifferiti(tx)
        })
      )
      expect(String(e)).toContain('ko al commit')
      expect(await contaRighe()).toBe(0)
    })
  })

  describe("B: client applicativo (l'estensione chiude i vincoli differiti) dentro TenantContext.run", () => {
    for (const [nome, esegui] of FORME) {
      it(`${nome}: l'errore del commit arriva e le scritture non restano`, async () => {
        const e = await TenantContext.run({ tenantId: 'tenant-differito' }, () =>
          errore(() => esegui(applicativo as unknown as Cliente))
        )
        expect(e).not.toBeNull()
        expect(String(e)).toContain('ko al commit')
        expect(await contaRighe()).toBe(0)
      })
      it(`${nome} su .db (estensione RLS): l'errore del commit arriva`, async () => {
        const e = await TenantContext.run({ tenantId: 'tenant-differito' }, () =>
          errore(() => esegui(applicativo.db as unknown as Cliente))
        )
        expect(e).not.toBeNull()
        expect(String(e)).toContain('ko al commit')
        expect(await contaRighe()).toBe(0)
      })
    }
  })
})
