import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..')

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

const ACCESSI_AL_TENANT_DEL_TOKEN: RegExp[] = [
  /\buser\s*\??\.\s*tenantId\b/, // user.tenantId, user?.tenantId, req.user.tenantId, req.user?.tenantId
  /\buser\s*\??\.?\s*\[\s*['"`]tenantId['"`]\s*\]/, // user['tenantId']
  /\{[^{}]*\btenantId\b[^{}]*\}\s*=\s*(?:\w+\.)*user\b/, // { tenantId } = user
]

function controller(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return controller(percorso)
    return nome.endsWith('.controller.ts') ? [percorso] : []
  })
}

/** Toglie i commenti rispettando le stringhe (un URL con `//` non e' un commento). */
function senzaCommenti(testo: string): string {
  let fuori = ''
  let i = 0
  while (i < testo.length) {
    const c = testo[i]
    const n = testo[i + 1]
    if (c === '/' && n === '/') {
      while (i < testo.length && testo[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      const fine = testo.indexOf('*/', i + 2)
      i = fine === -1 ? testo.length : fine + 2
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < testo.length && testo[j] !== c) j += testo[j] === '\\' ? 2 : 1
      fuori += testo.slice(i, j + 1)
      i = j + 1
    } else {
      fuori += c
      i++
    }
  }
  return fuori
}

/** Percorsi (relativi a src/) dei file che leggono il tenant dell'utente e non sono autorizzati. */
function violazioni(file: Record<string, string>, autorizzati: Record<string, string>): string[] {
  return Object.entries(file)
    .filter(([rel]) => !(rel in autorizzati))
    .filter(([, testo]) => {
      const codice = senzaCommenti(testo)
      return ACCESSI_AL_TENANT_DEL_TOKEN.some(re => re.test(codice))
    })
    .map(([rel]) => rel)
    .sort()
}

function leggiControllerReali(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of controller(SRC)) {
    out[relative(SRC, f).split(sep).join('/')] = readFileSync(f, 'utf8')
  }
  return out
}

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
      ]
      for (const v of varianti) {
        expect({ v, r: violazioni({ 'api/finto.controller.ts': v }, {}) }).toEqual({
          v,
          r: ['api/finto.controller.ts'],
        })
      }
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
