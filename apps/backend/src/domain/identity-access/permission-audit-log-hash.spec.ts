import { PermissionAuditLog } from './permission-audit-log.entity'

const base = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  actionAttempted: 'audit:read:all',
  resourceType: 'audit',
  decision: 'ALLOW',
  spidFiscalCode: 'RSSMRA80A01H501U',
  sessionId: 'sessione-1',
  previousHash: '0',
  timestamp: new Date('2026-10-25T10:00:00.123Z'),
}

/** Simula la rilettura dal database: solo le colonne persistite (reason/ip/userAgent no). */
function rileggi(log: PermissionAuditLog, resourceId: string | null = null) {
  const p = log.toPersistence()
  return PermissionAuditLog.fromPersistence({
    id: p.id,
    tenantId: p.tenantId,
    userId: p.userId,
    spidFiscalCode: p.spidFiscalCode,
    actionAttempted: p.actionAttempted,
    resourceType: p.resourceType,
    resourceId,
    decision: p.decision,
    timestamp: p.timestamp,
    sessionId: p.sessionId,
    previousHash: p.previousHash,
    hash: p.hash,
  })
}

describe('PermissionAuditLog: hash sui soli campi persistiti', () => {
  it('una riga riletta dal database ha l hash valido anche con reason, ip e userAgent', () => {
    const log = PermissionAuditLog.create({
      ...base,
      reason: 'motivo non salvato',
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
    })
    expect(log.isHashValid()).toBe(true)
    expect(rileggi(log).isHashValid()).toBe(true)
  })

  it('null e undefined sono equivalenti (resourceId)', () => {
    const log = PermissionAuditLog.create({ ...base, resourceId: undefined })
    expect(rileggi(log, null).isHashValid()).toBe(true)
  })

  it('una modifica a un campo persistito invalida l hash', () => {
    const log = PermissionAuditLog.create(base)
    const p = log.toPersistence()
    const manomesso = PermissionAuditLog.fromPersistence({ ...p, decision: 'DENY' })
    expect(manomesso.isHashValid()).toBe(false)
  })
})
