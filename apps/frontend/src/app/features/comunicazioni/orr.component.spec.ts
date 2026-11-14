import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { of, throwError } from 'rxjs'
import { ConfirmationService } from 'primeng/api'
import { OrrComponent } from './orr.component'
import { OrrService } from './orr.service'
import { ComunicazioniService } from './comunicazioni.service'
import { DatiComunicazioniService } from './dati-comunicazioni.service'
import { AnteprimaOrr, ComunicazioneOrr } from './orr.model'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { ToastService } from '../../core/services/toast.service'

const sede = (id: string, denominazione: string) => ({
  id,
  denominazione,
  attiva: true,
  numIscrSito: 'X',
  principale: true,
  createdAt: '',
  updatedAt: '',
})

const anteprimaDi = (o: Partial<AnteprimaOrr> = {}): AnteprimaOrr => ({
  unitaLocaleId: 'ul-1',
  periodo: { da: '2026-05-01', a: '2026-05-31' },
  file: [
    {
      attivita: 'TRA',
      tracciato: 'xrec718-TRA',
      versione: 'xrec718-ww1',
      affidabilita: 'RICAVATO_WINWASTE',
      notaAffidabilita: 'n',
      numeroRecord: 2,
      numeroMovimenti: 2,
      avvisi: [],
      bloccanti: false,
      hashDati: 'h1',
    },
    {
      attivita: 'STO',
      tracciato: 'xrec718-STO',
      versione: 'xrec718-ww1',
      affidabilita: 'RICAVATO_WINWASTE',
      notaAffidabilita: 'n',
      numeroRecord: 1,
      numeroMovimenti: 1,
      avvisi: [],
      bloccanti: false,
      hashDati: 'h2',
    },
  ],
  avvisiGenerali: [],
  bloccanti: false,
  nessunDato: false,
  puoGenerare: true,
  ...o,
})

const comunicazione = (o: Partial<ComunicazioneOrr> = {}): ComunicazioneOrr => ({
  id: 'c1',
  consorzio: 'ORR',
  unitaLocaleId: 'ul-1',
  periodoDa: '2026-05-01',
  periodoA: '2026-05-31',
  tracciato: 'xrec718-STO',
  versione: 'xrec718-ww1',
  stato: 'GENERATA',
  hashDati: 'h',
  nomeFile: 'N0001MG26S.txt',
  generataIl: '2026-11-10T10:00:00Z',
  generataDa: 'u1',
  modificataDopoInvio: false,
  affidabilita: 'RICAVATO_WINWASTE',
  attivita: 'STO',
  ...o,
})

describe('OrrComponent', () => {
  let fixture: ComponentFixture<OrrComponent>
  let component: OrrComponent
  let orr: jasmine.SpyObj<OrrService>
  let com: jasmine.SpyObj<ComunicazioniService>
  let toast: jasmine.SpyObj<ToastService>

  function setup(a: AnteprimaOrr = anteprimaDi(), sedi = [sede('ul-1', 'Sede 1')]): void {
    orr = jasmine.createSpyObj<OrrService>('OrrService', ['anteprima', 'genera', 'storico'])
    orr.anteprima.and.returnValue(of(a))
    orr.storico.and.returnValue(of([]))
    com = jasmine.createSpyObj<ComunicazioniService>('ComunicazioniService', [
      'scaricaFile',
      'scaricaManifest',
      'segnaInviata',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    const sediSvc = jasmine.createSpyObj<RentriUnitaLocaleService>('RentriUnitaLocaleService', [
      'list',
    ])
    sediSvc.list.and.returnValue(of(sedi))
    TestBed.configureTestingModule({
      imports: [OrrComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: OrrService, useValue: orr },
        { provide: ComunicazioniService, useValue: com },
        { provide: RentriUnitaLocaleService, useValue: sediSvc },
        { provide: ToastService, useValue: toast },
        {
          provide: DatiComunicazioniService,
          useValue: {
            configurazione: () =>
              of({
                unitaLocaleId: 'ul-1',
                consorzio: 'CONOU',
                salvata: false,
                dati: {},
                puoModificare: false,
              }),
          },
        },
      ],
    })
    fixture = TestBed.createComponent(OrrComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  }
  const q = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`)
  const tutti = (id: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`))

  it('mostra sempre il banner «da confermare con un file reale»', () => {
    setup()
    expect(q('orr-banner-ricavato')?.textContent).toContain('da confermare con un file reale')
  })

  it('con una sola sede la sceglie da sola e carica anteprima e storico del periodo', () => {
    setup()
    expect(orr.anteprima).toHaveBeenCalledWith('ul-1', component.anno(), 1, component.meseA())
    expect(orr.storico).toHaveBeenCalledWith('ul-1', component.anno())
  })

  it('mostra un riquadro per ogni attivita con i record e i movimenti', () => {
    setup()
    expect(q('orr-file-TRA')?.textContent).toContain('2 record da 2 movimenti')
    expect(q('orr-file-STO')?.textContent).toContain('1 record da 1 movimenti')
    expect(q('orr-genera')).not.toBeNull()
    expect(q('orr-bloccanti')).toBeNull()
  })

  it('il periodo non puo avere il mese finale prima dell iniziale', () => {
    setup()
    component.scegliMeseA(3)
    component.scegliMeseDa(6)
    expect(component.meseDa()).toBe(6)
    expect(component.meseA()).toBe(6)
    component.scegliMeseA(2)
    expect(component.meseDa()).toBe(2)
  })

  it('un bloccante disabilita Genera e mostra avviso con link alla correzione', () => {
    const a = anteprimaDi()
    a.file[1] = {
      ...a.file[1],
      bloccanti: true,
      avvisi: [
        {
          codice: 'ATECO_PRODUTTORE',
          messaggio: 'Produttore «Rossi»: manca il codice ATECO.',
          movimentoIds: ['m1'],
          movimenti: [{ id: 'm1', data: '2026-05-10', numero: '1/2026', cer: '150110' }],
          bloccante: true,
          correzione: { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: 's1' },
        },
      ],
    }
    setup({ ...a, bloccanti: true })
    expect(q('orr-bloccanti')).not.toBeNull()
    expect(q('orr-file-avviso')?.textContent).toContain('manca il codice ATECO')
    expect(q('orr-file-avviso')?.textContent).toContain('1/2026')
    expect(q('orr-correzione')?.textContent).toContain('anagrafica della sede')
    expect(component.generaDisabilitato()).toBeTrue()
    component.genera()
    expect(orr.genera).not.toHaveBeenCalled()
  })

  it('nessun dato: lo dice, senza pulsante Genera', () => {
    setup(anteprimaDi({ file: [], nessunDato: true }))
    expect(q('orr-nessun-dato')?.textContent).toContain('Non ci sono dati da comunicare')
    expect(q('orr-genera')).toBeNull()
  })

  it('avvisi generali (sede non campana): elencati con il link alla configurazione', () => {
    setup(
      anteprimaDi({
        file: [],
        bloccanti: true,
        avvisiGenerali: [
          {
            codice: 'SEDE_NON_IN_CAMPANIA',
            messaggio: 'La sede non è in Campania.',
            movimentoIds: [],
            bloccante: true,
            correzione: { tipo: 'CONFIGURAZIONE_SEDE' },
          },
        ],
      })
    )
    expect(q('orr-avviso-generale')?.textContent).toContain('non è in Campania')
    expect(q('orr-correzione')?.textContent).toContain('configurazione')
    expect(q('orr-nessun-dato')).toBeNull()
  })

  it('un ruolo di sola lettura non vede Genera', () => {
    setup(anteprimaDi({ puoGenerare: false }))
    expect(q('orr-genera')).toBeNull()
  })

  it('genera: chiama il servizio con il periodo, avvisa e ricarica', () => {
    setup()
    orr.genera.and.returnValue(of({ file: [comunicazione(), comunicazione({ id: 'c2' })] }))
    component.genera()
    expect(orr.genera).toHaveBeenCalledWith('ul-1', component.anno(), 1, component.meseA())
    expect(toast.success).toHaveBeenCalledWith('2 file generati')
    expect(orr.anteprima).toHaveBeenCalledTimes(2)
  })

  it('genera con bloccanti dal backend: messaggio dedicato', () => {
    setup()
    orr.genera.and.returnValue(
      throwError(() => ({ status: 400, error: { error: 'COMUNICAZIONE_CON_BLOCCANTI' } }))
    )
    component.genera()
    expect(toast.error).toHaveBeenCalledWith(
      'Ci sono avvisi bloccanti: correggili prima di generare i file.'
    )
  })

  it('storico: etichetta «Da confermare», manifest e segna inviata con conferma esplicita', () => {
    setup()
    orr.storico.and.returnValue(of([comunicazione()]))
    component.carica()
    fixture.detectChanges()
    expect(tutti('orr-storico-riga').length).toBe(1)
    expect(q('orr-storico-da-confermare')).not.toBeNull()
    expect(q('orr-manifest')).not.toBeNull()
    const conferma = fixture.debugElement.injector.get(ConfirmationService)
    spyOn(conferma, 'confirm').and.callFake(c => {
      expect(c.message).toContain('Ho verificato che il consorzio accetta questo file')
      c.accept?.()
      return conferma
    })
    com.segnaInviata.and.returnValue(of(comunicazione({ stato: 'INVIATA' })))
    component.confermaInviata(comunicazione())
    expect(com.segnaInviata).toHaveBeenCalledWith('c1', true)
  })

  it('manifest e file: scaricano dal servizio generico', () => {
    setup()
    com.scaricaManifest.and.returnValue(of({ blob: new Blob(['x']), nomeFile: 'm.txt' }))
    com.scaricaFile.and.returnValue(of({ blob: new Blob(['x']), nomeFile: 'f.txt' }))
    component.scaricaManifest(comunicazione())
    component.scarica(comunicazione())
    expect(com.scaricaManifest).toHaveBeenCalledWith('c1')
    expect(com.scaricaFile).toHaveBeenCalledWith('c1')
  })

  it('periodo non valido dal backend: messaggio chiaro', () => {
    setup()
    orr.anteprima.and.returnValue(
      throwError(() => ({ status: 400, error: { error: 'RICHIESTA_COMUNICAZIONE_NON_VALIDA' } }))
    )
    component.carica()
    expect(component.errore()).toContain('mesi interi')
  })
})
