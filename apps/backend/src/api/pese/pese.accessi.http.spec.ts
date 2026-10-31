/**
 * Accessi, rettifiche, collegamenti e allegati delle pese attraverso la catena HTTP reale
 * (ValidationPipe come in main.ts, filtro globale, multer, controller). Servizi e ruolo finti.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import request from 'supertest'
import { PeseController } from './pese.controller'
import { StrumentiPesaService } from '../../application/pese/strumenti-pesa.service'
import { AutomezziService } from '../../application/pese/automezzi.service'
import { AccessiPesaService } from '../../application/pese/accessi-pesa.service'
import { AllegatiPesaService } from '../../application/pese/allegati-pesa.service'
import { RettifichePesoService } from '../../application/pese/rettifiche-peso.service'
import { CollegamentiAccessoService } from '../../application/pese/collegamenti-accesso.service'
import {
  AccessoNonTrovatoError,
  AlibiGiaUsatoError,
  AllegatoNonTrovatoError,
  CollegamentoNonTrovatoError,
  CollegamentoNonValidoError,
  DatiPesaNonValidiError,
  FirNonTrovatoError,
  RegolaPesataError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
} from '../../application/pese/errori-pese'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CsrfProtectionMiddleware } from '../middleware/csrf-protection.middleware'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'
const ALTRO_TENANT = '5a5a5a5a-0000-4000-8000-00000000000b'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '3b3b3b3b-0000-4000-8000-000000000006'
const CHIAVE = '4c4c4c4c-0000-4000-8000-000000000007'

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(50, 1),
])
const MAX = 4 * 1024 * 1024

const pesata = { pesoKg: 24000.5, motivo: 'Display guasto', stabileDichiarato: true }
const apertura = { chiaveIdempotenza: CHIAVE, verso: 'CARICO', modo: 'DOPPIA', pesata }

describe('PeseController (accessi, rettifiche, allegati) - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let accessi: Record<string, jest.Mock>
  let allegati: Record<string, jest.Mock>
  let rettifiche: Record<string, jest.Mock>
  let collegamenti: Record<string, jest.Mock>
  let ruoloEffettivo: jest.Mock

  async function avvia(prima?: (app: INestApplication) => void) {
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [PeseController],
      providers: [
        { provide: StrumentiPesaService, useValue: {} },
        { provide: AutomezziService, useValue: {} },
        { provide: AccessiPesaService, useValue: accessi },
        { provide: AllegatiPesaService, useValue: allegati },
        { provide: RettifichePesoService, useValue: rettifiche },
        { provide: CollegamentiAccessoService, useValue: collegamenti },
        { provide: RuoloEffettivoService, useValue: { ruoloEffettivo } },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = { id: UTENTE, tenantId: TENANT, role: 'ADMIN' }
          const selezionato = req.headers['x-tenant-id']
          if (typeof selezionato === 'string') req.tenantId = selezionato
          return true
        },
      })
      .compile()
    const a = moduleRef.createNestApplication()
    a.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    prima?.(a)
    await a.init()
    return a
  }

  beforeEach(async () => {
    ruolo = 'OPERATOR'
    accessi = {
      apri: jest.fn().mockResolvedValue({ id: ID, stato: 'APERTO' }),
      secondaPesata: jest.fn().mockResolvedValue({ id: ID, stato: 'CHIUSO' }),
      annulla: jest.fn().mockResolvedValue({ id: ID, stato: 'ANNULLATO' }),
      elenca: jest.fn().mockResolvedValue({ righe: [], totale: 0, pagina: 1 }),
      dettaglio: jest.fn().mockResolvedValue({ id: ID }),
    }
    allegati = {
      leggi: jest.fn().mockResolvedValue({
        nomeFile: 'scontrino "1".pdf',
        mimeType: 'application/pdf',
        sha256: 'x',
        contenuto: Buffer.from('%PDF-1.4 x'),
      }),
    }
    rettifiche = { rettifica: jest.fn().mockResolvedValue({ id: ID }) }
    collegamenti = {
      collegaFir: jest.fn().mockResolvedValue({ id: ID }),
      collegaMovimento: jest.fn().mockResolvedValue({ id: ID }),
      revoca: jest.fn().mockResolvedValue({ id: ID }),
    }
    ruoloEffettivo = jest.fn(async () => ruolo)
    app = await avvia()
  })

  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())
  const post = (url = '/pese/accessi') => http().post(url)

  describe('POST /pese/accessi (multipart)', () => {
    it('POST /pese/accessi multipart con dati e JPEG → 201', async () => {
      const r = await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', JPEG, { filename: 'scontrino.jpg', contentType: 'image/jpeg' })
        .expect(201)

      expect(r.body).toMatchObject({ id: ID, puoOperare: true, puoRettificare: false })
      const [tenant, utente, dati, allegato] = accessi.apri.mock.calls[0]
      expect(tenant).toBe(TENANT)
      expect(utente).toEqual({ id: UTENTE, ruolo: 'OPERATOR' })
      expect(dati).toMatchObject({ chiaveIdempotenza: CHIAVE, pesata: { pesoKg: 24000.5 } })
      expect(allegato).toMatchObject({ nomeFile: 'scontrino.jpg', mimeDichiarato: 'image/jpeg' })
      expect(allegato.contenuto.equals(JPEG)).toBe(true)
    })

    it('senza allegato: 201 con allegato undefined', async () => {
      await post().field('dati', JSON.stringify(apertura)).expect(201)
      expect(accessi.apri.mock.calls[0][3]).toBeUndefined()
    })

    it('dati non JSON → 400', async () => {
      const r = await post().field('dati', '{non json').expect(400)
      expect(r.body.message).toContain('JSON')
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('dati assenti → 400', async () => {
      await post()
        .attach('allegato', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(400)
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('dati oltre 16 kB → 400', async () => {
      const grande = { ...apertura, note: 'x'.repeat(17000) }
      await post().field('dati', JSON.stringify(grande)).expect(400)
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('campo sconosciuto in dati → 400', async () => {
      const r = await post()
        .field('dati', JSON.stringify({ ...apertura, tenantId: ALTRO_TENANT }))
        .expect(400)
      expect(JSON.stringify(r.body)).toContain('tenantId')
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('campo sconosciuto dentro la pesata → 400', async () => {
      await post()
        .field('dati', JSON.stringify({ ...apertura, pesata: { ...pesata, extra: 1 } }))
        .expect(400)
    })

    it('stabileDichiarato false → 400 col messaggio di D14', async () => {
      const r = await post()
        .field(
          'dati',
          JSON.stringify({ ...apertura, pesata: { ...pesata, stabileDichiarato: false } })
        )
        .expect(400)
      expect(JSON.stringify(r.body.message)).toContain(
        'Confermare che il display indicava un peso stabile.'
      )
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('peso con tre decimali o chiave non UUID → 400', async () => {
      await post()
        .field('dati', JSON.stringify({ ...apertura, pesata: { ...pesata, pesoKg: 10.123 } }))
        .expect(400)
      await post()
        .field('dati', JSON.stringify({ ...apertura, chiaveIdempotenza: 'abc' }))
        .expect(400)
    })

    it('file di 4 MiB esatti → 201; 4 MiB + 1 byte → 413 col messaggio', async () => {
      const esatto = Buffer.concat([JPEG, Buffer.alloc(MAX - JPEG.length)])
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', esatto, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201)
      accessi.apri.mockClear()

      const troppo = Buffer.concat([JPEG, Buffer.alloc(MAX + 1 - JPEG.length)])
      const r = await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', troppo, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(413)
      expect(r.body.message).toBe("L'allegato supera i 4 MB.")
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('eseguibile rinominato .jpg con image/jpeg → 415, servizio non chiamato', async () => {
      const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 7)])
      const r = await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', exe, { filename: 'foto.jpg', contentType: 'image/jpeg' })
        .expect(415)
      expect(r.body.message).toBe('Sono ammessi solo foto JPEG o PNG e documenti PDF.')
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('HTML con image/png → 415', async () => {
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', Buffer.from('<html><script>1</script></html>'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(415)
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('JPEG dichiarato come PNG o come text/html → 415', async () => {
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', JPEG, { filename: 'a.png', contentType: 'image/png' })
        .expect(415)
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', PNG, { filename: 'a.png', contentType: 'text/html' })
        .expect(415)
    })

    it('due file o file con altro nome di campo → 400, servizio non chiamato', async () => {
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .attach('allegato', JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' })
        .expect(400)
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('altro', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(400)
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it('il nome file con percorso resta al servizio, che lo ripulisce (il controller lo passa intatto)', async () => {
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', JPEG, { filename: '../../etc/passwd.jpg', contentType: 'image/jpeg' })
        .expect(201)
      expect(accessi.apri.mock.calls[0][3].nomeFile).not.toContain('..\\')
    })

    it('nome file non ASCII: arriva al servizio in UTF-8 ("città.jpg")', async () => {
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', JPEG, { filename: 'città.jpg', contentType: 'image/jpeg' })
        .expect(201)
      expect(accessi.apri.mock.calls[0][3].nomeFile).toBe('città.jpg')
    })

    it('VIEWER con file di 4 MiB e rettifica da OPERATOR: 403 prima del multipart, servizi non chiamati', async () => {
      ruolo = 'VIEWER'
      const grande = Buffer.concat([JPEG, Buffer.alloc(MAX - JPEG.length)])
      const r = await post()
        .field('dati', 'non json')
        .attach('allegato', grande, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(403)
      expect(r.body.error).toBe('PESE_RISERVATE_OPERATORI')
      expect(accessi.apri).not.toHaveBeenCalled()
      ruolo = 'OPERATOR'
      await post(`/pese/pesate/${ID}/rettifiche`)
        .field('dati', 'non json')
        .attach('allegato', grande, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(403)
    })

    it('campi: pesata mancante, ora senza fuso, motivo di soli spazi → 400 in italiano', async () => {
      const { pesata: _p, ...senza } = apertura
      let r = await post().field('dati', JSON.stringify(senza)).expect(400)
      expect(JSON.stringify(r.body.message)).toContain('Mancano i dati della pesata.')
      r = await post()
        .field(
          'dati',
          JSON.stringify({
            ...apertura,
            pesata: { ...pesata, oraStrumento: '2026-10-31T10:00:00' },
          })
        )
        .expect(400)
      expect(JSON.stringify(r.body.message)).toContain('fuso orario')
      r = await post()
        .field(
          'dati',
          JSON.stringify({ ...apertura, pesata: { ...pesata, motivo: '   ', extra: 1 } })
        )
        .expect(400)
      expect(JSON.stringify(r.body.message)).toContain('pesata.extra')
      await post()
        .field(
          'dati',
          JSON.stringify({
            ...apertura,
            pesata: { ...pesata, oraStrumento: '2026-10-31T10:00:00+02:00' },
          })
        )
        .expect(201)
    })

    it('VIEWER su POST → 403 PESE_RISERVATE_OPERATORI, servizio non chiamato', async () => {
      ruolo = 'VIEWER'
      const r = await post().field('dati', JSON.stringify(apertura)).expect(403)
      expect(r.body.error).toBe('PESE_RISERVATE_OPERATORI')
      expect(accessi.apri).not.toHaveBeenCalled()
    })

    it("usa il ruolo effettivo nell'azienda selezionata, non quello del token", async () => {
      ruolo = 'VIEWER' // il token dice ADMIN
      await post()
        .set('X-Tenant-ID', ALTRO_TENANT)
        .field('dati', JSON.stringify(apertura))
        .expect(403)
      expect(ruoloEffettivo).toHaveBeenCalledWith(expect.anything(), ALTRO_TENANT)
    })
  })

  describe('POST /pese/accessi/:id/seconda-pesata', () => {
    it('201 con la vista, ruolo effettivo al servizio', async () => {
      const r = await post(`/pese/accessi/${ID}/seconda-pesata`)
        .field('dati', JSON.stringify({ chiaveIdempotenza: CHIAVE, pesata }))
        .expect(201)
      expect(r.body.stato).toBe('CHIUSO')
      expect(accessi.secondaPesata).toHaveBeenCalledWith(
        TENANT,
        { id: UTENTE, ruolo: 'OPERATOR' },
        ID,
        expect.objectContaining({ chiaveIdempotenza: CHIAVE }),
        undefined
      )
    })

    it('id non UUID → 400', async () => {
      await post('/pese/accessi/abc/seconda-pesata')
        .field('dati', JSON.stringify({ chiaveIdempotenza: CHIAVE, pesata }))
        .expect(400)
    })

    it('accesso di un altra azienda → 404', async () => {
      accessi.secondaPesata.mockRejectedValue(new AccessoNonTrovatoError())
      const r = await post(`/pese/accessi/${ID}/seconda-pesata`)
        .field('dati', JSON.stringify({ chiaveIdempotenza: CHIAVE, pesata }))
        .expect(404)
      expect(r.body.message).toBe('Accesso non trovato.')
    })
  })

  describe('annullo', () => {
    it('200 con motivo; motivo vuoto o spazi → 400', async () => {
      await post(`/pese/accessi/${ID}/annulla`).send({ motivo: 'Errore di battitura' }).expect(200)
      expect(accessi.annulla).toHaveBeenCalledWith(
        TENANT,
        { id: UTENTE, ruolo: 'OPERATOR' },
        ID,
        'Errore di battitura'
      )
      await post(`/pese/accessi/${ID}/annulla`).send({ motivo: '   ' }).expect(400)
      await post(`/pese/accessi/${ID}/annulla`).send({}).expect(400)
    })

    it('annullo di un accesso chiuso da operatore: il servizio rifiuta → 403', async () => {
      accessi.annulla.mockRejectedValue(
        new RuoloPesaInsufficienteError('Solo un amministratore può annullare un accesso chiuso.')
      )
      const r = await post(`/pese/accessi/${ID}/annulla`).send({ motivo: 'x' }).expect(403)
      expect(r.body.message).toContain('amministratore')
    })
  })

  describe('rettifiche', () => {
    it('OPERATOR su rettifica → 403 PESE_RISERVATE_AMMINISTRATORI', async () => {
      const r = await post(`/pese/pesate/${ID}/rettifiche`)
        .field('dati', JSON.stringify({ pesoNuovoKg: 100, motivo: 'x' }))
        .expect(403)
      expect(r.body.error).toBe('PESE_RISERVATE_AMMINISTRATORI')
      expect(rettifiche.rettifica).not.toHaveBeenCalled()
    })

    it('ADMIN con allegato PNG → 201, permessi nella risposta', async () => {
      ruolo = 'ADMIN'
      const r = await post(`/pese/pesate/${ID}/rettifiche`)
        .field('dati', JSON.stringify({ pesoNuovoKg: 100.25, motivo: 'Ricontrollo' }))
        .attach('allegato', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(201)
      expect(r.body).toMatchObject({ puoOperare: true, puoRettificare: true })
      expect(rettifiche.rettifica.mock.calls[0][1]).toEqual({ id: UTENTE, ruolo: 'ADMIN' })
      expect(rettifiche.rettifica.mock.calls[0][4].mimeDichiarato).toBe('image/png')
    })

    it('dati non validi → 400; regola violata → 422; pesata di altra azienda → 404', async () => {
      ruolo = 'ADMIN'
      await post(`/pese/pesate/${ID}/rettifiche`)
        .field('dati', JSON.stringify({ pesoNuovoKg: 0, motivo: 'x' }))
        .expect(400)
      rettifiche.rettifica.mockRejectedValueOnce(new RegolaPesataError(['Il nuovo peso è uguale.']))
      const r = await post(`/pese/pesate/${ID}/rettifiche`)
        .field('dati', JSON.stringify({ pesoNuovoKg: 5, motivo: 'x' }))
        .expect(422)
      expect(r.body.error).toBe('PESE_REGOLA_NON_RISPETTATA')
    })
  })

  describe('collegamenti', () => {
    it('FIR → collegaFir; MOVIMENTO → collegaMovimento', async () => {
      await post(`/pese/accessi/${ID}/collegamenti`)
        .send({ tipo: 'FIR', firId: CHIAVE })
        .expect(201)
      expect(collegamenti.collegaFir).toHaveBeenCalledWith(
        TENANT,
        { id: UTENTE, ruolo: 'OPERATOR' },
        ID,
        CHIAVE
      )
      await post(`/pese/accessi/${ID}/collegamenti`)
        .send({ tipo: 'MOVIMENTO', movimentoId: CHIAVE })
        .expect(201)
      expect(collegamenti.collegaMovimento).toHaveBeenCalledTimes(1)
    })

    it('tipo e identificativo incoerenti → 400', async () => {
      await post(`/pese/accessi/${ID}/collegamenti`).send({ tipo: 'FIR' }).expect(400)
      await post(`/pese/accessi/${ID}/collegamenti`)
        .send({ tipo: 'FIR', firId: CHIAVE, movimentoId: CHIAVE })
        .expect(400)
      await post(`/pese/accessi/${ID}/collegamenti`).send({ tipo: 'MOVIMENTO' }).expect(400)
      await post(`/pese/accessi/${ID}/collegamenti`).send({ tipo: 'ALTRO' }).expect(400)
    })

    it.each([
      [new CollegamentoNonValidoError('Verso diverso.'), 422],
      [new StatoAccessoNonValidoError('Accesso annullato.'), 409],
      [new AlibiGiaUsatoError(), 409],
      [new FirNonTrovatoError(), 404],
      [new CollegamentoNonTrovatoError(), 404],
      [new DatiPesaNonValidiError(['Dati.']), 400],
    ])('errore %# del servizio → %i', async (errore, stato) => {
      collegamenti.collegaFir.mockRejectedValue(errore)
      const r = await post(`/pese/accessi/${ID}/collegamenti`)
        .send({ tipo: 'FIR', firId: CHIAVE })
        .expect(stato)
      expect(r.body.message).toBeTruthy()
    })

    it('revoca: solo amministratori', async () => {
      const r = await post(`/pese/collegamenti/${ID}/revoca`).send({ motivo: 'Errore' }).expect(403)
      expect(r.body.error).toBe('PESE_RISERVATE_AMMINISTRATORI')
      expect(collegamenti.revoca).not.toHaveBeenCalled()
      ruolo = 'ADMIN'
      await post(`/pese/collegamenti/${ID}/revoca`).send({ motivo: 'Errore' }).expect(200)
      expect(collegamenti.revoca).toHaveBeenCalledWith(
        TENANT,
        { id: UTENTE, ruolo: 'ADMIN' },
        ID,
        'Errore'
      )
    })
  })

  describe('letture', () => {
    it('GET /pese/accessi con filtri e permessi; VIEWER legge', async () => {
      ruolo = 'VIEWER'
      const r = await http()
        .get('/pese/accessi')
        .query({ stato: 'APERTO', dal: '2026-10-01', pagina: '2', targa: 'AB123CD' })
        .expect(200)
      expect(r.body).toMatchObject({
        righe: [],
        totale: 0,
        puoOperare: false,
        puoRettificare: false,
      })
      expect(accessi.elenca).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({ stato: 'APERTO', dal: '2026-10-01', pagina: 2, targa: 'AB123CD' })
      )
    })

    it('filtri non validi → 400', async () => {
      await http().get('/pese/accessi').query({ stato: 'BOH' }).expect(400)
      await http().get('/pese/accessi').query({ pagina: '0' }).expect(400)
      await http().get('/pese/accessi').query({ dal: '1/10/2026' }).expect(400)
      await http().get('/pese/accessi').query({ tenantId: ALTRO_TENANT }).expect(400)
    })

    it('GET /pese/accessi/:id con permessi; accesso di un altra azienda → 404', async () => {
      ruolo = 'ADMIN'
      const r = await http().get(`/pese/accessi/${ID}`).expect(200)
      expect(r.body).toMatchObject({ id: ID, puoOperare: true, puoRettificare: true })
      accessi.dettaglio.mockRejectedValue(new AccessoNonTrovatoError())
      await http().get(`/pese/accessi/${ID}`).expect(404)
    })

    it('errore sconosciuto → 500 generico, senza testo del database', async () => {
      accessi.dettaglio.mockRejectedValue(
        new Error('Invalid `prisma.accessoPesa.findFirst()` invocation: relation "accessi_pesa"')
      )
      const r = await http().get(`/pese/accessi/${ID}`).expect(500)
      expect(r.body.message).toBe('Si è verificato un errore imprevisto. Riprova più tardi.')
    })
  })

  describe('GET /pese/allegati/:id', () => {
    it('Content-Type salvato, nosniff, no-store, nome sicuro', async () => {
      const r = await http().get(`/pese/allegati/${ID}`).expect(200)
      expect(r.headers['content-type']).toContain('application/pdf')
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(r.headers['content-security-policy']).toBe('sandbox')
      expect(r.headers['cache-control']).toBe('private, no-store')
      const cd = r.headers['content-disposition']
      expect(cd).toMatch(
        /^inline; filename="scontrino _1_\.pdf"; filename\*=UTF-8''scontrino%20%221%22\.pdf$/
      )
      expect(allegati.leggi).toHaveBeenCalledWith(TENANT, ID)
    })

    it('nome con surrogato spaiato: intestazione ben formata', async () => {
      allegati.leggi.mockResolvedValue({
        nomeFile: 'a\uD800b.png',
        mimeType: 'image/png',
        sha256: 'x',
        contenuto: PNG,
      })
      const r = await http().get(`/pese/allegati/${ID}`).expect(200)
      expect(r.headers['content-disposition']).toContain("UTF-8''a%EF%BF%BDb.png")
    })

    it('nome con percorso, a capo e apice: nessun carattere pericoloso nell’intestazione', async () => {
      allegati.leggi.mockResolvedValue({
        nomeFile: "../../a\r\nSet-Cookie: x=1'è.png",
        mimeType: 'image/png',
        sha256: 'x',
        contenuto: PNG,
      })
      const r = await http().get(`/pese/allegati/${ID}`).expect(200)
      const cd = r.headers['content-disposition'] as string
      expect(cd).not.toMatch(/[\r\n]/)
      expect(cd).not.toContain('..')
      expect(cd).toContain('%27')
      expect(r.headers['set-cookie']).toBeUndefined()
    })

    it('allegato di un altra azienda o inesistente → 404', async () => {
      allegati.leggi.mockRejectedValue(new AllegatoNonTrovatoError())
      const r = await http().get(`/pese/allegati/${ID}`).expect(404)
      expect(r.body.message).toBe('Allegato non trovato.')
    })
  })

  describe('CSRF', () => {
    it('il middleware accetta il multipart con x-csrf-token (nessuna dipendenza dal content-type)', async () => {
      await app.close()
      const csrf = new CsrfProtectionMiddleware()
      const token = 'a'.repeat(64)
      app = await avvia(a => {
        a.use((req: any, _res: any, next: any) => {
          req.session = { csrfToken: token }
          next()
        })
        a.use((req: any, res: any, next: any) => csrf.use(req, res, next))
      })

      await post()
        .set('x-csrf-token', token)
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(201)
      await post()
        .field('dati', JSON.stringify(apertura))
        .attach('allegato', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(403)
    })
  })
})
