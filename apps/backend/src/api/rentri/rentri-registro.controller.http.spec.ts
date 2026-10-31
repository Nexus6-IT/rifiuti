/**
 * API di trasmissione del registro a RENTRI attraverso la catena HTTP reale: JwtAuthGuard (finto)
 * -> TenantSwitchInterceptor globale -> ValidationPipe (come main.ts) -> controller -> filtro
 * globale. Il ruolo che conta e' quello effettivo nell'azienda selezionata, mai quello del token.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { RentriRegistroController } from './rentri-registro.controller'
import { AccodaTrasmissioneRentriUseCase } from '../../application/rentri/registro/accoda-trasmissione-rentri.use-case'
import { TrasmettiLottoRegistroUseCase } from '../../application/rentri/registro/trasmetti-lotto-registro.use-case'
import { VerificaTrasmissioneRentriUseCase } from '../../application/rentri/registro/verifica-trasmissione-rentri.use-case'
import { ImpostazioniRentriRegistroService } from '../../application/rentri/registro/impostazioni-rentri-registro.service'
import { DettaglioTrasmissioneRentriService } from '../../application/rentri/registro/dettaglio-trasmissione-rentri.service'
import {
  IdentificativoGiaUsatoError,
  IdentificativoRegistroNonValidoError,
  MovimentoNonTrovatoError,
  RichiestaTrasmissioneNonValidaError,
  RuoloNonAutorizzatoRentriError,
  TrasmissioneNonModificabileError,
} from '../../application/rentri/registro/errori-azioni-rentri-registro'
import { RegistroNonTrovatoError } from '../../application/registro/registri.service'
import { RentriCredentialResolver } from '../../infrastructure/rentri/rentri-credential.resolver'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { LoggerService } from '../../core/logger/logger.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MembershipService } from '../me/membership.service'
import { TenantSwitchInterceptor } from '../../core/interceptors/tenant-switch.interceptor'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const STUDIO = '5a5a5a5a-0000-4000-8000-000000000001'
const CLIENTE = 'c1c1c1c1-0000-4000-8000-000000000002'
const CONSULENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const REGISTRO = '7e7e7e7e-0000-4000-8000-000000000004'
const MOVIMENTO = '3b3b3b3b-0000-4000-8000-000000000006'
const ALTRO = '4c4c4c4c-0000-4000-8000-000000000007'

function prismaFinto(ruoloNelCliente: string) {
  return {
    tenant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ parentTenantId: null }),
    },
    consultantTenantAssociation: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.consultantUserId === CONSULENTE && where.tenantId === CLIENTE
            ? { id: 'a1', role: { name: ruoloNelCliente } }
            : null
        )
      ),
    },
  } as any
}

jest.mock('../../core/monitoring/segnala-errore-job', () => ({ segnalaErroreJob: jest.fn() }))

describe('RentriRegistroController — catena HTTP', () => {
  let app: INestApplication
  let accoda: Record<
    | 'accoda'
    | 'accodaStorico'
    | 'togliDallaCoda'
    | 'dichiaraGiaSuRentri'
    | 'escludiDaInvioAutomatico'
    | 'reincludiNellInvioAutomatico',
    jest.Mock
  >
  let trasmetti: { trasmettiRegistro: jest.Mock }
  let verifica: { verifica: jest.Mock }
  let impostazioni: Record<'leggi' | 'imposta' | 'allineamento', jest.Mock>
  let dettaglio: { dettaglio: jest.Mock }
  let credenziali: { haCredenziale: jest.Mock }
  let logger: any

  // ADMIN del proprio studio (ruolo del token), consulente nell'azienda del cliente.
  const utente = { id: CONSULENTE, email: 'c@studio.it', tenantId: STUDIO, role: 'ADMIN' }

  async function avvia(ruoloNelCliente: string) {
    const prisma = prismaFinto(ruoloNelCliente)
    accoda = {
      accoda: jest.fn().mockResolvedValue({
        accodate: 2,
        riaccodate: 1,
        predecessori: 0,
        saltate: 3,
        saltatePerStato: { TRASMESSA: 2, INCERTA: 1 },
      }),
      accodaStorico: jest.fn().mockResolvedValue({
        accodate: 5,
        riaccodate: 0,
        predecessori: 0,
        saltate: 0,
        saltatePerStato: {},
      }),
      togliDallaCoda: jest.fn().mockResolvedValue(undefined),
      escludiDaInvioAutomatico: jest.fn().mockResolvedValue(undefined),
      reincludiNellInvioAutomatico: jest.fn().mockResolvedValue(undefined),
      dichiaraGiaSuRentri: jest.fn().mockResolvedValue({
        dichiarate: 4,
        saltate: 1,
        saltatePerStato: {},
        movimentiNellIntervallo: 5,
      }),
    }
    trasmetti = { trasmettiRegistro: jest.fn().mockResolvedValue({ esito: 'INVIATO' }) }
    verifica = {
      verifica: jest
        .fn()
        .mockResolvedValue({ esito: 'TRASMESSA', stato: 'TRASMESSA', messaggio: 'ok' }),
    }
    impostazioni = {
      leggi: jest
        .fn()
        .mockResolvedValue([{ registroId: REGISTRO, identificativoRentri: 'RABCDE12345' }]),
      imposta: jest.fn().mockResolvedValue({ registroId: REGISTRO }),
      allineamento: jest.fn().mockResolvedValue({ locali: 3, trasmessi: 2, suRentri: 2 }),
    }
    dettaglio = {
      dettaglio: jest.fn().mockResolvedValue({ stato: 'TRASMESSA', fase: 'CONFERMATA' }),
    }
    credenziali = { haCredenziale: jest.fn().mockResolvedValue(true) }
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [RentriRegistroController],
      providers: [
        { provide: AccodaTrasmissioneRentriUseCase, useValue: accoda },
        { provide: TrasmettiLottoRegistroUseCase, useValue: trasmetti },
        { provide: VerificaTrasmissioneRentriUseCase, useValue: verifica },
        { provide: ImpostazioniRentriRegistroService, useValue: impostazioni },
        { provide: DettaglioTrasmissioneRentriService, useValue: dettaglio },
        { provide: RentriCredentialResolver, useValue: credenziali },
        { provide: LoggerService, useValue: logger },
        { provide: RuoloEffettivoService, useValue: new RuoloEffettivoService(prisma) },
        {
          provide: MembershipService,
          useValue: new MembershipService(prisma, prisma, { generateTokenPair: jest.fn() } as any),
        },
        { provide: APP_INTERCEPTOR, useClass: TenantSwitchInterceptor },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = utente
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication()
    // Stessa configurazione di main.ts
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  }

  const http = () => request(app.getHttpServer())
  const cliente = (r: request.Test) => r.set('X-Tenant-ID', CLIENTE)

  afterEach(async () => {
    jest.clearAllMocks()
    await app?.close()
  })

  describe("ruoli nell'azienda selezionata", () => {
    it('VIEWER: legge ma non trasmette, non toglie, non verifica (403, nessun use case)', async () => {
      await avvia('VIEWER')
      expect((await cliente(http().get('/rentri/registro/registri'))).status).toBe(200)
      for (const r of [
        () =>
          cliente(
            http()
              .post('/rentri/registro/trasmetti')
              .send({ registroId: REGISTRO, movimentoIds: [MOVIMENTO] })
          ),
        () => cliente(http().delete(`/rentri/registro/movimenti/${MOVIMENTO}/coda`)),
        () => cliente(http().post(`/rentri/registro/movimenti/${MOVIMENTO}/verifica`)),
      ]) {
        const risposta = await r()
        expect(risposta.status).toBe(403)
        expect(risposta.body.message).not.toMatch(/[0-9a-f]{8}-/)
      }
      expect(accoda.accoda).not.toHaveBeenCalled()
      expect(accoda.togliDallaCoda).not.toHaveBeenCalled()
      expect(verifica.verifica).not.toHaveBeenCalled()
      expect(trasmetti.trasmettiRegistro).not.toHaveBeenCalled()
    })

    it('OPERATOR: trasmette ma non configura, non trasmette lo storico, non dichiara (403)', async () => {
      await avvia('OPERATOR')
      for (const r of [
        () =>
          cliente(
            http()
              .put(`/rentri/registro/registri/${REGISTRO}`)
              .send({ identificativoRentri: 'RABCDE12345', invioAutomatico: false })
          ),
        () =>
          cliente(
            http()
              .post('/rentri/registro/trasmetti-storico')
              .send({ registroId: REGISTRO, anno: 2026, conferma: true })
          ),
        () =>
          cliente(
            http().post('/rentri/registro/dichiara-gia-trasmessi').send({
              registroId: REGISTRO,
              anno: 2026,
              daProgressivo: 1,
              aProgressivo: 5,
              motivo: 'm',
            })
          ),
      ]) {
        expect((await r()).status).toBe(403)
      }
      expect(impostazioni.imposta).not.toHaveBeenCalled()
      expect(accoda.accodaStorico).not.toHaveBeenCalled()
      expect(accoda.dichiaraGiaSuRentri).not.toHaveBeenCalled()
      const ok = await cliente(
        http()
          .post('/rentri/registro/trasmetti')
          .send({ registroId: REGISTRO, movimentoIds: [MOVIMENTO] })
      )
      expect(ok.status).toBe(202)
    })

    it("ruolo del token ADMIN ma VIEWER nell'azienda selezionata: conta il ruolo effettivo", async () => {
      await avvia('VIEWER')
      const r = await cliente(
        http()
          .put(`/rentri/registro/registri/${REGISTRO}`)
          .send({ identificativoRentri: null, invioAutomatico: false })
      )
      expect(r.status).toBe(403)
      expect(impostazioni.imposta).not.toHaveBeenCalled()
    })

    it('ADMIN effettivo: imposta passa tenant del cliente, utente e RUOLO EFFETTIVO', async () => {
      await avvia('ADMIN')
      const r = await cliente(
        http()
          .put(`/rentri/registro/registri/${REGISTRO}`)
          .send({ identificativoRentri: 'RABCDE12345', invioAutomatico: true })
      )
      expect(r.status).toBe(200)
      expect(impostazioni.imposta).toHaveBeenCalledWith(CLIENTE, CONSULENTE, 'ADMIN', REGISTRO, {
        identificativoRentri: 'RABCDE12345',
        invioAutomatico: true,
      })
    })

    it('GET registri: puoConfigurare e puoTrasmettere secondo il ruolo effettivo', async () => {
      await avvia('OPERATOR')
      const r = await cliente(http().get('/rentri/registro/registri'))
      expect(impostazioni.leggi).toHaveBeenCalledWith(CLIENTE)
      expect(r.body).toMatchObject({ puoConfigurare: false, puoTrasmettere: true })
      expect(r.body.registri).toHaveLength(1)
    })

    it('azienda selezionata non accessibile: 403 e nessuna azione', async () => {
      await avvia('ADMIN')
      const r = await http().get('/rentri/registro/registri').set('X-Tenant-ID', ALTRO)
      expect(r.status).toBe(403)
      expect(impostazioni.leggi).not.toHaveBeenCalled()
    })
  })

  describe('trasmetti', () => {
    const corpo = { registroId: REGISTRO, movimentoIds: [MOVIMENTO] }

    it("202 prima che finisca l'invio; l'avvio e' chiamato una volta, con l'azienda del cliente", async () => {
      await avvia('ADMIN')
      let finisci!: () => void
      trasmetti.trasmettiRegistro.mockReturnValue(
        new Promise(r => (finisci = () => r({ esito: 'INVIATO' })))
      )
      const r = await cliente(http().post('/rentri/registro/trasmetti').send(corpo))
      expect(r.status).toBe(202)
      expect(r.body).toEqual({
        accodate: 3,
        saltate: [
          { motivo: 'Già trasmessa a RENTRI', numero: 2 },
          { motivo: 'Esito incerto: da verificare prima di ritrasmettere', numero: 1 },
        ],
        avvio: 'AVVIATO',
      })
      expect(accoda.accoda).toHaveBeenCalledWith(CLIENTE, CONSULENTE, REGISTRO, [MOVIMENTO])
      expect(trasmetti.trasmettiRegistro).toHaveBeenCalledTimes(1)
      expect(trasmetti.trasmettiRegistro).toHaveBeenCalledWith(CLIENTE, REGISTRO)
      finisci()
    })

    it('senza certificato: accodato ma invio non avviato, lo stato lo dice', async () => {
      await avvia('ADMIN')
      credenziali.haCredenziale.mockResolvedValue(false)
      const r = await cliente(http().post('/rentri/registro/trasmetti').send(corpo))
      expect(r.status).toBe(202)
      expect(r.body.avvio).toBe('SENZA_CERTIFICATO')
      expect(trasmetti.trasmettiRegistro).not.toHaveBeenCalled()
    })

    it('nulla da accodare: nessun avvio', async () => {
      await avvia('ADMIN')
      accoda.accoda.mockResolvedValue({
        accodate: 0,
        riaccodate: 0,
        predecessori: 0,
        saltate: 1,
        saltatePerStato: { IN_INVIO: 1 },
      })
      const r = await cliente(http().post('/rentri/registro/trasmetti').send(corpo))
      expect(r.body).toMatchObject({ accodate: 0, avvio: 'NIENTE_DA_INVIARE' })
      expect(trasmetti.trasmettiRegistro).not.toHaveBeenCalled()
    })

    it("errore dell'avvio in background: la risposta e' gia andata, l'errore e segnalato e loggato", async () => {
      await avvia('ADMIN')
      trasmetti.trasmettiRegistro.mockRejectedValue(new Error('boom'))
      const r = await cliente(http().post('/rentri/registro/trasmetti').send(corpo))
      expect(r.status).toBe(202)
      await new Promise(resolve => setImmediate(resolve))
      expect(logger.error).toHaveBeenCalled()
      expect(segnalaErroreJob).toHaveBeenCalledWith('trasmettiOra', expect.any(Error), {
        tenantId: CLIENTE,
      })
    })

    it('certificato non verificabile: 202 NON_AVVIATO, errore loggato e segnalato, nessun invio', async () => {
      await avvia('ADMIN')
      credenziali.haCredenziale.mockRejectedValue(new Error('db'))
      const r = await cliente(http().post('/rentri/registro/trasmetti').send(corpo))
      expect(r.status).toBe(202)
      expect(r.body.avvio).toBe('NON_AVVIATO')
      expect(logger.error).toHaveBeenCalled()
      expect(segnalaErroreJob).toHaveBeenCalled()
      expect(trasmetti.trasmettiRegistro).not.toHaveBeenCalled()
    })

    it("niente di nuovo ma righe gia in coda: l'invio parte comunque", async () => {
      await avvia('ADMIN')
      accoda.accoda.mockResolvedValue({
        accodate: 0,
        riaccodate: 0,
        predecessori: 0,
        saltate: 2,
        saltatePerStato: { DA_TRASMETTERE: 2 },
      })
      const r = await cliente(http().post('/rentri/registro/trasmetti').send(corpo))
      expect(r.body).toMatchObject({ accodate: 0, avvio: 'AVVIATO' })
      expect(trasmetti.trasmettiRegistro).toHaveBeenCalledTimes(1)
    })

    it('validazione in italiano: UUID, lista vuota, oltre 1000, campi extra', async () => {
      await avvia('ADMIN')
      const casi: Array<[object, RegExp]> = [
        [{ registroId: 'x', movimentoIds: [MOVIMENTO] }, /registro/i],
        [{ registroId: REGISTRO, movimentoIds: [] }, /almeno/i],
        [{ registroId: REGISTRO, movimentoIds: ['no'] }, /annotazion/i],
        [
          { registroId: REGISTRO, movimentoIds: Array.from({ length: 1001 }, () => MOVIMENTO) },
          /al massimo/i,
        ],
        [{ ...corpo, extra: 1 }, /extra/],
      ]
      for (const [c, re] of casi) {
        const r = await cliente(http().post('/rentri/registro/trasmetti').send(c))
        expect(r.status).toBe(400)
        expect(JSON.stringify(r.body.message)).toMatch(re)
      }
      expect(accoda.accoda).not.toHaveBeenCalled()
    })
  })

  describe('interruttore di emergenza RENTRI_REGISTRO_INVII_ATTIVI', () => {
    const originale = process.env.RENTRI_REGISTRO_INVII_ATTIVI
    afterEach(() => {
      if (originale === undefined) delete process.env.RENTRI_REGISTRO_INVII_ATTIVI
      else process.env.RENTRI_REGISTRO_INVII_ATTIVI = originale
    })

    it("spento: accoda ma l'avvio e' SOSPESO e nessun invio parte", async () => {
      process.env.RENTRI_REGISTRO_INVII_ATTIVI = 'false'
      await avvia('ADMIN')
      const r = await cliente(
        http()
          .post('/rentri/registro/trasmetti')
          .send({ registroId: REGISTRO, movimentoIds: [MOVIMENTO] })
      )
      expect(r.status).toBe(202)
      expect(r.body).toMatchObject({ accodate: 3, avvio: 'SOSPESO' })
      expect(accoda.accoda).toHaveBeenCalledTimes(1)
      expect(trasmetti.trasmettiRegistro).not.toHaveBeenCalled()
    })

    it('spento ma nulla da inviare: NIENTE_DA_INVIARE', async () => {
      process.env.RENTRI_REGISTRO_INVII_ATTIVI = 'false'
      await avvia('ADMIN')
      accoda.accoda.mockResolvedValue({
        accodate: 0,
        riaccodate: 0,
        predecessori: 0,
        saltate: 0,
        saltatePerStato: {},
        saltateEscluse: 0,
      })
      const r = await cliente(
        http()
          .post('/rentri/registro/trasmetti')
          .send({ registroId: REGISTRO, movimentoIds: [MOVIMENTO] })
      )
      expect(r.body.avvio).toBe('NIENTE_DA_INVIARE')
    })
  })

  describe('trasmetti-storico e dichiara', () => {
    it('storico (ADMIN): 202, passa anno e conferma; conferma false e 400 a validazione', async () => {
      await avvia('ADMIN')
      const r = await cliente(
        http()
          .post('/rentri/registro/trasmetti-storico')
          .send({ registroId: REGISTRO, anno: 2025, conferma: true })
      )
      expect(r.status).toBe(202)
      expect(accoda.accodaStorico).toHaveBeenCalledWith(CLIENTE, CONSULENTE, REGISTRO, 2025, true)
      expect(r.body).toMatchObject({ accodate: 5, avvio: 'AVVIATO' })
      const no = await cliente(
        http()
          .post('/rentri/registro/trasmetti-storico')
          .send({ registroId: REGISTRO, anno: 2025, conferma: false })
      )
      expect(no.status).toBe(400)
      expect(no.body.message.join(' ')).toMatch(/conferma/i)
    })

    it('dichiara (ADMIN): passa il ruolo effettivo; motivo vuoto o oltre 500: 400', async () => {
      await avvia('ADMIN')
      const base = {
        registroId: REGISTRO,
        anno: 2026,
        daProgressivo: 1,
        aProgressivo: 5,
        motivo: 'Gia su WinWaste',
      }
      const ok = await cliente(http().post('/rentri/registro/dichiara-gia-trasmessi').send(base))
      expect(ok.status).toBe(200)
      expect(accoda.dichiaraGiaSuRentri).toHaveBeenCalledWith(
        CLIENTE,
        CONSULENTE,
        'ADMIN',
        REGISTRO,
        2026,
        1,
        5,
        'Gia su WinWaste'
      )
      for (const motivo of ['', 'x'.repeat(501)]) {
        const r = await cliente(
          http()
            .post('/rentri/registro/dichiara-gia-trasmessi')
            .send({ ...base, motivo })
        )
        expect(r.status).toBe(400)
      }
    })
  })

  describe("esclusione dall'invio automatico (seguito, 31/10/2026)", () => {
    const url = (azione: string) => `/rentri/registro/movimenti/${MOVIMENTO}/${azione}`

    it('ADMIN effettivo: escludi passa il ruolo effettivo e il motivo; 204', async () => {
      await avvia('ADMIN')
      const r = await cliente(
        http().post(url('escludi-invio-automatico')).send({ motivo: 'Da correggere' })
      )
      expect(r.status).toBe(204)
      expect(accoda.escludiDaInvioAutomatico).toHaveBeenCalledWith(
        CLIENTE,
        CONSULENTE,
        'ADMIN',
        MOVIMENTO,
        'Da correggere'
      )
    })

    it('ADMIN effettivo: includi passa il ruolo effettivo; 204', async () => {
      await avvia('ADMIN')
      const r = await cliente(http().post(url('includi-invio-automatico')))
      expect(r.status).toBe(204)
      expect(accoda.reincludiNellInvioAutomatico).toHaveBeenCalledWith(
        CLIENTE,
        CONSULENTE,
        'ADMIN',
        MOVIMENTO
      )
    })

    it("OPERATOR e VIEWER (anche se il token e' ADMIN): 403 e nessun use case", async () => {
      for (const ruolo of ['OPERATOR', 'VIEWER']) {
        await avvia(ruolo)
        const a = await cliente(http().post(url('escludi-invio-automatico')).send({ motivo: 'x' }))
        const b = await cliente(http().post(url('includi-invio-automatico')))
        expect([a.status, b.status]).toEqual([403, 403])
        expect(accoda.escludiDaInvioAutomatico).not.toHaveBeenCalled()
        expect(accoda.reincludiNellInvioAutomatico).not.toHaveBeenCalled()
        await app.close()
      }
    })

    it('motivo mancante, vuoto, oltre 500 o campi extra: 400 e nessun use case', async () => {
      await avvia('ADMIN')
      for (const corpo of [
        {},
        { motivo: '' },
        { motivo: 'x'.repeat(501) },
        { motivo: 'x', altro: 1 },
      ]) {
        const r = await cliente(http().post(url('escludi-invio-automatico')).send(corpo))
        expect(r.status).toBe(400)
      }
      expect(accoda.escludiDaInvioAutomatico).not.toHaveBeenCalled()
    })

    it('DELETE coda con motivo (ADMIN) lo passa al use case; errori di dominio mappati', async () => {
      await avvia('ADMIN')
      const r = await cliente(
        http()
          .delete(`/rentri/registro/movimenti/${MOVIMENTO}/coda`)
          .send({ motivo: 'Da correggere' })
      )
      expect(r.status).toBe(204)
      expect(accoda.togliDallaCoda).toHaveBeenCalledWith(CLIENTE, CONSULENTE, MOVIMENTO, {
        ruolo: 'ADMIN',
        motivo: 'Da correggere',
      })
      accoda.escludiDaInvioAutomatico.mockRejectedValue(
        new TrasmissioneNonModificabileError("L'annotazione è già esclusa dall'invio automatico.")
      )
      const no = await cliente(http().post(url('escludi-invio-automatico')).send({ motivo: 'x' }))
      expect(no.status).toBe(409)
    })

    it('trasmetti: le annotazioni escluse sono riportate fra le saltate con il loro motivo', async () => {
      await avvia('ADMIN')
      accoda.accoda.mockResolvedValue({
        accodate: 0,
        riaccodate: 0,
        predecessori: 0,
        saltate: 2,
        saltatePerStato: {},
        saltateEscluse: 2,
      })
      const r = await cliente(
        http()
          .post('/rentri/registro/trasmetti')
          .send({ registroId: REGISTRO, movimentoIds: [MOVIMENTO] })
      )
      expect(r.body.saltate).toEqual([
        { motivo: "Esclusa dall'invio automatico: reincludila prima di trasmetterla", numero: 2 },
      ])
      expect(r.body.avvio).toBe('NIENTE_DA_INVIARE')
    })
  })

  describe('coda, verifica, dettaglio, allineamento', () => {
    it('DELETE coda: 204; riga automatica: 409 con la spiegazione del dominio', async () => {
      await avvia('OPERATOR')
      const ok = await cliente(http().delete(`/rentri/registro/movimenti/${MOVIMENTO}/coda`))
      expect(ok.status).toBe(204)
      expect(accoda.togliDallaCoda).toHaveBeenCalledWith(CLIENTE, CONSULENTE, MOVIMENTO, {
        ruolo: 'OPERATOR',
        motivo: undefined,
      })
      accoda.togliDallaCoda.mockRejectedValue(
        new TrasmissioneNonModificabileError(
          "L'annotazione è stata accodata dall'invio automatico."
        )
      )
      const no = await cliente(http().delete(`/rentri/registro/movimenti/${MOVIMENTO}/coda`))
      expect(no.status).toBe(409)
      expect(no.body.message).toBe("L'annotazione è stata accodata dall'invio automatico.")
    })

    it('verifica: restituisce lo stato aggiornato', async () => {
      await avvia('OPERATOR')
      const r = await cliente(http().post(`/rentri/registro/movimenti/${MOVIMENTO}/verifica`))
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ esito: 'TRASMESSA', stato: 'TRASMESSA', messaggio: 'ok' })
      expect(verifica.verifica).toHaveBeenCalledWith(CLIENTE, CONSULENTE, MOVIMENTO)
    })

    it('GET movimenti/:id: il VIEWER legge (dettaglio senza chiamare RENTRI)', async () => {
      await avvia('VIEWER')
      const d = await cliente(http().get(`/rentri/registro/movimenti/${MOVIMENTO}`))
      expect(d.status).toBe(200)
      expect(dettaglio.dettaglio).toHaveBeenCalledWith(CLIENTE, MOVIMENTO)
    })

    it('allineamento (chiama RENTRI): VIEWER 403 senza use case', async () => {
      await avvia('VIEWER')
      const a = await cliente(
        http().get(`/rentri/registro/registri/${REGISTRO}/allineamento?anno=2026`)
      )
      expect(a.status).toBe(403)
      expect(impostazioni.allineamento).not.toHaveBeenCalled()
    })

    it('dettaglio: lettura per ogni ruolo; allineamento (ruolo di scrittura) con anno validato', async () => {
      await avvia('OPERATOR')
      const d = await cliente(http().get(`/rentri/registro/movimenti/${MOVIMENTO}`))
      expect(d.status).toBe(200)
      expect(dettaglio.dettaglio).toHaveBeenCalledWith(CLIENTE, MOVIMENTO)
      const a = await cliente(
        http().get(`/rentri/registro/registri/${REGISTRO}/allineamento?anno=2026`)
      )
      expect(a.status).toBe(200)
      expect(impostazioni.allineamento).toHaveBeenCalledWith(CLIENTE, REGISTRO, 2026)
      const male = await cliente(
        http().get(`/rentri/registro/registri/${REGISTRO}/allineamento?anno=abc`)
      )
      expect(male.status).toBe(400)
      const uuid = await cliente(http().get('/rentri/registro/movimenti/non-un-uuid'))
      expect(uuid.status).toBe(400)
      expect(uuid.body.message).toBe("Identificativo dell'annotazione non valido.")
    })
  })

  describe('mappatura degli errori di dominio (messaggi in italiano, senza id)', () => {
    const casi: Array<[string, Error, number]> = [
      [
        'formato identificativo (regola)',
        new IdentificativoRegistroNonValidoError('Identificativo non valido.'),
        400,
      ],
      [
        'stato non modificabile',
        new TrasmissioneNonModificabileError('Il registro ha già annotazioni trasmesse.'),
        409,
      ],
      ['identificativo gia usato', new IdentificativoGiaUsatoError(), 409],
      ['registro non trovato', new RegistroNonTrovatoError(), 404],
      ['annotazione non trovata', new MovimentoNonTrovatoError(), 404],
      ['ruolo non autorizzato dal dominio', new RuoloNonAutorizzatoRentriError(), 403],
      [
        'richiesta non valida',
        new RichiestaTrasmissioneNonValidaError('Indica da 1 a 1000 annotazioni.'),
        400,
      ],
    ]
    it.each(casi)('%s', async (_nome, errore, status) => {
      await avvia('ADMIN')
      impostazioni.imposta.mockRejectedValue(errore)
      const r = await cliente(
        http()
          .put(`/rentri/registro/registri/${REGISTRO}`)
          .send({ identificativoRentri: 'RABCDE12345', invioAutomatico: false })
      )
      expect(r.status).toBe(status)
      expect(r.body.message).toBe(errore.message)
      expect(r.body.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    })

    it('errore sconosciuto: non travestito', async () => {
      await avvia('ADMIN')
      verifica.verifica.mockRejectedValue(new Error('imprevisto'))
      const r = await cliente(http().post(`/rentri/registro/movimenti/${MOVIMENTO}/verifica`))
      expect(r.status).toBe(500)
    })
  })
})
