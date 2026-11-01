/**
 * Ruoli CLIENTE e AGENTE sulle ditte (4.1b, D18, R20): tipi, regola del privato e messaggi.
 */
import { TenantContext } from '../../../core/context/tenant-context'
import {
  DatiControparteNonValidiError,
  SedeNonValidaPerRuoloError,
} from '../../../core/domain/errors'
import { DEL_RUOLO, NOME_RUOLO, SedeDitta } from '../../../domain/registry/entities/sede-ditta'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import {
  MESSAGGIO_PRIVATO_SOLO_PRODUTTORE,
  ammessoPrivato,
} from '../../../domain/registry/value-objects/identificativo-fiscale'
import { CF_PERSONA_VALIDO } from '../../../test-support/anagrafiche-di-test'
import { messaggioRuoloPresente } from '../crea-ruolo-su-ditta'
import { DitteService } from './ditte.service'

const INDIRIZZO = { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' }

describe('ruoli cliente e agente', () => {
  const repo = {
    bloccaIdentificativi: jest.fn().mockResolvedValue(undefined),
    bloccaSedi: jest.fn().mockResolvedValue(undefined),
    cercaPerIdentificativi: jest.fn().mockResolvedValue([]),
    sedi: jest.fn().mockResolvedValue([]),
    crea: jest.fn().mockResolvedValue(undefined),
    creaSede: jest.fn().mockResolvedValue(undefined),
    ruoliDellaDitta: jest.fn().mockResolvedValue([]),
  }
  const tx = {}
  const service = new DitteService({} as never, repo as never)
  const privato = {
    ragioneSociale: 'Mario Rossi',
    codiceFiscale: CF_PERSONA_VALIDO,
    indirizzo: INDIRIZZO,
  }
  const risolvi = (ruolo: 'CLIENTE' | 'AGENTE' | 'TRASPORTATORE') =>
    TenantContext.run({ tenantId: 't1' }, () =>
      service.risolviPerRuolo(tx as never, ruolo, privato)
    )

  it('risolviPerRuolo con CLIENTE e un privato non lancia', async () => {
    await expect(risolvi('CLIENTE')).resolves.toBeDefined()
  })

  it('risolviPerRuolo con AGENTE e un privato lancia il messaggio nuovo', async () => {
    await expect(risolvi('AGENTE')).rejects.toThrow(DatiControparteNonValidiError)
    await expect(risolvi('AGENTE')).rejects.toThrow(
      'Un privato senza partita IVA può essere solo produttore o cliente.'
    )
  })

  it('risolviPerRuolo con TRASPORTATORE e un privato lancia il messaggio nuovo', async () => {
    await expect(risolvi('TRASPORTATORE')).rejects.toThrow(MESSAGGIO_PRIVATO_SOLO_PRODUTTORE)
    expect(MESSAGGIO_PRIVATO_SOLO_PRODUTTORE).toBe(
      'Un privato senza partita IVA può essere solo produttore o cliente.'
    )
  })

  it('ammessoPrivato: PRODUTTORE e CLIENTE true, gli altri false', () => {
    expect(ammessoPrivato('PRODUTTORE')).toBe(true)
    expect(ammessoPrivato('CLIENTE')).toBe(true)
    expect(ammessoPrivato('TRASPORTATORE')).toBe(false)
    expect(ammessoPrivato('DESTINATARIO')).toBe(false)
    expect(ammessoPrivato('AGENTE')).toBe(false)
  })

  it('NOME_RUOLO.CLIENTE è "cliente" e NOME_RUOLO.AGENTE è "agente"', () => {
    expect(NOME_RUOLO.CLIENTE).toBe('cliente')
    expect(NOME_RUOLO.AGENTE).toBe('agente')
  })

  it('messaggioRuoloPresente per cliente e agente', () => {
    expect(messaggioRuoloPresente('cliente')).toBe('Esiste già un cliente per questa ditta')
    expect(messaggioRuoloPresente('agente')).toBe('Esiste già un agente per questa ditta')
  })

  it("SedeNonValidaPerRuoloError con l'articolo giusto (R20)", () => {
    expect(new SedeNonValidaPerRuoloError('cliente').message).toBe(
      'La sede indicata non è una sede attiva del cliente scelto'
    )
    expect(new SedeNonValidaPerRuoloError('agente').message).toBe(
      "La sede indicata non è una sede attiva dell'agente scelto"
    )
    expect(new SedeNonValidaPerRuoloError('produttore').message).toBe(
      'La sede indicata non è una sede attiva del produttore scelto'
    )
  })

  it('la sede predefinita di un agente non si disattiva, con "dell\'agente"', () => {
    const sede = SedeDitta.crea({ dittaId: 'd1', indirizzo: Indirizzo.create(INDIRIZZO) })
    expect(() => sede.disattiva(['AGENTE'])).toThrow(
      "È la sede predefinita dell'agente: scegline un'altra prima"
    )
    expect(DEL_RUOLO.CLIENTE).toBe('del cliente')
  })
})
