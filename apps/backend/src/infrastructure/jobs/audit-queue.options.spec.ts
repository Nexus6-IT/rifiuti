import { readFileSync } from 'fs'
import { join } from 'path'
import { AUDIT_QUEUE_JOB_OPTIONS } from './audit-queue.options'

describe('coda audit-logging', () => {
  it('coda audit: removeOnFail impostato', () => {
    // Come la coda RENTRI: i job falliti restano 7 giorni per l'analisi, poi spariscono
    // (senza, ogni evento non registrabile resterebbe in Redis per sempre).
    expect(AUDIT_QUEUE_JOB_OPTIONS.removeOnFail).toEqual({ age: 604800 })
  })

  it.each(['../../api/permissions/permissions.module.ts', './queues.config.ts'])(
    'la registrazione in %s usa le opzioni comuni',
    file => {
      const testo = readFileSync(join(__dirname, file), 'utf8')
      expect(testo).toContain('AUDIT_QUEUE_JOB_OPTIONS')
    }
  )
})
