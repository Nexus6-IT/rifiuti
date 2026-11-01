/**
 * ContrattiClienteController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione
 * dei DTO, UUID, azienda selezionata, ruoli (metadata e comportamento), ordine delle rotte
 * (`prossimo-numero` e `proroga-scadenze` prima di `:id`) e forma del contratto HTTP (R37, R43).
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ContrattiClienteController } from './contratti-cliente.controller'
import { ContrattiClienteService } from '../../application/contratti-cliente/contratti-cliente.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'
const CLIENTE = '8f8f8f8f-0000-4000-8000-000000000005'
const CATEGORIA = '9a9a9a9a-0000-4000-8000-000000000006'

const corpoValido = {
  numero: 'CC-2026-001',
  descrizione: 'Contratto di prova',
  clienteId: CLIENTE,
  dataInizio: '2026-01-01',
}

describe('ContrattiClienteController', () => {
  describe('metadata e ordine delle rotte', () => {
    const reflector = new Reflector()
    const proto = ContrattiClienteController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])
    const metodi = () =>
      Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )

    it.each(['list', 'prossimoNumero', 'getById'])('%s: lettura a tutti i ruoli', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['crea', 'modifica', 'cambiaStato', 'rinnova', 'prorogaScadenze', 'elimina'])(
      '%s: scrittura senza VIEWER',
      nome => {
        expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
      }
    )

    it('ogni rotta pubblica ha @Roles esplicito e non ci sono rotte degli allegati (R28)', () => {
      expect(metodi().sort()).toEqual(
        [
          'cambiaStato',
          'crea',
          'elimina',
          'getById',
          'list',
          'modifica',
          'prorogaScadenze',
          'prossimoNumero',
          'rinnova',
        ].sort()
      )
      for (const n of metodi()) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })

    it('prossimo-numero e proroga-scadenze sono dichiarate prima di :id', () => {
      const ordine = metodi()
      expect(ordine.indexOf('prossimoNumero')).toBeLessThan(ordine.indexOf('getById'))
      expect(ordine.indexOf('prorogaScadenze')).toBeLessThan(ordine.indexOf('getById'))
      expect(ordine.indexOf('prorogaScadenze')).toBeLessThan(ordine.indexOf('rinnova'))
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'OPERATOR'

    beforeEach(async () => {
      ruolo = 'OPERATOR'
      servizio = {
        list: jest.fn().mockResolvedValue({ elementi: [], totale: 0 }),
        getById: jest.fn().mockResolvedValue({ id: ID }),
        prossimoNumero: jest.fn().mockResolvedValue('CC-2026-004'),
        crea: jest.fn().mockResolvedValue({ id: ID }),
        modifica: jest.fn().mockResolvedValue({ id: ID, versione: 3 }),
        cambiaStato: jest.fn().mockResolvedValue({ id: ID, stato: 'SOSPESO' }),
        rinnova: jest.fn().mockResolvedValue({ id: ID, dataFine: '2027-12-31' }),
        prorogaScadenze: jest.fn().mockResolvedValue({ prorogati: 4 }),
        elimina: jest.fn().mockResolvedValue(undefined),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [ContrattiClienteController],
        providers: [
          { provide: ContrattiClienteService, useValue: servizio },
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

    // ------------------------------------------------------------------------------ letture

    it('GET: azienda selezionata (non quella del token), default pagina 1 / dimensione 25', async () => {
      const r = await http().get('/contratti-clienti')
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ elementi: [], totale: 0 })
      expect(servizio.list).toHaveBeenCalledWith(TENANT, { pagina: 1, dimensione: 25 })
    })

    it('GET con tutti i filtri: numeri convertiti, nessun booleano da convertire', async () => {
      await http().get(
        `/contratti-clienti?stato=ATTIVO&clienteId=${CLIENTE}&categoriaId=${CATEGORIA}&tipoId=${CATEGORIA}` +
          '&testo=rossi&inScadenzaEntroGiorni=30&pagina=2&dimensione=10'
      )
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        stato: 'ATTIVO',
        clienteId: CLIENTE,
        categoriaId: CATEGORIA,
        tipoId: CATEGORIA,
        testo: 'rossi',
        inScadenzaEntroGiorni: 30,
        pagina: 2,
        dimensione: 10,
      })
    })

    it('GET con inScadenzaEntroGiorni=0 lo passa (0 non è "assente")', async () => {
      await http().get('/contratti-clienti?inScadenzaEntroGiorni=0')
      expect(servizio.list.mock.calls[0][1]).toMatchObject({ inScadenzaEntroGiorni: 0 })
    })

    it.each([
      ['clienteId non UUID (R43: non 500)', 'clienteId=x'],
      ['categoriaId non UUID', 'categoriaId=x'],
      ['tipoId non UUID', 'tipoId=x'],
      ['stato sconosciuto', 'stato=CHISSA'],
      ['inScadenzaEntroGiorni negativo', 'inScadenzaEntroGiorni=-1'],
      ['inScadenzaEntroGiorni non numerico', 'inScadenzaEntroGiorni=a'],
      ['pagina 0', 'pagina=0'],
      ['dimensione 101', 'dimensione=101'],
      ['parametro sconosciuto', 'x=1'],
    ])('GET %s: 400', async (_nome, query) => {
      const r = await http().get(`/contratti-clienti?${query}`)
      expect(r.status).toBe(400)
      expect(servizio.list).not.toHaveBeenCalled()
    })

    it('GET prossimo-numero risponde { numero } e non finisce su :id', async () => {
      const r = await http().get('/contratti-clienti/prossimo-numero')
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ numero: 'CC-2026-004' })
      expect(servizio.prossimoNumero).toHaveBeenCalledWith(TENANT)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('GET :id con UUID non valido: 400; valido: la vista', async () => {
      expect((await http().get('/contratti-clienti/non-un-uuid')).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
      const r = await http().get(`/contratti-clienti/${ID}`)
      expect(r.status).toBe(200)
      expect(servizio.getById).toHaveBeenCalledWith(TENANT, ID)
    })

    // ------------------------------------------------------------------------------ ruoli

    it('un VIEWER legge ma non scrive (403 su ogni scrittura)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get('/contratti-clienti')).status).toBe(200)
      expect((await http().get('/contratti-clienti/prossimo-numero')).status).toBe(200)
      expect((await http().get(`/contratti-clienti/${ID}`)).status).toBe(200)
      expect((await http().post('/contratti-clienti').send(corpoValido)).status).toBe(403)
      expect(
        (await http().patch(`/contratti-clienti/${ID}`).send({ descrizione: 'x', versione: 1 }))
          .status
      ).toBe(403)
      expect(
        (
          await http()
            .patch(`/contratti-clienti/${ID}/stato`)
            .send({ stato: 'SOSPESO', versione: 1 })
        ).status
      ).toBe(403)
      expect(
        (await http().post(`/contratti-clienti/${ID}/rinnova`).send({ versione: 1 })).status
      ).toBe(403)
      expect(
        (
          await http()
            .post('/contratti-clienti/proroga-scadenze')
            .send({ scadutiEntro: '2026-12-31' })
        ).status
      ).toBe(403)
      expect((await http().delete(`/contratti-clienti/${ID}?versione=1`)).status).toBe(403)
      for (const n of [
        'crea',
        'modifica',
        'cambiaStato',
        'rinnova',
        'prorogaScadenze',
        'elimina',
      ]) {
        expect(servizio[n]).not.toHaveBeenCalled()
      }
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      const senza = (r: request.Test) => r.set('x-senza-azienda', '1')
      expect((await senza(http().get('/contratti-clienti'))).status).toBe(403)
      expect((await senza(http().get('/contratti-clienti/prossimo-numero'))).status).toBe(403)
      expect((await senza(http().post('/contratti-clienti').send(corpoValido))).status).toBe(403)
      expect(
        (
          await senza(
            http().post('/contratti-clienti/proroga-scadenze').send({ scadutiEntro: '2026-12-31' })
          )
        ).status
      ).toBe(403)
      expect(servizio.list).not.toHaveBeenCalled()
      expect(servizio.prossimoNumero).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
      expect(servizio.prorogaScadenze).not.toHaveBeenCalled()
    })

    // ------------------------------------------------------------------------------ crea

    it('POST: 201, azienda e utente dalla richiesta, corpo passato al servizio', async () => {
      const r = await http()
        .post('/contratti-clienti')
        .send({
          ...corpoValido,
          dataFine: '2026-12-31',
          ritenutaPercentuale: '4.50',
          annotazioni: ['uno'],
          periodi: [{ giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 }],
        })
      expect(r.status).toBe(201)
      expect(r.body).toEqual({ id: ID })
      expect(servizio.crea).toHaveBeenCalledTimes(1)
      const [tenant, utente, dati] = servizio.crea.mock.calls[0]
      expect(tenant).toBe(TENANT)
      expect(utente).toBe('utente-1')
      expect(dati).toMatchObject({
        ...corpoValido,
        dataFine: '2026-12-31',
        ritenutaPercentuale: '4.50',
        annotazioni: ['uno'],
        periodi: [{ giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 }],
      })
    })

    it.each([
      ['stato nel corpo', { stato: 'ATTIVO' }],
      ['data 2026-02-30', { dataInizio: '2026-02-30' }],
      ['ritenuta numerica', { ritenutaPercentuale: 4.5 }],
      [
        '13 periodi',
        {
          periodi: Array.from({ length: 13 }, () => ({
            giornoInizio: 1,
            meseInizio: 1,
            giornoFine: 2,
            meseFine: 1,
          })),
        },
      ],
      ['4 annotazioni', { annotazioni: ['a', 'b', 'c', 'd'] }],
      ['numero vuoto', { numero: '' }],
      ['clienteId non UUID', { clienteId: 'x' }],
      ['campo extra', { tenantId: 'x' }],
    ])('POST %s: 400 senza chiamare il servizio', async (_nome, extra) => {
      const r = await http()
        .post('/contratti-clienti')
        .send({ ...corpoValido, ...extra })
      expect(r.status).toBe(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    // ------------------------------------------------------------------------------ modifica

    it('PATCH: solo i campi cambiati, null = svuota, risponde con la vista', async () => {
      const r = await http()
        .patch(`/contratti-clienti/${ID}`)
        .send({ dataFine: null, descrizione: 'Nuova', versione: 2 })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ id: ID, versione: 3 })
      expect(servizio.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
        dataFine: null,
        descrizione: 'Nuova',
        versione: 2,
      })
    })

    it.each([
      ['senza versione', { descrizione: 'x' }],
      ['versione 0', { descrizione: 'x', versione: 0 }],
      ['stato nel corpo', { stato: 'ANNULLATO', versione: 1 }],
      ['data non valida', { dataFine: '2026-02-30', versione: 1 }],
      ['campo extra', { tenantId: 'x', versione: 1 }],
    ])('PATCH %s: 400', async (_nome, corpo) => {
      const r = await http().patch(`/contratti-clienti/${ID}`).send(corpo)
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH con id non UUID: 400', async () => {
      expect(
        (await http().patch('/contratti-clienti/x').send({ descrizione: 'a', versione: 1 })).status
      ).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    // ------------------------------------------------------------------------------ stato

    it('PATCH :id/stato: passa stato, versione e annullo, risponde con la vista', async () => {
      const r = await http()
        .patch(`/contratti-clienti/${ID}/stato`)
        .send({ stato: 'ANNULLATO', versione: 3, motivoAnnulloId: CATEGORIA, motivo: 'Disdetta' })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ id: ID, stato: 'SOSPESO' })
      expect(servizio.cambiaStato).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 'ANNULLATO', 3, {
        motivoAnnulloId: CATEGORIA,
        motivo: 'Disdetta',
      })
    })

    it('PATCH :id/stato senza annullo: oggetto vuoto', async () => {
      await http().patch(`/contratti-clienti/${ID}/stato`).send({ stato: 'SOSPESO', versione: 1 })
      expect(servizio.cambiaStato).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 'SOSPESO', 1, {})
    })

    it.each([
      ['stato sconosciuto', { stato: 'CHISSA', versione: 1 }],
      ['senza versione', { stato: 'SOSPESO' }],
      ['motivoAnnulloId non UUID', { stato: 'ANNULLATO', versione: 1, motivoAnnulloId: 'x' }],
      ['motivo di 256 caratteri', { stato: 'ANNULLATO', versione: 1, motivo: 'x'.repeat(256) }],
      ['campo extra', { stato: 'SOSPESO', versione: 1, x: 1 }],
    ])('PATCH :id/stato %s: 400', async (_nome, corpo) => {
      const r = await http().patch(`/contratti-clienti/${ID}/stato`).send(corpo)
      expect(r.status).toBe(400)
      expect(servizio.cambiaStato).not.toHaveBeenCalled()
    })

    // ------------------------------------------------------------------------------ rinnova

    it('POST :id/rinnova { versione }: risponde con la vista', async () => {
      const r = await http().post(`/contratti-clienti/${ID}/rinnova`).send({ versione: 4 })
      expect(r.status).toBeLessThan(300)
      expect(r.body).toEqual({ id: ID, dataFine: '2027-12-31' })
      expect(servizio.rinnova).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 4)
    })

    it('POST :id/rinnova senza versione o con id non UUID: 400', async () => {
      expect((await http().post(`/contratti-clienti/${ID}/rinnova`).send({})).status).toBe(400)
      expect((await http().post('/contratti-clienti/x/rinnova').send({ versione: 1 })).status).toBe(
        400
      )
      expect(servizio.rinnova).not.toHaveBeenCalled()
    })

    // ------------------------------------------------------------------------------ proroga

    it('POST proroga-scadenze: default di D11 (solo rinnovo automatico, senza sospesi)', async () => {
      const r = await http()
        .post('/contratti-clienti/proroga-scadenze')
        .send({ scadutiEntro: '2026-12-31' })
      expect(r.status).toBeLessThan(300)
      expect(r.body).toEqual({ prorogati: 4 })
      expect(servizio.prorogaScadenze).toHaveBeenCalledWith(TENANT, 'utente-1', {
        scadutiEntro: '2026-12-31',
        soloRinnovoAutomatico: true,
        ancheSospesi: false,
      })
      expect(servizio.rinnova).not.toHaveBeenCalled()
    })

    it('POST proroga-scadenze: flag e filtri espliciti passati così come sono', async () => {
      await http().post('/contratti-clienti/proroga-scadenze').send({
        scadutiEntro: '2026-12-31',
        soloRinnovoAutomatico: false,
        ancheSospesi: true,
        clienteId: CLIENTE,
        categoriaId: CATEGORIA,
      })
      expect(servizio.prorogaScadenze).toHaveBeenCalledWith(TENANT, 'utente-1', {
        scadutiEntro: '2026-12-31',
        soloRinnovoAutomatico: false,
        ancheSospesi: true,
        clienteId: CLIENTE,
        categoriaId: CATEGORIA,
      })
    })

    it.each([
      ['senza data', {}],
      ['30 febbraio', { scadutiEntro: '2026-02-30' }],
      ['flag non booleano', { scadutiEntro: '2026-12-31', ancheSospesi: 'si' }],
      ['categoria non UUID', { scadutiEntro: '2026-12-31', categoriaId: 'x' }],
      ['campo extra', { scadutiEntro: '2026-12-31', tenantId: 'x' }],
    ])('POST proroga-scadenze %s: 400', async (_nome, corpo) => {
      const r = await http().post('/contratti-clienti/proroga-scadenze').send(corpo)
      expect(r.status).toBe(400)
      expect(servizio.prorogaScadenze).not.toHaveBeenCalled()
    })

    // ------------------------------------------------------------------------------ elimina

    it('DELETE: 204 con ?versione=', async () => {
      const r = await http().delete(`/contratti-clienti/${ID}?versione=3`)
      expect(r.status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
    })

    it('DELETE senza versione o non numerica, o con id non UUID: 400', async () => {
      expect((await http().delete(`/contratti-clienti/${ID}`)).status).toBe(400)
      expect((await http().delete(`/contratti-clienti/${ID}?versione=a`)).status).toBe(400)
      expect((await http().delete('/contratti-clienti/x?versione=1')).status).toBe(400)
      expect(servizio.elimina).not.toHaveBeenCalled()
    })
  })
})
