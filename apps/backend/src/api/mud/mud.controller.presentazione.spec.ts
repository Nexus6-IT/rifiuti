import 'reflect-metadata'
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { MudController } from './mud.controller'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { AnnullaPresentazioneDto } from './dtos/annulla-presentazione.dto'
import { SegnaPresentatoDto } from './dtos/segna-presentato.dto'

describe('MudController presentazione del MUD', () => {
  // (confutazione dopo l'esecuzione, A-C-06): il ruolo è quello effettivo nell'azienda selezionata
  it.each(['VIEWER', 'OPERATOR'])(
    'solo chi è ADMIN o SUPER_ADMIN nell azienda selezionata può segnare o annullare la presentazione (%s no)',
    async ruolo => {
      const membership = { ruoloEffettivo: jest.fn().mockResolvedValue(ruolo) }
      const presentazione = { segnaPresentato: jest.fn(), annullaPresentazione: jest.fn() }
      const controller = new MudController(
        {} as any,
        {} as any,
        membership as any,
        {} as any,
        presentazione as any,
        {} as any
      )
      const req = { user: { id: 'u1', tenantId: 't1', role: 'ADMIN' } } as any // ADMIN globale, VIEWER qui

      const errore = await controller.segnaPresentato(req, 2025, {}).catch(e => e)
      expect(errore).toBeInstanceOf(ForbiddenException)
      expect(errore.getResponse()).toEqual({
        message: "Solo un amministratore dell'azienda può segnare o annullare la presentazione.",
        error: 'MUD_PRESENTAZIONE_RISERVATA_AMMINISTRATORI',
      })
      await expect(
        controller.annullaPresentazione(req, 2025, { motivo: 'SEGNATURA_ERRATA' })
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(membership.ruoloEffettivo).toHaveBeenCalledWith(req.user, 't1')
      expect(presentazione.segnaPresentato).not.toHaveBeenCalled()
      expect(presentazione.annullaPresentazione).not.toHaveBeenCalled()
      expect(
        Reflect.getMetadata(ROLES_KEY, MudController.prototype.segnaPresentato)
      ).toBeUndefined()
      expect(
        Reflect.getMetadata(ROLES_KEY, MudController.prototype.annullaPresentazione)
      ).toBeUndefined()
    }
  )

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
      presentazione as any,
      {} as any
    )
    await controller.segnaPresentato({ user: { id: 'u1', tenantId: 't1' } } as any, 2025, {
      dataPresentazione: '2026-06-30',
    })
    expect(presentazione.segnaPresentato).toHaveBeenCalledWith(
      't1',
      2025,
      'u1',
      new Date('2026-06-30'),
      undefined
    )
    await controller.annullaPresentazione({ user: { id: 'u2', tenantId: 't1' } } as any, 2025, {
      motivo: 'DICHIARAZIONE_DA_SOSTITUIRE',
    })
    expect(presentazione.annullaPresentazione).toHaveBeenCalledWith(
      't1',
      2025,
      'u2',
      'DICHIARAZIONE_DA_SOSTITUIRE'
    )
  })

  it("usa l'azienda selezionata e passa l'esportazione indicata", async () => {
    const membership = { ruoloEffettivo: jest.fn().mockResolvedValue('SUPER_ADMIN') }
    const presentazione = { segnaPresentato: jest.fn().mockResolvedValue({}) }
    const controller = new MudController(
      {} as any,
      {} as any,
      membership as any,
      {} as any,
      presentazione as any,
      {} as any
    )
    const req = { tenantId: 'cliente', user: { id: 'u1', tenantId: 'studio' } } as any

    await controller.segnaPresentato(req, 2025, { esportazioneGenerataIl: '2026-04-02T08:00:00Z' })

    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'cliente')
    expect(presentazione.segnaPresentato).toHaveBeenCalledWith(
      'cliente',
      2025,
      'u1',
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
      presentazione as any,
      {} as any
    )

    const r = await controller.statoPresentazione(
      { user: { id: 'u9', tenantId: 't1' } } as any,
      2025
    )

    expect(r).toBe(stato)
    expect(presentazione.stato).toHaveBeenCalledWith('t1', 2025)
  })

  it.each([
    [{ motivo: 'SEGNATURA_ERRATA' }, true],
    [{ motivo: 'DICHIARAZIONE_DA_SOSTITUIRE' }, true],
    [{}, false],
    [{ motivo: 'ALTRO' }, false],
  ])('l annullamento richiede un motivo valido: %j valido %s', async (corpo, valido) => {
    const errori = await validate(plainToInstance(AnnullaPresentazioneDto, corpo))
    expect(errori.length === 0).toBe(valido)
  })

  // La segnatura prende gli avvisi confermati dall'esportazione a cui si lega (A-W-03): il client
  // non li manda più, e con la validazione globale un campo in più è un 400
  it('il corpo della segnatura non accetta più avvisiConfermati', async () => {
    // stesse opzioni della pipe globale di main.ts
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
    const meta = { type: 'body' as const, metatype: SegnaPresentatoDto }

    await expect(
      pipe.transform({ avvisiConfermati: ['SCARICO_SENZA_FIR'] }, meta)
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      pipe.transform(
        { dataPresentazione: '2026-06-30', esportazioneGenerataIl: '2026-04-02T08:00:00Z' },
        meta
      )
    ).resolves.toBeInstanceOf(SegnaPresentatoDto)
  })
})
