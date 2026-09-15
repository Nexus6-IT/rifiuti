import { BadRequestException, ConflictException } from '@nestjs/common'

import { JobActionsService, AZIONE_AUDIT, UtenteAzione } from './job-actions.service'

const UTENTE: UtenteAzione = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'super@ignicraft.com',
  tenantId: '22222222-2222-2222-2222-222222222222',
}

/** Promessa che il test decide quando risolvere: serve a osservare il lucchetto. */
function promessaControllata() {
  let risolvi!: () => void
  let rigetta!: (e: Error) => void
  const promessa = new Promise<void>((res, rej) => {
    risolvi = res
    rigetta = rej
  })
  return { promessa, risolvi, rigetta }
}

describe('JobActionsService', () => {
  let prisma: { activityLog: { create: jest.Mock; findMany: jest.Mock } }
  let riconciliazione: { eseguiRiconciliazione: jest.Mock }
  let certificati: { eseguiControlloScadenza: jest.Mock }
  let codifiche: { allineaTutto: jest.Mock }
  let datiRiferimento: { reseedAll: jest.Mock }
  let scadenzario: { checkAuthorizationExpirations: jest.Mock }
  let service: JobActionsService

  beforeEach(() => {
    prisma = {
      activityLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn() },
    }
    riconciliazione = { eseguiRiconciliazione: jest.fn().mockResolvedValue(undefined) }
    certificati = { eseguiControlloScadenza: jest.fn().mockResolvedValue(undefined) }
    codifiche = { allineaTutto: jest.fn().mockResolvedValue(undefined) }
    datiRiferimento = { reseedAll: jest.fn().mockResolvedValue(undefined) }
    scadenzario = { checkAuthorizationExpirations: jest.fn().mockResolvedValue(undefined) }

    service = new JobActionsService(
      prisma as never,
      riconciliazione as never,
      certificati as never,
      codifiche as never,
      datiRiferimento as never,
      scadenzario as never
    )
  })

  it('rifiuta una chiave che non corrisponde a nessun job rilanciabile', async () => {
    await expect(service.avvia('inventata', UTENTE)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('elenca fra le chiavi solo i job realmente rilanciabili', () => {
    expect(service.chiaviDisponibili()).toEqual([
      'rentri-riconciliazione',
      'rentri-certificato-scadenza',
      'codifiche-rentri',
      'dati-riferimento',
      'scadenzario-autorizzazioni',
    ])
  })

  it('rilancia a mano il controllo scadenze autorizzazioni/controparti (DeadlineCheckerService)', async () => {
    const { promessa, risolvi } = promessaControllata()
    scadenzario.checkAuthorizationExpirations.mockReturnValue(promessa)

    const esito = await service.avvia('scadenzario-autorizzazioni', UTENTE)

    expect(esito).toMatchObject({ jobKey: 'scadenzario-autorizzazioni', stato: 'avviato' })
    expect(scadenzario.checkAuthorizationExpirations).toHaveBeenCalledTimes(1)

    risolvi()
    await promessa
  })

  it('risponde AVVIATO senza attendere la fine del giro', async () => {
    const { promessa, risolvi } = promessaControllata()
    riconciliazione.eseguiRiconciliazione.mockReturnValue(promessa)

    const esito = await service.avvia('rentri-riconciliazione', UTENTE)

    expect(esito).toMatchObject({ jobKey: 'rentri-riconciliazione', stato: 'avviato' })
    expect(riconciliazione.eseguiRiconciliazione).toHaveBeenCalledTimes(1)

    risolvi()
    await promessa
  })

  it('rifiuta con 409 un secondo avvio mentre il primo e ancora in corso', async () => {
    const { promessa, risolvi } = promessaControllata()
    riconciliazione.eseguiRiconciliazione.mockReturnValue(promessa)

    await service.avvia('rentri-riconciliazione', UTENTE)
    await expect(service.avvia('rentri-riconciliazione', UTENTE)).rejects.toBeInstanceOf(
      ConflictException
    )

    risolvi()
    await promessa
    await new Promise(process.nextTick)

    // Finito il giro, il lucchetto si libera: un nuovo avvio deve passare.
    await expect(service.avvia('rentri-riconciliazione', UTENTE)).resolves.toMatchObject({
      stato: 'avviato',
    })
  })

  it('il lucchetto e per chiave: un altro job resta avviabile', async () => {
    const { promessa, risolvi } = promessaControllata()
    riconciliazione.eseguiRiconciliazione.mockReturnValue(promessa)

    await service.avvia('rentri-riconciliazione', UTENTE)
    await expect(service.avvia('codifiche-rentri', UTENTE)).resolves.toMatchObject({
      stato: 'avviato',
    })

    risolvi()
    await promessa
  })

  it('registra nell audit avvio ed esito, con chi ha premuto il pulsante', async () => {
    await service.avvia('codifiche-rentri', UTENTE)
    await new Promise(process.nextTick)

    const azioni = prisma.activityLog.create.mock.calls.map(c => c[0].data)
    expect(azioni).toHaveLength(2)
    expect(azioni[0]).toMatchObject({
      action: AZIONE_AUDIT,
      userId: UTENTE.id,
      tenantId: UTENTE.tenantId,
      metadata: { jobKey: 'codifiche-rentri', esito: 'avviato', utente: UTENTE.email },
    })
    expect(azioni[1].metadata).toMatchObject({ esito: 'completato' })
  })

  it('registra il fallimento del giro invece di lasciarlo cadere in silenzio', async () => {
    codifiche.allineaTutto.mockRejectedValue(new Error('RENTRI irraggiungibile'))

    await service.avvia('codifiche-rentri', UTENTE)
    await new Promise(process.nextTick)

    const ultima = prisma.activityLog.create.mock.calls.at(-1)?.[0].data
    expect(ultima.metadata).toMatchObject({ esito: 'fallito' })
    expect(ultima.description).toContain('RENTRI irraggiungibile')
  })

  it('non fa fallire l avvio se l audit non riesce a scrivere', async () => {
    prisma.activityLog.create.mockRejectedValue(new Error('DB in sola lettura'))

    await expect(service.avvia('dati-riferimento', UTENTE)).resolves.toMatchObject({
      stato: 'avviato',
    })
    expect(datiRiferimento.reseedAll).toHaveBeenCalled()
  })

  it('restituisce lo storico piu recente, con esito e autore', async () => {
    prisma.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        description: 'Allineamento codifiche RENTRI: completato',
        metadata: { jobKey: 'codifiche-rentri', esito: 'completato' },
        user: { email: 'super@ignicraft.com' },
      },
    ])

    const storico = await service.storico(10)

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: AZIONE_AUDIT }, take: 10 })
    )
    expect(storico[0]).toEqual({
      jobKey: 'codifiche-rentri',
      esito: 'completato',
      descrizione: 'Allineamento codifiche RENTRI: completato',
      utente: 'super@ignicraft.com',
      al: '2026-09-01T10:00:00.000Z',
    })
  })

  it('limita la dimensione dello storico richiesto', async () => {
    prisma.activityLog.findMany.mockResolvedValue([])

    await service.storico(10_000)

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))
  })
})
