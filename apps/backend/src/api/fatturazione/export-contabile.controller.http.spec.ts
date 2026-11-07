/**
 * Controller dell'export contabile (4.4c, Task 29) con pipe, guard dei ruoli e filtro reali e
 * servizi finti: ruoli (RUOLI_AMMINISTRATORI), validazione dei DTO e forma degli errori.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { RegistroAdattatori } from '../../application/fatturazione/adattatori/registro-adattatori'
import { MappatureService } from '../../application/fatturazione/adattatori/mappature.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { creaAdattatoreFinto } from '../../test-support/adattatore-finto'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { ExportContabileController } from './export-contabile.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'

describe('ExportContabileController (HTTP con servizi finti)', () => {
  let app: INestApplication
  let ruolo = 'ADMIN'
  const mappature = {
    lista: jest.fn(),
    imposta: jest.fn(),
  }

  beforeEach(async () => {
    ruolo = 'ADMIN'
    mappature.lista.mockReset().mockResolvedValue([])
    mappature.imposta.mockReset().mockResolvedValue([])
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [ExportContabileController],
      providers: [
        {
          provide: RegistroAdattatori,
          useValue: new RegistroAdattatori([
            creaAdattatoreFinto(),
            creaAdattatoreFinto({ codice: 'VERO', modalita: 'API', verificato: true }),
          ]),
        },
        { provide: MappatureService, useValue: mappature },
        { provide: RuoloEffettivoService, useValue: { accesso: jest.fn() } },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest()
          req.user = { id: 'utente-1', tenantId: 'altro-tenant-del-token', role: ruolo }
          req.tenantId = TENANT
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

  it('GET adattatori: codice, nome, modalita` e verificato di ciascuno, e nient`altro', async () => {
    const r = await http().get('/export-contabile/adattatori')
    expect(r.status).toBe(200)
    expect(r.body).toEqual([
      { codice: 'FINTO', nome: 'Adattatore finto', modalita: 'FILE', verificato: false },
      { codice: 'VERO', nome: 'Adattatore finto', modalita: 'API', verificato: true },
    ])
  })

  it.each(['OPERATOR', 'VIEWER'])('%s: adattatori e mappature sono vietati (403)', async r => {
    ruolo = r
    expect((await http().get('/export-contabile/adattatori')).status).toBe(403)
    expect((await http().get('/export-contabile/FINTO/mappature')).status).toBe(403)
    expect((await http().put('/export-contabile/FINTO/mappature').send({ voci: [] })).status).toBe(
      403
    )
    expect(mappature.lista).not.toHaveBeenCalled()
    expect(mappature.imposta).not.toHaveBeenCalled()
  })

  it('GET mappature: l`azienda e` quella della richiesta, mai del token', async () => {
    mappature.lista.mockResolvedValue([
      { tipo: 'CLIENTE', chiaveWasteflow: 'k', valore: 'v', versione: 1 },
    ])
    const r = await http().get('/export-contabile/FINTO/mappature')
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(1)
    expect(mappature.lista).toHaveBeenCalledWith(TENANT, 'FINTO')
  })

  it('PUT mappature: passa utente e voci al servizio (valore null ammesso)', async () => {
    const voci = [
      { tipo: 'CLIENTE', chiaveWasteflow: 'k', valore: 'v' },
      { tipo: 'CODICE_IVA', chiaveWasteflow: '22.00', valore: null },
    ]
    const r = await http().put('/export-contabile/FINTO/mappature').send({ voci })
    expect(r.status).toBe(200)
    expect(mappature.imposta).toHaveBeenCalledWith(TENANT, 'utente-1', 'FINTO', voci)
  })

  it('PUT con 501 voci: 400, il servizio non e` chiamato', async () => {
    const voci = Array.from({ length: 501 }, (_, i) => ({
      tipo: 'CLIENTE',
      chiaveWasteflow: `k${i}`,
      valore: 'v',
    }))
    const r = await http().put('/export-contabile/FINTO/mappature').send({ voci })
    expect(r.status).toBe(400)
    expect(mappature.imposta).not.toHaveBeenCalled()
  })

  it.each([
    ['tipo sconosciuto', { voci: [{ tipo: 'X', chiaveWasteflow: 'k', valore: 'v' }] }],
    ['chiave vuota', { voci: [{ tipo: 'CLIENTE', chiaveWasteflow: '', valore: 'v' }] }],
    [
      'valore troppo lungo',
      { voci: [{ tipo: 'CLIENTE', chiaveWasteflow: 'k', valore: 'v'.repeat(51) }] },
    ],
    ['campo in piu`', { voci: [{ tipo: 'CLIENTE', chiaveWasteflow: 'k', valore: 'v', x: 1 }] }],
    ['voci mancanti', {}],
  ])('PUT non valido (%s): 400', async (_n, corpo) => {
    const r = await http().put('/export-contabile/FINTO/mappature').send(corpo)
    expect(r.status).toBe(400)
    expect(mappature.imposta).not.toHaveBeenCalled()
  })

  it('il codice dell`adattatore e` limitato a 30 caratteri nel percorso', async () => {
    const r = await http().get(`/export-contabile/${'X'.repeat(31)}/mappature`)
    expect(r.status).toBe(400)
    expect(mappature.lista).not.toHaveBeenCalled()
  })
})
