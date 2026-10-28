import { CronExpression } from '@nestjs/schedule'

import {
  JobSchedulatiProbe,
  JOB_SCHEDULATI,
  CronRegistrato,
  LettoreEvidenze,
  ChiaveEvidenza,
} from './job-schedulati.probe'

/** Registro «tutto cablato»: un cron per ogni job atteso, con la sua cadenza. */
function registroCompleto(prossima: Date | null = null): CronRegistrato[] {
  return JOB_SCHEDULATI.map(j => ({ espressione: j.espressioneCron, prossima, ultima: null }))
}

function evidenzeFinte(valori: Partial<Record<ChiaveEvidenza, Date | null>>): LettoreEvidenze {
  return { ultimoEffetto: async (chiave: ChiaveEvidenza) => valori[chiave] ?? null }
}

describe('JobSchedulatiProbe', () => {
  const probe = new JobSchedulatiProbe()

  it('restituisce una voce per ogni job atteso', async () => {
    const voci = await probe.raccogli(registroCompleto(), evidenzeFinte({}))

    expect(voci.map(v => v.key)).toEqual(JOB_SCHEDULATI.map(j => j.key))
  })

  it('dichiara error il job che nessuno ha registrato nello scheduler', async () => {
    const voci = await probe.raccogli([], evidenzeFinte({}))
    const voce = voci.find(v => v.key === 'job.rentri-riconciliazione')

    expect(voce?.state).toBe('error')
    expect(voce?.detail).toContain('Non registrato nello scheduler')
  })

  it('non offre il pulsante «esegui ora» su un job che non e nemmeno cablato', async () => {
    const voci = await probe.raccogli([], evidenzeFinte({}))
    const voce = voci.find(v => v.key === 'job.rentri-riconciliazione')

    expect(voce?.actionable).toBe(false)
    expect(voce?.actionKey).toBeNull()
  })

  it('conta i job che condividono la stessa cadenza invece di accontentarsi di uno', async () => {
    // Due job attesi con il refresh mensile (seeder + codifiche RENTRI): un
    // solo cron mensile registrato non prova che entrambi ci siano.
    const registro: CronRegistrato[] = [
      {
        espressione: CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT,
        prossima: null,
        ultima: null,
      },
    ]

    const voci = await probe.raccogli(registro, evidenzeFinte({}))
    const mensili = voci.filter(
      v => v.key === 'job.codifiche-rentri' || v.key === 'job.dati-riferimento'
    )

    expect(mensili.map(v => v.state)).toEqual(['error', 'error'])
    expect(mensili[0].detail).toContain('attesi 2 job')
    expect(mensili[0].detail).toContain('trovati 1')
  })

  it('dichiara off — non ok — il job registrato ma non implementato', async () => {
    const voci = await probe.raccogli(registroCompleto(), evidenzeFinte({}))
    const voce = voci.find(v => v.key === 'job.scadenzario-vidimazioni')

    expect(voce?.state).toBe('off')
    expect(voce?.detail).toContain('non implementato')
    expect(voce?.actionable).toBe(false)
  })

  it('lo scadenzario MUD non cita più il 30 aprile fisso: la scadenza viene dal tracciato', async () => {
    const voci = await probe.raccogli(registroCompleto(), evidenzeFinte({}))
    const voce = voci.find(v => v.key === 'job.scadenzario-mud')

    expect(voce?.detail).not.toContain('scadenza del 30 aprile')
    expect(voce?.detail).toContain('scadenza del tracciato')
  })

  it('dichiara unknown il job senza effetto osservabile, spiegando il perche', async () => {
    const voci = await probe.raccogli(registroCompleto(), evidenzeFinte({}))
    const voce = voci.find(v => v.key === 'job.rentri-certificato-scadenza')

    expect(voce?.state).toBe('unknown')
    expect(voce?.detail).toContain('non lascia traccia in banca dati')
  })

  it('offre il pulsante «esegui ora» sullo scadenzario autorizzazioni/controparti (Task 5 UAT/E2E)', async () => {
    // DeadlineCheckerService.checkAuthorizationExpirations e' implementato
    // da tempo (autorizzazioni impianto, iscrizione Albo trasportatori,
    // autorizzazione destinatari): il descrittore non puo' piu' dichiararlo
    // "non implementato" ne' negare il pulsante, altrimenti la nuova azione
    // 'scadenzario-autorizzazioni' di JobActionsService resterebbe invisibile
    // in questa pagina nonostante funzioni davvero.
    const voci = await probe.raccogli(registroCompleto(), evidenzeFinte({}))
    const voce = voci.find(v => v.key === 'job.scadenzario-autorizzazioni')

    expect(voce?.state).not.toBe('off')
    expect(voce?.actionable).toBe(true)
    expect(voce?.actionKey).toBe('scadenzario-autorizzazioni')
  })

  it('valuta il ritardo del job con evidenza in banca dati', async () => {
    const evidenze = evidenzeFinte({
      'riconciliazione-rentri': new Date(Date.now() - 2 * 3_600_000),
    })

    const voci = await probe.raccogli(registroCompleto(), evidenze)
    const voce = voci.find(v => v.key === 'job.rentri-riconciliazione')

    expect(voce?.state).toBe('ok')
    expect(voce?.detail).toContain('ultima riconciliazione registrata 2 h fa')
    expect(voce?.actionable).toBe(true)
    expect(voce?.actionKey).toBe('rentri-riconciliazione')
  })

  it('dichiara error il job registrato ma fermo da troppo tempo', async () => {
    const evidenze = evidenzeFinte({
      'riconciliazione-rentri': new Date(Date.now() - 5 * 24 * 3_600_000),
    })

    const voci = await probe.raccogli(registroCompleto(), evidenze)
    const voce = voci.find(v => v.key === 'job.rentri-riconciliazione')

    expect(voce?.state).toBe('error')
  })

  it('mostra quando scattera la prossima esecuzione, se lo scheduler la conosce', async () => {
    const registro = registroCompleto(new Date(Date.now() + 45 * 60_000))

    const voci = await probe.raccogli(registro, evidenzeFinte({}))
    const voce = voci.find(v => v.key === 'job.rentri-certificato-scadenza')

    expect(voce?.detail).toContain('Prossima esecuzione fra 45 min')
  })
})
