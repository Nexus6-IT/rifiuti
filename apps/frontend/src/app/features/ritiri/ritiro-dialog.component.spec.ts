import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { PeseService } from '../pese/pese.service'
import { RegistryService } from '../registry/registry.service'
import { RitiroDialogComponent } from './ritiro-dialog.component'
import { RitiriService } from './ritiri.service'
import { ritiroDiProva } from './ritiri-test-utils'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const bottone = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}

describe('RitiroDialogComponent', () => {
  let fixture: ComponentFixture<RitiroDialogComponent>
  let servizio: jasmine.SpyObj<RitiriService>

  async function crea(ritiro = null as ReturnType<typeof ritiroDiProva> | null): Promise<void> {
    servizio = jasmine.createSpyObj<RitiriService>('RitiriService', ['crea', 'modifica'])
    const registry = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
      'getDitta',
    ])
    const vuoto = { items: [], total: 0, page: 1, limit: 500, totalPages: 0 }
    registry.getProduttori.and.returnValue(of(vuoto))
    registry.getTrasportatori.and.returnValue(of(vuoto))
    registry.getDestinatari.and.returnValue(of(vuoto))
    await TestBed.configureTestingModule({
      imports: [RitiroDialogComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RitiriService, useValue: servizio },
        { provide: RegistryService, useValue: registry },
        {
          provide: PeseService,
          useValue: {
            elencaAutomezzi: () => of({ righe: [{ id: 'a1', targa: 'AB123CD', attivo: true }] }),
          },
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(RitiroDialogComponent)
    fixture.componentInstance.ritiro = ritiro
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach(e => e.remove()))

  it('senza dati non salva e mostra gli errori campo per campo', async () => {
    await crea()
    bottone('rd-salva')!.click()
    fixture.detectChanges()
    expect(servizio.crea).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Indica la data prevista.')
    expect(document.body.textContent).toContain('Scegli il produttore.')
    expect(document.body.textContent).toContain('La quantità deve essere maggiore di zero.')
  })

  it('senza provenienza (ritiro vecchio) non salva e chiede di sceglierla', async () => {
    await crea(ritiroDiProva({ provenienza: null }))
    bottone('rd-salva')!.click()
    fixture.detectChanges()
    expect(servizio.modifica).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Indica la provenienza del rifiuto.')
    expect(q('rd-provenienza')!.textContent).not.toContain('Non indicata')
  })

  it('in modifica precompila i campi e salva con la versione letta', async () => {
    const r = ritiroDiProva({ versione: 7 })
    await crea(r)
    servizio.modifica.and.returnValue(of(r))
    let salvato = false
    fixture.componentInstance.salvato.subscribe(() => (salvato = true))
    bottone('rd-salva')!.click()
    expect(servizio.modifica).toHaveBeenCalledTimes(1)
    const [id, dati] = servizio.modifica.calls.mostRecent().args
    expect(id).toBe('r1')
    expect(dati.versione).toBe(7)
    expect(dati.produttoreSedeId).toBe('s1')
    expect(dati.quantitaPresunta).toBe('1250.50')
    expect(dati.cerCode).toBe('170504')
    expect(salvato).toBeTrue()
  })

  it('l’anteprima della ripetizione elenca le date e il tasto dice quanti ritiri crea', async () => {
    await crea()
    const c = fixture.componentInstance
    c.form.patchValue({
      dataPrevista: '2026-11-02',
      ripeti: true,
      intervallo: 1,
      unitaRipetizione: 'settimane',
      fino: '2026-11-23',
    })
    fixture.detectChanges()
    expect(q('rd-anteprima')?.textContent).toContain('4 ritiri')
    expect(q('rd-anteprima')?.textContent).toContain('02/11/2026')
    expect(q('rd-salva')?.textContent).toContain('Crea 4 ritiri')
  })

  it('la creazione manda ripetizione e chiave di idempotenza, la stessa a ogni tentativo', async () => {
    await crea()
    const c = fixture.componentInstance
    c.form.patchValue({
      dataPrevista: '2026-11-02',
      produttoreId: 'p1',
      produttoreSedeId: 's1',
      trasportatoreId: 't1',
      destinatarioId: 'd1',
      destinatarioSedeId: 's2',
      cerCode: '170504',
      descrizione: 'Terre',
      quantita: 12.5,
      ripeti: true,
      intervallo: 2,
      unitaRipetizione: 'giorni',
      fino: '2026-11-10',
    })
    servizio.crea.and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ ritiri: [ritiroDiProva()], giaRegistrato: false })
    )
    c.salva()
    fixture.detectChanges()
    expect(q('rd-errore')?.textContent).toContain('Impossibile salvare il ritiro')
    c.salva()
    const [a, b] = servizio.crea.calls.allArgs().map(x => x[0])
    expect(a.chiaveIdempotenza).toBeTruthy()
    expect(b.chiaveIdempotenza).toBe(a.chiaveIdempotenza)
    expect(b.ripetizione).toEqual({ ogniGiorni: 2, fino: '2026-11-10' })
    expect(b.quantitaPresunta).toBe('12.50')
  })

  it('offre il mezzo solo se l’elenco delle pese lo permette', async () => {
    await crea()
    expect(q('rd-automezzo')?.textContent).toContain('AB123CD')
  })
})
