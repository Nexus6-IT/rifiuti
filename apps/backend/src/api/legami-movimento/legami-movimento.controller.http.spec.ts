/**
 * Controller dei legami movimento (4.3b, Task 22) con pipe, guard dei ruoli e filtro reali e
 * servizi finti: validazione dei DTO, UUID, azienda selezionata, ruoli per rotta (VIEWER solo
 * lettura, OPERATOR scrive i legami, solo ADMIN e SUPER_ADMIN aggiornano i prezzi), formato degli
 * errori (R36/R60) e passaggio intatto dei codici 404/409 dei servizi.
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
import { AggiornaPrezziService } from '../../application/legami-movimento/aggiorna-prezzi.service'
import { AzioniMassaService } from '../../application/legami-movimento/azioni-massa.service'
import { LegamiService } from '../../application/legami-movimento/conferma-legame.service'
import { ListaLegamiService } from '../../application/legami-movimento/lista-legami.service'
import { PropostaLegameService } from '../../application/legami-movimento/proposta-legame.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { LegamiMovimentoController } from './legami-movimento.controller'
import { MovimentoLegameController } from './movimento-legame.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'
const MOV = '7e7e7e7e-0000-4000-8000-000000000005'
const RIGA = '7e7e7e7e-0000-4000-8000-000000000006'
const CONTRATTO = '7e7e7e7e-0000-4000-8000-000000000007'
const L = 'legami-movimento'

interface Servizi {
  proposta: Record<string, jest.Mock>
  legami: Record<string, jest.Mock>
  lista: Record<string, jest.Mock>
  prezzi: Record<string, jest.Mock>
  massa: Record<string, jest.Mock>
}

function servizi(): Servizi {
  return {
    proposta: { calcola: jest.fn().mockResolvedValue({ stato: 'PROPOSTO' }) },
    legami: {
      dettaglio: jest.fn().mockResolvedValue({ id: ID }),
      perMovimento: jest.fn().mockResolvedValue({ id: ID }),
      modifica: jest.fn().mockResolvedValue({ id: ID }),
      conferma: jest.fn().mockResolvedValue({ id: ID }),
      escludi: jest.fn().mockResolvedValue({ id: ID }),
      riammetti: jest.fn().mockResolvedValue({ id: ID }),
    },
    lista: {
      lista: jest.fn().mockResolvedValue({ elementi: [], totale: 0 }),
      contatori: jest
        .fn()
        .mockResolvedValue({ daCollegare: 0, proposti: 0, mancanti: 0, daRiallineare: 0 }),
    },
    prezzi: {
      anteprima: jest.fn().mockResolvedValue({ firma: 'f', cambiano: 0 }),
      applica: jest.fn().mockResolvedValue({ aggiornati: 0, saltati: 0 }),
    },
    massa: {
      esegui: jest.fn().mockResolvedValue({ riusciti: 1, falliti: [] }),
      daMovimento: jest.fn().mockResolvedValue({ id: ID }),
    },
  }
}

async function creaApp(s: Servizi, ruolo: () => string, accesso: jest.Mock = jest.fn()) {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const moduleRef = await Test.createTestingModule({
    controllers: [LegamiMovimentoController, MovimentoLegameController],
    providers: [
      { provide: PropostaLegameService, useValue: s.proposta },
      { provide: LegamiService, useValue: s.legami },
      { provide: ListaLegamiService, useValue: s.lista },
      { provide: AggiornaPrezziService, useValue: s.prezzi },
      { provide: AzioniMassaService, useValue: s.massa },
      { provide: RuoloEffettivoService, useValue: { accesso } },
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

describe('Legami movimento: API (HTTP con servizi finti)', () => {
  let app: INestApplication
  let s: Servizi
  let ruolo = 'OPERATOR'
  let accesso: jest.Mock

  beforeEach(async () => {
    ruolo = 'OPERATOR'
    accesso = jest.fn()
    s = servizi()
    app = await creaApp(s, () => ruolo, accesso)
  })

  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())
  const proposta = {
    causale: 'INGRESSO_ESTERNO',
    type: 'CARICO',
    cerCode: '20 03 01',
    movementDate: '2026-03-01',
    unit: 'KG',
    quantity: '100.5',
  }

  describe('ruoli', () => {
    /** Una chiamata per ogni rotta dei due controller: [nome, metodo, percorso, corpo]. */
    const LETTURE: [string, string, string, object?][] = [
      ['proposta', 'post', `/${L}/proposta`, proposta],
      ['lista', 'get', `/${L}`, undefined],
      ['contatori', 'get', `/${L}/contatori`, undefined],
      ['dettaglio', 'get', `/${L}/${ID}`, undefined],
      ['legame del movimento', 'get', `/registro/movimenti/${MOV}/legame`, undefined],
    ]
    const SCRITTURE: [string, string, string, object?][] = [
      ['modifica', 'put', `/${L}/${ID}`, { versione: 1 }],
      ['conferma', 'post', `/${L}/${ID}/conferma`, { versione: 1 }],
      ['escludi', 'post', `/${L}/${ID}/escludi`, { versione: 1, motivo: 'Non fatturare' }],
      ['riammetti', 'post', `/${L}/${ID}/riammetti`, { versione: 1 }],
      [
        'azioni',
        'post',
        `/${L}/azioni`,
        { azione: 'CONFERMA', elementi: [{ legameId: ID, versione: 1 }] },
      ],
      ['da-movimento', 'post', `/${L}/da-movimento/${MOV}`, {}],
    ]
    const PREZZI: [string, string, string, object?][] = [
      [
        'anteprima prezzi',
        'post',
        `/${L}/aggiorna-prezzi`,
        { perimetro: { contrattoId: CONTRATTO } },
      ],
      [
        'applica prezzi',
        'post',
        `/${L}/aggiorna-prezzi`,
        { perimetro: { contrattoId: CONTRATTO }, firma: 'abc' },
      ],
    ]
    const chiama = (m: string, p: string, corpo?: object) => {
      const r = (http() as any)[m](p)
      return corpo === undefined ? r : r.send(corpo)
    }

    it.each(LETTURE)('VIEWER: %s e` consentita (200)', async (_n, m, p, corpo) => {
      ruolo = 'VIEWER'
      expect((await chiama(m, p, corpo)).status).toBe(200)
    })

    it.each([...SCRITTURE, ...PREZZI])('VIEWER: %s e` vietata (403)', async (_n, m, p, corpo) => {
      ruolo = 'VIEWER'
      expect((await chiama(m, p, corpo)).status).toBe(403)
      for (const gruppo of [s.legami, s.massa, s.prezzi]) {
        for (const f of Object.values(gruppo)) {
          if (f !== s.legami.dettaglio && f !== s.legami.perMovimento) {
            expect(f).not.toHaveBeenCalled()
          }
        }
      }
    })

    it.each(SCRITTURE)('OPERATOR: %s scrive (200)', async (_n, m, p, corpo) => {
      expect((await chiama(m, p, corpo)).status).toBe(200)
    })

    it.each(PREZZI)('OPERATOR: %s e` vietata (403)', async (_n, m, p, corpo) => {
      expect((await chiama(m, p, corpo)).status).toBe(403)
      expect(s.prezzi.anteprima).not.toHaveBeenCalled()
      expect(s.prezzi.applica).not.toHaveBeenCalled()
    })

    it.each(['ADMIN', 'SUPER_ADMIN'])('%s: legge, scrive e aggiorna i prezzi (200)', async r => {
      ruolo = r
      for (const [, m, p, corpo] of [...LETTURE, ...SCRITTURE, ...PREZZI]) {
        const risposta = await chiama(m, p, corpo)
        expect([p, risposta.status]).toEqual([p, 200])
      }
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get(`/${L}/${ID}`).set('x-senza-azienda', '1')).status).toBe(403)
      expect(s.legami.dettaglio).not.toHaveBeenCalled()
    })
  })

  describe('ruolo effettivo nell`azienda selezionata (m6)', () => {
    const ALTRA = '9b9b9b9b-0000-4000-8000-000000000009'

    it('ADMIN nel token ma VIEWER nell`azienda selezionata: 403 sulle scritture, 200 sulle letture', async () => {
      ruolo = 'ADMIN'
      accesso.mockResolvedValue('VIEWER')
      const h = (r: request.Test) => r.set('x-tenant-id', ALTRA)
      const scritture: (() => request.Test)[] = [
        () => h(http().put(`/${L}/${ID}`).send({ versione: 1 })),
        () => h(http().post(`/${L}/${ID}/conferma`).send({ versione: 1 })),
        () => h(http().post(`/${L}/${ID}/escludi`).send({ versione: 1, motivo: 'm' })),
        () => h(http().post(`/${L}/${ID}/riammetti`).send({ versione: 1 })),
        () =>
          h(
            http()
              .post(`/${L}/azioni`)
              .send({ azione: 'CONFERMA', movimentoIds: [MOV] })
          ),
        () => h(http().post(`/${L}/da-movimento/${MOV}`).send({})),
        () =>
          h(
            http()
              .post(`/${L}/aggiorna-prezzi`)
              .send({ perimetro: { contrattoId: CONTRATTO } })
          ),
      ]
      const stati: number[] = []
      for (const r of scritture) stati.push((await r()).status)
      expect(stati).toEqual(Array(7).fill(403))
      expect(accesso).toHaveBeenCalled()
      for (const g of [s.legami, s.massa, s.prezzi]) {
        for (const f of Object.values(g)) {
          if (f !== s.legami.dettaglio && f !== s.legami.perMovimento) {
            expect(f).not.toHaveBeenCalled()
          }
        }
      }
      expect((await h(http().get(`/${L}/${ID}`))).status).toBe(200)
    })
  })

  describe('messaggi dei DTO annidati (m1)', () => {
    it('riga sbagliata: «Riga N: ...» in italiano, senza il percorso tecnico', async () => {
      const r = await http()
        .put(`/${L}/${ID}`)
        .send({
          versione: 1,
          righe: [{ rigaAddebitoId: RIGA }, { rigaAddebitoId: RIGA, prezzo: '12,5' }],
        })
      expect(r.status).toBe(400)
      const testo = JSON.stringify(r.body)
      expect(testo).toMatch(/Riga 2: Prezzo/)
      expect(testo).not.toMatch(/righe\.\d/)
    })

    it('modifiche della conferma, scelte della proposta, elementi di massa, perimetro', async () => {
      const casi: [object, RegExp][] = [
        [
          { versione: 1, modifiche: { righe: [{ rigaAddebitoId: RIGA, quantita: '0' }] } },
          /Riga 1: Quantità/,
        ],
      ]
      const r1 = await http().post(`/${L}/${ID}/conferma`).send(casi[0][0])
      expect(JSON.stringify(r1.body)).toMatch(casi[0][1])
      const r2 = await http()
        .post(`/${L}/proposta`)
        .send({ ...proposta, scelte: { righe: [{ rigaAddebitoId: 'x' }] } })
      expect(JSON.stringify(r2.body)).toMatch(/Riga 1: La riga non è valida/)
      expect(JSON.stringify(r2.body)).not.toMatch(/scelte\./)
      const r3 = await http()
        .post(`/${L}/azioni`)
        .send({ azione: 'CONFERMA', elementi: [{ legameId: ID, versione: 'x' }] })
      expect(JSON.stringify(r3.body)).toMatch(/Elemento 1: La versione/)
      ruolo = 'ADMIN'
      const r4 = await http()
        .post(`/${L}/aggiorna-prezzi`)
        .send({ perimetro: { contrattoId: 'x' } })
      expect(JSON.stringify(r4.body)).toMatch(/Il contratto non è valido/)
      expect(JSON.stringify(r4.body)).not.toMatch(/perimetro\./)
    })
  })

  describe('azienda e utente', () => {
    it('l`azienda e` quella selezionata nella richiesta, mai quella del token o del corpo', async () => {
      await http().get(`/${L}/${ID}`)
      expect(s.legami.dettaglio).toHaveBeenCalledWith(TENANT, ID)
      await http().put(`/${L}/${ID}`).send({ versione: 3, clienteId: CONTRATTO })
      expect(s.legami.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3, {
        clienteId: CONTRATTO,
      })
      const r = await http().post(`/${L}/${ID}/conferma`).send({ versione: 1, tenantId: 'altro' })
      expect(r.status).toBe(400)
      expect(s.legami.conferma).not.toHaveBeenCalled()
    })
  })

  describe('POST proposta', () => {
    it('mappa il corpo sul servizio: scelte.righe -> righeIds, sola lettura', async () => {
      const r = await http()
        .post(`/${L}/proposta`)
        .send({
          ...proposta,
          causaleAziendaId: ID,
          firId: MOV,
          producerSedeId: RIGA,
          scelte: { clienteId: ID, contrattoId: CONTRATTO, righe: [{ rigaAddebitoId: RIGA }] },
        })
      expect(r.status).toBe(200)
      expect(s.proposta.calcola).toHaveBeenCalledWith(
        TENANT,
        {
          causale: 'INGRESSO_ESTERNO',
          causaleAziendaId: ID,
          type: 'CARICO',
          cerCode: '20 03 01',
          movementDate: '2026-03-01',
          unit: 'KG',
          quantity: '100.5',
          firId: MOV,
          producerSedeId: RIGA,
        },
        { clienteId: ID, contrattoId: CONTRATTO, righeIds: [RIGA] }
      )
    })

    it('senza scelte: scelte vuote', async () => {
      await http().post(`/${L}/proposta`).send(proposta)
      expect(s.proposta.calcola.mock.calls[0][2]).toEqual({})
    })

    it.each([
      ['type assente', { type: undefined }],
      ['type sconosciuto', { type: 'TRASFERIMENTO' }],
      ['quantity numero JSON', { quantity: 100 }],
      ['quantity con la virgola', { quantity: '1,5' }],
      ['quantity negativa', { quantity: '-1' }],
      ['quantity in notazione esponenziale', { quantity: '1e3' }],
      ['causale assente', { causale: undefined }],
      ['movementDate non valida', { movementDate: 'ieri' }],
      ['firId non UUID', { firId: 'x' }],
      ['scelte.righe oltre 100', { scelte: { righe: Array(101).fill({ rigaAddebitoId: RIGA }) } }],
      ['scelte con campo extra', { scelte: { tenantId: 'x' } }],
    ])('%s: 400 col nome del campo', async (_n, delta) => {
      const r = await http()
        .post(`/${L}/proposta`)
        .send({ ...proposta, ...delta })
      expect(r.status).toBe(400)
      expect(s.proposta.calcola).not.toHaveBeenCalled()
    })

    it('accetta firId e producerSedeId nulli', async () => {
      const r = await http()
        .post(`/${L}/proposta`)
        .send({ ...proposta, firId: null, producerSedeId: null })
      expect(r.status).toBe(200)
    })

    it('FIR di un`altra azienda: il 404 FIR_NON_TROVATO del servizio arriva intatto', async () => {
      s.proposta.calcola.mockRejectedValue(
        new NotFoundException({ error: 'FIR_NON_TROVATO', message: 'FIR non trovato.' })
      )
      const r = await http().post(`/${L}/proposta`).send(proposta)
      expect(r.status).toBe(404)
      expect(r.body).toMatchObject({ error: 'FIR_NON_TROVATO' })
    })
  })

  describe('GET lista e contatori', () => {
    it('contatori non e` scambiata per un :id', async () => {
      const r = await http().get(`/${L}/contatori`)
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ daCollegare: 0, proposti: 0, mancanti: 0, daRiallineare: 0 })
      expect(s.lista.contatori).toHaveBeenCalledWith(TENANT)
      expect(s.legami.dettaglio).not.toHaveBeenCalled()
    })

    it('?dimensione=50&esclusi=true: i valori della query string arrivano al servizio', async () => {
      const r = await http().get(`/${L}?dimensione=50&esclusi=true&pagina=2&stato=PROPOSTO`)
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ elementi: [], totale: 0 })
      expect(s.lista.lista).toHaveBeenCalledWith(TENANT, {
        dimensione: '50',
        esclusi: 'true',
        pagina: '2',
        stato: 'PROPOSTO',
      })
    })

    it('filtri completi del FE e `stati` separati da virgola', async () => {
      const q = `clienteId=${ID}&registroId=${MOV}&motivo=SENZA_PREZZO&dal=2026-01-01&al=2026-02-01&stati=PROPOSTO,MANCANTE`
      expect((await http().get(`/${L}?${q}`)).status).toBe(200)
      expect(s.lista.lista).toHaveBeenCalledWith(TENANT, {
        clienteId: ID,
        registroId: MOV,
        motivo: 'SENZA_PREZZO',
        dal: '2026-01-01',
        al: '2026-02-01',
        stati: 'PROPOSTO,MANCANTE',
      })
    })

    it('`stati` ripetuto in query e` accettato come lista (m2)', async () => {
      const r = await http().get(`/${L}?stati=PROPOSTO&stati=MANCANTE`)
      expect(r.status).toBe(200)
      expect(s.lista.lista).toHaveBeenCalledWith(TENANT, { stati: 'PROPOSTO,MANCANTE' })
    })

    it('`esclusi` accetta solo true o false, altrimenti 400 col nome del campo (m3)', async () => {
      for (const v of ['true', 'false']) {
        expect((await http().get(`/${L}?esclusi=${v}`)).status).toBe(200)
      }
      for (const v of ['1', 'si', 'TRUE', '']) {
        const r = await http().get(`/${L}?esclusi=${v}`)
        expect([v, r.status]).toEqual([v, 400])
        expect(JSON.stringify(r.body)).toMatch(/esclusi/)
      }
    })

    it('senza filtri: oggetto vuoto; parametro sconosciuto: 400', async () => {
      await http().get(`/${L}`)
      expect(s.lista.lista).toHaveBeenCalledWith(TENANT, {})
      expect((await http().get(`/${L}?azienda=x`)).status).toBe(400)
    })

    it('il 400 FILTRI_LISTA_NON_VALIDI del servizio arriva intatto', async () => {
      s.lista.lista.mockRejectedValue(
        new BadRequestException({ error: 'FILTRI_LISTA_NON_VALIDI', message: 'Pagina non valida.' })
      )
      const r = await http().get(`/${L}?dimensione=0`)
      expect(r.status).toBe(400)
      expect(r.body).toMatchObject({ error: 'FILTRI_LISTA_NON_VALIDI' })
    })
  })

  describe('letture per id', () => {
    it('GET :id e GET movimento/:id/legame usano l`azienda selezionata', async () => {
      expect((await http().get(`/registro/movimenti/${MOV}/legame`)).status).toBe(200)
      expect(s.legami.perMovimento).toHaveBeenCalledWith(TENANT, MOV)
    })

    it('404 LEGAME_MOVIMENTO_NON_TROVATO passa intatto (nessun legame per la catena)', async () => {
      s.legami.perMovimento.mockRejectedValue(
        new NotFoundException({
          error: 'LEGAME_MOVIMENTO_NON_TROVATO',
          message: 'Legame non trovato.',
        })
      )
      const r = await http().get(`/registro/movimenti/${MOV}/legame`)
      expect(r.status).toBe(404)
      expect(r.body).toMatchObject({ error: 'LEGAME_MOVIMENTO_NON_TROVATO' })
    })

    it('id non UUID: 400 su tutte le rotte con id', async () => {
      const x = 'non-un-uuid'
      const risposte = [
        await http().get(`/${L}/${x}`),
        await http().get(`/registro/movimenti/${x}/legame`),
        await http().put(`/${L}/${x}`).send({ versione: 1 }),
        await http().post(`/${L}/${x}/conferma`).send({ versione: 1 }),
        await http().post(`/${L}/${x}/escludi`).send({ versione: 1, motivo: 'm' }),
        await http().post(`/${L}/${x}/riammetti`).send({ versione: 1 }),
        await http().post(`/${L}/da-movimento/${x}`).send({}),
      ]
      expect(risposte.map(r => r.status)).toEqual(Array(7).fill(400))
    })
  })

  describe('PUT :id (modifica)', () => {
    const riga = (r: object) => ({ versione: 2, righe: [{ rigaAddebitoId: RIGA, ...r }] })

    it('passa versione e modifiche separate; tutti i valori come stringhe col punto', async () => {
      const r = await http()
        .put(`/${L}/${ID}`)
        .send({
          versione: 2,
          clienteId: ID,
          contrattoId: CONTRATTO,
          elencoId: MOV,
          righe: [
            { rigaAddebitoId: RIGA, quantita: '12.5', prezzo: '3.123456', sconto: '10+5' },
            { rigaAddebitoId: MOV, rimuovi: true },
            { rigaAddebitoId: CONTRATTO, quantita: null, sconto: null },
          ],
        })
      expect(r.status).toBe(200)
      expect(s.legami.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 2, {
        clienteId: ID,
        contrattoId: CONTRATTO,
        elencoId: MOV,
        righe: [
          { rigaAddebitoId: RIGA, quantita: '12.5', prezzo: '3.123456', sconto: '10+5' },
          { rigaAddebitoId: MOV, rimuovi: true },
          { rigaAddebitoId: CONTRATTO, quantita: null, sconto: null },
        ],
      })
    })

    it('OPERATOR e ADMIN modificano prezzo e sconto', async () => {
      for (const r of ['OPERATOR', 'ADMIN']) {
        ruolo = r
        expect(
          (
            await http()
              .put(`/${L}/${ID}`)
              .send(riga({ prezzo: '2', sconto: '5' }))
          ).status
        ).toBe(200)
      }
    })

    it('sconto con la virgola ("10,5"): 200, la formula e` del dominio (M7)', async () => {
      expect(
        (
          await http()
            .put(`/${L}/${ID}`)
            .send(riga({ sconto: '10,5' }))
        ).status
      ).toBe(200)
    })

    it.each([
      ['quantita numero JSON', { quantita: 12 }],
      ['quantita "0"', { quantita: '0' }],
      ['quantita "0.000"', { quantita: '0.000' }],
      ['quantita negativa', { quantita: '-1' }],
      ['quantita oltre 3 decimali', { quantita: '1.0001' }],
      ['quantita con la virgola', { quantita: '1,5' }],
      ['quantita vuota', { quantita: '' }],
      ['prezzo numero JSON', { prezzo: 12.5 }],
      ['prezzo con la virgola', { prezzo: '12,5' }],
      ['prezzo negativo', { prezzo: '-0.5' }],
      ['prezzo oltre 6 decimali', { prezzo: '1.1234567' }],
      ['sconto numero JSON', { sconto: 10 }],
      ['sconto formula non valida', { sconto: 'abc' }],
      ['rimuovi testo', { rimuovi: 'true' }],
      ['campo extra', { importo: '1' }],
    ])('%s: 400 dal DTO', async (_n, r) => {
      const res = await http().put(`/${L}/${ID}`).send(riga(r))
      expect(res.status).toBe(400)
      expect(s.legami.modifica).not.toHaveBeenCalled()
    })

    it('il 400 del DTO ha il campo nel messaggio', async () => {
      const res = await http()
        .put(`/${L}/${ID}`)
        .send(riga({ prezzo: '12,5' }))
      expect(JSON.stringify(res.body)).toMatch(/[Pp]rezzo/)
    })

    it('prezzo "0" e quantita "0.001" validi', async () => {
      expect(
        (
          await http()
            .put(`/${L}/${ID}`)
            .send(riga({ prezzo: '0', quantita: '0.001' }))
        ).status
      ).toBe(200)
    })

    it('riga senza rigaAddebitoId o con id non UUID: 400', async () => {
      expect(
        (
          await http()
            .put(`/${L}/${ID}`)
            .send({ versione: 1, righe: [{ prezzo: '1' }] })
        ).status
      ).toBe(400)
      expect(
        (
          await http()
            .put(`/${L}/${ID}`)
            .send({ versione: 1, righe: [{ rigaAddebitoId: 'x' }] })
        ).status
      ).toBe(400)
    })

    it('oltre 100 righe: 400; 100: 200', async () => {
      const righe = (n: number) => Array.from({ length: n }, () => ({ rigaAddebitoId: RIGA }))
      expect(
        (
          await http()
            .put(`/${L}/${ID}`)
            .send({ versione: 1, righe: righe(101) })
        ).status
      ).toBe(400)
      expect(
        (
          await http()
            .put(`/${L}/${ID}`)
            .send({ versione: 1, righe: righe(100) })
        ).status
      ).toBe(200)
    })

    it.each([
      ['senza versione', {}],
      ['versione testo', { versione: '1' }],
      ['versione 0', { versione: 0 }],
      ['versione decimale', { versione: 1.5 }],
      ['clienteId non UUID', { versione: 1, clienteId: 'x' }],
    ])('%s: 400', async (_n, corpo) => {
      expect((await http().put(`/${L}/${ID}`).send(corpo)).status).toBe(400)
      expect(s.legami.modifica).not.toHaveBeenCalled()
    })

    it('i 409 VERSIONE_SUPERATA e STATO_LEGAME_NON_AMMESSO passano intatti', async () => {
      for (const codice of ['VERSIONE_SUPERATA', 'STATO_LEGAME_NON_AMMESSO']) {
        s.legami.modifica.mockRejectedValueOnce(
          new ConflictException({ error: codice, message: 'm' })
        )
        const r = await http().put(`/${L}/${ID}`).send({ versione: 1 })
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ error: codice })
      }
    })
  })

  describe('POST conferma, escludi, riammetti', () => {
    it('conferma: versione e modifiche opzionali', async () => {
      await http().post(`/${L}/${ID}/conferma`).send({ versione: 4 })
      expect(s.legami.conferma).toHaveBeenLastCalledWith(TENANT, 'utente-1', ID, 4, undefined)
      await http()
        .post(`/${L}/${ID}/conferma`)
        .send({
          versione: 4,
          modifiche: { elencoId: MOV, righe: [{ rigaAddebitoId: RIGA, prezzo: '1' }] },
        })
      expect(s.legami.conferma).toHaveBeenLastCalledWith(TENANT, 'utente-1', ID, 4, {
        elencoId: MOV,
        righe: [{ rigaAddebitoId: RIGA, prezzo: '1' }],
      })
    })

    it('conferma: i valori delle modifiche sono validati come nel PUT', async () => {
      const r = await http()
        .post(`/${L}/${ID}/conferma`)
        .send({ versione: 1, modifiche: { righe: [{ rigaAddebitoId: RIGA, quantita: 5 }] } })
      expect(r.status).toBe(400)
      expect(s.legami.conferma).not.toHaveBeenCalled()
    })

    it('conferma incompleta: 409 LEGAME_INCOMPLETO con i motivi in details', async () => {
      s.legami.conferma.mockRejectedValue(
        new ConflictException({
          error: 'LEGAME_INCOMPLETO',
          message: 'Il legame non e` completo.',
          details: { motivi: ['SENZA_PREZZO'], dettaglioCliente: 'cliente disattivato' },
        })
      )
      const r = await http().post(`/${L}/${ID}/conferma`).send({ versione: 1 })
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({
        error: 'LEGAME_INCOMPLETO',
        details: { motivi: ['SENZA_PREZZO'], dettaglioCliente: 'cliente disattivato' },
      })
    })

    it('escludi: motivo e versione; motivo assente o non testo: 400', async () => {
      await http().post(`/${L}/${ID}/escludi`).send({ versione: 2, motivo: 'Contratto a forfait' })
      expect(s.legami.escludi).toHaveBeenCalledWith(
        TENANT,
        'utente-1',
        ID,
        2,
        'Contratto a forfait'
      )
      expect((await http().post(`/${L}/${ID}/escludi`).send({ versione: 2 })).status).toBe(400)
      expect(
        (await http().post(`/${L}/${ID}/escludi`).send({ versione: 2, motivo: 5 })).status
      ).toBe(400)
    })

    it('escludi: il 400 MOTIVO_ESCLUSIONE_NON_VALIDO del servizio passa intatto', async () => {
      s.legami.escludi.mockRejectedValue(
        new BadRequestException({ error: 'MOTIVO_ESCLUSIONE_NON_VALIDO', message: 'Motivo vuoto.' })
      )
      const r = await http().post(`/${L}/${ID}/escludi`).send({ versione: 2, motivo: '   ' })
      expect(r.status).toBe(400)
      expect(r.body).toMatchObject({ error: 'MOTIVO_ESCLUSIONE_NON_VALIDO' })
    })

    it('riammetti: solo la versione', async () => {
      await http().post(`/${L}/${ID}/riammetti`).send({ versione: 7 })
      expect(s.legami.riammetti).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 7)
      expect((await http().post(`/${L}/${ID}/riammetti`).send({})).status).toBe(400)
    })
  })

  describe('POST azioni (massa)', () => {
    const elemento = { legameId: ID, versione: 1 }

    it('passa elementi, movimentoIds e motivo', async () => {
      const r = await http()
        .post(`/${L}/azioni`)
        .send({ azione: 'ESCLUDI', elementi: [elemento], movimentoIds: [MOV], motivo: 'Fuori' })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ riusciti: 1, falliti: [] })
      expect(s.massa.esegui).toHaveBeenCalledWith(TENANT, 'utente-1', {
        azione: 'ESCLUDI',
        elementi: [elemento],
        movimentoIds: [MOV],
        motivo: 'Fuori',
      })
    })

    it('elementi assente con movimentoIds: passa elementi vuoti', async () => {
      await http()
        .post(`/${L}/azioni`)
        .send({ azione: 'CONFERMA', movimentoIds: [MOV] })
      expect(s.massa.esegui.mock.calls[0][2]).toMatchObject({ elementi: [], movimentoIds: [MOV] })
    })

    it('500 elementi: 200; 501: 400; 501 movimentoIds: 400', async () => {
      const elementi = (n: number) => Array.from({ length: n }, () => elemento)
      expect(
        (
          await http()
            .post(`/${L}/azioni`)
            .send({ azione: 'CONFERMA', elementi: elementi(500) })
        ).status
      ).toBe(200)
      expect(
        (
          await http()
            .post(`/${L}/azioni`)
            .send({ azione: 'CONFERMA', elementi: elementi(501) })
        ).status
      ).toBe(400)
      expect(
        (
          await http()
            .post(`/${L}/azioni`)
            .send({ azione: 'CONFERMA', movimentoIds: Array(501).fill(MOV) })
        ).status
      ).toBe(400)
      expect(s.massa.esegui).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['azione sconosciuta', { azione: 'ANNULLA', elementi: [elemento] }],
      ['azione assente', { elementi: [elemento] }],
      ['versione testo', { azione: 'CONFERMA', elementi: [{ legameId: ID, versione: '1' }] }],
      ['versione decimale', { azione: 'CONFERMA', elementi: [{ legameId: ID, versione: 1.5 }] }],
      ['legameId non UUID', { azione: 'CONFERMA', elementi: [{ legameId: 'x', versione: 1 }] }],
      ['movimentoId non UUID', { azione: 'CONFERMA', movimentoIds: ['x'] }],
      ['elementi non lista', { azione: 'CONFERMA', elementi: 'x' }],
      ['motivo non testo', { azione: 'ESCLUDI', elementi: [elemento], motivo: 5 }],
    ])('%s: 400', async (_n, corpo) => {
      expect((await http().post(`/${L}/azioni`).send(corpo)).status).toBe(400)
      expect(s.massa.esegui).not.toHaveBeenCalled()
    })

    it('richiesta senza elementi ne movimenti: il 400 ELEMENTI_NON_VALIDI e` del servizio', async () => {
      s.massa.esegui.mockRejectedValue(
        new BadRequestException({ error: 'ELEMENTI_NON_VALIDI', message: 'Nessun elemento.' })
      )
      const r = await http().post(`/${L}/azioni`).send({ azione: 'CONFERMA' })
      expect(r.status).toBe(400)
      expect(r.body).toMatchObject({ error: 'ELEMENTI_NON_VALIDI' })
    })

    it('200 anche con tutti gli elementi falliti', async () => {
      s.massa.esegui.mockResolvedValue({
        riusciti: 0,
        falliti: [{ legameId: ID, codice: 'VERSIONE_SUPERATA', messaggio: 'm' }],
      })
      const r = await http()
        .post(`/${L}/azioni`)
        .send({ azione: 'CONFERMA', elementi: [elemento] })
      expect(r.status).toBe(200)
      expect(r.body.falliti).toHaveLength(1)
    })
  })

  describe('POST aggiorna-prezzi', () => {
    beforeEach(() => {
      ruolo = 'ADMIN'
    })

    it('senza firma: anteprima (nulla scritto)', async () => {
      const perimetro = { contrattoId: CONTRATTO, dal: '2026-01-01', al: '2026-03-31' }
      const r = await http().post(`/${L}/aggiorna-prezzi`).send({ perimetro })
      expect(r.status).toBe(200)
      expect(s.prezzi.anteprima).toHaveBeenCalledWith(TENANT, perimetro)
      expect(s.prezzi.applica).not.toHaveBeenCalled()
    })

    it('con firma: applica', async () => {
      const perimetro = { elencoId: MOV }
      await http().post(`/${L}/aggiorna-prezzi`).send({ perimetro, firma: 'impronta' })
      expect(s.prezzi.applica).toHaveBeenCalledWith(TENANT, 'utente-1', perimetro, 'impronta')
      expect(s.prezzi.anteprima).not.toHaveBeenCalled()
    })

    it.each([
      ['perimetro assente', {}],
      ['perimetro non oggetto', { perimetro: 'x' }],
      ['contrattoId non UUID', { perimetro: { contrattoId: 'x' } }],
      ['elencoId non UUID', { perimetro: { elencoId: 'x' } }],
      ['dal numero', { perimetro: { contrattoId: CONTRATTO, dal: 20260101 } }],
      ['firma numero', { perimetro: { contrattoId: CONTRATTO }, firma: 5 }],
      ['campo extra nel perimetro', { perimetro: { contrattoId: CONTRATTO, tutti: true } }],
    ])('%s: 400', async (_n, corpo) => {
      expect((await http().post(`/${L}/aggiorna-prezzi`).send(corpo)).status).toBe(400)
      expect(s.prezzi.anteprima).not.toHaveBeenCalled()
    })

    it('perimetro vuoto: il 400 PERIMETRO_NON_VALIDO e` del servizio', async () => {
      s.prezzi.anteprima.mockRejectedValue(
        new BadRequestException({
          error: 'PERIMETRO_NON_VALIDO',
          message: 'Indica contratto o elenco.',
        })
      )
      const r = await http().post(`/${L}/aggiorna-prezzi`).send({ perimetro: {} })
      expect(r.status).toBe(400)
      expect(r.body).toMatchObject({ error: 'PERIMETRO_NON_VALIDO' })
    })

    it('409 ANTEPRIMA_SUPERATA passa intatto', async () => {
      s.prezzi.applica.mockRejectedValue(
        new ConflictException({ error: 'ANTEPRIMA_SUPERATA', message: 'Rifai l`anteprima.' })
      )
      const r = await http()
        .post(`/${L}/aggiorna-prezzi`)
        .send({ perimetro: { contrattoId: CONTRATTO }, firma: 'x' })
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({ error: 'ANTEPRIMA_SUPERATA' })
    })
  })

  describe('POST da-movimento', () => {
    it('passa azienda, utente e movimento; corpo vuoto', async () => {
      const r = await http().post(`/${L}/da-movimento/${MOV}`)
      expect(r.status).toBe(200)
      expect(s.massa.daMovimento).toHaveBeenCalledWith(TENANT, 'utente-1', MOV)
    })

    it('i 409 CAUSALE_NON_FATTURABILE e MOVIMENTO_FUORI_FATTURAZIONE passano intatti', async () => {
      for (const codice of ['CAUSALE_NON_FATTURABILE', 'MOVIMENTO_FUORI_FATTURAZIONE']) {
        s.massa.daMovimento.mockRejectedValueOnce(
          new ConflictException({ error: codice, message: 'm' })
        )
        const r = await http().post(`/${L}/da-movimento/${MOV}`).send({})
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ error: codice })
      }
    })
  })
})
