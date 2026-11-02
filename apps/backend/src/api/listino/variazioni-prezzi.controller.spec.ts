/**
 * VariazioniPrezziController con pipe, guard dei ruoli e filtro reali e servizio finto: contratto
 * HTTP del Task 24 (D20, D22, R46): validazione dei DTO, azienda selezionata, ruoli, utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { VariazioniPrezziService } from '../../application/listino/variazioni-prezzi.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { VariazioniPrezziController } from './variazioni-prezzi.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'
const IMPRONTA = 'a'.repeat(64)

describe('VariazioniPrezziController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = VariazioniPrezziController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])
    const metodi = Object.getOwnPropertyNames(proto).filter(
      n => n !== 'constructor' && typeof proto[n] === 'function'
    )

    it('ogni rotta ha @Roles esplicito e solo SUPER_ADMIN e ADMIN (toccano tutti i contratti)', () => {
      expect(metodi.sort()).toEqual([
        'anteprima',
        'anteprimaIstat',
        'applica',
        'applicaIstat',
        'mesiIstat',
      ])
      for (const n of metodi) expect(ruoli(n)).toEqual(['SUPER_ADMIN', 'ADMIN'])
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'ADMIN'

    beforeEach(async () => {
      ruolo = 'ADMIN'
      servizio = {
        anteprima: jest.fn().mockResolvedValue({ totale: 0, righe: [], errori: [], impronta: 'x' }),
        applica: jest.fn().mockResolvedValue({ aggiornati: 3 }),
        mesiIstat: jest.fn().mockResolvedValue([{ anno: 2010, mese: 3, contratti: 2 }]),
        anteprimaIstat: jest
          .fn()
          .mockResolvedValue({ totale: 0, righe: [], errori: [], impronta: 'x' }),
        applicaIstat: jest.fn().mockResolvedValue({ aggiornati: 5 }),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [VariazioniPrezziController],
        providers: [
          { provide: VariazioniPrezziService, useValue: servizio },
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
              id: 'utente-1',
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
    const R = 'variazioni-prezzi'
    const corpo = {
      tipo: 'AUMENTO_PERCENTUALE',
      valore: '3,5',
      soloMinimi: false,
      filtri: {
        addebitoId: ID,
        cerCode: '20 03 01',
        clienteId: ID,
        riferimento: 'R1',
        prezzoAttuale: '10,00',
        anchePrezziZero: true,
        tipiPrezzo: ['NORMALE', 'SPECIALE'],
        tipi: ['V', 'F'],
        categorieAddebitoIds: [ID],
        centriRicavoIds: [ID],
        tipiContrattoIds: [ID],
        categorieContrattoIds: [ID],
        inizioDal: '2026-01-01',
        inizioAl: '2026-12-31',
        fineDal: '2026-01-01',
        fineAl: '2026-12-31',
        contrattiIds: [ID],
        addebitiIds: [ID],
        primaScadenzaFissi: '2026-03-31',
      },
    }
    const corpoIstat = {
      percentuali: [{ anno: 2010, mese: 3, percentuale: '3,0' }],
      tipi: ['V'],
    }

    it('POST anteprima: tutti i filtri del contratto FE sono ammessi, azienda selezionata', async () => {
      const r = await http().post(`/${R}/anteprima`).send(corpo)
      expect(r.status).toBe(200)
      expect(servizio.anteprima).toHaveBeenCalledWith(TENANT, corpo)
    })

    it('POST applica: impronta obbligatoria, utente da req.user.id', async () => {
      const r = await http()
        .post(`/${R}`)
        .send({ ...corpo, impronta: IMPRONTA })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ aggiornati: 3 })
      expect(servizio.applica).toHaveBeenCalledWith(TENANT, 'utente-1', {
        ...corpo,
        impronta: IMPRONTA,
      })
    })

    it.each([
      ['senza impronta', undefined],
      ['impronta corta', 'abc'],
      ['impronta maiuscola', 'A'.repeat(64)],
    ])('POST applica %s: 400', async (_n, impronta) => {
      const r = await http()
        .post(`/${R}`)
        .send({ ...corpo, impronta })
      expect(r.status).toBe(400)
      expect(servizio.applica).not.toHaveBeenCalled()
    })

    it.each([
      ['filtro sconosciuto', { filtri: { sorpresa: 1 } }],
      ['id non UUID', { filtri: { clienteId: 'x' } }],
      ['data in formato italiano', { filtri: { inizioDal: '01/01/2026' } }],
      ['tipo di prezzo non ammesso', { filtri: { tipiPrezzo: ['ENORME'] } }],
      ['anchePrezziZero non booleano', { filtri: { anchePrezziZero: 'si' } }],
      ['tipo di variazione non ammesso', { tipo: 'RADDOPPIA' }],
      ['filtri mancanti', { filtri: undefined }],
    ])('POST anteprima %s: 400', async (_n, extra) => {
      const r = await http()
        .post(`/${R}/anteprima`)
        .send({ ...corpo, ...extra })
      expect(r.status).toBe(400)
      expect(servizio.anteprima).not.toHaveBeenCalled()
    })

    it('GET istat/mesi: senza parametro false, con ancheAnnoPrecedente=true true', async () => {
      const r = await http().get(`/${R}/istat/mesi`)
      expect(r.status).toBe(200)
      expect(r.body).toEqual([{ anno: 2010, mese: 3, contratti: 2 }])
      expect(servizio.mesiIstat).toHaveBeenCalledWith(TENANT, false)
      await http().get(`/${R}/istat/mesi?ancheAnnoPrecedente=true`)
      expect(servizio.mesiIstat).toHaveBeenLastCalledWith(TENANT, true)
    })

    it('GET istat/mesi con un valore non ammesso: 400', async () => {
      expect((await http().get(`/${R}/istat/mesi?ancheAnnoPrecedente=forse`)).status).toBe(400)
    })

    it('POST istat/anteprima e POST istat: corpo del FE (CorpoIstat), impronta nella seconda', async () => {
      expect((await http().post(`/${R}/istat/anteprima`).send(corpoIstat)).status).toBe(200)
      expect(servizio.anteprimaIstat).toHaveBeenCalledWith(TENANT, corpoIstat)
      const r = await http()
        .post(`/${R}/istat`)
        .send({ ...corpoIstat, impronta: IMPRONTA })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ aggiornati: 5 })
      expect(servizio.applicaIstat).toHaveBeenCalledWith(TENANT, 'utente-1', {
        ...corpoIstat,
        impronta: IMPRONTA,
      })
    })

    it.each([
      ['senza percentuali', { percentuali: [] }],
      ['mese come testo', { percentuali: [{ anno: 2010, mese: '3', percentuale: '3' }] }],
      ['percentuale numerica', { percentuali: [{ anno: 2010, mese: 3, percentuale: 3 }] }],
      [
        'campo in più nella percentuale',
        { percentuali: [{ anno: 2010, mese: 3, percentuale: '3', x: 1 }] },
      ],
      ['tipi non array', { tipi: 'V' }],
    ])('POST istat/anteprima %s: 400', async (_n, extra) => {
      const r = await http()
        .post(`/${R}/istat/anteprima`)
        .send({ ...corpoIstat, ...extra })
      expect(r.status).toBe(400)
      expect(servizio.anteprimaIstat).not.toHaveBeenCalled()
    })

    it('POST istat senza impronta: 400', async () => {
      expect((await http().post(`/${R}/istat`).send(corpoIstat)).status).toBe(400)
    })

    it.each(['OPERATOR', 'VIEWER'])(
      '%s: 403 su tutte le rotte, nessun servizio chiamato',
      async r => {
        ruolo = r
        expect((await http().post(`/${R}/anteprima`).send(corpo)).status).toBe(403)
        expect(
          (
            await http()
              .post(`/${R}`)
              .send({ ...corpo, impronta: IMPRONTA })
          ).status
        ).toBe(403)
        expect((await http().get(`/${R}/istat/mesi`)).status).toBe(403)
        expect((await http().post(`/${R}/istat/anteprima`).send(corpoIstat)).status).toBe(403)
        expect(
          (
            await http()
              .post(`/${R}/istat`)
              .send({ ...corpoIstat, impronta: IMPRONTA })
          ).status
        ).toBe(403)
        for (const f of Object.values(servizio)) expect(f).not.toHaveBeenCalled()
      }
    )

    it('senza azienda selezionata: nessun servizio chiamato', async () => {
      const r = await http().post(`/${R}/anteprima`).set('x-senza-azienda', '1').send(corpo)
      expect(r.status).toBeGreaterThanOrEqual(400)
      expect(servizio.anteprima).not.toHaveBeenCalled()
    })
  })
})
