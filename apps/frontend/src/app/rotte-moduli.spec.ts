import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { MessageService } from 'primeng/api'
import { Route, Routes, provideRouter } from '@angular/router'
import { routes } from './app.routes'
import { moduloGuard } from './core/guards/modulo.guard'
import { LayoutComponent } from './shared/components/layout.component'

/**
 * Copertura statica di T11: ogni rotta di un modulo commerciale ha `moduloGuard` e
 * `data: { modulo }`, e ogni voce di menu con `feature` porta a una rotta protetta da quel
 * modulo. Una rotta nuova o una voce nuova senza guard fa fallire questi test: la decisione
 * (modulo o base) va presa per iscritto qui sotto.
 */

/** Rotte di modulo: percorso completo -> chiave del modulo (mappa §1 della proposta). */
const MAPPA_MODULI: Record<string, string | string[]> = {
  fir: 'fir',
  'fir/:id': 'fir',
  cer: 'cer',
  produttori: 'anagrafiche',
  trasportatori: 'anagrafiche',
  destinatari: 'anagrafiche',
  mud: 'mud',
  esg: 'esg',
  pese: 'pese',
  giacenze: 'giacenze',
  'giacenze/abbinamenti': 'giacenze',
  registro: 'registro',
  anomalie: 'anomalie',
  contratti: 'contratti',
  clienti: 'contratti',
  'clienti/tabelle': 'contratti',
  'clienti/agenti': 'contratti',
  'clienti/addebiti': 'contratti',
  'clienti/fatturazione': 'contratti',
  'legami/da-collegare': 'contratti',
  'contratti-clienti': 'contratti',
  'contratti-clienti/:id/listino': 'contratti',
  fatturazione: 'contratti',
  'fatturazione/elaborazioni': 'contratti',
  'fatturazione/elaborazioni/:id': 'contratti',
  'fatturazione/scostamenti': 'contratti',
  'fatturazione/documenti': 'contratti',
  'fatturazione/documenti/:id': 'contratti',
  'fatturazione/export-contabile': 'contratti',
  'fatturazione/export-contabile/:adattatore': 'contratti',
  'impostazioni/modelli-stampa': ['fir', 'ritiri'],
  'reference-data': 'reference_data',
  'rentri/certificato': 'rentri',
  'rentri/modalita-legame': 'rentri',
  'rentri/sedi': 'rentri',
  'rentri/formulari': 'rentri',
  'rentri/unita-locali': 'rentri',
  'rentri/codifiche': 'rentri',
  'rentri/diagnostica': 'rentri',
  'rentri/blocchi': 'rentri',
}

/** Rotte base (sempre attive): motivate, senza modulo. */
const BASE: string[] = [
  'login',
  'richiedi-accesso',
  'auth/callback',
  'legal/termini',
  'legal/privacy',
  'legal/dpa',
  'dashboard',
  'notifications',
  'abbonamento',
  'admin/tenants',
  'admin/utenti',
  'admin/stato-sistema',
]
const BASE_PREFISSI = ['permissions/']

interface Piatta {
  percorso: string
  route: Route
  antenati: Route[]
}

async function appiattisci(
  elenco: Routes,
  prefisso = '',
  antenati: Route[] = []
): Promise<Piatta[]> {
  const out: Piatta[] = []
  for (const route of elenco) {
    const percorso = [prefisso, route.path ?? ''].filter(Boolean).join('/')
    out.push({ percorso, route, antenati })
    const figli: Routes | undefined =
      route.children ??
      (route.loadChildren
        ? ((await (route.loadChildren as () => Promise<Routes>)()) as Routes)
        : undefined)
    if (figli) out.push(...(await appiattisci(figli, percorso, [...antenati, route])))
  }
  return out
}

const haGuard = (r: Route) => (r.canActivate ?? []).includes(moduloGuard)
const moduliDi = (r: Route): string[] => {
  const m = r.data?.['modulo'] as string | string[] | undefined
  return m === undefined ? [] : Array.isArray(m) ? m : [m]
}

describe('rotte dei moduli: moduloGuard su ogni rotta', () => {
  let piatte: Piatta[]
  beforeAll(async () => {
    piatte = await appiattisci(routes)
  })

  it('ogni rotta con componente è in MAPPA_MODULI o tra le base motivate', () => {
    const sconosciute = piatte
      .filter(p => p.route.loadComponent && p.percorso !== '')
      .map(p => p.percorso)
      .filter(
        p => !(p in MAPPA_MODULI) && !BASE.includes(p) && !BASE_PREFISSI.some(x => p.startsWith(x))
      )
    expect(sconosciute).withContext('rotte senza decisione modulo/base').toEqual([])
  })

  it('ogni voce di MAPPA_MODULI esiste davvero (nessuna voce orfana)', () => {
    const percorsi = new Set(piatte.map(p => p.percorso))
    const orfane = Object.keys(MAPPA_MODULI).filter(p => !percorsi.has(p))
    expect(orfane).toEqual([])
  })

  for (const [percorso, modulo] of Object.entries(MAPPA_MODULI)) {
    it(`${percorso}: moduloGuard con data.modulo = ${modulo}`, () => {
      const voce = piatte.find(p => p.percorso === percorso)
      expect(voce).withContext('rotta mancante').toBeDefined()
      expect(haGuard(voce!.route)).withContext('canActivate senza moduloGuard').toBeTrue()
      expect(moduliDi(voce!.route)).toEqual([modulo].flat())
    })
  }

  it('le rotte base non portano moduloGuard', () => {
    const sbagliate = piatte
      .filter(p => BASE.includes(p.percorso) || BASE_PREFISSI.some(x => p.percorso.startsWith(x)))
      .filter(p => haGuard(p.route))
      .map(p => p.percorso)
    expect(sbagliate).toEqual([])
  })
})

describe('menu e rotte: ogni voce con feature porta a una rotta protetta dal suo modulo', () => {
  let piatte: Piatta[]
  let layout: LayoutComponent

  beforeAll(async () => {
    piatte = await appiattisci(routes)
  })

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    layout = TestBed.createComponent(LayoutComponent).componentInstance
  })

  const protetta = (route: string, feature: string): boolean => {
    const chiave = route.replace(/^\//, '')
    const voce = piatte.find(p => p.percorso === chiave)
    if (!voce) return false
    return [...voce.antenati, voce.route].some(r => haGuard(r) && moduliDi(r).includes(feature))
  }

  it('navMain', () => {
    const scoperte = layout.navMain
      .filter(v => v.feature)
      .filter(v => !protetta(v.route, v.feature!))
      .map(v => `${v.route} (${v.feature})`)
    expect(scoperte).toEqual([])
  })

  it('navImpostazioni', () => {
    const scoperte = layout.navImpostazioni
      .filter(v => !protetta(v.route, v.feature))
      .map(v => `${v.route} (${v.feature})`)
    expect(scoperte).toEqual([])
  })

  it('navAnagrafiche (intera sezione gated da anagrafiche)', () => {
    const scoperte = layout.navAnagrafiche
      .filter(v => !protetta(v.route, 'anagrafiche'))
      .map(v => v.route)
    expect(scoperte).toEqual([])
  })

  it('il test vede davvero le voci di menu (sanità)', () => {
    expect(layout.navMain.filter(v => v.feature).length).toBeGreaterThan(10)
    expect(layout.navImpostazioni.length).toBeGreaterThan(0)
  })
})
