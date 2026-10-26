import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { argomentiCustom } from '../../test-support/argomenti-handler'
import { RentriFirLifecycleController } from './rentri-fir-lifecycle.controller'
import { DomainException } from '../../domain/shared/domain-exception'
import { traduciErroreRentri } from '../../application/rentri/rentri-error-presentation'

/**
 * RentriFirLifecycleController — `GET :id/pdf` (R3 Task 7).
 *
 * Il controller è istanziato direttamente con dipendenze mockate (stesso
 * stile di `pdf.controller.spec.ts`): evita il bootstrap di
 * JwtAuthGuard/RolesGuard/TestingModule, irrilevante per verificare la
 * logica del singolo metodo.
 *
 * **Il punto che questa suite dimostra**: l'endpoint è un TRAMITE (scarica
 * il PDF e lo trasmette come byte), non un redirect. Se il controller
 * chiamasse `res.redirect(...)` verso il portale RENTRI, il criterio di
 * valore del programma (l'utente non cambia mai piattaforma) sarebbe
 * violato — la suite verifica ESPLICITAMENTE che `res.redirect` non venga
 * mai chiamato e che i byte trasmessi a `res.send` corrispondano
 * esattamente al contenuto decodificato dallo use case, non a un URL.
 */
describe('RentriFirLifecycleController — scaricaPdf', () => {
  const FIR_ID = 'fir-1'
  const TENANT_ID = 'tenant-1'
  const USER_ID = 'utente-1'

  let controller: RentriFirLifecycleController
  let scaricaPdfFirUseCase: { execute: jest.Mock }
  let res: { set: jest.Mock; send: jest.Mock; status: jest.Mock; redirect: jest.Mock }

  function creaLogger(): any {
    return {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
  }

  beforeEach(() => {
    scaricaPdfFirUseCase = { execute: jest.fn() }
    res = {
      set: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
      redirect: jest.fn(),
    }

    controller = new RentriFirLifecycleController(
      {} as any, // GetAzioniDisponibiliUseCase — non usato da questo endpoint
      {} as any, // AccettaORespingiFIRUseCase
      {} as any, // AnnullaFIRRentriUseCase
      {} as any, // GestisciAllegatiFIRUseCase
      scaricaPdfFirUseCase as any,
      creaLogger(),
      {} as any
    )
  })

  it('trasmette i byte del PDF (TRAMITE) e non chiama MAI un redirect al portale RENTRI', async () => {
    const contenutoBase64 = Buffer.from('%PDF-1.4 contenuto di prova').toString('base64')
    scaricaPdfFirUseCase.execute.mockResolvedValue({
      disponibile: true,
      nomeFile: 'FIR-BCDFGH00001JK.pdf',
      mime: 'application/pdf',
      contenutoBase64,
    })

    await controller.scaricaPdf(FIR_ID, TENANT_ID, USER_ID, res as any)

    expect(scaricaPdfFirUseCase.execute).toHaveBeenCalledWith(FIR_ID, TENANT_ID)
    expect(res.redirect).not.toHaveBeenCalled()

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': expect.stringContaining('FIR-BCDFGH00001JK.pdf'),
      })
    )

    // I byte trasmessi sono ESATTAMENTE quelli decodificati dal contenuto
    // restituito dallo use case: prova che il controller trasmette il
    // documento stesso, non un riferimento/URL a esso.
    const bufferInviato = res.send.mock.calls[0][0]
    expect(Buffer.isBuffer(bufferInviato)).toBe(true)
    expect(bufferInviato.toString('base64')).toBe(contenutoBase64)
  })

  it('risponde 204, non un errore, quando il PDF non è ancora disponibile presso l’ente', async () => {
    scaricaPdfFirUseCase.execute.mockResolvedValue({ disponibile: false })

    await controller.scaricaPdf(FIR_ID, TENANT_ID, USER_ID, res as any)

    expect(res.status).toHaveBeenCalledWith(204)
    expect(res.redirect).not.toHaveBeenCalled()
  })

  it('mappa NOT_FOUND (FIR inesistente o di un altro tenant) su 404, non 403/401', async () => {
    scaricaPdfFirUseCase.execute.mockRejectedValue(DomainException.notFound('FIR', FIR_ID))

    await expect(
      controller.scaricaPdf(FIR_ID, TENANT_ID, USER_ID, res as any)
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(res.send).not.toHaveBeenCalled()
  })

  it('mappa un FIR non legato a RENTRI su 400', async () => {
    scaricaPdfFirUseCase.execute.mockRejectedValue(
      DomainException.businessRuleViolation('FIR_NON_LEGATO_RENTRI', 'non legato')
    )

    await expect(
      controller.scaricaPdf(FIR_ID, TENANT_ID, USER_ID, res as any)
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(res.send).not.toHaveBeenCalled()
  })
})

/**
 * RentriFirLifecycleController — traduzione dei sei `errorCode` del Task 9
 * (debito Task 10, Parte 0).
 *
 * Prima di questa modifica, ogni endpoint faceva sempre
 * `BadRequestException(error.message)` — il messaggio grezzo di
 * `DomainException.businessRuleViolation`, col prefisso tecnico
 * "Business rule violated: <regola>." mai tradotto. Questa suite dimostra
 * che, per i sei `errorCode` gestiti da `traduciErroreRentri` (R3 Task 9),
 * l'eccezione HTTP porta ESATTAMENTE il testo prodotto da quella funzione —
 * non solo un testo che "contiene" qualcosa — e che il prefisso grezzo non
 * trapela mai. Include anche un test di non-regressione: un `rule` non
 * tradotto continua a propagare `error.message` invariato (il fallback di
 * `mappaErroreDominio`).
 */
describe('RentriFirLifecycleController — traduzione errori Task 9', () => {
  const FIR_ID = 'fir-1'
  const TENANT_ID = 'tenant-1'
  const USER_ID = 'utente-1'

  const REQ = { user: { id: USER_ID, role: 'ADMIN', tenantId: 'altra-azienda' } }
  const ruolo = { ruoloEffettivo: jest.fn() }

  let controller: RentriFirLifecycleController
  let getAzioniDisponibiliUseCase: { execute: jest.Mock }
  let accettaORespingiFIRUseCase: { execute: jest.Mock }
  let annullaFIRRentriUseCase: { execute: jest.Mock }
  let gestisciAllegatiFIRUseCase: {
    elencaAllegati: jest.Mock
    caricaAllegato: jest.Mock
    eliminaAllegato: jest.Mock
  }

  function creaLogger(): any {
    return {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
  }

  /** Verifica comune: nessun prefisso tecnico grezzo nel messaggio esposto. */
  function assertNessunPrefissoTecnico(messaggio: string): void {
    expect(messaggio).not.toContain('Business rule violated')
    expect(messaggio).not.toMatch(
      /ACCETTAZIONE_NON_DISPONIBILE|ANNULLAMENTO_NON_DISPONIBILE|ALLEGATO_NON_DISPONIBILE|FIRMA_RENTRI_RIFIUTATA|FORMATO_ALLEGATO_NON_AMMESSO|ALLEGATO_TROPPO_GRANDE/
    )
  }

  /**
   * Cattura l'eccezione lanciata da `esecuzione` (fallisce il test se non ne
   * lancia nessuna). Preferito a `.rejects.toMatchObject({constructor: ...})`
   * — non affidabile per verificare instanceof — permette di asserire
   * SEPARATAMENTE tipo (`toBeInstanceOf`) e testo ESATTO del messaggio sulla
   * stessa eccezione catturata una sola volta.
   */
  async function catturaErrore(esecuzione: () => Promise<unknown>): Promise<Error> {
    try {
      await esecuzione()
    } catch (errore) {
      return errore as Error
    }
    throw new Error('Era attesa un’eccezione, ma la chiamata è andata a buon fine')
  }

  beforeEach(() => {
    getAzioniDisponibiliUseCase = { execute: jest.fn() }
    ruolo.ruoloEffettivo.mockReset()
    ruolo.ruoloEffettivo.mockResolvedValue('OPERATOR')
    accettaORespingiFIRUseCase = { execute: jest.fn() }
    annullaFIRRentriUseCase = { execute: jest.fn() }
    gestisciAllegatiFIRUseCase = {
      elencaAllegati: jest.fn(),
      caricaAllegato: jest.fn(),
      eliminaAllegato: jest.fn(),
    }

    controller = new RentriFirLifecycleController(
      getAzioniDisponibiliUseCase as any,
      accettaORespingiFIRUseCase as any,
      annullaFIRRentriUseCase as any,
      gestisciAllegatiFIRUseCase as any,
      {} as any, // ScaricaPdfFirUseCase — non usato da questi test
      creaLogger(),
      ruolo as any
    )
  })

  it('ACCETTAZIONE_NON_DISPONIBILE (POST :id/accettazione) → messaggio tradotto, senza prefisso tecnico', async () => {
    accettaORespingiFIRUseCase.execute.mockRejectedValue(
      DomainException.businessRuleViolation(
        'ACCETTAZIONE_NON_DISPONIBILE',
        'Questo formulario non è nella fase di accettazione: nessuna operazione è stata inviata a RENTRI.'
      )
    )

    const atteso = traduciErroreRentri({ errorCode: 'ACCETTAZIONE_NON_DISPONIBILE' }).messaggio

    const errore = await catturaErrore(() =>
      controller.accettaORespingi(
        FIR_ID,
        { tipoAccettazione: 'TOTALE' } as any,
        TENANT_ID,
        USER_ID,
        REQ
      )
    )
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe(atteso)
    assertNessunPrefissoTecnico(atteso)
  })

  it('ANNULLAMENTO_NON_DISPONIBILE (POST :id/annullamento) → messaggio tradotto, senza prefisso tecnico', async () => {
    annullaFIRRentriUseCase.execute.mockRejectedValue(
      DomainException.businessRuleViolation(
        'ANNULLAMENTO_NON_DISPONIBILE',
        'Questo formulario non è nella fase di annullamento.'
      )
    )

    const atteso = traduciErroreRentri({ errorCode: 'ANNULLAMENTO_NON_DISPONIBILE' }).messaggio

    const errore = await catturaErrore(() =>
      controller.annulla(FIR_ID, { motivo: 'errore di battitura' } as any, TENANT_ID, USER_ID, REQ)
    )
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe(atteso)
    assertNessunPrefissoTecnico(atteso)
  })

  it('ALLEGATO_NON_DISPONIBILE (DELETE :id/allegati/:allegatoId) → messaggio tradotto, senza prefisso tecnico', async () => {
    gestisciAllegatiFIRUseCase.eliminaAllegato.mockRejectedValue(
      DomainException.businessRuleViolation(
        'ALLEGATO_NON_DISPONIBILE',
        'Il caricamento allegati non è disponibile in questa fase.'
      )
    )

    const atteso = traduciErroreRentri({ errorCode: 'ALLEGATO_NON_DISPONIBILE' }).messaggio

    const errore = await catturaErrore(() =>
      controller.eliminaAllegato(FIR_ID, 'allegato-1', TENANT_ID, USER_ID, REQ)
    )
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe(atteso)
    assertNessunPrefissoTecnico(atteso)
  })

  it("FIRMA_RENTRI_RIFIUTATA (accettazione) → messaggio tradotto che nomina l'operazione, senza prefisso tecnico", async () => {
    const messaggioGrezzo =
      "L'ente ha rifiutato la firma del formulario 123: l'operazione ACCETTAZIONE NON è stata completata. Dettaglio della validazione RENTRI: []"
    accettaORespingiFIRUseCase.execute.mockRejectedValue(
      DomainException.businessRuleViolation('FIRMA_RENTRI_RIFIUTATA', messaggioGrezzo)
    )

    const atteso = traduciErroreRentri({
      errorCode: 'FIRMA_RENTRI_RIFIUTATA',
      errorMessage: DomainException.businessRuleViolation('FIRMA_RENTRI_RIFIUTATA', messaggioGrezzo)
        .message,
    }).messaggio

    const errore = await catturaErrore(() =>
      controller.accettaORespingi(
        FIR_ID,
        { tipoAccettazione: 'TOTALE' } as any,
        TENANT_ID,
        USER_ID,
        REQ
      )
    )
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe(atteso)
    // Prova che l'operazione è stata riconosciuta (regex su error.message
    // completo, non sul solo `details` passato qui): mai il fallback generico.
    expect(atteso).toBe("L'accettazione non si è completata sull'ente: puoi riprovare.")
    assertNessunPrefissoTecnico(atteso)
  })

  it('FORMATO_ALLEGATO_NON_AMMESSO (POST :id/allegati) → messaggio tradotto, senza prefisso tecnico', async () => {
    gestisciAllegatiFIRUseCase.caricaAllegato.mockRejectedValue(
      DomainException.businessRuleViolation(
        'FORMATO_ALLEGATO_NON_AMMESSO',
        'Sono accettati solo allegati in formato PDF.'
      )
    )

    const atteso = traduciErroreRentri({ errorCode: 'FORMATO_ALLEGATO_NON_AMMESSO' }).messaggio

    const errore = await catturaErrore(() =>
      controller.caricaAllegato(
        FIR_ID,
        { nomeFile: 'documento.txt', contentType: 'text/plain', contenutoBase64: 'AAAA' } as any,
        TENANT_ID,
        USER_ID,
        REQ
      )
    )
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe(atteso)
    assertNessunPrefissoTecnico(atteso)
  })

  it('ALLEGATO_TROPPO_GRANDE (POST :id/allegati) → messaggio tradotto, senza prefisso tecnico', async () => {
    gestisciAllegatiFIRUseCase.caricaAllegato.mockRejectedValue(
      DomainException.businessRuleViolation(
        'ALLEGATO_TROPPO_GRANDE',
        'Il file supera la dimensione massima di 1 MB.'
      )
    )

    const atteso = traduciErroreRentri({ errorCode: 'ALLEGATO_TROPPO_GRANDE' }).messaggio

    const errore = await catturaErrore(() =>
      controller.caricaAllegato(
        FIR_ID,
        {
          nomeFile: 'documento.pdf',
          contentType: 'application/pdf',
          contenutoBase64: 'AAAA',
        } as any,
        TENANT_ID,
        USER_ID,
        REQ
      )
    )
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe(atteso)
    assertNessunPrefissoTecnico(atteso)
  })

  it('non-regressione: un `rule` NON tradotto (FIR_NON_LEGATO_RENTRI) propaga error.message invariato, il fallback non si rompe', async () => {
    const eccezione = DomainException.businessRuleViolation(
      'FIR_NON_LEGATO_RENTRI',
      'Il FIR non è legato a un formulario RENTRI.'
    )
    getAzioniDisponibiliUseCase.execute.mockRejectedValue(eccezione)

    const errore = await catturaErrore(() =>
      controller.getAzioniDisponibili(FIR_ID, TENANT_ID, USER_ID)
    )
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe(eccezione.message)
    // Il fallback non tenta MAI traduciErroreRentri per un rule sconosciuto:
    // il messaggio resta quello grezzo di businessRuleViolation, prefisso
    // tecnico incluso (non è il caso che questo debito doveva chiudere).
    expect(eccezione.message).toContain('Business rule violated')
  })
})

describe('RentriFirLifecycleController: @TenantId è l’azienda selezionata', () => {
  it('getAzioniDisponibili: token A, azienda selezionata B → lo use case riceve B', async () => {
    const azioni = { execute: jest.fn().mockResolvedValue({ azioni: [] }) }
    const controller = new RentriFirLifecycleController(
      azioni as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { setContext: jest.fn(), debug: jest.fn(), error: jest.fn() } as any,
      {} as any
    )
    const request = { tenantId: 'B', user: { id: 'u1', tenantId: 'A' }, headers: {} }
    const arg = argomentiCustom(RentriFirLifecycleController, 'getAzioniDisponibili', request)

    await controller.getAzioniDisponibili('fir-1', arg[1] as string, 'u1')

    expect(azioni.execute).toHaveBeenCalledWith('fir-1', 'B')
  })

  it('senza azienda selezionata: 403, header grezzo ignorato', () => {
    const request = { user: { id: 'u1' }, headers: { 'x-tenant-id': 'ALTRUI' } }
    expect(() =>
      argomentiCustom(RentriFirLifecycleController, 'getAzioniDisponibili', request)
    ).toThrow(ForbiddenException)
  })
})

describe('RentriFirLifecycleController: ruolo effettivo nell azienda selezionata (scritture)', () => {
  const REQ = { user: { id: 'u1', role: 'ADMIN', tenantId: 'A' } }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const useCase = {
    accettaORespingi: { execute: jest.fn() },
    annulla: { execute: jest.fn() },
    allegati: { caricaAllegato: jest.fn(), eliminaAllegato: jest.fn() },
  }
  let controller: RentriFirLifecycleController

  beforeEach(() => {
    jest.resetAllMocks()
    useCase.accettaORespingi.execute.mockResolvedValue({})
    useCase.annulla.execute.mockResolvedValue({})
    useCase.allegati.caricaAllegato.mockResolvedValue({})
    useCase.allegati.eliminaAllegato.mockResolvedValue(undefined)
    controller = new RentriFirLifecycleController(
      {} as any,
      useCase.accettaORespingi as any,
      useCase.annulla as any,
      useCase.allegati as any,
      {} as any,
      { setContext: jest.fn(), debug: jest.fn(), error: jest.fn() } as any,
      ruolo as any
    )
  })

  const scritture: Array<[string, () => Promise<unknown>, jest.Mock]> = [
    [
      'accettazione',
      () => controller.accettaORespingi('f', { tipoAccettazione: 'TOTALE' } as any, 'B', 'u1', REQ),
      useCase.accettaORespingi.execute,
    ],
    [
      'annullamento',
      () => controller.annulla('f', { motivo: 'x' } as any, 'B', 'u1', REQ),
      useCase.annulla.execute,
    ],
    [
      'carica allegato',
      () => controller.caricaAllegato('f', { nomeFile: 'a.pdf' } as any, 'B', 'u1', REQ),
      useCase.allegati.caricaAllegato,
    ],
    [
      'elimina allegato',
      () => controller.eliminaAllegato('f', 'al', 'B', 'u1', REQ),
      useCase.allegati.eliminaAllegato,
    ],
  ]

  it.each(scritture)(
    '%s: consulente VIEWER nell azienda selezionata → 403, nessuna scrittura',
    async (_n, chiama, uc) => {
      ruolo.ruoloEffettivo.mockResolvedValue('VIEWER')
      await expect(chiama()).rejects.toBeInstanceOf(ForbiddenException)
      expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(REQ.user, 'B')
      expect(uc).not.toHaveBeenCalled()
    }
  )

  it.each(scritture)('%s: ADMIN/OPERATOR effettivo → passa', async (_n, chiama, uc) => {
    for (const r of ['ADMIN', 'OPERATOR', 'SUPER_ADMIN']) {
      uc.mockClear()
      ruolo.ruoloEffettivo.mockResolvedValue(r)
      await chiama()
      expect(uc).toHaveBeenCalledTimes(1)
    }
  })
})
