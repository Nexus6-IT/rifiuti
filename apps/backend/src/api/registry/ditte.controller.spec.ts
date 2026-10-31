/**
 * DitteController (F2-10, Task 4) con pipe e filtro reali e `DitteService` finto:
 * validazione dei DTO, UUID, azienda selezionata, identificativo malformato e ruoli.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { DitteController } from './ditte.controller'
import { DitteService } from '../../application/registry/ditte/ditte.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { DatiControparteNonValidiError, DittaNonTrovataError } from '../../core/domain/errors'
import { PIVA_VALIDA } from '../../test-support/anagrafiche-di-test'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const DITTA = '7e7e7e7e-0000-4000-8000-000000000004'
const SEDE = '9a9a9a9a-0000-4000-8000-000000000005'

describe('DitteController — pipe e filtro reali', () => {
  let app: INestApplication
  let servizio: Record<string, jest.Mock>
  let ruolo = 'OPERATOR'

  beforeEach(async () => {
    ruolo = 'OPERATOR'
    servizio = {
      cerca: jest.fn(),
      dettaglio: jest.fn(),
      aggiornaDitta: jest.fn(),
      aggiungiSede: jest.fn(),
      aggiornaSede: jest.fn(),
      impostaPrincipale: jest.fn(),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [DitteController],
      providers: [
        { provide: DitteService, useValue: servizio },
        { provide: RuoloEffettivoService, useValue: { accesso: jest.fn() } },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest()
          const senza = !!req.headers['x-senza-azienda']
          req.user = {
            id: 'u1',
            tenantId: senza ? undefined : 'altro-tenant-del-token',
            role: ruolo,
          }
          if (!senza) req.tenantId = TENANT
          return true
        },
      })
      .compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  describe('POST /registry/ditte/cerca', () => {
    it('ditta trovata: la restituisce', async () => {
      servizio.cerca.mockResolvedValue({ id: DITTA })
      const r = await http().post('/registry/ditte/cerca').send({ identificativo: PIVA_VALIDA })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ ditta: { id: DITTA } })
      expect(servizio.cerca).toHaveBeenCalledWith(PIVA_VALIDA)
    })

    it('nessun risultato: { ditta: null }', async () => {
      servizio.cerca.mockResolvedValue(null)
      const r = await http().post('/registry/ditte/cerca').send({ identificativo: PIVA_VALIDA })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ ditta: null })
    })

    it('identificativo malformato: 400 senza il valore nel messaggio', async () => {
      servizio.cerca.mockRejectedValue(
        new DatiControparteNonValidiError('Identificativo non valido.')
      )
      const r = await http().post('/registry/ditte/cerca').send({ identificativo: 'ZZ-SEGRETO' })
      expect(r.status).toBe(400)
      expect(JSON.stringify(r.body)).not.toContain('SEGRETO')
    })

    it('corpo senza identificativo o con campi extra: 400', async () => {
      expect((await http().post('/registry/ditte/cerca').send({})).status).toBe(400)
      expect(
        (await http().post('/registry/ditte/cerca').send({ identificativo: 'x', altro: 1 })).status
      ).toBe(400)
      expect(servizio.cerca).not.toHaveBeenCalled()
    })

    it('è una lettura: la può fare anche un VIEWER', async () => {
      ruolo = 'VIEWER'
      servizio.cerca.mockResolvedValue(null)
      const r = await http().post('/registry/ditte/cerca').send({ identificativo: PIVA_VALIDA })
      expect(r.status).toBe(200)
    })

    it('senza azienda selezionabile: 403 e nessuna lettura', async () => {
      const r = await http()
        .post('/registry/ditte/cerca')
        .set('x-senza-azienda', '1')
        .send({ identificativo: PIVA_VALIDA })
      expect(r.status).toBe(403)
      expect(servizio.cerca).not.toHaveBeenCalled()
    })
  })

  describe('GET /registry/ditte/:id', () => {
    it('id non UUID: 400', async () => {
      const r = await http().get('/registry/ditte/non-un-uuid')
      expect(r.status).toBe(400)
      expect(servizio.dettaglio).not.toHaveBeenCalled()
    })

    it('ditta di un altro tenant: 404 senza id', async () => {
      servizio.dettaglio.mockRejectedValue(new DittaNonTrovataError())
      const r = await http().get(`/registry/ditte/${DITTA}`)
      expect(r.status).toBe(404)
      expect(r.body.message).not.toContain(DITTA)
    })

    it('trovata: 200', async () => {
      servizio.dettaglio.mockResolvedValue({ id: DITTA })
      const r = await http().get(`/registry/ditte/${DITTA}`)
      expect(r.status).toBe(200)
      expect(r.body.id).toBe(DITTA)
    })
  })

  describe('scritture', () => {
    const sede = { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' }

    it('PUT :id passa ragione sociale e identificativi al servizio', async () => {
      servizio.aggiornaDitta.mockResolvedValue({ id: DITTA })
      const r = await http()
        .put(`/registry/ditte/${DITTA}`)
        .send({ ragioneSociale: 'Nuova SRL', partitaIva: PIVA_VALIDA })
      expect(r.status).toBe(200)
      expect(servizio.aggiornaDitta).toHaveBeenCalledWith(
        DITTA,
        { ragioneSociale: 'Nuova SRL', partitaIva: PIVA_VALIDA, codiceFiscale: undefined },
        { userId: undefined }
      )
    })

    it('PUT :id con codice fiscale oltre 16 caratteri: 400 di campo', async () => {
      const r = await http()
        .put(`/registry/ditte/${DITTA}`)
        .send({ codiceFiscale: 'A'.repeat(17) })
      expect(r.status).toBe(400)
      expect(servizio.aggiornaDitta).not.toHaveBeenCalled()
    })

    it('POST :id/sedi crea la sede (201)', async () => {
      servizio.aggiungiSede.mockResolvedValue({ id: SEDE })
      const r = await http()
        .post(`/registry/ditte/${DITTA}/sedi`)
        .send({ ...sede, email: 'a@b.it' })
      expect(r.status).toBe(201)
      expect(servizio.aggiungiSede).toHaveBeenCalledWith(
        DITTA,
        expect.objectContaining({ indirizzo: sede, email: 'a@b.it' })
      )
    })

    it('POST :id/sedi con indirizzo incompleto: 400', async () => {
      const r = await http().post(`/registry/ditte/${DITTA}/sedi`).send({ via: 'Via Roma' })
      expect(r.status).toBe(400)
      expect(servizio.aggiungiSede).not.toHaveBeenCalled()
    })

    it('PUT :id/sedi/:sedeId aggiorna contatti e attiva', async () => {
      servizio.aggiornaSede.mockResolvedValue({ id: SEDE })
      const r = await http()
        .put(`/registry/ditte/${DITTA}/sedi/${SEDE}`)
        .send({ telefono: '0612345', attiva: false })
      expect(r.status).toBe(200)
      expect(servizio.aggiornaSede).toHaveBeenCalledWith(
        DITTA,
        SEDE,
        expect.objectContaining({ telefono: '0612345', attiva: false, indirizzo: undefined })
      )
    })

    it('PUT :id/sedi/:sedeId con indirizzo parziale: 400', async () => {
      const r = await http().put(`/registry/ditte/${DITTA}/sedi/${SEDE}`).send({ via: 'Via Nuova' })
      expect(r.status).toBe(400)
      expect(servizio.aggiornaSede).not.toHaveBeenCalled()
    })

    it('sedeId non UUID: 400', async () => {
      expect((await http().put(`/registry/ditte/${DITTA}/sedi/xx`).send({})).status).toBe(400)
      expect((await http().post(`/registry/ditte/${DITTA}/sedi/xx/principale`)).status).toBe(400)
    })

    it('POST :id/sedi/:sedeId/principale (200)', async () => {
      servizio.impostaPrincipale.mockResolvedValue({ id: DITTA })
      const r = await http().post(`/registry/ditte/${DITTA}/sedi/${SEDE}/principale`)
      expect(r.status).toBe(200)
      expect(servizio.impostaPrincipale).toHaveBeenCalledWith(DITTA, SEDE)
    })

    it.each([
      ['put', `/registry/ditte/${DITTA}`],
      ['post', `/registry/ditte/${DITTA}/sedi`],
      ['put', `/registry/ditte/${DITTA}/sedi/${SEDE}`],
      ['post', `/registry/ditte/${DITTA}/sedi/${SEDE}/principale`],
    ] as const)('un VIEWER non può scrivere: %s %s -> 403', async (metodo, url) => {
      ruolo = 'VIEWER'
      const r = await http()[metodo](url).send({})
      expect(r.status).toBe(403)
      expect(servizio.aggiornaDitta).not.toHaveBeenCalled()
      expect(servizio.aggiungiSede).not.toHaveBeenCalled()
      expect(servizio.aggiornaSede).not.toHaveBeenCalled()
      expect(servizio.impostaPrincipale).not.toHaveBeenCalled()
    })
  })

  describe('autorizzazione (metadati @Roles)', () => {
    const roles = (m: string): string[] | undefined =>
      Reflect.getMetadata('roles', (DitteController.prototype as any)[m])
    it.each(['aggiornaDitta', 'creaSede', 'aggiornaSede', 'impostaPrincipale'])(
      '%s richiede SUPER_ADMIN, ADMIN, OPERATOR',
      m => expect(roles(m)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    )
    it.each(['cerca', 'dettaglio'])('%s non richiede un ruolo', m =>
      expect(roles(m)).toBeUndefined()
    )
  })
})
