/**
 * ============================================================================
 * RLS Prisma Extension — difesa in profondità multi-tenant
 * ============================================================================
 *
 * Verifica che l'estensione `applyTenantScope` inietti automaticamente il
 * `tenantId` corrente (risolto dal TenantContext) nelle query dei model
 * tenant-scoped, e che sia un NO-OP quando il contesto è assente o il model
 * non è tenant-scoped.
 *
 * Si testa direttamente `applyTenantScope` con un `query` mockato (cattura gli
 * `args` finali con cui Prisma verrebbe invocato), senza bisogno di un vero
 * PrismaClient né di un database.
 * ============================================================================
 */

import {
  applyTenantScope,
  TENANT_SCOPED_MODELS,
  rlsExtension,
} from './prisma-rls.extension'
import { TenantContext } from '../../core/context/tenant-context'

const TENANT_B = 'tenant-B-societa-beta'

/**
 * Esegue `applyTenantScope` su una singola operazione e ritorna gli `args`
 * effettivamente passati a `query` (cioè ciò che arriverebbe a Prisma).
 */
function runOperation(params: {
  model?: string
  operation: string
  args: unknown
}): any {
  const query = jest.fn((a: unknown) => a)
  applyTenantScope({ ...params, query })
  expect(query).toHaveBeenCalledTimes(1)
  return query.mock.calls[0][0]
}

describe('RLS Prisma Extension (applyTenantScope)', () => {
  afterEach(() => {
    delete process.env.CURRENT_TENANT_ID
    jest.clearAllMocks()
  })

  describe('con TenantContext attivo (tenant B)', () => {
    it('LETTURA findMany su model tenant-scoped → inietta where.tenantId === B', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        const finalArgs = runOperation({
          model: 'Produttore',
          operation: 'findMany',
          args: { where: { partitaIVA: '12345678901' } },
        })

        expect(finalArgs.where.tenantId).toBe(TENANT_B)
        // Mantiene gli altri filtri già presenti.
        expect(finalArgs.where.partitaIVA).toBe('12345678901')
      })
    })

    it('findFirst senza where → crea where con solo tenantId', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        const finalArgs = runOperation({
          model: 'FIR',
          operation: 'findFirst',
          args: {},
        })
        expect(finalArgs.where.tenantId).toBe(TENANT_B)
      })
    })

    it('count / deleteMany / updateMany → filtrano per tenantId', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        for (const operation of ['count', 'deleteMany', 'updateMany']) {
          const finalArgs = runOperation({
            model: 'Notification',
            operation,
            args: { where: { isRead: false } },
          })
          expect(finalArgs.where.tenantId).toBe(TENANT_B)
        }
      })
    })

    it('SCRITTURA create su model tenant-scoped → inietta data.tenantId === B', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        const finalArgs = runOperation({
          model: 'Produttore',
          operation: 'create',
          args: { data: { ragioneSociale: 'Cliente Srl' } },
        })
        expect(finalArgs.data.tenantId).toBe(TENANT_B)
        expect(finalArgs.data.ragioneSociale).toBe('Cliente Srl')
      })
    })

    it('createMany → inietta tenantId in ogni record', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        const finalArgs = runOperation({
          model: 'Produttore',
          operation: 'createMany',
          args: { data: [{ ragioneSociale: 'A' }, { ragioneSociale: 'B' }] },
        })
        expect(finalArgs.data).toHaveLength(2)
        expect(finalArgs.data[0].tenantId).toBe(TENANT_B)
        expect(finalArgs.data[1].tenantId).toBe(TENANT_B)
      })
    })

    it('upsert → inietta tenantId sia in where sia in create', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        const finalArgs = runOperation({
          model: 'Produttore',
          operation: 'upsert',
          args: {
            where: { id: 'abc' },
            create: { ragioneSociale: 'Nuovo' },
            update: { ragioneSociale: 'Aggiornato' },
          },
        })
        expect(finalArgs.where.tenantId).toBe(TENANT_B)
        expect(finalArgs.create.tenantId).toBe(TENANT_B)
        // update NON viene toccato (filtrato già dal where).
        expect(finalArgs.update.tenantId).toBeUndefined()
      })
    })

    it('NON sovrascrive un tenantId già presente nel where (rispetta la query esplicita)', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        const finalArgs = runOperation({
          model: 'Produttore',
          operation: 'findMany',
          args: { where: { tenantId: 'tenant-esplicito' } },
        })
        expect(finalArgs.where.tenantId).toBe('tenant-esplicito')
      })
    })

    it('findUnique NON viene alterata (la PK è globale, eviterebbe rotture unique)', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        const finalArgs = runOperation({
          model: 'Produttore',
          operation: 'findUnique',
          args: { where: { id: 'abc' } },
        })
        expect(finalArgs.where.tenantId).toBeUndefined()
        expect(finalArgs.where.id).toBe('abc')
      })
    })

    it('model NON tenant-scoped (Tenant, CERCode, AbacPolicy) → NESSUNA iniezione', () => {
      TenantContext.run({ tenantId: TENANT_B }, () => {
        for (const model of ['Tenant', 'CERCode', 'AbacPolicy', 'Permission']) {
          const finalArgs = runOperation({
            model,
            operation: 'findMany',
            args: { where: { foo: 'bar' } },
          })
          expect(finalArgs.where.tenantId).toBeUndefined()
        }
      })
    })
  })

  describe('SENZA TenantContext (seed / migrazioni / job / test di setup)', () => {
    it('findMany su model tenant-scoped → query INVARIATA (no-op)', () => {
      // Nessun TenantContext.run, nessuna env var: getTenantId() === null.
      const originalArgs = { where: { partitaIVA: '123' } }
      const finalArgs = runOperation({
        model: 'Produttore',
        operation: 'findMany',
        args: originalArgs,
      })
      // Stesso riferimento: non è stato creato un nuovo oggetto args.
      expect(finalArgs).toBe(originalArgs)
      expect(finalArgs.where.tenantId).toBeUndefined()
    })

    it('create su model tenant-scoped → data INVARIATO (no-op)', () => {
      const originalArgs = { data: { ragioneSociale: 'X' } }
      const finalArgs = runOperation({
        model: 'Produttore',
        operation: 'create',
        args: originalArgs,
      })
      expect(finalArgs).toBe(originalArgs)
      expect(finalArgs.data.tenantId).toBeUndefined()
    })
  })

  describe('whitelist e wiring', () => {
    it('TENANT_SCOPED_MODELS contiene i model con tenantId e NON quelli globali', () => {
      expect(TENANT_SCOPED_MODELS.has('Produttore')).toBe(true)
      expect(TENANT_SCOPED_MODELS.has('FIR')).toBe(true)
      expect(TENANT_SCOPED_MODELS.has('User')).toBe(true)
      expect(TENANT_SCOPED_MODELS.has('Tenant')).toBe(false)
      expect(TENANT_SCOPED_MODELS.has('CERCode')).toBe(false)
      expect(TENANT_SCOPED_MODELS.has('AbacPolicy')).toBe(false)
    })

    it('rlsExtension è applicabile a un client tramite $extends', () => {
      // defineExtension ritorna una funzione t => t.$extends(config).
      const fakeExtended = Symbol('extended')
      const fakeClient = { $extends: jest.fn().mockReturnValue(fakeExtended) }
      const result = (rlsExtension as unknown as (c: unknown) => unknown)(fakeClient)
      expect(fakeClient.$extends).toHaveBeenCalledTimes(1)
      expect(result).toBe(fakeExtended)
    })
  })
})
