/**
 * RuoloAutistaInterceptor (app campo, P1): un utente `AUTISTA` entra solo nelle rotte marcate
 * `@ConsentitoAutista()`. Tre livelli: (1) i rami dell'algoritmo; (2) l'INSIEME di tutte le rotte
 * montate in AppModule, non due a mano: ognuna e' negata all'autista, salvo l'elenco fisso delle
 * ammesse; (3) l'ordine fra gli APP_INTERCEPTOR.
 */
import { CallHandler, ExecutionContext, ForbiddenException, Logger, Type } from '@nestjs/common'
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core'
import { lastValueFrom, of } from 'rxjs'
import { AppModule } from '../../app.module'
import { ConsentitoAutista } from '../decorators/consentito-autista.decorator'
import {
  ROTTA_NON_CONSENTITA_ALL_AUTISTA,
  RuoloAutistaInterceptor,
} from './ruolo-autista.interceptor'
import { TenantSwitchInterceptor } from './tenant-switch.interceptor'

@ConsentitoAutista('classe intera')
class ControllerAmmessoDiClasse {
  rotta() {}
}
class ControllerChiuso {
  nessunMarcatore() {}
  @ConsentitoAutista('solo questa')
  ammessa() {}
}

function ctx(classe: any, metodo: string, req: Record<string, unknown>, tipo = 'http') {
  return {
    getType: () => tipo,
    getClass: () => classe,
    getHandler: () => classe.prototype[metodo],
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}
const next: CallHandler = { handle: () => of('HANDLER') }
beforeAll(() => Logger.overrideLogger(false))
const interceptor = new RuoloAutistaInterceptor(new Reflector())
const esegui = (c: ExecutionContext) => lastValueFrom(interceptor.intercept(c, next))
const autista = { id: 'u-aut', role: 'AUTISTA' }

describe('RuoloAutistaInterceptor: rami', () => {
  it('un autista su una rotta senza marcatore riceve 403 col codice macchina', async () => {
    let errore: unknown
    try {
      await esegui(ctx(ControllerChiuso, 'nessunMarcatore', { user: autista }))
    } catch (e) {
      errore = e
    }
    expect(errore).toBeInstanceOf(ForbiddenException)
    expect((errore as ForbiddenException).getResponse()).toMatchObject({
      error: ROTTA_NON_CONSENTITA_ALL_AUTISTA,
    })
  })

  it('un autista passa sul marcatore di metodo e su quello di classe', async () => {
    await expect(esegui(ctx(ControllerChiuso, 'ammessa', { user: autista }))).resolves.toBe(
      'HANDLER'
    )
    await expect(esegui(ctx(ControllerAmmessoDiClasse, 'rotta', { user: autista }))).resolves.toBe(
      'HANDLER'
    )
  })

  it.each(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])(
    'il ruolo %s non e toccato dall interceptor',
    async ruolo => {
      await expect(
        esegui(ctx(ControllerChiuso, 'nessunMarcatore', { user: { id: 'x', role: ruolo } }))
      ).resolves.toBe('HANDLER')
    }
  )

  it('una rotta pubblica (nessun utente) e un contesto non http passano', async () => {
    await expect(esegui(ctx(ControllerChiuso, 'nessunMarcatore', {}))).resolves.toBe('HANDLER')
    await expect(
      esegui(ctx(ControllerChiuso, 'nessunMarcatore', { user: autista }, 'ws'))
    ).resolves.toBe('HANDLER')
  })

  it('il ruolo e quello del token: un ruolo con maiuscole diverse non e un autista', async () => {
    // Il ruolo e un enum del database: nessun confronto "morbido" che apra una via di fuga.
    await expect(
      esegui(ctx(ControllerChiuso, 'nessunMarcatore', { user: { id: 'x', role: 'autista' } }))
    ).resolves.toBe('HANDLER')
  })
})

function controllerRaggiungibili(radice: unknown): Type<unknown>[] {
  const visti = new Set<unknown>()
  const out: Type<unknown>[] = []
  const coda: unknown[] = [radice]
  while (coda.length > 0) {
    let corrente = coda.shift() as { module?: unknown } | undefined
    // Modulo dinamico (`{ module, controllers, imports }`): i suoi controller e import contano.
    const dinamico =
      corrente && typeof corrente === 'object' && 'module' in corrente
        ? (corrente as { controllers?: Type<unknown>[]; imports?: unknown[] })
        : null
    if (dinamico) {
      out.push(...(dinamico.controllers ?? []))
      coda.push(...(dinamico.imports ?? []))
      corrente = (corrente as { module: unknown }).module as { module?: unknown }
    }
    if (!corrente || visti.has(corrente)) continue
    visti.add(corrente)
    out.push(
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, corrente) as Type<unknown>[]) ?? [])
    )
    coda.push(...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, corrente) as unknown[]) ?? []))
  }
  return out
}

function rotte(classe: Type<unknown>): string[] {
  const proto = classe.prototype as Record<string, unknown>
  return Object.getOwnPropertyNames(proto).filter(
    nome =>
      nome !== 'constructor' &&
      typeof proto[nome] === 'function' &&
      Reflect.hasMetadata(PATH_METADATA, proto[nome] as object) &&
      Reflect.hasMetadata(METHOD_METADATA, proto[nome] as object)
  )
}

/** Le SOLE rotte che un autista puo' usare. Una in piu' richiede di toccare anche questo elenco. */
const AMMESSE_ALL_AUTISTA = [
  'AuthController.getProfile',
  'AuthController.logout',
  'CampoController.giro',
  'CampoController.registraEvento',
  'CampoController.configurazioneRicevute',
  'CampoController.registraRicevuta',
]

describe('RuoloAutistaInterceptor: tutte le rotte montate in AppModule', () => {
  const montati = controllerRaggiungibili(AppModule)
  const tutte = montati.flatMap(c => rotte(c).map(m => ({ classe: c, metodo: m })))

  it('la scoperta trova molte rotte', () => {
    expect(montati.length).toBeGreaterThan(60)
    expect(tutte.length).toBeGreaterThan(300)
  })

  it('un autista e respinto con 403 da OGNI rotta, tranne l elenco fisso delle ammesse', async () => {
    const ammesse: string[] = []
    const passate: string[] = []
    for (const { classe, metodo } of tutte) {
      const nome = `${classe.name}.${metodo}`
      // Una rotta pubblica ha `@Public`: senza utente l'interceptor passa, e va bene cosi'.
      // Qui si simula un autista AUTENTICATO su qualunque rotta, anche pubblica: se una rotta
      // pubblica avesse un utente (token valido) l'autista non deve oltrepassarla comunque.
      try {
        await esegui(ctx(classe, metodo, { user: autista }))
        ammesse.push(nome)
      } catch (e) {
        if (!(e instanceof ForbiddenException)) passate.push(`${nome}: ${String(e)}`)
      }
    }
    expect(passate).toEqual([])
    expect(ammesse.sort()).toEqual([...AMMESSE_ALL_AUTISTA].sort())
  })
})

describe('ordine degli APP_INTERCEPTOR in AppModule (autista)', () => {
  it('RuoloAutistaInterceptor sta PRIMA di TenantSwitchInterceptor', () => {
    const providers: any[] = Reflect.getMetadata('providers', AppModule)
    const ordine = providers
      .filter(p => p && typeof p === 'object' && p.provide === APP_INTERCEPTOR)
      .map(p => p.useClass)
    const iAutista = ordine.indexOf(RuoloAutistaInterceptor)
    expect(iAutista).toBeGreaterThanOrEqual(0)
    expect(iAutista).toBeLessThan(ordine.indexOf(TenantSwitchInterceptor))
  })
})
