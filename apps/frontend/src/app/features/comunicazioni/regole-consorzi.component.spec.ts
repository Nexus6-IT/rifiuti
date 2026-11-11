import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RegoleConsorziComponent } from './regole-consorzi.component'
import { ConsorziService } from './consorzi.service'
import { RegolaConsorzio } from './consorzi.model'
import { ToastService } from '../../core/services/toast.service'
import { CausaliRegistroService } from '../registro/causali-registro.service'

const regola = (o: Partial<RegolaConsorzio> = {}): RegolaConsorzio => ({
  id: null,
  consorzio: 'CONOU',
  verso: null,
  cer: '13',
  cerEsatto: false,
  causaleCodice: null,
  registroId: null,
  attiva: true,
  validaDal: '1970-01-01',
  sistema: true,
  inVigore: true,
  ...o,
})

describe('RegoleConsorziComponent', () => {
  let fixture: ComponentFixture<RegoleConsorziComponent>
  let component: RegoleConsorziComponent
  let svc: jasmine.SpyObj<ConsorziService>
  let toast: jasmine.SpyObj<ToastService>
  let causali: jasmine.SpyObj<CausaliRegistroService>

  function setup(puoModificare: boolean, regole: RegolaConsorzio[] = [regola()]): void {
    svc = jasmine.createSpyObj<ConsorziService>('ConsorziService', [
      'regole',
      'creaRegola',
      'modificaRegola',
      'eliminaRegola',
      'scaricaEstratto',
    ])
    svc.regole.and.returnValue(of({ regole, puoModificare }))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    causali = jasmine.createSpyObj<CausaliRegistroService>('CausaliRegistroService', ['opzioni'])
    const opzione = (codice: string, descrizione: string) =>
      ({ codice, descrizione, origine: 'SISTEMA', ruoloMud: 'RICEVUTO_DA_TERZI' }) as never
    causali.opzioni.and.callFake(tipo =>
      of(
        tipo === 'CARICO'
          ? [opzione('INGRESSO_ESTERNO', 'Ingresso da terzi'), opzione('RESO', 'Reso')]
          : [opzione('RESO', 'Reso'), opzione('USCITA_A_TERZI', 'Uscita a terzi')]
      )
    )
    TestBed.configureTestingModule({
      imports: [RegoleConsorziComponent, NoopAnimationsModule],
      providers: [
        { provide: CausaliRegistroService, useValue: causali },
        { provide: ConsorziService, useValue: svc },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(RegoleConsorziComponent)
    component = fixture.componentInstance
    fixture.componentRef.setInput('sedi', [{ id: 'ul-1', denominazione: 'Sede 1' }])
    fixture.detectChanges()
  }
  const q = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`)

  it('mostra le regole di sistema con la loro descrizione e senza azioni per chi non puo modificare', () => {
    setup(false)
    const riga = q('regole-riga')
    expect(riga?.textContent).toContain('CONOU')
    expect(riga?.textContent).toContain('CER 13 xx xx, carichi e scarichi')
    expect(riga?.textContent).toContain('Di sistema')
    expect(q('regole-nuova')).toBeNull()
    expect(q('regole-modifica')).toBeNull()
  })

  it('una regola di sistema sostituita dalle regole dell azienda e segnata come tale e non si modifica', () => {
    setup(true, [
      regola({ id: 'r1', sistema: false, cer: '1302', verso: 'CARICO', attiva: false }),
      regola({ inVigore: false }),
    ])
    const righe = fixture.nativeElement.querySelectorAll('[data-testid="regole-riga"]')
    expect(righe[0].textContent).toContain('Disattiva')
    expect(righe[0].textContent).toContain('CER 13 02 xx, solo carichi')
    expect(righe[1].textContent).toContain('Sostituita dalle tue regole')
    expect(fixture.nativeElement.querySelectorAll('[data-testid="regole-modifica"]').length).toBe(1)
  })

  it('crea una regola: normalizza gli spazi, manda il verso e ricarica', () => {
    setup(true)
    svc.creaRegola.and.returnValue(of(regola({ id: 'r1', sistema: false })))
    component.nuova()
    const f = component.form()!
    f.consorzio = 'COBAT'
    f.cer = ' 16 06 01* '
    f.verso = 'CARICO'
    f.causaleCodice = '  '
    component.salva()
    expect(svc.creaRegola).toHaveBeenCalledWith(
      jasmine.objectContaining({
        consorzio: 'COBAT',
        cer: '16 06 01*',
        verso: 'CARICO',
        causaleCodice: null,
        attiva: true,
      })
    )
    expect(toast.success).toHaveBeenCalled()
    expect(component.form()).toBeNull()
    expect(svc.regole).toHaveBeenCalledTimes(2)
  })

  it('CER non valido: non chiama il servizio e mostra il messaggio nel form', () => {
    setup(true)
    component.nuova()
    component.form()!.cer = '131'
    component.salva()
    expect(svc.creaRegola).not.toHaveBeenCalled()
    expect(component.erroriForm()[0]).toContain('CER non valido')
    expect(component.form()).not.toBeNull()
  })

  it('errore del backend: il form resta aperto con il messaggio', () => {
    setup(true)
    svc.creaRegola.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Registro non trovato.' } }))
    )
    component.nuova()
    component.form()!.cer = '13'
    component.salva()
    expect(component.form()).not.toBeNull()
    expect(component.erroriForm()).toEqual(['Registro non trovato.'])
    expect(component.inCorso()).toBe(false)
  })

  it('modifica una regola propria con il suo id', () => {
    setup(true, [regola({ id: 'r1', sistema: false, cer: '160601', cerEsatto: true })])
    svc.modificaRegola.and.returnValue(of(regola({ id: 'r1' })))
    component.modifica(component.regole()[0])
    expect(component.form()?.cer).toBe('160601')
    component.form()!.attiva = false
    component.salva()
    expect(svc.modificaRegola).toHaveBeenCalledWith(
      'r1',
      jasmine.objectContaining({ cer: '160601', attiva: false })
    )
  })

  it('una regola nuova non propone «oggi» come inizio: senza data vale da sempre e non manda validaDal', () => {
    setup(true)
    svc.creaRegola.and.returnValue(of(regola({ id: 'r1', sistema: false })))
    component.nuova()
    expect(component.form()!.validaDal).toBe('')
    component.form()!.cer = '13'
    component.salva()
    const input = svc.creaRegola.calls.mostRecent().args[0]
    expect(input.validaDal).toBe('1970-01-01')
  })

  it('in modifica, «Valida dal» svuotato riporta la regola a da sempre (non lascia la vecchia data)', () => {
    setup(true, [regola({ id: 'r1', sistema: false, cer: '13', validaDal: '2026-11-01' })])
    svc.modificaRegola.and.returnValue(of(regola({ id: 'r1' })))
    component.modifica(component.regole()[0])
    expect(component.form()!.validaDal).toBe('2026-11-01')
    component.form()!.validaDal = ''
    component.salva()
    expect(svc.modificaRegola).toHaveBeenCalledWith(
      'r1',
      jasmine.objectContaining({ validaDal: '1970-01-01' })
    )
  })

  it('in modifica il consorzio non si cambia: il campo e disattivato, in creazione no', () => {
    setup(true, [regola({ id: 'r1', sistema: false, cer: '13' })])
    component.nuova()
    fixture.detectChanges()
    const campo = () => document.querySelector('[data-testid="regola-consorzio"]')
    expect(campo()?.querySelector('.p-disabled')).toBeNull()
    component.modifica(component.regole()[0])
    fixture.detectChanges()
    expect(campo()?.querySelector('.p-disabled')).not.toBeNull()
  })

  it('la data 01/01/1970 (da sempre) si mostra come «da sempre»; in modifica il campo resta vuoto', () => {
    setup(true, [regola({ id: 'r1', sistema: false, cer: '13' })])
    expect(q('regole-riga')?.textContent).toContain('da sempre')
    expect(q('regole-riga')?.textContent).not.toContain('1970')
    component.modifica(component.regole()[0])
    expect(component.form()?.validaDal).toBe('')
  })

  it('la causale si sceglie dal catalogo (carichi e scarichi, senza doppioni) e non e un testo libero', () => {
    setup(true)
    component.nuova()
    expect(component.causali().map(c => c.codice)).toEqual([
      'INGRESSO_ESTERNO',
      'RESO',
      'USCITA_A_TERZI',
    ])
    component.form()!.cer = '13'
    component.form()!.causaleCodice = 'INGRESSO_ESTERNO'
    svc.creaRegola.and.returnValue(of(regola({ id: 'r1', sistema: false })))
    component.salva()
    expect(svc.creaRegola).toHaveBeenCalledWith(
      jasmine.objectContaining({ causaleCodice: 'INGRESSO_ESTERNO' })
    )
  })

  it('in modifica la causale gia scelta resta nell elenco anche se oggi non e piu proponibile', () => {
    setup(true, [regola({ id: 'r1', sistema: false, causaleCodice: 'AZ_VECCHIA' })])
    component.modifica(component.regole()[0])
    expect(component.causali().some(c => c.codice === 'AZ_VECCHIA')).toBe(true)
  })

  it('una regola di sistema non si apre in modifica', () => {
    setup(true)
    component.modifica(regola())
    expect(component.form()).toBeNull()
  })

  it('elimina dopo la conferma', () => {
    setup(true, [regola({ id: 'r1', sistema: false })])
    svc.eliminaRegola.and.returnValue(of(undefined))
    component.elimina('r1')
    expect(svc.eliminaRegola).toHaveBeenCalledWith('r1')
    expect(toast.success).toHaveBeenCalled()
  })

  it('estratto: periodo non valido disabilita il download; valido chiama il servizio', () => {
    setup(false)
    component.estrattoDa = '2026-03-01'
    component.estrattoA = '2026-01-01'
    expect(component.estrattoValido()).toBe(false)
    component.scarica()
    expect(svc.scaricaEstratto).not.toHaveBeenCalled()
    component.estrattoA = '2026-03-31'
    component.estrattoConsorzio = 'COBAT'
    svc.scaricaEstratto.and.returnValue(of({ blob: new Blob(['x']), nomeFile: 'e.csv' }))
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(URL, 'revokeObjectURL')
    component.scarica()
    expect(svc.scaricaEstratto).toHaveBeenCalledWith('COBAT', '2026-03-01', '2026-03-31', undefined)
  })
})
