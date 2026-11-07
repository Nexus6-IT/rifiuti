import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Router } from '@angular/router'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { ClientiService } from '../../clienti/clienti.service'
import { ElaborazioneRiga, Pagina } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { ElaborazioniListaComponent } from './elaborazioni-lista.component'

function riga(n: number, extra: Partial<ElaborazioneRiga> = {}): ElaborazioneRiga {
  return {
    id: `e${n}`,
    stato: 'ANTEPRIMA_PRONTA',
    createdAt: '2026-11-03T09:30:00.000Z',
    periodoDal: '2026-10-01',
    periodoAl: '2026-10-31',
    dataDocumento: '2026-11-03',
    documenti: 12,
    totale: '12345.60',
    errori: 2,
    avvisi: 1,
    ...extra,
  }
}

const pagina = (
  elementi: ElaborazioneRiga[],
  totale = elementi.length
): Pagina<ElaborazioneRiga> => ({
  elementi,
  totale,
  pagina: 1,
  dimensione: 50,
})

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

describe('ElaborazioniListaComponent (DOM)', () => {
  let fixture: ComponentFixture<ElaborazioniListaComponent>
  let servizio: jasmine.SpyObj<FatturazioneService>
  let router: jasmine.SpyObj<Router>

  async function crea(ruolo: string, risposta = of(pagina([riga(1)]))): Promise<void> {
    servizio = jasmine.createSpyObj('FatturazioneService', ['lista', 'avvia'])
    servizio.lista.and.returnValue(risposta)
    router = jasmine.createSpyObj('Router', ['navigate'])
    await TestBed.configureTestingModule({
      imports: [ElaborazioniListaComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FatturazioneService, useValue: servizio },
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        {
          provide: ClientiService,
          useValue: {
            clienti: { list: () => of({ elementi: [], totale: 0 }) },
            contratti: { list: () => of({ elementi: [], totale: 0 }) },
          },
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(ElaborazioniListaComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => fixture?.destroy())

  it('usa la classe pagina-lavoro', async () => {
    await crea('ADMIN')
    expect(fixture.nativeElement.querySelector('.pagina-lavoro')).not.toBeNull()
  })

  it('tabella con data, periodo, stato (badge da vocabolario), documenti, totale it-IT, errori', async () => {
    await crea('ADMIN')
    const tr = q('elaborazione-e1')!
    expect(tr.querySelector('[data-testid="el-data"]')!.textContent).toContain('03/11/2026')
    expect(tr.querySelector('[data-testid="el-periodo"]')!.textContent).toContain(
      '01/10/2026 – 31/10/2026'
    )
    expect(tr.querySelector('[data-testid="el-stato"]')!.textContent).toContain('Anteprima pronta')
    expect(tr.querySelector('[data-testid="el-documenti"]')!.textContent).toContain('12')
    expect(tr.querySelector('[data-testid="el-totale"]')!.textContent).toContain('12.345,60')
    expect(tr.querySelector('[data-testid="el-errori"]')!.textContent).toContain('2')
  })

  it('paginazione con dimensione ≤ 100: la prima richiesta è pagina 1, dimensione 50', async () => {
    await crea('ADMIN')
    const arg = servizio.lista.calls.mostRecent().args[0]!
    expect(arg.pagina).toBe(1)
    expect(arg.dimensione!).toBeLessThanOrEqual(100)
    expect(fixture.componentInstance.dimensione).toBeLessThanOrEqual(100)
  })

  it('cambio pagina: rilegge con la pagina nuova', async () => {
    await crea('ADMIN', of(pagina([riga(1)], 120)))
    fixture.componentInstance.cambiaPagina({ page: 1 })
    expect(servizio.lista.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ pagina: 2 })
    )
  })

  it('«Nuova elaborazione» per OPERATOR, ADMIN e SUPER_ADMIN', async () => {
    for (const ruolo of ['OPERATOR', 'ADMIN', 'SUPER_ADMIN']) {
      TestBed.resetTestingModule()
      await crea(ruolo)
      expect(q('nuova-elaborazione-apri')).not.toBeNull()
      fixture.destroy()
    }
  })

  it('il VIEWER non vede «Nuova elaborazione»', async () => {
    await crea('VIEWER')
    expect(q('nuova-elaborazione-apri')).toBeNull()
  })

  it('lista vuota: messaggio', async () => {
    await crea('ADMIN', of(pagina([])))
    expect(q('elaborazioni-vuota')).not.toBeNull()
  })

  it('errore di lettura: messaggio e «Riprova»', async () => {
    await crea(
      'ADMIN',
      throwError(() => ({ status: 500, error: { message: 'Errore del server' } }))
    )
    expect(q('elaborazioni-errore')!.textContent).toContain('Errore del server')
    expect(q('elaborazioni-riprova')).not.toBeNull()
  })

  it('una nuova lettura annulla la GET pendente e ignora la risposta tardiva', async () => {
    const prima = new Subject<Pagina<ElaborazioneRiga>>()
    const seconda = new Subject<Pagina<ElaborazioneRiga>>()
    await crea('ADMIN', prima as never)
    expect(prima.observed).toBeTrue()
    servizio.lista.and.returnValue(seconda)
    fixture.componentInstance.carica()
    expect(prima.observed).toBeFalse()
    seconda.next(pagina([riga(2)]))
    prima.next(pagina([riga(9)]))
    fixture.detectChanges()
    expect(q('elaborazione-e2')).not.toBeNull()
    expect(q('elaborazione-e9')).toBeNull()
  })

  it('alla distruzione la GET pendente è annullata', async () => {
    const prima = new Subject<Pagina<ElaborazioneRiga>>()
    await crea('ADMIN', prima as never)
    fixture.destroy()
    expect(prima.observed).toBeFalse()
  })

  it('dopo l’avvio naviga al dettaglio senza mostrare altro', async () => {
    await crea('ADMIN')
    fixture.componentInstance.dopoAvvio('e77')
    expect(router.navigate).toHaveBeenCalledWith(['/fatturazione', 'elaborazioni', 'e77'])
    expect(fixture.componentInstance.nuovaAperta()).toBeFalse()
  })
})
