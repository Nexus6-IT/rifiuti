/**
 * Test statico: ogni lettura che ITERA o ELENCA `tenants` (findMany, count, aggregate, groupBy,
 * findFirst) deve escludere l'azienda piattaforma con `escludiPiattaforma`, oppure stare nella
 * lista qui sotto con il motivo per cui la piattaforma non puo' comparire.
 * Una nuova lettura non censita fa fallire il test: o si aggiunge il filtro o si motiva.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const RADICE = join(__dirname, '..', '..')

/** File con letture di `tenants` che non hanno bisogno del filtro, col motivo. */
const NON_NECESSARIO: Record<string, string> = {
  'api/me/membership.service.ts':
    'filtra per ownerUserId, parentTenantId o id gia noti: la piattaforma non ha owner, madre ne e tra le aziende accessibili',
  'api/me/ruolo-effettivo.service.ts':
    'findFirst per id + ownerUserId: la piattaforma non ha owner',
  'application/billing/contratto-gruppo.service.ts':
    'findMany per id delle madri delle figlie gia lette: la piattaforma non e madre di nessuno (assertNonPiattaforma su parentTenantId)',
  'application/billing/billing.service.ts':
    'findFirst per stripeCustomerId: la piattaforma non ha un customer Stripe',
  'application/queries/handlers/get-aggregated-dashboard.handler.ts':
    'figlie per parentTenantId: la piattaforma non ha madre e non e figlia di nessuno',
}

/** Toglie le righe di commento: una menzione in un commento non e' una lettura. */
function senzaCommenti(testo: string): string {
  return testo
    .split('\n')
    .filter(r => !/^\s*(\*|\/\/|\/\*)/.test(r))
    .join('\n')
}

function fileTs(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) return nome === 'node_modules' ? [] : fileTs(p)
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : []
  })
}

describe('azienda piattaforma: esclusione dalle letture di tenants', () => {
  const RE = /\.tenant\.(findMany|count|aggregate|groupBy|findFirst)\s*\(/

  it('ogni lettura elenco/conteggio di tenants esclude la piattaforma o e motivata', () => {
    const mancanti: string[] = []
    for (const file of fileTs(RADICE)) {
      const rel = relative(RADICE, file).split(sep).join('/')
      if (rel === 'core/context/azienda-piattaforma.ts') continue
      const testo = senzaCommenti(readFileSync(file, 'utf8'))
      if (!RE.test(testo)) continue
      if (testo.includes('escludiPiattaforma')) continue
      if (NON_NECESSARIO[rel]) continue
      mancanti.push(rel)
    }
    expect(mancanti).toEqual([])
  })

  it('le voci motivate esistono ancora e leggono davvero tenants', () => {
    for (const rel of Object.keys(NON_NECESSARIO)) {
      const testo = readFileSync(join(RADICE, rel), 'utf8')
      expect(RE.test(testo)).toBe(true)
    }
  })
})
