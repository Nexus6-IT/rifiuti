/**
 * AllegatiContrattoClienteController con pipe, guard dei ruoli, multer e filtro reali e servizio
 * finto: multipart (`allegato` + `posizione`), ruoli, azienda selezionata, download binario (R37).
 */
import {
  BadRequestException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AllegatiContrattoClienteController } from './allegati-contratto-cliente.controller'
import { AllegatiContrattoClienteService } from '../../application/contratti-cliente/allegati-contratto-cliente.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const K = '7e7e7e7e-0000-4000-8000-000000000004'
const A = '8f8f8f8f-0000-4000-8000-000000000005'
const PDF = Buffer.from('%PDF-1.4 prova')
const VISTA = {
  id: A,
  posizione: 1,
  nomeFile: 'c.pdf',
  dimensioneByte: PDF.length,
  caricatoIl: '2026-11-02T10:00:00.000Z',
}

describe('AllegatiContrattoClienteController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = AllegatiContrattoClienteController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it.each(['elenco', 'scarica'])('%s: lettura a tutti i ruoli', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })
    it.each(['carica', 'rimuovi'])('%s: scrittura senza VIEWER', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    })
    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual(['carica', 'elenco', 'rimuovi', 'scarica'])
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'OPERATOR'

    beforeEach(async () => {
      ruolo = 'OPERATOR'
      servizio = {
        elenco: jest.fn().mockResolvedValue([VISTA]),
        carica: jest.fn().mockResolvedValue(VISTA),
        contenuto: jest.fn().mockResolvedValue({ nomeFile: 'città è.pdf', contenuto: PDF }),
        rimuovi: jest.fn().mockResolvedValue(undefined),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [AllegatiContrattoClienteController],
        providers: [
          { provide: AllegatiContrattoClienteService, useValue: servizio },
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
    const url = `/contratti-clienti/${K}/allegati`
    const invia = (posizione: string | null = '1', buf: Buffer = PDF, nome = 'c.pdf') => {
      const r = http()
        .post(url)
        .attach('allegato', buf, { filename: nome, contentType: 'application/pdf' })
      return posizione === null ? r : r.field('posizione', posizione)
    }

    it('GET elenco: azienda selezionata e contratto', async () => {
      const r = await http().get(url)
      expect(r.status).toBe(200)
      expect(r.body).toEqual([VISTA])
      expect(servizio.elenco).toHaveBeenCalledWith(TENANT, K)
    })

    it('id non UUID: 400', async () => {
      expect((await http().get('/contratti-clienti/x/allegati')).status).toBe(400)
      expect((await http().delete(`${url}/x`)).status).toBe(400)
    })

    it('POST: 201, posizione stringa -> intero, utente della sessione', async () => {
      const r = await invia('2')
      expect(r.status).toBe(201)
      expect(r.body).toEqual(VISTA)
      const [t, u, k, pos, file] = servizio.carica.mock.calls[0]
      expect([t, u, k, pos]).toEqual([TENANT, 'utente-1', K, 2])
      expect(file.originalname).toBe('c.pdf')
      expect(file.size).toBe(PDF.length)
      expect(Buffer.isBuffer(file.buffer)).toBe(true)
    })

    it.each([['abc'], ['1.5'], [''], ['-1'], ['1e0']])('POST posizione %p: 400', async p => {
      const r = await invia(p)
      expect(r.status).toBe(400)
      expect(servizio.carica).not.toHaveBeenCalled()
    })

    it('POST senza posizione o senza file: 400', async () => {
      expect((await invia(null)).status).toBe(400)
      expect((await http().post(url).field('posizione', '1')).status).toBe(400)
      expect(servizio.carica).not.toHaveBeenCalled()
    })

    it('POST posizione 3: passa al servizio, che risponde 400', async () => {
      servizio.carica.mockImplementationOnce(() => {
        throw new BadRequestException("La posizione dell'allegato è 1 o 2.")
      })
      const r = await invia('3')
      expect(r.status).toBe(400)
    })

    it('POST file oltre 4 MiB: 413 in italiano, servizio non chiamato', async () => {
      const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(4 * 1024 * 1024 + 10)])
      const r = await invia('1', grande)
      expect(r.status).toBe(413)
      expect(servizio.carica).not.toHaveBeenCalled()
    })

    it('POST campo extra: 400', async () => {
      const r = await invia('1').field('altro', 'x')
      expect(r.status).toBe(400)
    })

    it('POST: il nome con accenti è ricodificato in UTF-8', async () => {
      await invia('1', PDF, 'città.pdf')
      expect(servizio.carica.mock.calls[0][4].originalname).toBe('città.pdf')
    })

    it('GET contenuto: application/pdf, attachment con filename*, byte identici', async () => {
      const r = await http()
        .get(`${url}/${A}/contenuto`)
        .buffer(true)
        .parse((res, cb) => {
          const parti: Buffer[] = []
          res.on('data', (d: Buffer) => parti.push(d))
          res.on('end', () => cb(null, Buffer.concat(parti)))
        })
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toMatch(/^application\/pdf/)
      expect(r.headers['content-disposition']).toMatch(
        /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/
      )
      expect(r.headers['content-disposition']).toContain(encodeURIComponent('città è.pdf'))
      expect((r.body as Buffer).equals(PDF)).toBe(true)
      expect(servizio.contenuto).toHaveBeenCalledWith(TENANT, K, A)
    })

    it('DELETE: 204 senza versione', async () => {
      const r = await http().delete(`${url}/${A}`)
      expect(r.status).toBe(204)
      expect(servizio.rimuovi).toHaveBeenCalledWith(TENANT, 'utente-1', K, A)
    })

    it('VIEWER: legge ma non scrive', async () => {
      ruolo = 'VIEWER'
      expect((await http().get(url)).status).toBe(200)
      expect((await http().get(`${url}/${A}/contenuto`)).status).toBe(200)
      expect((await invia('1')).status).toBe(403)
      expect((await http().delete(`${url}/${A}`)).status).toBe(403)
      expect(servizio.carica).not.toHaveBeenCalled()
      expect(servizio.rimuovi).not.toHaveBeenCalled()
    })

    it('senza azienda selezionata: 403 su tutte le rotte', async () => {
      const s = { 'x-senza-azienda': '1' }
      expect((await http().get(url).set(s)).status).toBe(403)
      expect((await http().get(`${url}/${A}/contenuto`).set(s)).status).toBe(403)
      expect((await invia('1').set(s)).status).toBe(403)
      expect((await http().delete(`${url}/${A}`).set(s)).status).toBe(403)
    })
  })
})
