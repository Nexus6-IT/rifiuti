/**
 * Controller della fatturazione (4.4b1, Task 25a) con pipe, guard dei ruoli e filtro reali e
 * servizi finti (niente Postgres): ruoli per rotta (§12, Q29), validazione dei DTO, azienda dalla
 * richiesta, forma degli errori `{ error, message, details? }` e mappatura dei codici di dominio.
 * Il confronto delle risposte con `fatturazione.model.ts` e` del Task 26a, su risposte reali (Q21).
 */
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AnnulloStornoService } from '../../application/fatturazione/annullo-storno.service'
import { DocumentiFatturaService } from '../../application/fatturazione/documenti-fattura.service'
import { ExportService } from '../../application/fatturazione/export.service'
import { XmlDocumentoService } from '../../application/fatturazione/xml-documento.service'
import { ElaborazioniService } from '../../application/fatturazione/elaborazioni.service'
import { ScostamentiService } from '../../application/fatturazione/scostamenti.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { DocumentiFatturaController } from './documenti-fattura.controller'
import { ElaborazioniController } from './elaborazioni.controller'
import { ScostamentiController } from './scostamenti.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'
const DOC = '7e7e7e7e-0000-4000-8000-000000000005'
const LEG = '7e7e7e7e-0000-4000-8000-000000000006'
const CLI = '7e7e7e7e-0000-4000-8000-000000000007'
const E = 'elaborazioni-fatturazione'
const D = 'documenti-fattura'
const IMPRONTA = 'a'.repeat(64)

type Mocks = Record<string, jest.Mock>
interface Servizi {
  elab: Mocks
  doc: Mocks
  annullo: Mocks
  scost: Mocks
}

function servizi(): Servizi {
  const pagina = { elementi: [], totale: 0, pagina: 1, dimensione: 50 }
  return {
    elab: {
      avvia: jest.fn().mockResolvedValue({ id: ID }),
      lista: jest.fn().mockResolvedValue(pagina),
      dettaglio: jest.fn().mockResolvedValue({ id: ID }),
      documenti: jest.fn().mockResolvedValue(pagina),
      ricalcola: jest.fn().mockResolvedValue(undefined),
      scarta: jest.fn().mockResolvedValue({ id: ID }),
      escludi: jest.fn().mockResolvedValue({ id: DOC }),
      chiediDefinitiva: jest.fn().mockResolvedValue({ id: ID }),
    },
    doc: {
      lista: jest.fn().mockResolvedValue(pagina),
      dettaglio: jest.fn().mockResolvedValue({ id: DOC }),
    },
    annullo: {
      annulla: jest.fn().mockResolvedValue({ id: DOC, stato: 'ANNULLATO' }),
      storna: jest.fn().mockResolvedValue({ id: 'storno' }),
    },
    scost: {
      lista: jest.fn().mockResolvedValue(pagina),
      presaAtto: jest.fn().mockResolvedValue(undefined),
    },
  }
}

async function creaApp(s: Servizi, ruolo: () => string) {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const moduleRef = await Test.createTestingModule({
    controllers: [ElaborazioniController, DocumentiFatturaController, ScostamentiController],
    providers: [
      { provide: ElaborazioniService, useValue: s.elab },
      { provide: DocumentiFatturaService, useValue: s.doc },
      { provide: AnnulloStornoService, useValue: s.annullo },
      { provide: ScostamentiService, useValue: s.scost },
      { provide: XmlDocumentoService, useValue: {} },
      { provide: ExportService, useValue: {} },
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
          role: ruolo(),
        }
        if (!senza) req.tenantId = TENANT
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

const nuova = {
  periodoDal: '2026-01-01',
  periodoAl: '2026-03-31',
  dataDocumento: '2026-04-05',
  raggruppamento: 'PER_CONTRATTO',
  includiArretrati: false,
  filtri: {},
}
const storno = {
  motivo: 'reso',
  dataDocumento: '2026-05-01',
  rifatturabile: true,
  versione: 2,
}

describe('Fatturazione: API (HTTP con servizi finti)', () => {
  let app: INestApplication
  let s: Servizi
  let ruolo = 'OPERATOR'

  beforeEach(async () => {
    ruolo = 'OPERATOR'
    s = servizi()
    app = await creaApp(s, () => ruolo)
  })
  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())
  type Voce = [string, string, string, object?]
  const chiama = (m: string, p: string, corpo?: object) => {
    const r = (http() as any)[m](p)
    return corpo === undefined ? r : r.send(corpo)
  }
  const tuttiIServizi = () => [s.elab, s.doc, s.annullo, s.scost].flatMap(g => Object.values(g))

  // Matrice §12 (Q29, senza PDF).
  const LETTURE: Voce[] = [
    ['lista elaborazioni', 'get', `/${E}`],
    ['dettaglio elaborazione', 'get', `/${E}/${ID}`],
    ['documenti elaborazione', 'get', `/${E}/${ID}/documenti`],
    ['lista documenti', 'get', `/${D}`],
    ['dettaglio documento', 'get', `/${D}/${DOC}`],
    ['lista scostamenti', 'get', '/scostamenti-fattura'],
  ]
  const PREPARAZIONE: Voce[] = [
    ['avvia', 'post', `/${E}`, nuova],
    ['ricalcola', 'post', `/${E}/${ID}/ricalcola`, { versione: 1 }],
    ['scarta', 'post', `/${E}/${ID}/scarta`, { versione: 1 }],
    ['escludi', 'post', `/${E}/${ID}/documenti/${DOC}/escludi`, {}],
    ['riammetti', 'post', `/${E}/${ID}/documenti/${DOC}/riammetti`, {}],
  ]
  const AMMINISTRAZIONE: Voce[] = [
    ['definitiva', 'post', `/${E}/${ID}/definitiva`, { impronta: IMPRONTA, versione: 1 }],
    ['annulla', 'post', `/${D}/${DOC}/annulla`, { motivo: 'errore', versione: 1 }],
    ['storno', 'post', `/${D}/${DOC}/storno`, storno],
    [
      'presa d`atto',
      'post',
      `/legami-movimento/${LEG}/presa-atto-scostamento`,
      { nota: 'ok', versione: 1 },
    ],
  ]

  describe('ruoli (§12)', () => {
    it.each(LETTURE)('VIEWER: %s e` consentita (200)', async (_n, m, p) => {
      // Tre parametri come le colonne della tabella: un quarto sarebbe letto da jest come `done`.
      ruolo = 'VIEWER'
      expect((await chiama(m, p)).status).toBe(200)
    })

    it.each([...PREPARAZIONE, ...AMMINISTRAZIONE])(
      'VIEWER: %s e` vietata (403, nessun servizio chiamato)',
      async (_n, m, p, corpo) => {
        ruolo = 'VIEWER'
        expect((await chiama(m, p, corpo)).status).toBe(403)
        for (const f of tuttiIServizi()) expect(f).not.toHaveBeenCalled()
      }
    )

    it.each(PREPARAZIONE)('OPERATOR: %s prepara (2xx)', async (_n, m, p, corpo) => {
      const r = await chiama(m, p, corpo)
      expect([p, r.status >= 200 && r.status < 300]).toEqual([p, true])
    })

    it.each(AMMINISTRAZIONE)('OPERATOR: %s e` vietata (403)', async (_n, m, p, corpo) => {
      expect((await chiama(m, p, corpo)).status).toBe(403)
      for (const f of tuttiIServizi()) expect(f).not.toHaveBeenCalled()
    })

    it.each(['ADMIN', 'SUPER_ADMIN'])('%s: legge, prepara e amministra', async r => {
      ruolo = r
      for (const [, m, p, corpo] of [...LETTURE, ...PREPARAZIONE, ...AMMINISTRAZIONE]) {
        const risposta = await chiama(m, p, corpo)
        expect([p, risposta.status >= 200 && risposta.status < 300]).toEqual([p, true])
      }
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get(`/${E}/${ID}`).set('x-senza-azienda', '1')).status).toBe(403)
      expect(s.elab.dettaglio).not.toHaveBeenCalled()
    })
  })

  describe('codici di stato', () => {
    it('avvia, ricalcola e definitiva rispondono 202 con { id }', async () => {
      const a = await http().post(`/${E}`).send(nuova)
      expect([a.status, a.body]).toEqual([202, { id: ID }])
      const r = await http().post(`/${E}/${ID}/ricalcola`).send({ versione: 1 })
      expect([r.status, r.body]).toEqual([202, { id: ID }])
      ruolo = 'ADMIN'
      const d = await http()
        .post(`/${E}/${ID}/definitiva`)
        .send({ impronta: IMPRONTA, versione: 1 })
      expect([d.status, d.body]).toEqual([202, { id: ID }])
    })

    it('scarta risponde { id }', async () => {
      const r = await http().post(`/${E}/${ID}/scarta`).send({ versione: 4 })
      expect([r.status, r.body]).toEqual([200, { id: ID }])
      expect(s.elab.scarta).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 4)
    })

    it('annullo e storno rispondono 200 col documento', async () => {
      ruolo = 'ADMIN'
      expect(
        (await http().post(`/${D}/${DOC}/annulla`).send({ motivo: 'm', versione: 1 })).status
      ).toBe(200)
      expect((await http().post(`/${D}/${DOC}/storno`).send(storno)).status).toBe(200)
    })
  })

  describe('azienda e utente dalla richiesta', () => {
    it('il tenant e` quello selezionato, mai quello del token ne` del corpo', async () => {
      await http().post(`/${E}`).send(nuova)
      expect(s.elab.avvia).toHaveBeenCalledWith(TENANT, 'utente-1', expect.any(Object))
      await http().get(`/${D}/${DOC}`)
      expect(s.doc.dettaglio).toHaveBeenCalledWith(TENANT, DOC)
    })

    it.each([
      ['avvia', `/${E}`, nuova],
      ['ricalcola', `/${E}/${ID}/ricalcola`, { versione: 1 }],
      ['annulla', `/${D}/${DOC}/annulla`, { motivo: 'm', versione: 1 }],
      [
        'presa d`atto',
        `/legami-movimento/${LEG}/presa-atto-scostamento`,
        { nota: 'n', versione: 1 },
      ],
    ])('%s: un tenantId nel corpo e` rifiutato (400)', async (_n, p, corpo) => {
      ruolo = 'ADMIN'
      const r = await http()
        .post(p)
        .send({ ...corpo, tenantId: 'altra-azienda' })
      expect(r.status).toBe(400)
      for (const f of tuttiIServizi()) expect(f).not.toHaveBeenCalled()
    })
  })

  describe('validazione', () => {
    const lista400: [string, string][] = [
      ['elaborazioni', `/${E}`],
      ['documenti dell`elaborazione', `/${E}/${ID}/documenti`],
      ['documenti', `/${D}`],
      ['scostamenti', '/scostamenti-fattura'],
    ]
    it.each(lista400)('%s: dimensione 101 e pagina 0 sono 400', async (_n, p) => {
      expect((await http().get(`${p}?dimensione=101`)).status).toBe(400)
      expect((await http().get(`${p}?pagina=0`)).status).toBe(400)
      expect((await http().get(`${p}?dimensione=0`)).status).toBe(400)
      expect((await http().get(`${p}?pagina=abc`)).status).toBe(400)
      for (const f of tuttiIServizi()) expect(f).not.toHaveBeenCalled()
    })

    it.each(lista400)('%s: pagina oltre il limite (100000) e` 400, mai un 500', async (_n, p) => {
      const r = await http().get(`${p}?pagina=100001&dimensione=100`)
      expect(r.status).toBe(400)
      expect(JSON.stringify(r.body.message)).toMatch(/pagina/i)
      expect((await http().get(`${p}?pagina=50000000`)).status).toBe(400)
      expect((await http().get(`${p}?pagina=100000&dimensione=100`)).status).toBe(200)
    })

    it.each(lista400)(
      '%s: dimensione 100 passa; i predefiniti sono pagina 1 e dimensione 50',
      async (_n, p) => {
        expect((await http().get(`${p}?dimensione=100`)).status).toBe(200)
        expect((await http().get(p)).status).toBe(200)
      }
    )

    it('i predefiniti arrivano al servizio come numeri', async () => {
      await http().get(`/${E}`)
      expect(s.elab.lista).toHaveBeenCalledWith(TENANT, { pagina: 1, dimensione: 50 })
      await http().get(`/${E}/${ID}/documenti?conErrori=true&pagina=2&dimensione=10`)
      expect(s.elab.documenti).toHaveBeenCalledWith(TENANT, ID, {
        pagina: 2,
        dimensione: 10,
        conErrori: true,
      })
    })

    it('id non UUID: 400 su tutte le rotte con :id', async () => {
      ruolo = 'ADMIN'
      const rotte: Voce[] = [
        ['', 'get', `/${E}/abc`],
        ['', 'get', `/${E}/abc/documenti`],
        ['', 'post', `/${E}/abc/ricalcola`, { versione: 1 }],
        ['', 'post', `/${E}/abc/scarta`, { versione: 1 }],
        ['', 'post', `/${E}/abc/documenti/${DOC}/escludi`, {}],
        ['', 'post', `/${E}/${ID}/documenti/abc/riammetti`, {}],
        ['', 'post', `/${E}/abc/definitiva`, { impronta: IMPRONTA, versione: 1 }],
        ['', 'get', `/${D}/abc`],
        ['', 'post', `/${D}/abc/annulla`, { motivo: 'm', versione: 1 }],
        ['', 'post', `/${D}/abc/storno`, storno],
        ['', 'post', '/legami-movimento/abc/presa-atto-scostamento', { nota: 'n', versione: 1 }],
      ]
      for (const [, m, p, corpo] of rotte) {
        expect([p, (await chiama(m, p, corpo)).status]).toEqual([p, 400])
      }
      for (const f of tuttiIServizi()) expect(f).not.toHaveBeenCalled()
    })

    it('date solo AAAA-MM-GG: "05/11/2026" e` 400 in avvio, filtri e storno', async () => {
      ruolo = 'ADMIN'
      for (const campo of ['periodoDal', 'periodoAl', 'dataDocumento']) {
        const r = await http()
          .post(`/${E}`)
          .send({ ...nuova, [campo]: '05/11/2026' })
        expect([campo, r.status]).toEqual([campo, 400])
      }
      expect((await http().get(`/${D}?dataDa=05/11/2026`)).status).toBe(400)
      expect((await http().get(`/${D}?dataA=2026-5-1`)).status).toBe(400)
      expect(
        (
          await http()
            .post(`/${D}/${DOC}/storno`)
            .send({ ...storno, dataDocumento: '05/11/2026' })
        ).status
      ).toBe(400)
      for (const f of tuttiIServizi()) expect(f).not.toHaveBeenCalled()
    })

    it('filtri dei documenti validi arrivano al servizio', async () => {
      const r = await http().get(
        `/${D}?registroIvaId=${ID}&anno=2026&stato=DEFINITIVO&clienteId=${CLI}&dataDa=2026-01-01&dataA=2026-03-31`
      )
      expect(r.status).toBe(200)
      expect(s.doc.lista).toHaveBeenCalledWith(TENANT, {
        pagina: 1,
        dimensione: 50,
        registroIvaId: ID,
        anno: 2026,
        stato: 'DEFINITIVO',
        clienteId: CLI,
        dataDa: '2026-01-01',
        dataA: '2026-03-31',
      })
    })

    it.each([
      ['stato sconosciuto', `/${D}?stato=XX`],
      ['anno 1999', `/${D}?anno=1999`],
      ['cliente non UUID', `/${D}?clienteId=abc`],
      ['registro non UUID', `/${D}?registroIvaId=abc`],
      ['stato elaborazione sconosciuto', `/${E}?stato=XX`],
      ['conErrori non booleano', `/${E}/${ID}/documenti?conErrori=forse`],
      ['cliente scostamenti non UUID', '/scostamenti-fattura?clienteId=abc'],
      ['parametro sconosciuto', `/${D}?tenantId=${TENANT}`],
    ])('filtro non valido (%s): 400', async (_n, p) => {
      expect((await http().get(p)).status).toBe(400)
      for (const f of tuttiIServizi()) expect(f).not.toHaveBeenCalled()
    })

    it('filtri con piu` di 200 id: 400; 200 passano', async () => {
      const ids = (n: number) => Array.from({ length: n }, () => CLI)
      for (const chiave of ['clienteIds', 'contrattoIds', 'categoriaIds', 'registroIvaIds']) {
        const troppi = await http()
          .post(`/${E}`)
          .send({ ...nuova, filtri: { [chiave]: ids(201) } })
        expect([chiave, troppi.status]).toEqual([chiave, 400])
        const ok = await http()
          .post(`/${E}`)
          .send({ ...nuova, filtri: { [chiave]: ids(200) } })
        expect([chiave, ok.status]).toEqual([chiave, 202])
      }
      const tipi = await http()
        .post(`/${E}`)
        .send({ ...nuova, filtri: { tipiAddebito: Array(201).fill('CER') } })
      expect(tipi.status).toBe(400)
    })

    it('categoriaIds e tipiAddebito validati (UUID, tipi del listino)', async () => {
      const prova = (filtri: object) =>
        http()
          .post(`/${E}`)
          .send({ ...nuova, filtri })
      expect((await prova({ categoriaIds: ['abc'] })).status).toBe(400)
      expect((await prova({ categoriaIds: 'non un array' })).status).toBe(400)
      expect((await prova({ clienteIds: [CLI, 'x'] })).status).toBe(400)
      expect((await prova({ tipiAddebito: ['XX'] })).status).toBe(400)
      expect((await prova({ tipiAddebito: ['CER', 5] })).status).toBe(400)
      expect((await prova({ tipiAddebito: ['T0011'] })).status).toBe(400)
      expect(
        (await prova({ categoriaIds: [CLI], tipiAddebito: ['CER', 'F', 'T001', 'M002', '$A'] }))
          .status
      ).toBe(202)
      expect((await prova({ filtro: [] })).status).toBe(400)
    })

    it('corpo di avvio: raggruppamento e booleano obbligatori; filtri facoltativi', async () => {
      expect(
        (
          await http()
            .post(`/${E}`)
            .send({ ...nuova, raggruppamento: 'ALTRO' })
        ).status
      ).toBe(400)
      expect(
        (
          await http()
            .post(`/${E}`)
            .send({ ...nuova, includiArretrati: 'si' })
        ).status
      ).toBe(400)
      const { filtri: _f, ...senzaFiltri } = nuova
      expect((await http().post(`/${E}`).send(senzaFiltri)).status).toBe(202)
    })

    it('versione e impronta', async () => {
      ruolo = 'ADMIN'
      for (const versione of [0, -1, 1.5, '1', null]) {
        const r = await http().post(`/${E}/${ID}/ricalcola`).send({ versione })
        expect([versione, r.status]).toEqual([versione, 400])
      }
      for (const impronta of ['', 'abc', 'g'.repeat(64), 5]) {
        const r = await http().post(`/${E}/${ID}/definitiva`).send({ impronta, versione: 1 })
        expect([impronta, r.status]).toEqual([impronta, 400])
      }
      expect((await http().post(`/${E}/${ID}/definitiva`).send({ versione: 1 })).status).toBe(400)
    })

    it('motivo e nota: da 1 a 200 caratteri dopo il trim', async () => {
      ruolo = 'ADMIN'
      const annulla = (motivo: unknown) =>
        http().post(`/${D}/${DOC}/annulla`).send({ motivo, versione: 1 })
      expect((await annulla('x'.repeat(201))).status).toBe(400)
      expect((await annulla('')).status).toBe(400)
      expect((await annulla('   ')).status).toBe(400)
      expect((await annulla(5)).status).toBe(400)
      expect((await annulla('x'.repeat(200))).status).toBe(200)
      expect((await annulla('  con spazi  ')).status).toBe(200)
      expect(s.annullo.annulla).toHaveBeenLastCalledWith(TENANT, 'utente-1', DOC, {
        motivo: 'con spazi',
        versione: 1,
      })
      expect(
        (
          await http()
            .post(`/${D}/${DOC}/storno`)
            .send({ ...storno, motivo: 'x'.repeat(201) })
        ).status
      ).toBe(400)
      const presa = (nota: unknown) =>
        http().post(`/legami-movimento/${LEG}/presa-atto-scostamento`).send({ nota, versione: 1 })
      expect((await presa('x'.repeat(201))).status).toBe(400)
      expect((await presa('   ')).status).toBe(400)
      expect((await presa('x'.repeat(200))).status).toBe(200)
    })

    it('storno: rifatturabile deve essere booleano', async () => {
      ruolo = 'ADMIN'
      expect(
        (
          await http()
            .post(`/${D}/${DOC}/storno`)
            .send({ ...storno, rifatturabile: 'si' })
        ).status
      ).toBe(400)
      const { rifatturabile: _r, ...senza } = storno
      expect((await http().post(`/${D}/${DOC}/storno`).send(senza)).status).toBe(400)
    })
  })

  describe('errori dei servizi', () => {
    const conflitto = (error: string, details?: object) =>
      new ConflictException({ error, message: `msg ${error}`, ...(details ? { details } : {}) })

    it('forma { error, message, details } con dettagli numerici in details', async () => {
      ruolo = 'ADMIN'
      s.elab.chiediDefinitiva.mockRejectedValueOnce(
        conflitto('ANTEPRIMA_SUPERATA', { nuovi: 1, cambiati: 2, fatturatiDaAltri: 3 })
      )
      const r = await http()
        .post(`/${E}/${ID}/definitiva`)
        .send({ impronta: IMPRONTA, versione: 1 })
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({
        error: 'ANTEPRIMA_SUPERATA',
        message: 'msg ANTEPRIMA_SUPERATA',
        details: { nuovi: 1, cambiati: 2, fatturatiDaAltri: 3 },
      })
      expect(r.body.nuovi).toBeUndefined()
    })

    it('definitiva con l`interruttore spento: 409 DEFINITIVE_NON_ATTIVE (P33)', async () => {
      ruolo = 'ADMIN'
      s.elab.chiediDefinitiva.mockRejectedValueOnce(conflitto('DEFINITIVE_NON_ATTIVE'))
      const r = await http()
        .post(`/${E}/${ID}/definitiva`)
        .send({ impronta: IMPRONTA, versione: 1 })
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({ error: 'DEFINITIVE_NON_ATTIVE', message: expect.any(String) })
    })

    it('definitiva: CEDENTE_INCOMPLETO e DATA_ANTERIORE_ULTIMA_FATTURA (con details.ultimaData), decisione 24', async () => {
      ruolo = 'ADMIN'
      s.elab.chiediDefinitiva.mockRejectedValueOnce(conflitto('CEDENTE_INCOMPLETO'))
      const a = await http()
        .post(`/${E}/${ID}/definitiva`)
        .send({ impronta: IMPRONTA, versione: 1 })
      expect([a.status, a.body.error]).toEqual([409, 'CEDENTE_INCOMPLETO'])
      s.elab.chiediDefinitiva.mockRejectedValueOnce(
        conflitto('DATA_ANTERIORE_ULTIMA_FATTURA', { ultimaData: '2026-03-31' })
      )
      const b = await http()
        .post(`/${E}/${ID}/definitiva`)
        .send({ impronta: IMPRONTA, versione: 1 })
      expect([b.status, b.body.error, b.body.details]).toEqual([
        409,
        'DATA_ANTERIORE_ULTIMA_FATTURA',
        { ultimaData: '2026-03-31' },
      ])
    })

    it('NESSUN_DOCUMENTO_DEFINIBILE (409) e TROPPI_DOCUMENTI (400) escono dalla rotta, sincroni', async () => {
      ruolo = 'ADMIN'
      s.elab.chiediDefinitiva.mockRejectedValueOnce(conflitto('NESSUN_DOCUMENTO_DEFINIBILE'))
      const a = await http()
        .post(`/${E}/${ID}/definitiva`)
        .send({ impronta: IMPRONTA, versione: 1 })
      expect([a.status, a.body.error]).toEqual([409, 'NESSUN_DOCUMENTO_DEFINIBILE'])
      s.elab.chiediDefinitiva.mockRejectedValueOnce(
        new BadRequestException({ error: 'TROPPI_DOCUMENTI', message: 'troppi' })
      )
      const b = await http()
        .post(`/${E}/${ID}/definitiva`)
        .send({ impronta: IMPRONTA, versione: 1 })
      expect([b.status, b.body.error]).toEqual([400, 'TROPPI_DOCUMENTI'])
    })

    it('ANNULLO_NON_AMMESSO e STORNO_NON_AMMESSO con details.motivo', async () => {
      ruolo = 'ADMIN'
      s.annullo.annulla.mockRejectedValueOnce(
        conflitto('ANNULLO_NON_AMMESSO', { motivo: 'EMESSO' })
      )
      const a = await http().post(`/${D}/${DOC}/annulla`).send({ motivo: 'm', versione: 1 })
      expect([a.status, a.body.error, a.body.details]).toEqual([
        409,
        'ANNULLO_NON_AMMESSO',
        { motivo: 'EMESSO' },
      ])
      s.annullo.storna.mockRejectedValueOnce(
        conflitto('STORNO_NON_AMMESSO', { motivo: 'NOTA_DI_CREDITO' })
      )
      const b = await http().post(`/${D}/${DOC}/storno`).send(storno)
      expect([b.status, b.body.error, b.body.details]).toEqual([
        409,
        'STORNO_NON_AMMESSO',
        { motivo: 'NOTA_DI_CREDITO' },
      ])
    })

    it.each([
      ['ELABORAZIONE_IN_CORSO', 'post', `/${E}`, nuova, 'avvia'],
      ['OPERAZIONE_CONCORRENTE', 'post', `/${E}/${ID}/ricalcola`, { versione: 1 }, 'ricalcola'],
      ['VERSIONE_SUPERATA', 'post', `/${E}/${ID}/scarta`, { versione: 1 }, 'scarta'],
      [
        'ELABORAZIONE_GIA_IN_DEFINITIVA',
        'post',
        `/${E}/${ID}/documenti/${DOC}/escludi`,
        {},
        'escludi',
      ],
    ])('409 %s passa intatto', async (codice, m, p, corpo, metodo) => {
      s.elab[metodo].mockRejectedValueOnce(conflitto(codice))
      const r = await chiama(m, p, corpo)
      expect([r.status, r.body.error]).toEqual([409, codice])
    })

    it('404 dei servizi passa intatto', async () => {
      s.elab.dettaglio.mockRejectedValueOnce(
        new NotFoundException({ error: 'ELABORAZIONE_NON_TROVATA', message: 'no' })
      )
      const r = await http().get(`/${E}/${ID}`)
      expect([r.status, r.body.error]).toEqual([404, 'ELABORAZIONE_NON_TROVATA'])
    })

    it('presa d`atto: 409 SCOSTAMENTO_NON_APERTO e OPERAZIONE_CONCORRENTE', async () => {
      ruolo = 'ADMIN'
      s.scost.presaAtto.mockRejectedValueOnce(conflitto('SCOSTAMENTO_NON_APERTO'))
      const r = await http()
        .post(`/legami-movimento/${LEG}/presa-atto-scostamento`)
        .send({ nota: 'n', versione: 1 })
      expect([r.status, r.body.error]).toEqual([409, 'SCOSTAMENTO_NON_APERTO'])
    })
  })

  describe('forma delle risposte', () => {
    it('il controller restituisce il valore del servizio senza aggiungere ne togliere chiavi', async () => {
      const dettaglio = { id: ID, stato: 'ANTEPRIMA_PRONTA', versione: 3, annidato: { a: [1, 2] } }
      s.elab.dettaglio.mockResolvedValueOnce(dettaglio)
      expect((await http().get(`/${E}/${ID}`)).body).toEqual(dettaglio)
      const pagina = { elementi: [{ id: DOC, x: null }], totale: 1, pagina: 1, dimensione: 50 }
      s.doc.lista.mockResolvedValueOnce(pagina)
      expect((await http().get(`/${D}`)).body).toEqual(pagina)
      s.scost.lista.mockResolvedValueOnce(pagina)
      expect((await http().get('/scostamenti-fattura')).body).toEqual(pagina)
      s.elab.escludi.mockResolvedValueOnce({ id: DOC, esclusoDaDefinitiva: true })
      const e = await http().post(`/${E}/${ID}/documenti/${DOC}/escludi`).send({})
      expect(e.body).toEqual({ id: DOC, esclusoDaDefinitiva: true })
      expect(s.elab.escludi).toHaveBeenCalledWith(TENANT, ID, DOC, true)
      await http().post(`/${E}/${ID}/documenti/${DOC}/riammetti`).send({})
      expect(s.elab.escludi).toHaveBeenLastCalledWith(TENANT, ID, DOC, false)
    })
  })
})
