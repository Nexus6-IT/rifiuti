import { readFileSync } from 'fs'
import { join, posix } from 'path'
import {
  SRC,
  leggiControllerReali,
  senzaCommenti,
  soloCodice,
} from '../test-support/sorgenti-controller'

/**
 * Elenco esplicito dei controller che leggono `tenantId` dall'utente. Nei controller
 * l'azienda della richiesta e' quella SELEZIONATA (`requireRequestTenantId(req)` o
 * `@CurrentTenant()`), non quella scritta nel token: leggere `user.tenantId` dal token
 * durante uno switch di azienda scrive nell'azienda sbagliata.
 * Aggiungere un file qui e' una decisione da motivare, non una formalita'.
 */
const AUTORIZZATI: Record<string, string> = {
  'auth/controllers/auth.controller.ts':
    "login SPID e refresh: user e' il record letto dal DB, l'azienda primaria e' la base del token emesso e del controllo d'accesso",
  'auth/controllers/dev-auth.controller.ts':
    "login di sviluppo: user e' il record letto dal DB, azienda primaria del token emesso",
  'api/me/membership.controller.ts':
    'getCompany usa req.tenantId e ripiega sul token solo se il middleware non lo ha impostato',
  'api/admin/user-admin.controller.ts':
    "toResponse proietta il record dell'utente gestito (riga DB), non il token del chiamante",
}

/**
 * LIMITE NOTO: la guardia vede solo gli accessi diretti. Un alias (`const u = req.user; u.tenantId`)
 * o un passaggio dell'intero utente a una funzione non vengono rilevati: per quelli resta la
 * revisione del codice.
 */
const UTENTE = String.raw`(?:\buser|\[\s*['"\x60]user['"\x60]\s*\])` // user | ['user']
const ACCESSI_AL_TENANT_DEL_TOKEN: RegExp[] = [
  // user.tenantId, user?.tenantId, req.user.tenantId, req.user?.tenantId, req['user'].tenantId
  new RegExp(UTENTE + String.raw`\s*\??\.\s*tenantId\b`),
  // user['tenantId'], req.user?.['tenantId'], req['user']['tenantId']
  new RegExp(UTENTE + String.raw`\s*\??\.?\s*\[\s*['"\x60]tenantId['"\x60]\s*\]`),
  /\{[^{}]*\btenantId\b[^{}]*\}\s*=\s*(?:\w+\.)*user\b/, // { tenantId } = user
]

/** Percorsi (relativi a src/) dei file che leggono il tenant dell'utente e non sono autorizzati. */
function violazioni(file: Record<string, string>, autorizzati: Record<string, string>): string[] {
  return Object.entries(file)
    .filter(([rel]) => !(rel in autorizzati))
    .filter(([, testo]) => {
      const codice = soloCodice(testo)
      return ACCESSI_AL_TENANT_DEL_TOKEN.some(re => re.test(codice))
    })
    .map(([rel]) => rel)
    .sort()
}

/**
 * Il vecchio `api/decorators/current-user.decorator` e' ora solo un ri-export, ma un
 * controller deve importare quello canonico di `auth/decorators`: ripristinare un
 * decoratore diverso nel vecchio percorso riaprirebbe la trappola (azienda del token).
 */
function importaIlVecchioCurrentUser(rel: string, testo: string): boolean {
  const codice = senzaCommenti(testo)
  const re = /from\s+['"](\.[^'"]*current-user\.decorator)['"]/g
  for (const m of codice.matchAll(re)) {
    const risolto = posix.normalize(posix.join(posix.dirname(rel), m[1]))
    if (risolto === 'api/decorators/current-user.decorator') return true
  }
  return false
}

function controllerConVecchioCurrentUser(file: Record<string, string>): string[] {
  return Object.entries(file)
    .filter(([rel, testo]) => importaIlVecchioCurrentUser(rel, testo))
    .map(([rel]) => rel)
    .sort()
}

/** `@TenantId` non deve leggere il tenant del token ne' l'header grezzo: delega a requireRequestTenantId. */
function decoratorTenantIdValido(testo: string): boolean {
  const codice = senzaCommenti(testo)
  return (
    /requireRequestTenantId\s*\(/.test(codice) &&
    !/\buser\s*\??\.\s*tenantId\b/.test(codice) &&
    !/x-tenant-id/i.test(codice)
  )
}

describe('decoratori: azienda selezionata, non quella del token', () => {
  it('nessun controller importa il vecchio api/decorators/current-user.decorator', () => {
    expect(controllerConVecchioCurrentUser(leggiControllerReali())).toEqual([])
  })

  it('tenant.decorator.ts delega a requireRequestTenantId e non legge token ne header', () => {
    const testo = readFileSync(join(SRC, 'core/decorators/tenant.decorator.ts'), 'utf8')
    expect(decoratorTenantIdValido(testo)).toBe(true)
  })

  it('la guardia stessa: segnala import vecchi e decoratori che leggono il token', () => {
    expect(
      controllerConVecchioCurrentUser({
        'api/permissions/x.controller.ts':
          "import { CurrentUser } from '../decorators/current-user.decorator'",
        'api/y.controller.ts': "import { CurrentUser } from './decorators/current-user.decorator'",
        'api/me/ok.controller.ts':
          "import { CurrentUser } from '../../auth/decorators/current-user.decorator'",
        'auth/controllers/ok2.controller.ts':
          "import { CurrentUser } from '../decorators/current-user.decorator'",
      })
    ).toEqual(['api/permissions/x.controller.ts', 'api/y.controller.ts'])
    expect(
      decoratorTenantIdValido('return request.user?.tenantId || request.headers["x-tenant-id"]')
    ).toBe(false)
    expect(
      decoratorTenantIdValido("return request.headers['x-tenant-id'] ?? requireRequestTenantId(r)")
    ).toBe(false)
    expect(decoratorTenantIdValido('return request.user.tenantId')).toBe(false)
    expect(decoratorTenantIdValido('return requireRequestTenantId(request)')).toBe(true)
  })
})

describe('controller: azienda selezionata, non quella del token', () => {
  it('nessun controller fuori elenco legge il tenantId dall utente del token', () => {
    expect(violazioni(leggiControllerReali(), AUTORIZZATI)).toEqual([])
  })

  it("ogni voce dell'elenco esiste, ha un motivo e usa davvero il tenant dell'utente", () => {
    const reali = leggiControllerReali()
    for (const [file, motivo] of Object.entries(AUTORIZZATI)) {
      expect({ file, esiste: file in reali }).toEqual({ file, esiste: true })
      expect({ file, motivo: motivo.trim().length > 10 }).toEqual({ file, motivo: true })
      // voce obsoleta: se il file non usa piu' l'accesso va tolta dall'elenco
      expect({ file, usa: violazioni({ [file]: reali[file] }, {}).length === 1 }).toEqual({
        file,
        usa: true,
      })
    }
  })

  describe('la guardia stessa', () => {
    it('segnala user.tenantId fuori elenco, nelle varianti', () => {
      const varianti = [
        'const t = user.tenantId',
        'const t = user?.tenantId',
        'const t = req.user.tenantId',
        'const t = request.user?.tenantId',
        "const t = user['tenantId']",
        'const { tenantId } = user',
        'const { id, tenantId } = req.user',
        "const t = req['user'].tenantId",
        "const t = req['user']['tenantId']",
        "const t = req.user?.['tenantId']",
        'const t = `${req.user.tenantId}`',
      ]
      for (const v of varianti) {
        expect({ v, r: violazioni({ 'api/finto.controller.ts': v }, {}) }).toEqual({
          v,
          r: ['api/finto.controller.ts'],
        })
      }
    })

    it('non segnala le stringhe che citano user.tenantId', () => {
      const lecite = [
        "throw new Error('non usare user.tenantId')",
        'this.logger.log("req.user?.tenantId non e valido")',
        'const m = `usa requireRequestTenantId, non user.tenantId`',
        "const ok = req['user'].id",
      ]
      for (const v of lecite) {
        expect({ v, r: violazioni({ 'api/finto.controller.ts': v }, {}) }).toEqual({ v, r: [] })
      }
    })

    it('legge anche i controller fuori da *.controller.ts (es. fir.controller.v2.ts)', () => {
      const trovati = Object.keys(leggiControllerReali())
      expect(trovati).toContain('api/fir/fir.controller.v2.ts')
      expect(trovati.every(f => !f.endsWith('.spec.ts'))).toBe(true)
    })

    it('non segnala un file in elenco ne i commenti', () => {
      expect(
        violazioni(
          { 'api/finto.controller.ts': 'const t = user.tenantId' },
          { 'api/finto.controller.ts': 'motivo di prova' }
        )
      ).toEqual([])
      expect(
        violazioni(
          {
            'api/finto.controller.ts':
              '// non usare user.tenantId\n/* req.user?.tenantId */\nconst t = requireRequestTenantId(req)',
          },
          {}
        )
      ).toEqual([])
    })
  })
})
