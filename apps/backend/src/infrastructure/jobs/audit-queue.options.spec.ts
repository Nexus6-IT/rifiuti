import { AUDIT_QUEUE_JOB_OPTIONS } from './audit-queue.options'

describe('coda audit-logging', () => {
  it('coda audit: removeOnFail impostato', () => {
    // Come la coda RENTRI: i job falliti restano 7 giorni per l'analisi, poi spariscono
    // (senza, ogni evento non registrabile resterebbe in Redis per sempre).
    expect(AUDIT_QUEUE_JOB_OPTIONS.removeOnFail).toEqual({ age: 604800 })
  })

  it('la registrazione reale della coda in PermissionsModule passa le opzioni comuni', () => {
    // Si intercetta registerQueue prima di caricare il modulo: si verifica l'oggetto
    // davvero passato a Nest, non il testo del sorgente.
    let audit: Record<string, unknown> | undefined
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BullModule } = require('@nestjs/bullmq')
      const spia = jest.spyOn(BullModule, 'registerQueue')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../api/permissions/permissions.module')
      audit = (
        spia.mock.calls.flatMap((args: unknown[]) => args) as Array<Record<string, unknown>>
      ).find(opzioni => opzioni.name === 'audit-logging')
    })
    expect(audit).toBeDefined()
    expect(audit?.defaultJobOptions).toEqual(AUDIT_QUEUE_JOB_OPTIONS)
  })
})
