import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { AccessoDettaglioComponent } from './accesso-dettaglio.component'
import { AccessoVista, CollegamentoVista, PeseService } from './pese.service'
import { By } from '@angular/platform-browser'
import { SecondaPesataDialogComponent } from './seconda-pesata-dialog.component'
import { accesso, incolla, pesata, q, qb, scrivi } from './pese-test-utils'

const allegato = {
  id: 'al1',
  nomeFile: 'display.jpg',
  mimeType: 'image/jpeg',
  dimensioneByte: 1000,
}

function collegamentoFir(diff: number): CollegamentoVista {
  return {
    id: 'c1',
    tipo: 'FIR',
    fir: {
      id: 'f1',
      numero: 'FIR-77',
      stato: 'EMESSO',
      quantita: 16000,
      unita: 'KG',
      pesoEffettivo: null,
    },
    confronto: { confrontabile: true, quantitaKg: 16000 + diff, differenzaKg: diff },
    creatoIl: '2026-10-30T10:00:00.000Z',
    revocatoIl: null,
    motivoRevoca: null,
  }
}

describe('AccessoDettaglioComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<AccessoDettaglioComponent>

  function apri(a: AccessoVista) {
    pese.dettaglioAccesso.and.returnValue(of(a))
    fixture = TestBed.createComponent(AccessoDettaglioComponent)
    fixture.componentRef.setInput('accessoId', a.id)
    fixture.detectChanges()
  }

  beforeEach(() => {
    pese = jasmine.createSpyObj<PeseService>('PeseService', [
      'dettaglioAccesso',
      'annullaAccesso',
      'rettificaPesata',
      'revocaCollegamento',
      'apriAllegato',
      'collega',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [AccessoDettaglioComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: PeseService, useValue: pese },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('pesata manuale mostra il badge Manuale e l avviso metrologico', () => {
    apri(
      accesso({
        pesate: [pesata({ fonte: 'MANUALE', motivo: 'Display rotto' }), accesso().pesate[1]],
      })
    )
    expect(q('ad-badge-1')?.textContent).toContain('Manuale')
    expect(q('ad-avviso-manuale')?.textContent).toContain('nessuna garanzia metrologica')
    expect(document.body.textContent).toContain('Senza prova documentale')
  })

  it('senza pesate manuali non c e l avviso metrologico', () => {
    apri(accesso())
    expect(q('ad-avviso-manuale')).toBeNull()
  })

  it('netto NON_VALIDO mostra l errore e nessun netto', () => {
    apri(
      accesso({
        netto: {
          stato: 'NON_VALIDO',
          lordoKg: 5000,
          taraKg: 8000,
          nettoKg: null,
          qualita: null,
          manuale: false,
          rettificato: true,
          errore: 'Il lordo deve superare la tara.',
          avvisi: [],
        },
      })
    )
    expect(q('ad-netto-errore')?.textContent).toContain('Il lordo deve superare la tara.')
    expect(q('ad-netto-errore')?.getAttribute('role')).toBe('alert')
    expect(q('ad-netto-valore')).toBeNull()
  })

  it('netto calcolato con qualita e avvisi', () => {
    apri(accesso({ avvisi: ['Tara aggiornata più di un anno fa.'] }))
    expect(q('ad-netto-valore')?.textContent).toContain('16.000 kg')
    expect(q('ad-qualita')?.textContent).toContain('Due pesate')
    expect(q('ad-avvisi')?.textContent).toContain('Tara aggiornata')
  })

  it('il pulsante Rettifica non c è senza puoRettificare', () => {
    apri(accesso({ puoRettificare: false }))
    expect(q('ad-rettifica-1')).toBeNull()
    expect(q('ad-revoca-c1')).toBeNull()
  })

  it('con puoRettificare il pulsante Rettifica c è e apre il dialog con peso precedente e numero', () => {
    apri(accesso())
    qb('ad-rettifica-1')!.click()
    fixture.detectChanges()
    expect(q('rt-precedente')?.textContent).toContain('24.000 kg')
    expect(q('rt-numero')?.textContent).toContain('1')
    expect(q('rt-avvisi')?.textContent).toContain('tara')
  })

  it('rettifica: il motivo è obbligatorio, il 422 sul netto è mostrato testuale', () => {
    apri(accesso({ collegamenti: [collegamentoFir(0)] }))
    qb('ad-rettifica-1')!.click()
    fixture.detectChanges()
    expect(q('rt-avvisi')?.textContent).toContain('collegato a un FIR')
    incolla(document.getElementById('rt-peso') as HTMLInputElement, '5000')
    qb('rt-salva')!.click()
    fixture.detectChanges()
    expect(pese.rettificaPesata).not.toHaveBeenCalled()
    expect(q('rt-motivo-errore')).not.toBeNull()
    scrivi(q<HTMLTextAreaElement>('rt-motivo')! as unknown as HTMLInputElement, 'Errore di lettura')
    pese.rettificaPesata.and.returnValue(
      throwError(() => ({
        status: 422,
        error: { message: 'Il netto non sarebbe valido: il lordo non supera la tara.' },
      }))
    )
    qb('rt-salva')!.click()
    fixture.detectChanges()
    expect(pese.rettificaPesata).toHaveBeenCalledTimes(1)
    expect(pese.rettificaPesata.calls.mostRecent().args[0]).toBe('p1')
    expect(pese.rettificaPesata.calls.mostRecent().args[1]).toEqual({
      pesoNuovoKg: 5000,
      motivo: 'Errore di lettura',
    })
    expect(q('rt-errore')?.textContent).toContain('Il netto non sarebbe valido')
  })

  it('rettifica riuscita: aggiorna il dettaglio con peso effettivo e storico', () => {
    apri(accesso())
    qb('ad-rettifica-1')!.click()
    fixture.detectChanges()
    incolla(document.getElementById('rt-peso') as HTMLInputElement, '23500')
    scrivi(q<HTMLTextAreaElement>('rt-motivo')! as unknown as HTMLInputElement, 'Errore di lettura')
    const rettificata = pesata({
      pesoEffettivoKg: 23500,
      rettifiche: [
        {
          id: 'r1',
          numero: 1,
          pesoPrecedenteKg: 24000,
          pesoNuovoKg: 23500,
          motivo: 'Errore di lettura',
          autore: 'Anna',
          createdAt: '2026-10-30T11:00:00.000Z',
          allegato: null,
          integra: true,
        },
      ],
    })
    pese.rettificaPesata.and.returnValue(
      of(accesso({ pesate: [rettificata, accesso().pesate[1]] }))
    )
    qb('rt-salva')!.click()
    fixture.detectChanges()
    expect(q('ad-effettivo')?.textContent).toContain('23.500 kg')
    expect(q('ad-storico-1')?.textContent).toContain('24.000 kg → 23.500 kg')
    expect(q('ad-badge-1')?.textContent).toContain('Rettificato')
    expect(q('rt-salva')).toBeNull()
  })

  it('collegamento con differenza diversa da zero in rosso, uguale a zero no', () => {
    apri(accesso({ collegamenti: [collegamentoFir(-250)] }))
    const d = q('ad-differenza')!
    expect(d.textContent).toContain('-250 kg')
    expect(d.classList).toContain('diff-ko')
    fixture.destroy()
    apri(accesso({ collegamenti: [collegamentoFir(0)] }))
    expect(q('ad-differenza')!.classList).not.toContain('diff-ko')
  })

  it('revoca un collegamento solo con il motivo', () => {
    apri(accesso({ collegamenti: [collegamentoFir(0)] }))
    qb('ad-revoca-c1')!.click()
    fixture.detectChanges()
    qb('md-conferma')!.click()
    fixture.detectChanges()
    expect(pese.revocaCollegamento).not.toHaveBeenCalled()
    expect(q('md-motivo-errore')).not.toBeNull()
    scrivi(q<HTMLTextAreaElement>('md-motivo')! as unknown as HTMLInputElement, 'FIR sbagliato')
    pese.revocaCollegamento.and.returnValue(of(accesso()))
    qb('md-conferma')!.click()
    expect(pese.revocaCollegamento).toHaveBeenCalledWith('c1', 'FIR sbagliato')
  })

  it('annullamento: la conferma nomina il numero dell accesso e il motivo è obbligatorio', () => {
    apri(accesso({ stato: 'APERTO', pesate: [accesso().pesate[0]] }))
    qb('ad-annulla')!.click()
    fixture.detectChanges()
    expect(q('md-messaggio')?.textContent).toContain('ACC-2026-0001')
    qb('md-conferma')!.click()
    fixture.detectChanges()
    expect(pese.annullaAccesso).not.toHaveBeenCalled()
    scrivi(q<HTMLTextAreaElement>('md-motivo')! as unknown as HTMLInputElement, 'Mezzo andato via')
    pese.annullaAccesso.and.returnValue(
      of(
        accesso({
          stato: 'ANNULLATO',
          annullatoIl: '2026-10-30T12:00:00.000Z',
          motivoAnnullamento: 'Mezzo andato via',
        })
      )
    )
    qb('md-conferma')!.click()
    fixture.detectChanges()
    expect(pese.annullaAccesso).toHaveBeenCalledWith('a1', 'Mezzo andato via')
    expect(q('ad-stato')?.textContent).toContain('Annullato')
    expect(q('ad-motivo-annullo')?.textContent).toContain('Mezzo andato via')
  })

  it('409 all annullamento: messaggio testuale e accesso riletto', () => {
    apri(accesso({ stato: 'APERTO', pesate: [accesso().pesate[0]] }))
    qb('ad-annulla')!.click()
    fixture.detectChanges()
    scrivi(q<HTMLTextAreaElement>('md-motivo')! as unknown as HTMLInputElement, 'Mezzo andato via')
    pese.annullaAccesso.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'Prima revocare i collegamenti.' } }))
    )
    pese.dettaglioAccesso.calls.reset()
    qb('md-conferma')!.click()
    fixture.detectChanges()
    expect(q('md-errore')?.textContent).toContain('Prima revocare i collegamenti.')
    expect(pese.dettaglioAccesso).toHaveBeenCalledTimes(1)
  })

  it('i pulsanti di azione seguono i flag del backend e lo stato', () => {
    apri(
      accesso({
        stato: 'APERTO',
        pesate: [accesso().pesate[0]],
        puoOperare: false,
        puoRettificare: false,
      })
    )
    expect(q('ad-seconda')).toBeNull()
    expect(q('ad-annulla')).toBeNull()
    expect(q('ad-collega')).toBeNull()
    fixture.destroy()
    apri(
      accesso({
        stato: 'APERTO',
        pesate: [accesso().pesate[0]],
        puoOperare: true,
        puoRettificare: false,
      })
    )
    expect(q('ad-seconda')).not.toBeNull()
    expect(q('ad-annulla')).not.toBeNull()
    fixture.destroy()
    apri(accesso({ stato: 'CHIUSO', puoOperare: true, puoRettificare: false }))
    expect(q('ad-annulla')).toBeNull()
  })

  it('l allegato si apre con apriAllegato', () => {
    apri(accesso({ pesate: [pesata({ allegato }), accesso().pesate[1]] }))
    pese.apriAllegato.and.returnValue(of(undefined))
    qb('ad-allegato-1')!.click()
    expect(pese.apriAllegato).toHaveBeenCalledWith('al1')
  })

  it('un errore di caricamento è mostrato testuale', () => {
    pese.dettaglioAccesso.and.returnValue(
      throwError(() => ({ status: 404, error: { message: 'Accesso non trovato.' } }))
    )
    fixture = TestBed.createComponent(AccessoDettaglioComponent)
    fixture.componentRef.setInput('accessoId', 'x')
    fixture.detectChanges()
    expect(q('ad-errore-caricamento')?.textContent).toContain('Accesso non trovato.')
  })

  it('seconda pesata già registrata in precedenza: avviso e non "registrata"', () => {
    apri(accesso({ stato: 'APERTO', pesate: [accesso().pesate[0]] }))
    qb('ad-seconda')!.click()
    fixture.detectChanges()
    const d = fixture.debugElement.query(By.directive(SecondaPesataDialogComponent))
    ;(d.componentInstance as SecondaPesataDialogComponent).fatto.emit(
      accesso({ giaRegistrata: true })
    )
    expect(toast.info).toHaveBeenCalledWith(
      'Pesata già registrata in precedenza: controllare i dati mostrati'
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('al primo caricamento il fuoco va sul titolo', async () => {
    apri(accesso())
    await new Promise(r => setTimeout(r, 50))
    expect(document.activeElement?.id).toBe('ad-titolo')
  })
})
