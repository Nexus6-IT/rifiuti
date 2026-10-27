/**
 * Modifica FIR Use Case - test (repository e registri finti)
 */

import { ModificaFIRUseCase } from './modifica-fir.use-case'
import { ModificaFIRCommand } from '../commands/modifica-fir.command'
import {
  FIR,
  FIRStato,
  ParteFIR,
  ProvenienzaRifiuto,
  TipoTratta,
} from '../../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { IFIRModificaBozzaRepository } from '../../../domain/fir/repositories/fir-modifica-bozza.port'
import { Produttore } from '../../../domain/registry/entities/produttore'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { Destinatario } from '../../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import {
  FirModificatoNelFrattempoError,
  FirNonModificabileError,
  FirNonTrovatoError,
} from '../../../core/domain/errors'

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const P1 = '11111111-1111-4111-8111-111111111111'
const T1 = '22222222-2222-4222-8222-222222222222'
const D1 = '33333333-3333-4333-8333-333333333333'
const D2 = '44444444-4444-4444-8444-444444444444'
const T2 = '55555555-5555-4555-8555-555555555555'

const indirizzo = Indirizzo.create({
  via: 'Via Roma',
  civico: '1',
  cap: '00100',
  citta: 'Roma',
  provincia: 'RM',
})

const snapP: ParteFIR = {
  registroId: P1,
  ragioneSociale: 'Produttore congelato',
  partitaIva: '12345678901',
  indirizzo: 'Via Vecchia 1',
}
const snapT: ParteFIR = {
  registroId: T1,
  ragioneSociale: 'Trasportatore congelato',
  partitaIva: '22345678901',
  indirizzo: 'Via Vecchia 2',
}
const snapD: ParteFIR = {
  registroId: D1,
  ragioneSociale: 'Destinatario congelato',
  partitaIva: '32345678901',
  indirizzo: 'Via Vecchia 3',
}

function bozza(opzioni: { senzaSnapshot?: boolean } = {}): FIR {
  const fir = FIR.create({
    produttoreId: P1,
    rifiuto: { cerCode: '15 01 01', quantita: 100, unitaMisura: UnitaMisura.KG },
    trasportatoreId: T1,
    destinatarioId: D1,
    tenantId: TENANT,
    creatoDaUserId: USER,
    produttore: opzioni.senzaSnapshot ? undefined : snapP,
    trasportatore: opzioni.senzaSnapshot ? undefined : snapT,
    destinatario: opzioni.senzaSnapshot ? undefined : snapD,
    provenienza: ProvenienzaRifiuto.SPECIALE,
    tipoTrattaPrincipale: TipoTratta.TERRESTRE,
  })
  fir.registraVersioneSalvata(1)
  return fir
}

function comando(fir: FIR, extra: Partial<ModificaFIRCommand> = {}): ModificaFIRCommand {
  return {
    firId: fir.id,
    tenantId: TENANT,
    userId: USER,
    versione: 1,
    produttoreId: P1,
    trasportatoreId: T1,
    destinatarioId: D1,
    rifiuto: { cerCode: '15 01 01', quantita: 100, unitaMisura: UnitaMisura.KG },
    provenienza: ProvenienzaRifiuto.SPECIALE,
    tipoTrattaPrincipale: TipoTratta.TERRESTRE,
    trasportatoriAggiuntivi: [],
    ...extra,
  }
}

describe('ModificaFIRUseCase', () => {
  let repo: jest.Mocked<IFIRModificaBozzaRepository>
  let cer: { exists: jest.Mock; isUtilizzabilePerNuovoFormulario: jest.Mock }
  let produttori: { findById: jest.Mock }
  let trasportatori: { findById: jest.Mock }
  let destinatari: { findById: jest.Mock }
  let useCase: ModificaFIRUseCase
  let logger: { warn: jest.Mock; info: jest.Mock; error: jest.Mock; debug: jest.Mock }

  beforeEach(() => {
    logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
    repo = { findById: jest.fn(), salvaModificaBozza: jest.fn().mockResolvedValue(undefined) }
    cer = {
      exists: jest.fn().mockResolvedValue(true),
      isUtilizzabilePerNuovoFormulario: jest.fn().mockResolvedValue(true),
    }
    produttori = {
      findById: jest.fn(async (id: string) =>
        Produttore.reconstitute({
          id,
          ragioneSociale: 'Produttore registro',
          partitaIVA: PartitaIVA.create('12345678901'),
          sedeLegale: indirizzo,
          pec: 'prod@pec.it',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ),
    }
    trasportatori = {
      findById: jest.fn(async (id: string) =>
        Trasportatore.reconstitute({
          id,
          ragioneSociale: 'Trasportatore registro',
          partitaIVA: PartitaIVA.create('22345678901'),
          sedeLegale: indirizzo,
          numeroIscrizione: 'ALBO-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ),
    }
    destinatari = {
      findById: jest.fn(async (id: string) =>
        Destinatario.reconstitute({
          id,
          ragioneSociale: 'Destinatario registro',
          partitaIVA: PartitaIVA.create('32345678901'),
          sede: indirizzo,
          numeroAutorizzazione: 'AUT-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ),
    }
    useCase = new ModificaFIRUseCase(
      repo,
      cer as never,
      produttori as never,
      trasportatori as never,
      destinatari as never,
      logger as never
    )
  })

  it('il guard RENTRI dell aggregate diventa FIR_NON_MODIFICABILE LEGATO_RENTRI e il testo originale va nel log', async () => {
    const fir = bozza()
    // Il motivo e' nullo (lo stato e' stato letto prima del legame) ma l'aggregate ha il legame:
    // la modifica arriva davvero al guard dentro modificaBozza.
    Object.assign(fir, { _rentriNumeroFir: 'N-1' })
    jest.spyOn(fir, 'motivoNonModificabile').mockReturnValue(null)
    repo.findById.mockResolvedValue(fir)

    const errore = await useCase.execute(comando(fir, { annotazioni: 'x' })).catch(e => e)

    expect(errore).toBeInstanceOf(FirNonModificabileError)
    expect(errore.motivo).toBe('LEGATO_RENTRI')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ causa: expect.stringContaining('modificaBozza') })
    )
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it.each([
    ['FirNonModificabileError', () => new FirNonModificabileError('FIRMATO')],
    ['FirModificatoNelFrattempoError', () => new FirModificatoNelFrattempoError('x')],
  ])('un %s lanciato dall aggregate si rilancia, non diventa Result.fail', async (_n, crea) => {
    const fir = bozza()
    const errore = crea()
    jest.spyOn(fir, 'modificaBozza').mockImplementation(() => {
      throw errore
    })
    repo.findById.mockResolvedValue(fir)

    await expect(useCase.execute(comando(fir, { annotazioni: 'x' }))).rejects.toBe(errore)
  })

  it('FIR assente: FirNonTrovatoError, nessuna scrittura', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(useCase.execute(comando(bozza()))).rejects.toBeInstanceOf(FirNonTrovatoError)
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('FIR di un altra azienda: FirNonTrovatoError', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    await expect(
      useCase.execute(comando(fir, { tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }))
    ).rejects.toBeInstanceOf(FirNonTrovatoError)
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it.each([
    ['LEGATO_RENTRI', (f: FIR) => Object.assign(f, { _rentriNumeroFir: 'N-1' })],
    ['NON_BOZZA', (f: FIR) => Object.assign(f, { _stato: FIRStato.EMESSO })],
    ['FIRMATO', (f: FIR) => Object.assign(f, { _firmePresenti: true })],
    [
      'IN_ATTESA_FIRMA_PRODUTTORE',
      (f: FIR) => Object.assign(f, { _inAttesaFirmaProduttore: true }),
    ],
  ])('motivo %s: FirNonModificabileError, nessuna scrittura', async (motivo, prepara) => {
    const fir = prepara(bozza()) as FIR
    repo.findById.mockResolvedValue(fir)
    await expect(useCase.execute(comando(fir))).rejects.toMatchObject({
      constructor: FirNonModificabileError,
      motivo,
    })
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('versione diversa: FirModificatoNelFrattempoError, nessuna scrittura', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    await expect(useCase.execute(comando(fir, { versione: 7 }))).rejects.toBeInstanceOf(
      FirModificatoNelFrattempoError
    )
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('non modificabile ha la precedenza sulla versione', async () => {
    const fir = Object.assign(bozza(), { _firmePresenti: true }) as FIR
    repo.findById.mockResolvedValue(fir)
    await expect(useCase.execute(comando(fir, { versione: 7 }))).rejects.toBeInstanceOf(
      FirNonModificabileError
    )
  })

  it('CER inesistente o non piu utilizzabile: Result.fail, nessuna scrittura', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    cer.exists.mockResolvedValue(false)
    const r1 = await useCase.execute(comando(fir))
    expect(r1.isFailure).toBe(true)

    cer.exists.mockResolvedValue(true)
    cer.isUtilizzabilePerNuovoFormulario.mockResolvedValue(false)
    const r2 = await useCase.execute(comando(fir))
    expect(r2.isFailure).toBe(true)
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('il CER si verifica anche se non cambia', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    await useCase.execute(comando(fir))
    expect(cer.exists).toHaveBeenCalledTimes(1)
    expect(cer.isUtilizzabilePerNuovoFormulario).toHaveBeenCalledTimes(1)
  })

  it('nessun cambiamento: Result.ok, nessuna scrittura, nessuna lettura del registro', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    const r = await useCase.execute(comando(fir))
    expect(r.isSuccess).toBe(true)
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
    expect(produttori.findById).not.toHaveBeenCalled()
    expect(trasportatori.findById).not.toHaveBeenCalled()
    expect(destinatari.findById).not.toHaveBeenCalled()
  })

  it('campi vuoti equivalenti a null: nessun cambiamento', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    const r = await useCase.execute(
      comando(fir, {
        annotazioni: '',
        rifiuto: {
          cerCode: '15 01 01',
          quantita: 100,
          unitaMisura: UnitaMisura.KG,
          statoFisico: '',
          caratteristichePericolo: '',
        },
      })
    )
    expect(r.isSuccess).toBe(true)
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('parti invariate: snapshot esistente, il registro non si legge; salvataggio con campi e audit', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    const r = await useCase.execute(
      comando(fir, {
        annotazioni: 'Nota nuova',
        rifiuto: { cerCode: '15 01 01', quantita: 250, unitaMisura: UnitaMisura.KG },
      })
    )
    expect(r.isSuccess).toBe(true)
    expect(produttori.findById).not.toHaveBeenCalled()
    expect(trasportatori.findById).not.toHaveBeenCalled()
    expect(destinatari.findById).not.toHaveBeenCalled()
    expect(fir.produttore).toBe(snapP)
    expect(repo.salvaModificaBozza).toHaveBeenCalledTimes(1)
    const [salvato, versioneAttesa, audit] = repo.salvaModificaBozza.mock.calls[0]
    expect(salvato).toBe(fir)
    expect(versioneAttesa).toBe(1)
    expect(audit.userId).toBe(USER)
    expect(audit.campiModificati).toEqual(expect.arrayContaining(['quantita', 'annotazioni']))
    expect(audit.partiRisnapshottate).toEqual([])
  })

  it('destinatario cambiato: nuovo snapshot dal registro, le altre parti restano', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    const r = await useCase.execute(comando(fir, { destinatarioId: D2 }))
    expect(r.isSuccess).toBe(true)
    expect(destinatari.findById).toHaveBeenCalledWith(D2)
    expect(produttori.findById).not.toHaveBeenCalled()
    expect(fir.destinatario?.ragioneSociale).toBe('Destinatario registro')
    expect(fir.destinatario?.registroId).toBe(D2)
    expect(fir.produttore).toBe(snapP)
    const audit = repo.salvaModificaBozza.mock.calls[0][2]
    expect(audit.campiModificati).toContain('destinatario')
    expect(audit.partiRisnapshottate).toEqual(['destinatario'])
  })

  it('FIR legacy con snapshot null e stesso id: la parte si rilegge dal registro ed e segnalata', async () => {
    const fir = bozza({ senzaSnapshot: true })
    expect(fir.produttore).toBeNull()
    repo.findById.mockResolvedValue(fir)
    const r = await useCase.execute(comando(fir))
    expect(r.isSuccess).toBe(true)
    expect(produttori.findById).toHaveBeenCalledWith(P1)
    expect(trasportatori.findById).toHaveBeenCalledWith(T1)
    expect(destinatari.findById).toHaveBeenCalledWith(D1)
    const audit = repo.salvaModificaBozza.mock.calls[0][2]
    expect(audit.partiRisnapshottate).toEqual(['produttore', 'trasportatore', 'destinatario'])
    expect(fir.produttore?.ragioneSociale).toBe('Produttore registro')
  })

  it('parte nuova non trovata nel registro: Result.fail, nessuna scrittura', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    destinatari.findById.mockResolvedValue(null)
    const r = await useCase.execute(comando(fir, { destinatarioId: D2 }))
    expect(r.isFailure).toBe(true)
    expect(r.error).toContain('Destinatario not found')
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('tratta nuova: snapshot dal registro e salvataggio con trasportatoriAggiuntivi', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    const r = await useCase.execute(
      comando(fir, {
        trasportatoriAggiuntivi: [
          { trasportatoreId: T2, tipoTratta: TipoTratta.TERRESTRE, ordine: 1 },
        ],
      })
    )
    expect(r.isSuccess).toBe(true)
    expect(trasportatori.findById).toHaveBeenCalledWith(T2)
    expect(fir.tratteModificate).toBe(true)
    expect(fir.trasportatoriAggiuntivi).toHaveLength(1)
    expect(repo.salvaModificaBozza.mock.calls[0][2].campiModificati).toContain(
      'trasportatoriAggiuntivi'
    )
  })

  it('tratta nuova non trovata nel registro: Result.fail', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    trasportatori.findById.mockResolvedValue(null)
    const r = await useCase.execute(
      comando(fir, {
        trasportatoriAggiuntivi: [
          { trasportatoreId: T2, tipoTratta: TipoTratta.TERRESTRE, ordine: 1 },
        ],
      })
    )
    expect(r.isFailure).toBe(true)
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('tratte invariate: nessuna lettura del registro, nessun cambiamento', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    await useCase.execute(
      comando(fir, {
        trasportatoriAggiuntivi: [
          { trasportatoreId: T2, tipoTratta: TipoTratta.TERRESTRE, ordine: 1 },
        ],
      })
    )
    repo.salvaModificaBozza.mockClear()
    trasportatori.findById.mockClear()
    // Seconda modifica sulla stessa istanza: stesse tratte, il trasportatore e gia nello snapshot.
    const r = await useCase.execute(
      comando(fir, {
        trasportatoriAggiuntivi: [
          { trasportatoreId: T2, tipoTratta: TipoTratta.TERRESTRE, ordine: 1 },
        ],
      })
    )
    expect(r.isSuccess).toBe(true)
    expect(trasportatori.findById).not.toHaveBeenCalled()
    expect(fir.tratteModificate).toBe(false)
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('quantita non valida: Result.fail, nessuna scrittura', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    const r = await useCase.execute(
      comando(fir, { rifiuto: { cerCode: '15 01 01', quantita: 0, unitaMisura: UnitaMisura.KG } })
    )
    expect(r.isFailure).toBe(true)
    expect(repo.salvaModificaBozza).not.toHaveBeenCalled()
  })

  it('un errore del repository (409 sotto lock) risale com e', async () => {
    const fir = bozza()
    repo.findById.mockResolvedValue(fir)
    repo.salvaModificaBozza.mockRejectedValue(new FirModificatoNelFrattempoError(fir.id))
    await expect(useCase.execute(comando(fir, { annotazioni: 'x' }))).rejects.toBeInstanceOf(
      FirModificatoNelFrattempoError
    )
  })
})
