/**
 * TemplateService — test unitari sul rendering reale (non mockato) dei
 * modelli email più delicati sul piano del contenuto legale.
 *
 * Copertura mirata al rilievo critico di revisione sullo scadenzario
 * (2026-09-11): il modello `authorization-expiration`, corretto per le
 * autorizzazioni impianto (caso proprio), è FALSO se riusato per un
 * trasportatore o un destinatario in anagrafica — soggetti TERZI. Il nuovo
 * modello dedicato `counterparty-expiration` deve dire la verità e non
 * lasciare campi/titoli in bianco.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { TemplateService } from './template.service'
import { LoggerService } from '../../core/logger/logger.service'

const mockLogger = {
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as LoggerService

describe('TemplateService', () => {
  let service: TemplateService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TemplateService, { provide: LoggerService, useValue: mockLogger }],
    }).compile()

    service = module.get<TemplateService>(TemplateService)
    // `initializeTemplates` gira in background nel costruttore (non atteso):
    // lascia il tempo alla promise di risolversi prima di renderizzare.
    await new Promise(resolve => setImmediate(resolve))
  })

  describe('renderCounterpartyExpiration', () => {
    const basePayload = {
      recipientName: 'Mario Rossi',
      counterpartyKind: 'trasportatore' as const,
      counterpartyName: 'Trasporti Alfa Srl',
      tipoDato: 'Iscrizione Albo Gestori Ambientali',
      identificativo: 'MI/001234',
      expirationDate: '10 settembre 2026',
      isExpired: true,
      counterpartyUrl: 'https://wasteflow.app/trasportatori',
    }

    it('non attribuisce mai al lettore un reato o un\'autorizzazione "della tua azienda"', async () => {
      const html = await service.renderCounterpartyExpiration(basePayload)

      expect(html).not.toMatch(/della tua azienda/i)
      expect(html).not.toMatch(/reato/i)
      expect(html).not.toMatch(/sanzioni penali/i)
      expect(html).not.toMatch(/180 giorni/i)
    })

    it('distingue il caso trasportatore (iscrizione Albo) da quello destinatario (autorizzazione)', async () => {
      const htmlTrasportatore = await service.renderCounterpartyExpiration(basePayload)
      expect(htmlTrasportatore).toMatch(/Albo Gestori Ambientali/i)
      expect(htmlTrasportatore).toMatch(/trasportator/i)

      const htmlDestinatario = await service.renderCounterpartyExpiration({
        ...basePayload,
        counterpartyKind: 'destinatario',
        tipoDato: 'Autorizzazione destinatario',
        counterpartyUrl: 'https://wasteflow.app/destinatari',
      })
      expect(htmlDestinatario).toMatch(/destinatari/i)
      expect(htmlDestinatario).not.toMatch(/Albo Gestori Ambientali/i)
    })

    it('non lascia un titolo seguito da una lista vuota né un campo in bianco quando counterpartyName manca', async () => {
      const html = await service.renderCounterpartyExpiration({
        ...basePayload,
        counterpartyName: undefined,
      })

      // Nessuna etichetta "Ragione sociale:" priva di valore.
      expect(html).not.toMatch(/Ragione sociale:\s*<\/div>/i)
    })

    it('usa un URL assoluto quando fornito (responsabilità del chiamante, non del template)', async () => {
      const html = await service.renderCounterpartyExpiration(basePayload)
      expect(html).toContain('href="https://wasteflow.app/trasportatori"')
    })
  })
})
