import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import {
  GiacenzeInizialiDialogComponent,
  dataItaliana,
  messaggioErroreGiacenza,
  oggiItaliano,
} from './giacenze-iniziali-dialog.component'
import {
  ElencoGiacenzeIniziali,
  GiacenzaInizialeInElenco,
  RegistroService,
} from './registro.service'
import { ToastService } from '../../core/services/toast.service'

function voce(parziale: Partial<GiacenzaInizialeInElenco> = {}): GiacenzaInizialeInElenco {
  return {
    id: 'g1',
    registroId: 'r1',
    cerCode: '17 04 05',
    statoFisico: 'SOLIDO',
    quantita: 120,
    unita: 'KG',
    dataRiferimento: '2026-01-01',
    origini: [{ anno: 2025, protocollo: 7, quantita: 50 }],
    provenienza: 'MANUALE',
    note: 'migrazione',
    impostatoDa: 'u1',
    createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:00:00.000Z',
    modificabile: true,
    ...parziale,
  }
}

function elenco(parziale: Partial<ElencoGiacenzeIniziali> = {}): ElencoGiacenzeIniziali {
  return { registroId: 'r1', puoImpostare: true, voci: [voce()], ...parziale }
}

describe('GiacenzeInizialiDialogComponent', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<GiacenzeInizialiDialogComponent>
  let c: GiacenzeInizialiDialogComponent

  function apri(
    el: ElencoGiacenzeIniziali,
    registroId: string | null = 'r1',
    sede: string | null = null
  ): void {
    servizio.getGiacenzeIniziali.and.returnValue(of(el))
    fixture = TestBed.createComponent(GiacenzeInizialiDialogComponent)
    c = fixture.componentInstance
    fixture.componentRef.setInput('registroId', registroId)
    fixture.componentRef.setInput('sede', sede)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
  }

  const q = (testid: string): HTMLElement | null =>
    document.body.querySelector(`[data-testid="${testid}"]`)

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'getGiacenzeIniziali',
      'creaGiacenzaIniziale',
      'modificaGiacenzaIniziale',
      'eliminaGiacenzaIniziale',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [GiacenzeInizialiDialogComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
  })

  afterEach(() => {
    fixture?.destroy()
  })

  it("all'apertura legge l'elenco del registro indicato", () => {
    apri(elenco(), 'r1')
    expect(servizio.getGiacenzeIniziali).toHaveBeenCalledOnceWith('r1')
    expect(q('gi-riga-g1')?.textContent).toContain('17 04 05')
    expect(q('gi-riga-g1')?.textContent).toContain('01/01/2026')
  })

  it("l'etichetta della sede compare nel titolo e nel testo", () => {
    apri(elenco(), 'r1', 'Sede B')
    expect(c.titolo()).toBe('Giacenze iniziali · Sede B')
    expect(q('giacenze-iniziali-sede')?.textContent).toContain('Sede B')
  })

  it("a chi non può impostare mostra l'elenco senza azioni né pulsante di aggiunta", () => {
    apri(elenco({ puoImpostare: false }))
    expect(q('gi-riga-g1')).not.toBeNull()
    expect(q('gi-modifica-g1')).toBeNull()
    expect(q('gi-elimina-g1')).toBeNull()
    expect(q('gi-aggiungi')).toBeNull()
    expect(q('gi-sola-lettura')).not.toBeNull()
  })

  it("all'amministratore offre modifica ed elimina se la giacenza è modificabile", () => {
    apri(elenco())
    expect(q('gi-modifica-g1')).not.toBeNull()
    expect(q('gi-elimina-g1')).not.toBeNull()
    expect(q('gi-bloccata-g1')).toBeNull()
    expect(q('gi-aggiungi')).not.toBeNull()
  })

  it("se uno scarico l'ha usata niente azioni, ma un testo spiega perché", () => {
    apri(elenco({ voci: [voce({ modificabile: false })] }))
    expect(q('gi-modifica-g1')).toBeNull()
    expect(q('gi-elimina-g1')).toBeNull()
    expect(q('gi-bloccata-g1')?.textContent).toContain('Usata da uno scarico')
  })

  it('con registroId null spiega che il registro va indicato e non mostra la tabella', () => {
    apri({ registroId: null, puoImpostare: true, voci: [] }, null)
    expect(servizio.getGiacenzeIniziali).toHaveBeenCalledOnceWith(undefined)
    expect(q('gi-registro-da-indicare')).not.toBeNull()
    expect(q('gi-tabella')).toBeNull()
    expect(q('gi-aggiungi')).toBeNull()
  })

  it("mostra l'errore di lettura del backend", () => {
    servizio.getGiacenzeIniziali.and.returnValue(
      throwError(() => ({ error: { message: 'Registro non trovato' } }))
    )
    fixture = TestBed.createComponent(GiacenzeInizialiDialogComponent)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    expect(q('gi-errore')?.textContent).toContain('Registro non trovato')
  })

  describe('inserimento', () => {
    beforeEach(() => apri(elenco({ voci: [] })))

    it('non invia un form non valido', () => {
      c.apriNuova()
      c.salva()
      expect(servizio.creaGiacenzaIniziale).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalled()
    })

    it('rifiuta una data successiva a oggi', () => {
      c.apriNuova()
      c.form.patchValue({ dataRiferimento: '2999-01-01' })
      expect(c.form.get('dataRiferimento')?.hasError('dataFutura')).toBeTrue()
      c.form.patchValue({ dataRiferimento: oggiItaliano() })
      expect(c.form.get('dataRiferimento')?.valid).toBeTrue()
    })

    it('invia la POST con la data come stringa, origini e registro, poi mostra gli avvisi e ricarica', () => {
      servizio.creaGiacenzaIniziale.and.returnValue(
        of({ giacenza: voce(), avvisi: ['Nel registro ci sono carichi «Altro carico»'] })
      )
      servizio.getGiacenzeIniziali.calls.reset()
      servizio.getGiacenzeIniziali.and.returnValue(of(elenco()))
      c.apriNuova()
      c.form.patchValue({
        cerCode: '17 04 05',
        statoFisico: 'SOLIDO',
        quantita: 120,
        unita: 'KG',
        dataRiferimento: '2026-01-01',
        note: '  migrazione  ',
      })
      c.aggiungiOrigine()
      c.origini.at(0).patchValue({ anno: 2025, protocollo: 7, quantita: 50 })
      c.aggiungiOrigine()
      c.origini.at(1).patchValue({ anno: 2024, protocollo: 3, quantita: null })
      c.salva()

      expect(servizio.creaGiacenzaIniziale).toHaveBeenCalledOnceWith(
        {
          cerCode: '17 04 05',
          statoFisico: 'SOLIDO',
          quantita: 120,
          unita: 'KG',
          dataRiferimento: '2026-01-01',
          origini: [
            { anno: 2025, protocollo: 7, quantita: 50 },
            { anno: 2024, protocollo: 3 },
          ],
          note: 'migrazione',
        },
        'r1'
      )
      expect(c.avvisi()).toEqual(['Nel registro ci sono carichi «Altro carico»'])
      fixture.detectChanges()
      expect(q('gi-avvisi')?.textContent).toContain('Altro carico')
      expect(servizio.getGiacenzeIniziali).toHaveBeenCalledTimes(1)
      expect(c.formAperto()).toBeFalse()
    })

    it("mostra il messaggio d'errore del backend (409) e tiene aperto il form", () => {
      servizio.creaGiacenzaIniziale.and.returnValue(
        throwError(() => ({ error: { message: 'Esiste già una giacenza iniziale' } }))
      )
      c.apriNuova()
      c.form.patchValue({ cerCode: '17 04 05', quantita: 1, dataRiferimento: '2026-01-01' })
      c.salva()
      expect(toast.error).toHaveBeenCalledWith('Esiste già una giacenza iniziale')
      expect(c.formAperto()).toBeTrue()
      expect(c.salvataggio()).toBeFalse()
    })
  })

  describe('modifica', () => {
    beforeEach(() => apri(elenco()))

    it('precompila il form, disabilita il CER e invia la sostituzione completa senza cerCode', () => {
      servizio.modificaGiacenzaIniziale.and.returnValue(of({ giacenza: voce() }))
      c.apriModifica(voce())
      expect(c.form.get('cerCode')?.disabled).toBeTrue()
      expect(c.form.get('dataRiferimento')?.value).toBe('2026-01-01')
      c.form.patchValue({ quantita: 130 })
      c.salva()

      expect(servizio.modificaGiacenzaIniziale).toHaveBeenCalledOnceWith('g1', {
        statoFisico: 'SOLIDO',
        quantita: 130,
        unita: 'KG',
        dataRiferimento: '2026-01-01',
        origini: [{ anno: 2025, protocollo: 7, quantita: 50 }],
        note: 'migrazione',
      })
      const corpo = servizio.modificaGiacenzaIniziale.calls.mostRecent().args[1] as any
      expect('cerCode' in corpo).toBeFalse()
    })

    it('svuotare stato, origini e note li invia esplicitamente vuoti (PUT completo)', () => {
      servizio.modificaGiacenzaIniziale.and.returnValue(of({ giacenza: voce() }))
      c.apriModifica(voce())
      c.form.patchValue({ statoFisico: null, note: '' })
      c.rimuoviOrigine(0)
      c.salva()
      expect(servizio.modificaGiacenzaIniziale.calls.mostRecent().args[1]).toEqual({
        statoFisico: null,
        quantita: 120,
        unita: 'KG',
        dataRiferimento: '2026-01-01',
        origini: [],
        note: null,
      })
    })

    it('un 409 (usata nel frattempo) mostra il messaggio del backend', () => {
      servizio.modificaGiacenzaIniziale.and.returnValue(
        throwError(() => ({ error: { message: 'Esiste uno scarico dello stesso CER' } }))
      )
      c.apriModifica(voce())
      c.salva()
      expect(toast.error).toHaveBeenCalledWith('Esiste uno scarico dello stesso CER')
    })
  })

  describe('eliminazione', () => {
    beforeEach(() => apri(elenco()))

    it('chiede conferma e poi cancella e ricarica', () => {
      servizio.eliminaGiacenzaIniziale.and.returnValue(of(undefined))
      servizio.getGiacenzeIniziali.calls.reset()
      c.daEliminare.set('g1')
      fixture.detectChanges()
      expect(q('gi-elimina-conferma-g1')).not.toBeNull()
      c.elimina(voce())
      expect(servizio.eliminaGiacenzaIniziale).toHaveBeenCalledOnceWith('g1')
      expect(servizio.getGiacenzeIniziali).toHaveBeenCalledTimes(1)
      expect(c.daEliminare()).toBeNull()
    })

    it("in errore mostra il messaggio e rilegge l'elenco", () => {
      servizio.eliminaGiacenzaIniziale.and.returnValue(
        throwError(() => ({ error: { message: 'Non si può cancellare' } }))
      )
      servizio.getGiacenzeIniziali.calls.reset()
      c.elimina(voce())
      expect(toast.error).toHaveBeenCalledWith('Non si può cancellare')
      expect(servizio.getGiacenzeIniziali).toHaveBeenCalledTimes(1)
    })
  })
})

describe('helper delle giacenze iniziali', () => {
  it('dataItaliana non passa da Date', () => {
    expect(dataItaliana('2026-01-31')).toBe('31/01/2026')
  })

  it('messaggioErroreGiacenza gestisce stringa, array e assenza di messaggio', () => {
    expect(messaggioErroreGiacenza({ error: { message: 'x' } })).toBe('x')
    expect(messaggioErroreGiacenza({ error: { message: ['a', 'b'] } })).toBe('a · b')
    expect(messaggioErroreGiacenza({})).toBe('Operazione sulle giacenze iniziali non riuscita')
  })

  it('oggiItaliano usa il giorno di Roma', () => {
    // 31/12 alle 23:30 UTC è già il 1/1 a Roma.
    expect(oggiItaliano(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
    expect(oggiItaliano(new Date('2026-07-01T10:00:00Z'))).toBe('2026-07-01')
  })
})
