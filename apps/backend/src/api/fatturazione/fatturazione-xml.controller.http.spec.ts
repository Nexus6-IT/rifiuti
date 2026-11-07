/**
 * Task 25b (4.4b2): XML, «segna come emesso» ed export con pipe, guard dei ruoli e filtro reali e
 * servizi finti (niente Postgres). Matrice §12 (Q29, senza PDF): il CSV e` a tutti i ruoli,
 * XML, XML_ZIP ed emissione solo agli amministratori. Il download passa da `StreamableFile`.
 */
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AnnulloStornoService } from '../../application/fatturazione/annullo-storno.service'
import { DocumentiFatturaService } from '../../application/fatturazione/documenti-fattura.service'
import { ExportService } from '../../application/fatturazione/export.service'
import { XmlDocumentoService } from '../../application/fatturazione/xml-documento.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { DocumentiFatturaController } from './documenti-fattura.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const DOC = '7e7e7e7e-0000-4000-8000-000000000005'
const CLI = '7e7e7e7e-0000-4000-8000-000000000007'
const D = 'documenti-fattura'
const XML = Buffer.from('<?xml version="1.0"?><a/>')
const ZIP = Buffer.from('PK-finto')

interface Finti {
  xml: Record<string, jest.Mock>
  esporta: Record<string, jest.Mock>
}

function finti(): Finti {
  return {
    xml: {
      xml: jest
        .fn()
        .mockResolvedValue({ nomeFile: 'IT01234567890_00001.xml', contenuto: XML, sha256: 'x' }),
      zip: jest.fn().mockResolvedValue({ contenuto: ZIP, saltati: 1 }),
      segnaEmesso: jest.fn().mockResolvedValue({ id: DOC, emessoIl: '2026-11-07T10:00:00.000Z' }),
    },
    esporta: {
      esporta: jest.fn().mockResolvedValue({
        nomeFile: 'fatture-2026.zip',
        contentType: 'application/zip',
        contenuto: ZIP,
        saltati: 0,
      }),
    },
  }
}

async function creaApp(f: Finti, ruolo: () => string, effettivo: () => string = ruolo) {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const moduleRef = await Test.createTestingModule({
    controllers: [DocumentiFatturaController],
    providers: [
      { provide: DocumentiFatturaService, useValue: { lista: jest.fn(), dettaglio: jest.fn() } },
      { provide: AnnulloStornoService, useValue: { annulla: jest.fn(), storna: jest.fn() } },
      { provide: XmlDocumentoService, useValue: f.xml },
      { provide: ExportService, useValue: f.esporta },
      {
        provide: RuoloEffettivoService,
        useValue: { accesso: jest.fn(), ruoloEffettivo: jest.fn(async () => effettivo()) },
      },
      { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest()
        req.user = { id: 'utente-1', tenantId: 'altro-tenant-del-token', role: ruolo() }
        req.tenantId = TENANT
        return true
      },
    })
    .compile()
  const app = moduleRef.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  )
  await app.init()
  return app
}

describe('Fatturazione: XML, emissione ed export (HTTP con servizi finti)', () => {
  let app: INestApplication
  let f: Finti
  let ruolo = 'ADMIN'
  let effettivo: string | null = null

  beforeEach(async () => {
    ruolo = 'ADMIN'
    effettivo = null
    f = finti()
    app = await creaApp(
      f,
      () => ruolo,
      () => effettivo ?? ruolo
    )
  })
  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())
  const tutti = () => [...Object.values(f.xml), ...Object.values(f.esporta)]
  const xml = (corpo: object = { confermaEmissione: true }) =>
    http().post(`/${D}/${DOC}/xml`).send(corpo)
  const emesso = () => http().post(`/${D}/${DOC}/emesso`).send({ versione: 3 })
  const csv = () =>
    http()
      .post(`/${D}/export`)
      .send({ formato: 'CSV', selezione: { anno: 2026 } })
  const zip = (conferma: boolean | undefined = true) =>
    http()
      .post(`/${D}/export`)
      .send({
        formato: 'XML_ZIP',
        selezione: { anno: 2026 },
        ...(conferma === undefined ? {} : { confermaEmissione: conferma }),
      })

  it('ogni rotta nuova ha @Roles esplicito', () => {
    const reflector = new Reflector()
    const proto = DocumentiFatturaController.prototype as any
    for (const nome of ['scaricaXml', 'segnaEmesso', 'esporta']) {
      const ruoli = reflector.get<string[]>(ROLES_KEY, proto[nome])
      expect([nome, Array.isArray(ruoli) && ruoli.length > 0]).toEqual([nome, true])
    }
  })

  describe('ruoli (§12)', () => {
    it.each(['VIEWER', 'OPERATOR'])('%s: export CSV 200', async r => {
      ruolo = r
      expect((await csv()).status).toBe(200)
      expect(f.esporta.esporta).toHaveBeenCalledTimes(1)
    })

    it.each(['VIEWER', 'OPERATOR'])('%s: 403 su xml, export XML_ZIP ed emesso', async r => {
      ruolo = r
      expect((await xml()).status).toBe(403)
      expect((await zip()).status).toBe(403)
      expect((await emesso()).status).toBe(403)
      for (const m of tutti()) expect(m).not.toHaveBeenCalled()
    })

    it.each(['ADMIN', 'SUPER_ADMIN'])('%s: 200 su xml, export e emesso', async r => {
      ruolo = r
      expect((await xml()).status).toBe(200)
      expect((await zip()).status).toBe(200)
      expect((await csv()).status).toBe(200)
      expect((await emesso()).status).toBe(200)
    })

    it('token ADMIN ma ruolo effettivo VIEWER nell`azienda selezionata: XML_ZIP 403', async () => {
      ruolo = 'ADMIN'
      effettivo = 'VIEWER'
      expect((await zip()).status).toBe(403)
      expect(f.esporta.esporta).not.toHaveBeenCalled()
    })

    it('token VIEWER ma ruolo effettivo ADMIN: XML_ZIP passa il controllo nel metodo', async () => {
      // Il guard decide sul token (il mock non risolve l`header): qui si prova che il controllo
      // nel metodo usa il ruolo effettivo, non quello del token.
      ruolo = 'OPERATOR'
      effettivo = 'ADMIN'
      expect((await csv()).status).toBe(200)
      expect((await zip()).status).toBe(200)
    })

    it('un formato diverso da CSV (adattatore) richiede un amministratore', async () => {
      ruolo = 'OPERATOR'
      const r = await http()
        .post(`/${D}/export`)
        .send({ formato: 'TEAMSYSTEM', selezione: {}, confermaEmissione: true })
      expect(r.status).toBe(403)
      expect(f.esporta.esporta).not.toHaveBeenCalled()
    })
  })

  describe('XML', () => {
    it('senza confermaEmissione: 400, nessun servizio chiamato', async () => {
      expect((await xml({})).status).toBe(400)
      expect((await xml({ confermaEmissione: 'si' })).status).toBe(400)
      expect(f.xml.xml).not.toHaveBeenCalled()
    })

    it('confermaEmissione false arriva al servizio com`e`, mai inventata', async () => {
      await xml({ confermaEmissione: false })
      expect(f.xml.xml).toHaveBeenCalledWith(TENANT, 'utente-1', DOC, { confermaEmissione: false })
    })

    it('download: Content-Type XML, attachment col nome del file, byte del servizio', async () => {
      const r = await xml()
        .buffer(true)
        .parse((res, cb) => {
          const pezzi: Buffer[] = []
          res.on('data', (c: Buffer) => pezzi.push(c))
          res.on('end', () => cb(null, Buffer.concat(pezzi)))
        })
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toMatch(/^application\/xml/)
      expect(r.headers['content-disposition']).toBe(
        'attachment; filename="IT01234567890_00001.xml"'
      )
      expect(Buffer.compare(r.body, XML)).toBe(0)
    })

    it('XML_NON_DISPONIBILE su un annullato: 409 col codice', async () => {
      f.xml.xml.mockRejectedValue(
        new ConflictException({
          error: 'XML_NON_DISPONIBILE',
          message: 'Un documento annullato non ha l`XML.',
        })
      )
      const r = await xml()
      expect([r.status, r.body.error]).toEqual([409, 'XML_NON_DISPONIBILE'])
    })

    it('id non UUID: 400', async () => {
      expect((await http().post(`/${D}/abc/xml`).send({ confermaEmissione: true })).status).toBe(
        400
      )
      expect((await http().post(`/${D}/abc/emesso`).send({ versione: 1 })).status).toBe(400)
    })

    it('tenant dal request, mai dal corpo: tenantId nel corpo e` 400', async () => {
      const r = await xml({ confermaEmissione: true, tenantId: 'altra' })
      expect(r.status).toBe(400)
      expect(f.xml.xml).not.toHaveBeenCalled()
      await emesso()
      expect(f.xml.segnaEmesso).toHaveBeenCalledWith(TENANT, 'utente-1', DOC, 3)
    })
  })

  describe('segna come emesso', () => {
    it('risponde 200 col documento; versione obbligatoria', async () => {
      const r = await emesso()
      expect([r.status, r.body.id]).toEqual([200, DOC])
      expect((await http().post(`/${D}/${DOC}/emesso`).send({})).status).toBe(400)
      expect((await http().post(`/${D}/${DOC}/emesso`).send({ versione: '1' })).status).toBe(400)
      expect((await http().post(`/${D}/${DOC}/emesso`).send({ versione: 0 })).status).toBe(400)
    })

    it('EMISSIONE_NON_AMMESSA arriva come 409', async () => {
      f.xml.segnaEmesso.mockRejectedValue(
        new ConflictException({ error: 'EMISSIONE_NON_AMMESSA', message: 'no' })
      )
      const r = await emesso()
      expect([r.status, r.body.error]).toEqual([409, 'EMISSIONE_NON_AMMESSA'])
    })
  })

  describe('export', () => {
    it('CSV con confermaEmissione: ignorata, nessuna emissione richiesta al servizio', async () => {
      const r = await http()
        .post(`/${D}/export`)
        .send({ formato: 'CSV', selezione: { anno: 2026 }, confermaEmissione: true })
      expect(r.status).toBe(200)
      expect(f.esporta.esporta).toHaveBeenCalledWith(TENANT, 'utente-1', {
        formato: 'CSV',
        selezione: { anno: 2026 },
        confermaEmissione: false,
      })
      expect(f.xml.zip).not.toHaveBeenCalled()
      expect(f.xml.xml).not.toHaveBeenCalled()
    })

    it('XML_ZIP: la conferma arriva al servizio', async () => {
      await zip(true)
      expect(f.esporta.esporta).toHaveBeenCalledWith(TENANT, 'utente-1', {
        formato: 'XML_ZIP',
        selezione: { anno: 2026 },
        confermaEmissione: true,
      })
    })

    it('XML_ZIP con un annullato: header X-Documenti-Saltati 1', async () => {
      f.esporta.esporta.mockResolvedValue({
        nomeFile: 'fatture-2026.zip',
        contentType: 'application/zip',
        contenuto: ZIP,
        saltati: 1,
      })
      const r = await zip()
      expect(r.headers['x-documenti-saltati']).toBe('1')
    })

    it('XML_ZIP senza saltati: header 0; CSV: nessun header', async () => {
      expect((await zip()).headers['x-documenti-saltati']).toBe('0')
      expect((await csv()).headers['x-documenti-saltati']).toBeUndefined()
    })

    it('download con Content-Disposition attachment, nome del file e tipo del servizio', async () => {
      f.esporta.esporta.mockResolvedValue({
        nomeFile: 'fatture-2026.csv',
        contentType: 'text/csv; charset=utf-8',
        contenuto: Buffer.from('a;b'),
        saltati: 0,
      })
      const r = await csv()
      expect(r.headers['content-disposition']).toBe('attachment; filename="fatture-2026.csv"')
      expect(r.headers['content-type']).toMatch(/^text\/csv/)
    })

    it('tenant dal request: tenantId nel corpo o nella selezione e` 400', async () => {
      const a = await http()
        .post(`/${D}/export`)
        .send({ formato: 'CSV', selezione: {}, tenantId: 'x' })
      const b = await http()
        .post(`/${D}/export`)
        .send({ formato: 'CSV', selezione: { tenantId: 'x' } })
      expect([a.status, b.status]).toEqual([400, 400])
      expect(f.esporta.esporta).not.toHaveBeenCalled()
    })

    it('validazione: formato, selezione, UUID, date, numeri, id oltre il massimo', async () => {
      const invalidi: object[] = [
        { selezione: {} },
        { formato: '', selezione: {} },
        { formato: 'CSV' },
        { formato: 'CSV', selezione: { clienteId: 'abc' } },
        { formato: 'CSV', selezione: { dataDa: '05/11/2026' } },
        { formato: 'CSV', selezione: { anno: 'x' } },
        { formato: 'CSV', selezione: { numeroDa: 0 } },
        { formato: 'CSV', selezione: { documentoIds: ['abc'] } },
        { formato: 'CSV', selezione: { documentoIds: Array(2001).fill(CLI) } },
        { formato: 'CSV', selezione: {}, confermaEmissione: 'si' },
      ]
      for (const corpo of invalidi) {
        const r = await http().post(`/${D}/export`).send(corpo)
        expect([JSON.stringify(corpo).slice(0, 60), r.status]).toEqual([
          JSON.stringify(corpo).slice(0, 60),
          400,
        ])
      }
      expect(f.esporta.esporta).not.toHaveBeenCalled()
    })

    it('selezione completa valida passa intatta', async () => {
      const selezione = {
        registroIvaId: CLI,
        anno: 2026,
        numeroDa: 1,
        numeroA: 10,
        dataDa: '2026-01-01',
        dataA: '2026-03-31',
        clienteId: CLI,
        documentoIds: [DOC],
        elaborazioneId: CLI,
      }
      const r = await http().post(`/${D}/export`).send({ formato: 'CSV', selezione })
      expect(r.status).toBe(200)
      expect(f.esporta.esporta.mock.calls[0][2].selezione).toEqual(selezione)
    })

    it('errori di dominio dell`export escono con il loro codice', async () => {
      f.esporta.esporta.mockRejectedValue(
        new ConflictException({ error: 'OPERAZIONE_CONCORRENTE', message: 'riprova' })
      )
      const r = await csv()
      expect([r.status, r.body.error]).toEqual([409, 'OPERAZIONE_CONCORRENTE'])
    })
  })
})
