/**
 * ModuloAttivoInterceptor: tutti i rami dell'algoritmo, la modalita' `registra` e l'ordine
 * rispetto a TenantSwitchInterceptor.
 */
import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core'
import { lastValueFrom, of } from 'rxjs'
import { ModuloAttivoInterceptor } from './modulo-attivo.interceptor'
import { TenantSwitchInterceptor } from './tenant-switch.interceptor'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { RichiedeModulo, SenzaModulo } from '../decorators/richiede-modulo.decorator'
import { ConsentiSelezioneNonValida } from '../decorators/consenti-selezione-non-valida.decorator'
import { AppModule } from '../../app.module'

const PRIMARIA = 'aaaaaaaa-0000-4000-8000-00000000000a'
const SELEZIONATA = 'bbbbbbbb-0000-4000-8000-00000000000b'

@RichiedeModulo('registro')
class ControllerDiClasse {
  ereditaDallaClasse() {}
  @RichiedeModulo('mud', 'giacenze')
  conPiuChiavi() {}
  @SenzaModulo('area base')
  libera() {}
  @ConsentiSelezioneNonValida()
  recupero() {}
}
class ControllerSenzaNulla {
  nessunMetadato() {}
}
@SenzaModulo('classe base')
class ControllerBase {
  ok() {}
  @RichiedeModulo('esg')
  eccezione() {}
}

function ctx(
  classe: any,
  metodo: string,
  req: Record<string, unknown>,
  tipo: string = 'http'
): ExecutionContext {
  return {
    getType: () => tipo,
    getClass: () => classe,
    getHandler: () => classe.prototype[metodo],
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}
const next: CallHandler = { handle: () => of('HANDLER') }

function make(moduliAttivi: jest.Mock) {
  const servizio = { moduliAttivi } as unknown as ModuliAttiviService
  return new ModuloAttivoInterceptor(new Reflector(), servizio)
}
const utente = (extra: Record<string, unknown> = {}) => ({
  id: 'u1',
  role: 'ADMIN',
  tenantId: PRIMARIA,
  ...extra,
})
const esegui = (i: ModuloAttivoInterceptor, c: ExecutionContext) =>
  lastValueFrom(i.intercept(c, next) as any)

describe('ModuloAttivoInterceptor', () => {
  const envOriginale = process.env.MODULI_BACKEND_MODALITA
  afterEach(() => {
    if (envOriginale === undefined) delete process.env.MODULI_BACKEND_MODALITA
    else process.env.MODULI_BACKEND_MODALITA = envOriginale
  })

  it('contesto non http: passa senza interrogare i moduli', async () => {
    const m = jest.fn()
    const r = await esegui(
      make(m),
      ctx(ControllerDiClasse, 'ereditaDallaClasse', { user: utente() }, 'ws')
    )
    expect(r).toBe('HANDLER')
    expect(m).not.toHaveBeenCalled()
  })

  it('nessun metadato: passa', async () => {
    const m = jest.fn()
    expect(
      await esegui(make(m), ctx(ControllerSenzaNulla, 'nessunMetadato', { user: utente() }))
    ).toBe('HANDLER')
    expect(m).not.toHaveBeenCalled()
  })

  it('@SenzaModulo: passa', async () => {
    const m = jest.fn()
    expect(await esegui(make(m), ctx(ControllerDiClasse, 'libera', { user: utente() }))).toBe(
      'HANDLER'
    )
    expect(m).not.toHaveBeenCalled()
  })

  it('@SenzaModulo di classe: passa; il @RichiedeModulo del metodo prevale', async () => {
    const m = jest.fn().mockResolvedValue([])
    const i = make(m)
    expect(await esegui(i, ctx(ControllerBase, 'ok', { user: utente(), tenantId: PRIMARIA }))).toBe(
      'HANDLER'
    )
    await expect(
      esegui(i, ctx(ControllerBase, 'eccezione', { user: utente(), tenantId: PRIMARIA }))
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('senza utente (rotta pubblica): passa, ci pensa il guard JWT', async () => {
    const m = jest.fn()
    expect(await esegui(make(m), ctx(ControllerDiClasse, 'ereditaDallaClasse', {}))).toBe('HANDLER')
    expect(m).not.toHaveBeenCalled()
  })

  it('SUPER_ADMIN senza azienda: passa (D2b)', async () => {
    const m = jest.fn()
    const r = await esegui(
      make(m),
      ctx(ControllerDiClasse, 'ereditaDallaClasse', {
        user: utente({ role: 'SUPER_ADMIN', tenantId: '' }),
      })
    )
    expect(r).toBe('HANDLER')
    expect(m).not.toHaveBeenCalled()
  })

  it('SUPER_ADMIN con azienda selezionata: valgono i moduli dell azienda (D2b)', async () => {
    const m = jest.fn().mockResolvedValue(['fir'])
    const req = { user: utente({ role: 'SUPER_ADMIN', tenantId: '' }), tenantId: SELEZIONATA }
    await expect(
      esegui(make(m), ctx(ControllerDiClasse, 'ereditaDallaClasse', req))
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(m).toHaveBeenCalledWith(SELEZIONATA)
  })

  it('utente normale senza azienda: 403 MODULO_NON_ATTIVO', async () => {
    const m = jest.fn()
    const p = esegui(
      make(m),
      ctx(ControllerDiClasse, 'ereditaDallaClasse', { user: utente({ tenantId: '' }) })
    )
    await expect(p).rejects.toMatchObject({
      response: { error: 'MODULO_NON_ATTIVO', details: { moduli: ['registro'] } },
    })
    expect(m).not.toHaveBeenCalled()
  })

  it('modulo attivo: passa e interroga l azienda selezionata (req.tenantId)', async () => {
    const m = jest.fn().mockResolvedValue(['registro'])
    const req = { user: utente(), tenantId: SELEZIONATA }
    expect(await esegui(make(m), ctx(ControllerDiClasse, 'ereditaDallaClasse', req))).toBe(
      'HANDLER'
    )
    expect(m).toHaveBeenCalledWith(SELEZIONATA)
  })

  it('con piu chiavi ne basta una', async () => {
    const m = jest.fn().mockResolvedValue(['giacenze'])
    const req = { user: utente(), tenantId: PRIMARIA }
    expect(await esegui(make(m), ctx(ControllerDiClasse, 'conPiuChiavi', req))).toBe('HANDLER')
  })

  it('nessuna chiave attiva: 403 con messaggio, codice e moduli richiesti', async () => {
    const m = jest.fn().mockResolvedValue(['fir'])
    const req = { user: utente(), tenantId: PRIMARIA }
    const p = esegui(make(m), ctx(ControllerDiClasse, 'conPiuChiavi', req))
    await expect(p).rejects.toBeInstanceOf(ForbiddenException)
    await expect(p).rejects.toMatchObject({
      response: {
        error: 'MODULO_NON_ATTIVO',
        message: "Il modulo non è attivo per l'azienda selezionata.",
        details: { moduli: ['mud', 'giacenze'] },
      },
    })
  })

  it('il metodo prevale sulla classe', async () => {
    const m = jest.fn().mockResolvedValue(['mud'])
    const req = { user: utente(), tenantId: PRIMARIA }
    // la classe chiede registro, il metodo mud/giacenze: con solo `mud` passa
    expect(await esegui(make(m), ctx(ControllerDiClasse, 'conPiuChiavi', req))).toBe('HANDLER')
  })

  it('errore del database: 503 VERIFICA_AZIENDA_NON_DISPONIBILE, mai passa', async () => {
    const m = jest.fn().mockRejectedValue(new Error('db giu'))
    const req = { user: utente(), tenantId: PRIMARIA }
    const p = esegui(make(m), ctx(ControllerDiClasse, 'ereditaDallaClasse', req))
    await expect(p).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(p).rejects.toMatchObject({
      response: { error: 'VERIFICA_AZIENDA_NON_DISPONIBILE' },
    })
  })

  it('errore del database anche in modalita registra: 503, non passa', async () => {
    process.env.MODULI_BACKEND_MODALITA = 'registra'
    const m = jest.fn().mockRejectedValue(new Error('db giu'))
    const req = { user: utente(), tenantId: PRIMARIA }
    await expect(
      esegui(make(m), ctx(ControllerDiClasse, 'ereditaDallaClasse', req))
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('@ConsentiSelezioneNonValida: si controlla l azienda primaria, non la selezionata', async () => {
    const m = jest.fn().mockResolvedValue(['registro'])
    const req = { user: utente(), tenantId: SELEZIONATA }
    await esegui(make(m), ctx(ControllerDiClasse, 'recupero', req))
    expect(m).toHaveBeenCalledWith(PRIMARIA)
  })

  it('modalita registra: avviso nel log e la richiesta passa', async () => {
    process.env.MODULI_BACKEND_MODALITA = 'registra'
    const m = jest.fn().mockResolvedValue([])
    const i = make(m)
    const warn = jest.spyOn((i as any).logger, 'warn').mockImplementation(() => undefined)
    const req = { user: utente(), tenantId: PRIMARIA, method: 'GET', url: '/x' }
    expect(await esegui(i, ctx(ControllerDiClasse, 'ereditaDallaClasse', req))).toBe('HANDLER')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('registro')
  })

  it('modalita non riconosciuta: si comporta come blocca (default sicuro)', async () => {
    process.env.MODULI_BACKEND_MODALITA = 'boh'
    const m = jest.fn().mockResolvedValue([])
    const req = { user: utente(), tenantId: PRIMARIA }
    await expect(
      esegui(make(m), ctx(ControllerDiClasse, 'ereditaDallaClasse', req))
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('default (variabile assente): blocca', async () => {
    delete process.env.MODULI_BACKEND_MODALITA
    const m = jest.fn().mockResolvedValue([])
    const req = { user: utente(), tenantId: PRIMARIA }
    await expect(
      esegui(make(m), ctx(ControllerDiClasse, 'ereditaDallaClasse', req))
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('ordine degli APP_INTERCEPTOR in AppModule', () => {
  it('ModuloAttivoInterceptor viene subito dopo TenantSwitchInterceptor', () => {
    const providers: any[] = Reflect.getMetadata('providers', AppModule)
    const interceptor = providers
      .filter(p => p && typeof p === 'object' && p.provide === APP_INTERCEPTOR)
      .map(p => p.useClass)
    const iSwitch = interceptor.indexOf(TenantSwitchInterceptor)
    const iModulo = interceptor.indexOf(ModuloAttivoInterceptor)
    expect(iSwitch).toBeGreaterThanOrEqual(0)
    expect(iModulo).toBe(iSwitch + 1)
  })
})
