import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { FirService } from '../fir/fir.service'
import { Movimento, RegistroService } from '../registro/registro.service'
import { CollegaDocumentoDialogComponent } from './collega-documento-dialog.component'
import { PeseService } from './pese.service'
import { accesso, q, qb, scrivi } from './pese-test-utils'

const fir = (id: string, numero: string, stato = FIRStato.EMESSO) =>
  ({
    id,
    numeroProgressivo: numero,
    stato,
    rifiuto: { cerCode: '17 05 04', quantita: 16, unitaMisura: 'T' },
  }) as unknown as FIR

const mov = (id: string, n: number, p: Partial<Movimento> = {}) =>
  ({
    id,
    progressiveNumber: n,
    progressiveYear: 2026,
    cerCode: '17 05 04',
    quantity: 16000,
    unit: 'KG',
    stato: 'VIGENTE',
    tipoAnnotazione: 'ORDINARIA',
    ...p,
  }) as unknown as Movimento

describe('CollegaDocumentoDialogComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let firs: jasmine.SpyObj<FirService>
  let registro: jasmine.SpyObj<RegistroService>
  let fixture: ComponentFixture<CollegaDocumentoDialogComponent>

  beforeEach(() => {
    pese = jasmine.createSpyObj<PeseService>('PeseService', ['collega'])
    firs = jasmine.createSpyObj<FirService>('FirService', ['getFIRList'])
    registro = jasmine.createSpyObj<RegistroService>('RegistroService', ['lista'])
    firs.getFIRList.and.callFake((_p, _l, stato) =>
      of({
        items: stato === FIRStato.EMESSO ? [fir('f1', 'FIR-001'), fir('f2', 'FIR-002')] : [],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      })
    )
    registro.lista.and.returnValue(
      of({
        items: [
          mov('m1', 5),
          mov('m2', 6, { stato: 'ANNULLATO' }),
          mov('m3', 7, { tipoAnnotazione: 'ANNULLAMENTO' }),
        ],
        total: 3,
        page: 1,
        limit: 100,
        totalPages: 1,
      })
    )
    TestBed.configureTestingModule({
      imports: [CollegaDocumentoDialogComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: PeseService, useValue: pese },
        { provide: FirService, useValue: firs },
        { provide: RegistroService, useValue: registro },
      ],
    })
    fixture = TestBed.createComponent(CollegaDocumentoDialogComponent)
    fixture.componentRef.setInput('accesso', accesso())
    fixture.detectChanges()
  })
  afterEach(() => fixture?.destroy())

  it('cerca il FIR per numero e collega quello scelto', () => {
    expect(q('cd-fir-f1')).not.toBeNull()
    scrivi(q<HTMLInputElement>('cd-ricerca')!, '002')
    fixture.detectChanges()
    expect(q('cd-fir-f1')).toBeNull()
    expect(qb('cd-salva')!.disabled).toBeTrue()
    q<HTMLInputElement>('cd-fir-f2')!.click()
    fixture.detectChanges()
    pese.collega.and.returnValue(of(accesso()))
    qb('cd-salva')!.click()
    expect(pese.collega).toHaveBeenCalledWith('a1', { tipo: 'FIR', firId: 'f2' })
  })

  it('annotazioni: solo vigenti dello stesso registro e verso, collega movimentoId', () => {
    q('cd-tipo-movimento')!.click()
    fixture.detectChanges()
    expect(registro.lista).toHaveBeenCalledWith(
      jasmine.objectContaining({ registroId: 'r1', type: 'CARICO' })
    )
    expect(q('cd-mov-m1')).not.toBeNull()
    expect(q('cd-mov-m2')).toBeNull()
    expect(q('cd-mov-m3')).toBeNull()
    q<HTMLInputElement>('cd-mov-m1')!.click()
    fixture.detectChanges()
    pese.collega.and.returnValue(of(accesso()))
    qb('cd-salva')!.click()
    expect(pese.collega).toHaveBeenCalledWith('a1', { tipo: 'MOVIMENTO', movimentoId: 'm1' })
  })

  it('un 422 del backend è mostrato testuale', () => {
    q<HTMLInputElement>('cd-fir-f1')!.click()
    fixture.detectChanges()
    pese.collega.and.returnValue(
      throwError(() => ({
        status: 422,
        error: { message: "Il CER del FIR è diverso da quello dell'accesso." },
      }))
    )
    qb('cd-salva')!.click()
    fixture.detectChanges()
    expect(q('cd-errore')?.textContent).toContain('Il CER del FIR è diverso')
    expect(qb('cd-salva')!.disabled).toBeFalse()
  })

  it('pagina piena e nessun FIR corrispondente: lo dice con il limite', () => {
    const piena = Array.from({ length: 100 }, (_, i) => fir('p' + i, 'FIR-' + i))
    firs.getFIRList.and.returnValue(
      of({ items: piena, total: 300, page: 1, limit: 100, totalPages: 3 })
    )
    fixture.destroy()
    fixture = TestBed.createComponent(CollegaDocumentoDialogComponent)
    fixture.componentRef.setInput('accesso', accesso())
    fixture.detectChanges()
    scrivi(q<HTMLInputElement>('cd-ricerca')!, 'zzz')
    fixture.detectChanges()
    expect(q('cd-fir-vuoti')?.textContent).toContain(
      'nessun FIR tra i 100 più recenti di ciascuno stato'
    )
  })

  it('pagina non piena: messaggio semplice', () => {
    scrivi(q<HTMLInputElement>('cd-ricerca')!, 'zzz')
    fixture.detectChanges()
    expect(q('cd-fir-vuoti')?.textContent).not.toContain('più recenti')
  })

  it('annotazioni: pagina piena senza vigenti lo dice con il limite', () => {
    const piene = Array.from({ length: 100 }, (_, i) => mov('x' + i, i, { stato: 'ANNULLATO' }))
    registro.lista.and.returnValue(
      of({ items: piene, total: 300, page: 1, limit: 100, totalPages: 3 })
    )
    q('cd-tipo-movimento')!.click()
    fixture.detectChanges()
    expect(q('cd-mov-vuoti')?.textContent).toContain('nessuna annotazione tra le ultime 100')
  })
})
