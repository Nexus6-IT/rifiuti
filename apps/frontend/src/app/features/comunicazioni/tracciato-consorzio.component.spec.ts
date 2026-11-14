import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { Observable, of, throwError } from 'rxjs'
import { ConfirmationService } from 'primeng/api'
import { ToastService } from '../../core/services/toast.service'
import { ComunicazioniService } from './comunicazioni.service'
import { TracciatoConsorzioComponent } from './tracciato-consorzio.component'
import {
  AnteprimaTracciato,
  ComunicazioneTracciatoVista,
  ConsorzioTracciato,
} from './tracciati.model'
import { TracciatiService } from './tracciati.service'

const vista = (o: Partial<ComunicazioneTracciatoVista> = {}): ComunicazioneTracciatoVista => ({
  id: 'c1',
  consorzio: 'CONOU',
  unitaLocaleId: 'ul-1',
  periodoDa: '2026-05-01',
  periodoA: '2026-05-31',
  tracciato: 'Movi2023',
  versione: 'Movi2023-ww1',
  stato: 'GENERATA',
  hashDati: 'h',
  nomeFile: 'Movi.txt',
  generataIl: '2026-06-02T10:00:00Z',
  generataDa: 'u1',
  modificataDopoInvio: false,
  affidabilita: 'RICAVATO_WINWASTE',
  notaAffidabilita: 'Nota di prova.',
  ...o,
})

const anteprima = (o: Partial<AnteprimaTracciato> = {}): AnteprimaTracciato => ({
  unitaLocale: { id: 'ul-1', nome: 'Sede 1' },
  consorzio: 'CONOU',
  periodo: { da: '2026-05-01', a: '2026-05-31' },
  tracciato: 'Movi2023',
  versione: 'Movi2023-ww1',
  affidabilita: 'RICAVATO_WINWASTE',
  notaAffidabilita: 'Nota di prova.',
  numeroRecord: 3,
  numeroMovimenti: 3,
  avvisi: [],
  bloccanti: false,
  hashDati: 'h',
  puoGenerare: true,
  ...o,
})

describe('TracciatoConsorzioComponent', () => {
  let fixture: ComponentFixture<TracciatoConsorzioComponent>
  let tracciati: jasmine.SpyObj<TracciatiService>
  let comunicazioni: jasmine.SpyObj<ComunicazioniService>
  let toast: jasmine.SpyObj<ToastService>
  const q = (id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  const qa = (id: string) =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[]

  function setup(
    o: {
      anteprima?: AnteprimaTracciato | Observable<AnteprimaTracciato>
      storico?: ComunicazioneTracciatoVista[]
      consorzio?: ConsorzioTracciato
    } = {}
  ): void {
    tracciati = jasmine.createSpyObj<TracciatiService>('TracciatiService', [
      'anteprima',
      'genera',
      'storico',
    ])
    const a = o.anteprima ?? anteprima()
    tracciati.anteprima.and.returnValue('subscribe' in a ? a : of(a))
    tracciati.storico.and.returnValue(of(o.storico ?? []))
    tracciati.genera.and.returnValue(of(vista()))
    comunicazioni = jasmine.createSpyObj<ComunicazioniService>('ComunicazioniService', [
      'scaricaFile',
      'scaricaManifest',
      'segnaInviata',
    ])
    comunicazioni.segnaInviata.and.returnValue(of(vista({ stato: 'INVIATA' })))
    comunicazioni.scaricaFile.and.returnValue(of({ blob: new Blob(['x']), nomeFile: 'Movi.txt' }))
    comunicazioni.scaricaManifest.and.returnValue(
      of({ blob: new Blob(['m']), nomeFile: 'Movi.txt.manifest.txt' })
    )
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    TestBed.configureTestingModule({
      imports: [TracciatoConsorzioComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: TracciatiService, useValue: tracciati },
        { provide: ComunicazioniService, useValue: comunicazioni },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(TracciatoConsorzioComponent)
    fixture.componentRef.setInput('consorzio', o.consorzio ?? 'CONOU')
    fixture.componentRef.setInput('unitaLocaleId', 'ul-1')
    fixture.detectChanges()
  }

  it('carica anteprima e storico del mese scorso per la sede', () => {
    setup()
    expect(tracciati.anteprima).toHaveBeenCalledTimes(1)
    const [consorzio, sede, da, a] = tracciati.anteprima.calls.mostRecent().args
    expect(consorzio).toBe('CONOU')
    expect(sede).toBe('ul-1')
    expect(da).toMatch(/^\d{4}-\d{2}-01$/)
    expect(a).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(tracciati.storico).toHaveBeenCalledWith('CONOU', 'ul-1', da, a)
    expect(q('tracciato-riepilogo')?.textContent).toContain('3 record da 3 movimenti')
  })

  it('mostra il banner «ricavato da WinWaste» se l affidabilita lo dice, per CONOU e per COBAT', () => {
    setup({ consorzio: 'COBAT', anteprima: anteprima({ consorzio: 'COBAT' }) })
    expect(q('tracciato-banner')?.textContent).toContain(
      'Tracciato ricavato da WinWaste, da confermare con un file reale'
    )
    expect(q('tracciato-banner')?.textContent).toContain('Nota di prova.')
  })

  it('niente banner per un tracciato ufficiale (guidato da affidabilita, non dal consorzio)', () => {
    setup({ anteprima: anteprima({ affidabilita: 'UFFICIALE' }) })
    expect(q('tracciato-banner')).toBeNull()
  })

  it('avvisi: bloccanti e informativi, movimenti e link alle correzioni', () => {
    setup({
      anteprima: anteprima({
        bloccanti: true,
        avvisi: [
          {
            codice: 'ATECO_MANCANTE',
            messaggio: 'Manca il codice ATECO.',
            movimentoIds: ['m1'],
            movimenti: [{ id: 'm1', data: '2026-05-10', numero: '17/2026', cer: '130205' }],
            bloccante: true,
            correzione: { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: 's1' },
          },
          {
            codice: 'CAMPI_NON_DISPONIBILI',
            messaggio: 'Rimorchio non disponibile.',
            movimentoIds: [],
            bloccante: false,
          },
        ],
      }),
    })
    const righe = qa('tracciato-avviso')
    expect(righe.length).toBe(2)
    expect(righe[0].textContent).toContain('Bloccante')
    expect(righe[0].textContent).toContain('n. 17/2026 del 10/05/2026 — CER 130205')
    expect(righe[1].textContent).toContain('Informativo')
    expect(qa('tracciato-correggi').map(a => a.textContent?.trim())).toEqual([
      'Produttori',
      'Trasportatori',
      'Destinatari',
    ])
    expect(q('tracciato-bloccanti')).not.toBeNull()
    const genera = q('tracciato-genera')?.querySelector('button') as HTMLButtonElement
    expect(genera.disabled).toBeTrue()
  })

  it('genera: chiama il servizio e ricarica; con bloccanti il pulsante e disabilitato', () => {
    setup()
    const genera = q('tracciato-genera')?.querySelector('button') as HTMLButtonElement
    expect(genera.disabled).toBeFalse()
    genera.click()
    expect(tracciati.genera).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalled()
    expect(tracciati.anteprima).toHaveBeenCalledTimes(2)
  })

  it('senza il permesso di scrittura non ci sono genera e segna inviata', () => {
    setup({ anteprima: anteprima({ puoGenerare: false }), storico: [vista()] })
    expect(q('tracciato-genera')).toBeNull()
    expect(q('tracciato-segna-inviata')).toBeNull()
  })

  it('storico: etichetta «Da confermare» dai dati della comunicazione, modificata dopo l invio', () => {
    setup({
      storico: [
        vista({ stato: 'INVIATA', modificataDopoInvio: true }),
        vista({ id: 'c2', affidabilita: 'UFFICIALE' }),
      ],
    })
    const righe = qa('tracciato-storico-riga')
    expect(righe[0].querySelector('[data-testid="tracciato-etichetta"]')).not.toBeNull()
    expect(righe[0].querySelector('[data-testid="tracciato-modificata"]')).not.toBeNull()
    expect(righe[1].querySelector('[data-testid="tracciato-etichetta"]')).toBeNull()
  })

  it('segna inviata di un tracciato da confermare chiede la conferma di verifica e la invia', () => {
    setup({ storico: [vista()] })
    const conferma = fixture.debugElement.injector.get(ConfirmationService)
    spyOn(conferma, 'confirm').and.callFake(c => {
      expect(c.message).toContain('da WinWaste')
      expect(c.acceptLabel).toContain('Ho verificato che il consorzio accetta questo file')
      c.accept?.()
      return conferma
    })
    ;(q('tracciato-segna-inviata')?.querySelector('button') as HTMLButtonElement).click()
    expect(comunicazioni.segnaInviata).toHaveBeenCalledWith('c1', true)
  })

  it('segna inviata di un tracciato ufficiale non manda la conferma di verifica', () => {
    setup({ storico: [vista({ affidabilita: 'UFFICIALE' })] })
    const conferma = fixture.debugElement.injector.get(ConfirmationService)
    spyOn(conferma, 'confirm').and.callFake(c => {
      c.accept?.()
      return conferma
    })
    ;(q('tracciato-segna-inviata')?.querySelector('button') as HTMLButtonElement).click()
    expect(comunicazioni.segnaInviata).toHaveBeenCalledWith('c1', undefined)
  })

  it('scarica file e manifest dal servizio', () => {
    setup({ storico: [vista()] })
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(URL, 'revokeObjectURL')
    ;(q('tracciato-scarica')?.querySelector('button') as HTMLButtonElement).click()
    ;(q('tracciato-manifest')?.querySelector('button') as HTMLButtonElement).click()
    expect(comunicazioni.scaricaFile).toHaveBeenCalledWith('c1')
    expect(comunicazioni.scaricaManifest).toHaveBeenCalledWith('c1')
  })

  it('errore dell anteprima: messaggio, nessun banner', () => {
    setup({ anteprima: throwError(() => ({ status: 500 })) })
    expect(q('tracciato-errore')?.textContent).toContain('Impossibile calcolare')
    expect(q('tracciato-banner')).toBeNull()
  })

  it('cambiare periodo ricarica; un periodo incompleto non ricarica', () => {
    setup()
    tracciati.anteprima.calls.reset()
    fixture.componentInstance.scegliPeriodo('2026-01-01', '')
    expect(tracciati.anteprima).not.toHaveBeenCalled()
    fixture.componentInstance.scegliPeriodo('2026-01-01', '2026-01-31')
    expect(tracciati.anteprima).toHaveBeenCalledWith('CONOU', 'ul-1', '2026-01-01', '2026-01-31')
  })
})
