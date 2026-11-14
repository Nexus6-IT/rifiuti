import {
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import type { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import type {
  AgenteRisolto,
  RisoluzioneAgenteService,
} from '../../application/pese/agenti/risoluzione-agente.service'
import { generaToken, hashSegreto } from '../../domain/pese/agenti/credenziali-agente'
import { ThrottlerException } from '@nestjs/throttler'
import { AgentePesaGuard } from './agente-pesa.guard'
import { FallimentiAutenticazione } from './fallimenti-autenticazione'
import type { RichiestaConAgente } from './agente-richiesta'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ALTRO_TENANT = '22222222-2222-4222-8222-222222222222'
const AGENTE = '33333333-3333-4333-8333-333333333333'

function contesto(req: Partial<RichiestaConAgente> & Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
}

describe('AgentePesaGuard', () => {
  let daToken: jest.Mock
  let moduliAttivi: jest.Mock
  let guard: AgentePesaGuard
  let spieLog: jest.SpyInstance[]
  let righeLog: string[]
  const modalitaPrecedente = process.env.MODULI_BACKEND_MODALITA

  beforeEach(() => {
    delete process.env.MODULI_BACKEND_MODALITA
    daToken = jest.fn()
    moduliAttivi = jest.fn().mockResolvedValue(['pese', 'registro'])
    guard = new AgentePesaGuard(
      { daToken } as unknown as RisoluzioneAgenteService,
      { moduliAttivi } as unknown as ModuliAttiviService
    )
    righeLog = []
    spieLog = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(m =>
      jest
        .spyOn(Logger.prototype, m)
        .mockImplementation((...a: unknown[]) => void righeLog.push(a.map(String).join(' ')))
    )
  })

  afterEach(() => {
    spieLog.forEach(s => s.mockRestore())
    if (modalitaPrecedente === undefined) delete process.env.MODULI_BACKEND_MODALITA
    else process.env.MODULI_BACKEND_MODALITA = modalitaPrecedente
  })

  const richiesta = (token: string | undefined, extra: Record<string, unknown> = {}) =>
    ({
      headers: token === undefined ? {} : { authorization: token },
      ...extra,
    }) as Partial<RichiestaConAgente> & Record<string, unknown>

  const risolto = (stato: AgenteRisolto['stato']): AgenteRisolto => ({
    id: AGENTE,
    tenantId: TENANT,
    stato,
  })

  it('senza intestazione Authorization: 401 TOKEN_NON_VALIDO, nessun accesso al database', async () => {
    const e = await guard.canActivate(contesto(richiesta(undefined))).catch(x => x)
    expect(e).toBeInstanceOf(UnauthorizedException)
    expect(e.getResponse()).toMatchObject({ error: 'TOKEN_NON_VALIDO' })
    expect(daToken).not.toHaveBeenCalled()
  })

  it('conta per IP solo i token rifiutati e, oltre il tetto, risponde 429 senza interrogare il database', async () => {
    guard = new AgentePesaGuard(
      { daToken } as unknown as RisoluzioneAgenteService,
      { moduliAttivi } as unknown as ModuliAttiviService,
      FallimentiAutenticazione.con(2, 60_000)
    )
    daToken.mockResolvedValue(null)
    const ignoto = `Bearer ${generaToken()}`
    for (let i = 0; i < 2; i++) {
      await expect(
        guard.canActivate(contesto(richiesta(ignoto, { ip: '9.9.9.9' })))
      ).rejects.toBeInstanceOf(UnauthorizedException)
    }
    daToken.mockClear()
    await expect(
      guard.canActivate(contesto(richiesta(ignoto, { ip: '9.9.9.9' })))
    ).rejects.toBeInstanceOf(ThrottlerException)
    expect(daToken).not.toHaveBeenCalled()
    // un altro IP con un token valido passa
    const valido = generaToken()
    daToken.mockResolvedValue(risolto('ATTIVO'))
    await expect(
      guard.canActivate(contesto(richiesta(`Bearer ${valido}`, { ip: '8.8.8.8' })))
    ).resolves.toBe(true)
  })

  it('le richieste autenticate (anche revocate) non incrementano il conteggio dei rifiuti', async () => {
    const f = FallimentiAutenticazione.con(1, 60_000)
    guard = new AgentePesaGuard(
      { daToken } as unknown as RisoluzioneAgenteService,
      { moduliAttivi } as unknown as ModuliAttiviService,
      f
    )
    daToken.mockResolvedValue(risolto('ATTIVO'))
    for (let i = 0; i < 5; i++) {
      await guard.canActivate(contesto(richiesta(`Bearer ${generaToken()}`, { ip: '7.7.7.7' })))
    }
    daToken.mockResolvedValue(risolto('REVOCATO'))
    await guard
      .canActivate(contesto(richiesta(`Bearer ${generaToken()}`, { ip: '7.7.7.7' })))
      .catch(() => undefined)
    expect(f.bloccatoPer('7.7.7.7')).toBeNull()
  })

  it.each([
    ['schema diverso', 'Basic abc'],
    ['Bearer vuoto', 'Bearer '],
    ['token senza prefisso wfpa_', `Bearer ${'a'.repeat(48)}`],
    ['token di lunghezza sbagliata', 'Bearer wfpa_corto'],
    ['token con spazi', `Bearer ${generaToken()} extra`],
  ])('%s: 401 senza interrogare il database', async (_n, intestazione) => {
    await expect(guard.canActivate(contesto(richiesta(intestazione)))).rejects.toBeInstanceOf(
      UnauthorizedException
    )
    expect(daToken).not.toHaveBeenCalled()
  })

  it('token ignoto: 401 TOKEN_NON_VALIDO; si cerca per hash, mai per token in chiaro', async () => {
    daToken.mockResolvedValue(null)
    const token = generaToken()
    const e = await guard.canActivate(contesto(richiesta(`Bearer ${token}`))).catch(x => x)
    expect(e).toBeInstanceOf(UnauthorizedException)
    expect(e.getResponse()).toMatchObject({ error: 'TOKEN_NON_VALIDO' })
    expect(daToken).toHaveBeenCalledWith(hashSegreto(token))
  })

  it('agente IN_ATTESA: 401', async () => {
    daToken.mockResolvedValue(risolto('IN_ATTESA'))
    await expect(
      guard.canActivate(contesto(richiesta(`Bearer ${generaToken()}`)))
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('agente REVOCATO: 403 AGENTE_REVOCATO', async () => {
    daToken.mockResolvedValue(risolto('REVOCATO'))
    const e = await guard.canActivate(contesto(richiesta(`Bearer ${generaToken()}`))).catch(x => x)
    expect(e).toBeInstanceOf(ForbiddenException)
    expect(e.getResponse()).toMatchObject({ error: 'AGENTE_REVOCATO' })
  })

  it('modulo pese spento: 403 MODULO_NON_ATTIVO', async () => {
    daToken.mockResolvedValue(risolto('ATTIVO'))
    moduliAttivi.mockResolvedValue(['registro'])
    const e = await guard.canActivate(contesto(richiesta(`Bearer ${generaToken()}`))).catch(x => x)
    expect(e).toBeInstanceOf(ForbiddenException)
    expect(e.getResponse()).toMatchObject({
      error: 'MODULO_NON_ATTIVO',
      details: { moduli: ['pese'] },
    })
  })

  it('modulo pese spento in modalita registra: passa con un avviso', async () => {
    process.env.MODULI_BACKEND_MODALITA = 'registra'
    daToken.mockResolvedValue(risolto('ATTIVO'))
    moduliAttivi.mockResolvedValue([])
    const req = richiesta(`Bearer ${generaToken()}`)
    await expect(guard.canActivate(contesto(req))).resolves.toBe(true)
    expect(req.agentePesa).toEqual({ id: AGENTE, tenantId: TENANT })
    expect(righeLog.some(r => r.includes('Modulo non attivo'))).toBe(true)
  })

  it('errore del database nella verifica dei moduli: 503, mai un passaggio', async () => {
    daToken.mockResolvedValue(risolto('ATTIVO'))
    moduliAttivi.mockRejectedValue(new Error('connessione persa'))
    await expect(
      guard.canActivate(contesto(richiesta(`Bearer ${generaToken()}`)))
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('errore del database nella risoluzione del token: 503', async () => {
    daToken.mockRejectedValue(new Error('connessione persa'))
    await expect(
      guard.canActivate(contesto(richiesta(`Bearer ${generaToken()}`)))
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('agente attivo: valorizza req.agentePesa e lascia intatti req.tenantId e req.user', async () => {
    daToken.mockResolvedValue(risolto('ATTIVO'))
    const req = richiesta(`Bearer ${generaToken()}`)
    await expect(guard.canActivate(contesto(req))).resolves.toBe(true)
    expect(req.agentePesa).toEqual({ id: AGENTE, tenantId: TENANT })
    expect(req).not.toHaveProperty('tenantId')
    expect(req).not.toHaveProperty('user')
    expect(moduliAttivi).toHaveBeenCalledWith(TENANT)
  })

  it('l’intestazione X-Tenant-ID e ignorata: l’azienda viene solo dal token', async () => {
    daToken.mockResolvedValue(risolto('ATTIVO'))
    const req = richiesta(`Bearer ${generaToken()}`, {})
    ;(req.headers as Record<string, string>)['x-tenant-id'] = ALTRO_TENANT
    await guard.canActivate(contesto(req))
    expect(req.agentePesa?.tenantId).toBe(TENANT)
    expect(moduliAttivi).toHaveBeenCalledWith(TENANT)
    expect(moduliAttivi).not.toHaveBeenCalledWith(ALTRO_TENANT)
  })

  it('Bearer e case-insensitive', async () => {
    daToken.mockResolvedValue(risolto('ATTIVO'))
    await expect(guard.canActivate(contesto(richiesta(`bearer ${generaToken()}`)))).resolves.toBe(
      true
    )
  })

  it('il token non compare mai nei messaggi di log (successo, rifiuti, errori)', async () => {
    const token = generaToken()
    const casi: Array<() => void> = [
      () => daToken.mockResolvedValue(risolto('ATTIVO')),
      () => daToken.mockResolvedValue(risolto('REVOCATO')),
      () => daToken.mockResolvedValue(null),
      () => daToken.mockRejectedValue(new Error(`errore con ${token}`)),
      () => {
        daToken.mockResolvedValue(risolto('ATTIVO'))
        moduliAttivi.mockRejectedValue(new Error(`errore con ${token}`))
      },
      () => {
        process.env.MODULI_BACKEND_MODALITA = 'registra'
        daToken.mockResolvedValue(risolto('ATTIVO'))
        moduliAttivi.mockResolvedValue([])
      },
    ]
    for (const prepara of casi) {
      moduliAttivi.mockResolvedValue(['pese'])
      prepara()
      await guard.canActivate(contesto(richiesta(`Bearer ${token}`))).catch(() => undefined)
    }
    expect(righeLog.length).toBeGreaterThan(0)
    expect(righeLog.join('\n')).not.toContain(token)
    expect(righeLog.join('\n')).not.toContain(token.slice(5))
  })
})
