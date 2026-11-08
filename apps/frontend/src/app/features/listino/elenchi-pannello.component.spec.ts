import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ElenchiPannelloComponent } from './elenchi-pannello.component'
import { ElencoAddebiti } from './listino.model'

const elenco = (over: Partial<ElencoAddebiti> = {}): ElencoAddebiti =>
  ({
    id: 'e1',
    codice: '001',
    descrizione: 'Elenco standard',
    predefinito: true,
    modificabile: true,
    eliminabile: true,
    validoDal: null,
    validoAl: null,
    righe: 3,
    versione: 1,
    ...over,
  }) as ElencoAddebiti

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const bottone = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}

describe('ElenchiPannelloComponent', () => {
  let fixture: ComponentFixture<ElenchiPannelloComponent>
  let c: ElenchiPannelloComponent

  const monta = (elenchi: ElencoAddebiti[], over: Partial<ElenchiPannelloComponent> = {}) => {
    fixture = TestBed.createComponent(ElenchiPannelloComponent)
    c = fixture.componentInstance
    c.elenchi = elenchi
    Object.assign(c, over)
    fixture.detectChanges()
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [ElenchiPannelloComponent] }))
  afterEach(() => fixture?.destroy())

  it('senza elenchi: messaggio compatto', () => {
    monta([])
    expect(q('listino-nessun-elenco')!.textContent).toContain('Nessun elenco.')
  })

  it('scegliere un elenco emette e segna quello scelto con aria-pressed', () => {
    const e = elenco()
    monta([e, elenco({ id: 'e2', codice: '002' })], { scelto: e })
    const spy = jasmine.createSpy('scegli')
    c.scegli.subscribe(spy)
    expect(q('listino-scegli-e1')!.getAttribute('aria-pressed')).toBe('true')
    expect(q('listino-scegli-e2')!.getAttribute('aria-pressed')).toBe('false')
    q('listino-scegli-e2')!.click()
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'e2' }))
  })

  it('descrizione lunga: una riga con ellissi e title completo', () => {
    const lunga = 'Listino standard dei rifiuti speciali non pericolosi '.repeat(4).trim()
    monta([elenco({ descrizione: lunga })])
    const voce = q('listino-scegli-e1')!
    expect(voce.getAttribute('title')).toContain(lunga)
    const testo = voce.querySelector('.voce__testo') as HTMLElement
    expect(getComputedStyle(testo).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(testo).textOverflow).toBe('ellipsis')
  })

  it('«Predefinito» solo sul predefinito', () => {
    monta([elenco(), elenco({ id: 'e2', predefinito: false })])
    expect(q('listino-predefinito-e1')).toBeTruthy()
    expect(q('listino-predefinito-e2')).toBeNull()
  })

  it('modifica ed elimina emettono; i bottoni hanno il nome accessibile col codice', () => {
    monta([elenco()])
    const modifica = jasmine.createSpy('modifica')
    const elimina = jasmine.createSpy('elimina')
    c.modifica.subscribe(modifica)
    c.elimina.subscribe(elimina)
    expect(bottone('listino-modifica-e1')!.getAttribute('aria-label')).toBe('Modifica l’elenco 001')
    bottone('listino-modifica-e1')!.click()
    bottone('listino-elimina-e1')!.click()
    expect(modifica).toHaveBeenCalledTimes(1)
    expect(elimina).toHaveBeenCalledTimes(1)
  })

  it('elenco in uso: «Elimina» spento, motivo come title e come testo visibile', () => {
    monta([elenco({ eliminabile: false })])
    expect(bottone('listino-elimina-e1')!.disabled).toBeTrue()
    expect(q('listino-elimina-tip-e1')!.getAttribute('title')).toMatch(/citato da movimenti/)
    expect(q('listino-elimina-tip-e1')!.textContent).toContain('In uso')
    expect(bottone('listino-elimina-e1')!.getAttribute('aria-label')).toContain('In uso')
    expect(bottone('listino-modifica-e1')!.disabled).toBeFalse()
  })

  it('elenco non modificabile: nessuna azione sulla riga', () => {
    monta([elenco({ modificabile: false })])
    expect(q('listino-modifica-e1')).toBeNull()
    expect(q('listino-elimina-e1')).toBeNull()
  })

  it('sola lettura: né «Nuovo elenco» né azioni, ma si può scegliere', () => {
    monta([elenco()], { soloLettura: true })
    expect(q('listino-nuovo-elenco')).toBeNull()
    expect(q('listino-modifica-e1')).toBeNull()
    expect(q('listino-elimina-e1')).toBeNull()
    expect(q('listino-scegli-e1')).toBeTruthy()
  })

  it('«Nuovo elenco» è secondario: l’unico primario della pagina è «Nuova riga»', () => {
    monta([elenco()])
    expect(document.body.querySelector('.wf-primario')).toBeNull()
    const spy = jasmine.createSpy('nuovo')
    c.nuovo.subscribe(spy)
    bottone('listino-nuovo-elenco')!.click()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('«Solo validi oggi» emette il nuovo valore', () => {
    monta([elenco()])
    const spy = jasmine.createSpy('valore')
    c.soloValidiChange.subscribe(spy)
    q('listino-solo-validi')!.querySelector<HTMLElement>('.p-checkbox-box, input')!.click()
    expect(spy).toHaveBeenCalledWith(true)
  })

  it('il periodo di validità si legge in date italiane', () => {
    monta([elenco({ validoDal: '2026-01-01', validoAl: '2026-12-31' })])
    expect(q('listino-scegli-e1')!.textContent).toContain('01/01/2026')
    expect(q('listino-scegli-e1')!.textContent).toContain('31/12/2026')
  })
})
