import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Readable } from 'stream'
import type { Request } from 'express'
import { RiconciliazioneService } from '../../application/migrazione/riconciliazione/riconciliazione.service'
import {
  DifferenzaInesistenteError,
  RapportoChiusoError,
  RapportoNonChiudibileError,
  RapportoNonTrovatoError,
  VerbaleNonValidoError,
  VersioneCambiataError,
} from '../../application/migrazione/riconciliazione/errori'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import {
  comeEccezioneHttp,
  leggiCorpoGrezzo,
  RiconciliazioneImportController,
} from './riconciliazione-import.controller'

const T = '33333333-3333-4333-8333-333333333333'
const R = '44444444-4444-4444-8444-444444444444'
const UTENTE: CurrentUserPayload = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'super@ignicraft.com',
  tenantId: '22222222-2222-4222-8222-222222222222',
  role: 'SUPER_ADMIN',
  permissions: [],
}

const richiesta = (corpo: Buffer[], tipo = 'application/pdf') =>
  Object.assign(Readable.from(corpo), { headers: { 'content-type': tipo } }) as unknown as Request

describe('RiconciliazioneImportController', () => {
  let controller: RiconciliazioneImportController
  let servizio: Record<string, jest.Mock>

  beforeEach(async () => {
    servizio = {
      elenca: jest.fn().mockResolvedValue([]),
      leggi: jest.fn().mockResolvedValue({ id: 'x' }),
      registraEsitoCampione: jest.fn().mockResolvedValue(undefined),
      accettaDifferenza: jest.fn().mockResolvedValue({ versione: 2 }),
      chiudi: jest.fn().mockResolvedValue({ stato: 'CHIUSO' }),
      caricaVerbale: jest.fn().mockResolvedValue({ id: 'x' }),
    }
    const ref = await Test.createTestingModule({
      controllers: [RiconciliazioneImportController],
      providers: [{ provide: RiconciliazioneService, useValue: servizio }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()
    controller = ref.get(RiconciliazioneImportController)
  })

  it('solo SUPER_ADMIN: il decoratore sta sulla classe', () => {
    expect(Reflect.getMetadata('roles', RiconciliazioneImportController)).toEqual(['SUPER_ADMIN'])
  })

  it('le operazioni passano azienda, versione e utente al servizio', async () => {
    await controller.leggi(R, { tenantId: T })
    expect(servizio.leggi).toHaveBeenCalledWith(T, R)
    await controller.accetta(
      R,
      { tenantId: T, versione: 3, chiave: '3:cer|x', motivo: 'perche si' },
      UTENTE
    )
    expect(servizio.accettaDifferenza).toHaveBeenCalledWith({
      ruolo: 'SUPER_ADMIN',
      tenantId: T,
      radiceId: R,
      versione: 3,
      chiave: '3:cer|x',
      motivo: 'perche si',
      utenteId: UTENTE.id,
    })
    await controller.chiudi(R, { tenantId: T, versione: 3 }, UTENTE)
    expect(servizio.chiudi).toHaveBeenCalledWith({
      tenantId: T,
      radiceId: R,
      versione: 3,
      utenteId: UTENTE.id,
    })
    await controller.esitoCampione(R, R, { tenantId: T, esito: 'CORRISPONDE' }, UTENTE)
    expect(servizio.registraEsitoCampione).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: T,
        campioneId: R,
        esito: 'CORRISPONDE',
        utenteId: UTENTE.id,
      })
    )
  })

  it('versione cambiata e rapporto chiuso: 409; non chiudibile: 422 con la valutazione', async () => {
    servizio.chiudi.mockRejectedValueOnce(new VersioneCambiataError(1, 2))
    await expect(controller.chiudi(R, { tenantId: T, versione: 1 }, UTENTE)).rejects.toBeInstanceOf(
      ConflictException
    )
    servizio.chiudi.mockRejectedValueOnce(new RapportoChiusoError())
    await expect(controller.chiudi(R, { tenantId: T, versione: 1 }, UTENTE)).rejects.toBeInstanceOf(
      ConflictException
    )
    const valutazione = {
      chiudibile: false,
      differenzeAperte: ['3:x'],
      campioniSenzaEsito: 0,
      campioniNonCorrispondono: 0,
    }
    servizio.chiudi.mockRejectedValueOnce(new RapportoNonChiudibileError(valutazione))
    const e = await controller.chiudi(R, { tenantId: T, versione: 1 }, UTENTE).catch(x => x)
    expect(e).toBeInstanceOf(UnprocessableEntityException)
    expect((e as UnprocessableEntityException).getResponse()).toMatchObject({ valutazione })
  })

  it('mappa gli errori del dominio, lascia passare gli altri', () => {
    expect(comeEccezioneHttp(new RapportoNonTrovatoError())).toBeInstanceOf(NotFoundException)
    expect(comeEccezioneHttp(new DifferenzaInesistenteError('x'))).toBeInstanceOf(
      BadRequestException
    )
    expect(comeEccezioneHttp(new VerbaleNonValidoError('x'))).toBeInstanceOf(BadRequestException)
    const altro = new TypeError('boom')
    expect(comeEccezioneHttp(altro)).toBe(altro)
  })

  it('verbale: solo application/pdf, versione valida, e passa il contenuto al servizio', async () => {
    await controller.verbale(
      R,
      { tenantId: T },
      '2',
      'v.pdf',
      richiesta([Buffer.from('%PDF-1')]),
      UTENTE
    )
    expect(servizio.caricaVerbale).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: T, radiceId: R, versione: 2, nomeFile: 'v.pdf' })
    )
    await expect(
      controller.verbale(
        R,
        { tenantId: T },
        '2',
        'v.pdf',
        richiesta([Buffer.from('x')], 'text/plain'),
        UTENTE
      )
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      controller.verbale(R, { tenantId: T }, 'x', 'v.pdf', richiesta([Buffer.from('x')]), UTENTE)
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('il corpo grezzo ha un tetto: oltre, 413 senza leggere il resto', async () => {
    await expect(
      leggiCorpoGrezzo(richiesta([Buffer.alloc(6), Buffer.alloc(6)]), 10)
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect((await leggiCorpoGrezzo(richiesta([Buffer.alloc(4), Buffer.alloc(6)]), 10)).length).toBe(
      10
    )
  })
})
