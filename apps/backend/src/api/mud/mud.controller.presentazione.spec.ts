import 'reflect-metadata'
import { ForbiddenException } from '@nestjs/common'
import { MudController } from './mud.controller'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'

describe('MudController presentazione del MUD', () => {
  // (confutazione dopo l'esecuzione, A-C-06): il ruolo è quello effettivo nell'azienda selezionata
  it('solo chi è ADMIN o SUPER_ADMIN nell azienda selezionata può segnare o annullare la presentazione', async () => {
    const membership = { ruoloEffettivo: jest.fn().mockResolvedValue('VIEWER') }
    const presentazione = { segnaPresentato: jest.fn(), annullaPresentazione: jest.fn() }
    const controller = new MudController(
      {} as any,
      {} as any,
      membership as any,
      {} as any,
      presentazione as any
    )
    const req = { user: { id: 'u1', tenantId: 't1', role: 'ADMIN' } } as any // ADMIN globale, VIEWER qui

    const errore = await controller.segnaPresentato(req, 2025, {}).catch(e => e)
    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse()).toEqual({
      message: "Solo un amministratore dell'azienda può segnare o annullare la presentazione.",
      error: 'MUD_PRESENTAZIONE_RISERVATA_AMMINISTRATORI',
    })
    await expect(controller.annullaPresentazione(req, 2025)).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(req.user, 't1')
    expect(presentazione.segnaPresentato).not.toHaveBeenCalled()
    expect(presentazione.annullaPresentazione).not.toHaveBeenCalled()
    expect(Reflect.getMetadata(ROLES_KEY, MudController.prototype.segnaPresentato)).toBeUndefined()
    expect(
      Reflect.getMetadata(ROLES_KEY, MudController.prototype.annullaPresentazione)
    ).toBeUndefined()
  })

  it('passa tenant, utente e data al servizio', async () => {
    const membership = { ruoloEffettivo: jest.fn().mockResolvedValue('ADMIN') }
    const presentazione = {
      segnaPresentato: jest.fn().mockResolvedValue({}),
      annullaPresentazione: jest.fn().mockResolvedValue({}),
    }
    const controller = new MudController(
      {} as any,
      {} as any,
      membership as any,
      {} as any,
      presentazione as any
    )
    await controller.segnaPresentato({ user: { id: 'u1', tenantId: 't1' } } as any, 2025, {
      dataPresentazione: '2026-06-30',
      avvisiConfermati: ['SCARICO_SENZA_FIR'],
    })
    expect(presentazione.segnaPresentato).toHaveBeenCalledWith(
      't1',
      2025,
      'u1',
      new Date('2026-06-30'),
      ['SCARICO_SENZA_FIR'],
      undefined
    )
    await controller.annullaPresentazione({ user: { id: 'u2', tenantId: 't1' } } as any, 2025)
    expect(presentazione.annullaPresentazione).toHaveBeenCalledWith('t1', 2025, 'u2')
  })

  it("usa l'azienda selezionata e passa l'esportazione indicata", async () => {
    const membership = { ruoloEffettivo: jest.fn().mockResolvedValue('SUPER_ADMIN') }
    const presentazione = { segnaPresentato: jest.fn().mockResolvedValue({}) }
    const controller = new MudController(
      {} as any,
      {} as any,
      membership as any,
      {} as any,
      presentazione as any
    )
    const req = { tenantId: 'cliente', user: { id: 'u1', tenantId: 'studio' } } as any

    await controller.segnaPresentato(req, 2025, { esportazioneGenerataIl: '2026-04-02T08:00:00Z' })

    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'cliente')
    expect(presentazione.segnaPresentato).toHaveBeenCalledWith(
      'cliente',
      2025,
      'u1',
      undefined,
      undefined,
      '2026-04-02T08:00:00Z'
    )
  })

  it('lo stato lo legge qualunque ruolo', async () => {
    const membership = { ruoloEffettivo: jest.fn().mockResolvedValue('VIEWER') }
    const stato = { year: 2025, status: 'DRAFT' }
    const presentazione = { stato: jest.fn().mockResolvedValue(stato) }
    const controller = new MudController(
      {} as any,
      {} as any,
      membership as any,
      {} as any,
      presentazione as any
    )

    const r = await controller.statoPresentazione(
      { user: { id: 'u9', tenantId: 't1' } } as any,
      2025
    )

    expect(r).toBe(stato)
    expect(presentazione.stato).toHaveBeenCalledWith('t1', 2025)
  })
})
