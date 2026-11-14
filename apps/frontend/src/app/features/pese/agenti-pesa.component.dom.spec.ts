import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { RegistroService } from '../registro/registro.service'
import { AgentiPesaComponent } from './agenti-pesa.component'
import { q, qb, scrivi } from './pese-test-utils'
import { AgenteCreato, AgenteVista, PeseService, StrumentoPesa } from './pese.service'

export function agente(p: Partial<AgenteVista> = {}): AgenteVista {
  return {
    id: 'g1',
    descrizione: 'PC pesa ingresso',
    registro: { id: 'r1', descrizione: 'Sede di Milano' },
    stato: 'ATTIVO',
    abbinatoIl: '2026-11-10T08:00:00.000Z',
    nomeHost: 'PESA-01',
    versioneAgente: '1.0.0',
    ultimoContattoIl: new Date().toISOString(),
    inLinea: true,
    scartoOrologioS: 2,
    codaInAttesa: 3,
    lettureScartate: 0,
    improntaChiave: 'AB12 CD34',
    strumenti: [{ id: 's1', descrizione: 'Pesa a ponte', stato: 'OK', ultimoErrore: null }],
    codiceScadeIl: null,
    revocatoIl: null,
    motivoRevoca: null,
    ultimoIp: '10.0.0.5',
    ...p,
  }
}
const strumento = (id: string, descrizione: string): StrumentoPesa => ({
  id,
  registroId: null,
  descrizione,
  costruttore: null,
  modello: null,
  matricola: null,
  portataMaxKg: null,
  divisioneKg: null,
  dataUltimaVerificazione: null,
  attivo: true,
})

describe('AgentiPesaComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<AgentiPesaComponent>

  function apri(righe: AgenteVista[], puoGestire = true) {
    pese.elencaAgenti.and.returnValue(of({ righe, puoGestire }))
    fixture = TestBed.createComponent(AgentiPesaComponent)
    fixture.detectChanges()
  }

  beforeEach(() => {
    pese = jasmine.createSpyObj<PeseService>('PeseService', [
      'elencaAgenti',
      'elencaStrumenti',
      'creaAgente',
      'nuovoCodiceAgente',
      'revocaAgente',
      'assegnaStrumento',
    ])
    pese.elencaStrumenti.and.returnValue(
      of({
        righe: [strumento('s1', 'Pesa a ponte'), strumento('s2', 'Pesa interna')],
        puoOperare: true,
        puoRettificare: true,
      })
    )
    const registri = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    registri.listRegistri.and.returnValue(of([]))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [AgentiPesaComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: PeseService, useValue: pese },
        { provide: RegistroService, useValue: registri },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => {
    fixture?.destroy()
    document.body.querySelectorAll('.p-dialog-mask').forEach(e => e.remove())
  })

  it('mostra stato in linea, coda, strumenti e impronta della chiave', () => {
    apri([agente()])
    expect(q('ag-stato-g1')!.textContent).toContain('In linea')
    expect(q('ag-coda-g1')!.textContent).toContain('3 in attesa')
    const riga = q('ag-riga-g1')!.textContent!
    expect(riga).toContain('Pesa a ponte')
    expect(q('ag-impronta-g1')!.textContent).toContain('AB12 CD34')
    expect(q('ag-orologio-g1')).toBeNull()
  })

  it('un agente senza battito da oltre 3 minuti e non in linea da...; scarto orologio oltre 60 s', () => {
    apri([
      agente({
        inLinea: false,
        ultimoContattoIl: new Date(Date.now() - 10 * 60_000).toISOString(),
        scartoOrologioS: 400,
      }),
    ])
    expect(q('ag-stato-g1')!.textContent).toContain('Non in linea da 10 min')
    expect(q('ag-orologio-g1')!.textContent).toContain('avanti')
  })

  it('OPERATOR: niente azioni di gestione', () => {
    apri([agente()], false)
    expect(q('ag-nuovo')).toBeNull()
    expect(q('ag-revoca-g1')).toBeNull()
    expect(q('ag-libera-s1')).toBeNull()
    expect(q('ag-assegna-g1')).toBeNull()
    expect(q('ag-sola-lettura')?.textContent).toContain('amministratore')
  })

  it('la guida dice dove trovare lo SHA-256 dell eseguibile', () => {
    apri([])
    expect(q('ag-guida')!.textContent).toContain('SHA-256')
    expect(q('ag-vuota')).not.toBeNull()
  })

  it('il codice si vede una volta sola e alla chiusura sparisce dal DOM', async () => {
    apri([])
    const creato: AgenteCreato = {
      agente: agente({ stato: 'IN_ATTESA' }),
      codice: 'ABCD-EFGH-JKLM',
      scadeIl: new Date(Date.now() + 15 * 60_000).toISOString(),
    }
    pese.creaAgente.and.returnValue(of(creato))
    qb('ag-nuovo')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    qb('ag-salva')!.click()
    fixture.detectChanges()
    expect(pese.creaAgente).not.toHaveBeenCalled()
    expect(q('ag-descrizione-errore')).not.toBeNull()
    scrivi(q<HTMLInputElement>('ag-descrizione')!, 'PC nuovo')
    qb('ag-salva')!.click()
    fixture.detectChanges()
    expect(pese.creaAgente).toHaveBeenCalledWith({ descrizione: 'PC nuovo', registroId: null })
    expect(q('ag-avviso-una-volta')!.textContent).toContain('una volta sola')
    expect(q('ag-codice')!.textContent!.replace(/\s/g, '')).toBe('ABCD-EFGH-JKLM')
    expect(q('ag-comando')!.textContent).toContain('agente-pesa abbina --server ')
    expect(q('ag-comando')!.textContent).toContain('/api/v1')
    expect(q('ag-comando')!.textContent).toContain('--codice ABCD-EFGH-JKLM')
    expect(q('ag-scadenza')!.textContent).toContain('Scade fra 1')
    qb('ag-chiudi')!.click()
    fixture.detectChanges()
    expect(document.body.textContent).not.toContain('ABCD-EFGH-JKLM')
  })

  it('la revoca chiede il motivo e lo manda al backend', async () => {
    apri([agente()])
    pese.revocaAgente.and.returnValue(of(agente({ stato: 'REVOCATO' })))
    qb('ag-revoca-g1')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    qb('md-conferma')!.click()
    fixture.detectChanges()
    expect(pese.revocaAgente).not.toHaveBeenCalled()
    expect(q('md-motivo-errore')).not.toBeNull()
    scrivi(q<HTMLTextAreaElement>('md-motivo')!, 'PC sostituito')
    qb('md-conferma')!.click()
    expect(pese.revocaAgente).toHaveBeenCalledWith('g1', 'PC sostituito')
  })

  it('una revoca rifiutata mostra il messaggio del backend', async () => {
    apri([agente()])
    pese.revocaAgente.and.returnValue(
      throwError(() => ({ error: { message: 'Agente già revocato.' } }))
    )
    qb('ag-revoca-g1')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    scrivi(q<HTMLTextAreaElement>('md-motivo')!, 'x')
    qb('md-conferma')!.click()
    fixture.detectChanges()
    expect(q('md-errore')!.textContent).toContain('già revocato')
  })

  it('assegna uno strumento libero e libera quello assegnato', () => {
    apri([agente()])
    pese.assegnaStrumento.and.returnValue(of({}))
    const sel = q<HTMLSelectElement>('ag-assegna-g1')!
    // s1 e gia assegnato: resta solo s2
    expect(Array.from(sel.options).map(o => o.value)).toEqual(['', 's2'])
    sel.value = 's2'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    expect(pese.assegnaStrumento).toHaveBeenCalledWith('s2', 'g1')
    qb('ag-libera-s1')!.click()
    expect(pese.assegnaStrumento).toHaveBeenCalledWith('s1', null)
  })

  it('un agente in attesa offre un nuovo codice, non la liberazione', () => {
    apri([agente({ stato: 'IN_ATTESA', strumenti: [], codiceScadeIl: new Date().toISOString() })])
    expect(q('ag-codice-g1')).not.toBeNull()
    expect(q('ag-stato-g1')!.textContent).toContain('In attesa di abbinamento')
  })
})
