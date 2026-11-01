import { ComponentFixture, TestBed } from '@angular/core/testing'
import { Subject, of, throwError } from 'rxjs'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { MessageService } from 'primeng/api'
import { AgenteDialogComponent } from './agente-dialog.component'
import { ClientiService } from './clienti.service'
import { Agente } from './clienti.model'
import { RegistryService } from '../registry/registry.service'
import { AuthService } from '../../core/services/auth.service'
import { Ditta, SedeDitta } from '../../shared/models/registry.model'
import { bottone, q, scrivi, stabilizza } from './tabelle/tabelle-test-utils'

const PIVA = '12345678903'
const CF_PERSONA = 'RSSMRA80A01H501U'

const sede = (id: string, over: Partial<SedeDitta> = {}): SedeDitta => ({
  id,
  denominazione: null,
  via: 'Via Roma',
  civico: '1',
  cap: '00100',
  citta: 'Roma',
  provincia: 'RM',
  referente: null,
  email: null,
  telefono: null,
  pec: null,
  principale: false,
  attiva: true,
  ...over,
})

const DITTA: Ditta = {
  id: 'd1',
  ragioneSociale: 'Rossi Provvigioni S.r.l.',
  partitaIva: PIVA,
  codiceFiscale: null,
  partitaIvaDaVerificare: false,
  privato: false,
  sedi: [sede('s1', { principale: true }), sede('s2', { via: 'Via Milano', citta: 'Milano' })],
  ruoli: {},
}

const agente: Agente = {
  id: 'a1',
  versione: 3,
  attivo: true,
  codice: 'AG1',
  note: 'note vecchie',
  ditta: {
    id: 'd1',
    ragioneSociale: 'Rossi Provvigioni S.r.l.',
    partitaIva: PIVA,
    codiceFiscale: null,
  },
  sede: sede('s1', { principale: true }),
  clienti: 2,
  contratti: 1,
  eliminabile: false,
}

describe('AgenteDialogComponent', () => {
  let fixture: ComponentFixture<AgenteDialogComponent>
  let agenti: { get: jasmine.Spy; crea: jasmine.Spy; modifica: jasmine.Spy }
  let registry: jasmine.SpyObj<RegistryService>
  let salvati: Agente[]

  async function apri(a: Agente | null = null) {
    fixture = TestBed.createComponent(AgenteDialogComponent)
    salvati = []
    fixture.componentInstance.salvato.subscribe(v => salvati.push(v))
    fixture.componentRef.setInput('agente', a)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    agenti = {
      get: jasmine.createSpy('get'),
      crea: jasmine.createSpy('crea'),
      modifica: jasmine.createSpy('modifica'),
    }
    registry = jasmine.createSpyObj('RegistryService', ['cercaDitta', 'getDitta'])
    registry.cercaDitta.and.returnValue(of({ ditta: null }))
    registry.getDitta.and.returnValue(of(DITTA))
    TestBed.configureTestingModule({
      imports: [AgenteDialogComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ClientiService, useValue: { agenti } },
        { provide: RegistryService, useValue: registry },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  async function compilaIndirizzo() {
    scrivi('agente-dlg-ragione', 'Bianchi Rappresentanze')
    scrivi('agente-dlg-via', 'Via Torino')
    scrivi('agente-dlg-civico', '5')
    scrivi('agente-dlg-cap', '10100')
    scrivi('agente-dlg-comune', 'Torino')
    scrivi('agente-dlg-provincia', 'TO')
    await stabilizza(fixture)
  }

  describe('nuovo', () => {
    it('usa app-ditta-identificativi con tipo "agente"', async () => {
      await apri()
      const ident = fixture.debugElement.query(e => e.name === 'app-ditta-identificativi')
      expect(ident).toBeTruthy()
      expect(ident.componentInstance.tipo).toBe('agente')
      expect(ident.componentInstance.modalita).toBe('create')
    })

    it('ditta trovata: ragione sociale bloccata e scelta della sede', async () => {
      registry.cercaDitta.and.returnValue(of({ ditta: DITTA }))
      await apri()
      scrivi('agente-dlg-piva-input', PIVA)
      q('agente-dlg-piva-input')!.dispatchEvent(new Event('blur'))
      await stabilizza(fixture)
      const ragione = q<HTMLInputElement>('agente-dlg-ragione')!
      expect(ragione.value).toBe('Rossi Provvigioni S.r.l.')
      expect(ragione.disabled).toBeTrue()
      expect(q('agente-dlg-sede-s2')).toBeTruthy()
      expect(q('agente-dlg-sede-nuova')).toBeTruthy()
      // la sede principale è preselezionata e precompila l'indirizzo
      expect(q<HTMLInputElement>('agente-dlg-via')!.value).toBe('Via Roma')
    })

    it('privato (solo CF): errore di D18 e nessuna chiamata', async () => {
      await apri()
      await compilaIndirizzo()
      scrivi('agente-dlg-cf-input', CF_PERSONA)
      await stabilizza(fixture)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(document.body.textContent).toContain(
        'Un privato senza partita IVA può essere solo produttore o cliente.'
      )
      expect(agenti.crea).not.toHaveBeenCalled()
    })

    it('senza identificativi o indirizzo non salva', async () => {
      await apri()
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(agenti.crea).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain('Indica la partita IVA o il codice fiscale.')
    })

    it('crea con il corpo di R37 e il comune dentro indirizzo', async () => {
      agenti.crea.and.returnValue(of({ agente, dittaEsistente: false, avvisi: [] }))
      await apri()
      await compilaIndirizzo()
      scrivi('agente-dlg-piva-input', PIVA)
      scrivi('agente-dlg-codice', 'AG9')
      scrivi('agente-dlg-note', 'prima nota')
      await stabilizza(fixture)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(agenti.crea).toHaveBeenCalledOnceWith({
        ragioneSociale: 'Bianchi Rappresentanze',
        partitaIva: PIVA,
        indirizzo: {
          via: 'Via Torino',
          civico: '5',
          cap: '10100',
          comune: 'Torino',
          provincia: 'TO',
        },
        codice: 'AG9',
        note: 'prima nota',
      })
      expect(salvati).toEqual([agente])
    })

    it('con la ditta trovata manda anche la sede scelta', async () => {
      registry.cercaDitta.and.returnValue(of({ ditta: DITTA }))
      agenti.crea.and.returnValue(of({ agente, dittaEsistente: true, avvisi: [] }))
      await apri()
      scrivi('agente-dlg-piva-input', PIVA)
      q('agente-dlg-piva-input')!.dispatchEvent(new Event('blur'))
      await stabilizza(fixture)
      q<HTMLInputElement>('agente-dlg-sede-s2')!.click()
      q<HTMLInputElement>('agente-dlg-sede-s2')!.dispatchEvent(new Event('change'))
      await stabilizza(fixture)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      const corpo = agenti.crea.calls.mostRecent().args[0]
      expect(corpo.sedeId).toBe('s2')
      expect(corpo.indirizzo.via).toBe('Via Milano')
    })

    it('409 e 400: messaggio del backend (stringa o array), il dialog resta aperto', async () => {
      agenti.crea.and.returnValues(
        throwError(() => ({ status: 409, error: { message: 'Il codice agente è già in uso.' } })),
        throwError(() => ({
          status: 400,
          error: { message: ['Primo errore.', 'Secondo errore.'] },
        }))
      )
      await apri()
      await compilaIndirizzo()
      scrivi('agente-dlg-piva-input', PIVA)
      await stabilizza(fixture)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('agente-dlg-errore')!.textContent).toContain('Il codice agente è già in uso.')
      expect(salvati).toEqual([])
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('agente-dlg-errore')!.textContent).toContain('Primo errore. Secondo errore.')
    })

    it('doppio clic: una sola chiamata', async () => {
      const r = new Subject<unknown>()
      agenti.crea.and.returnValue(r)
      await apri()
      await compilaIndirizzo()
      scrivi('agente-dlg-piva-input', PIVA)
      await stabilizza(fixture)
      fixture.componentInstance.salva()
      fixture.componentInstance.salva()
      expect(agenti.crea).toHaveBeenCalledTimes(1)
    })

    it("gli avvisi dell'esito vengono mostrati", async () => {
      agenti.crea.and.returnValue(
        of({ agente, dittaEsistente: true, avvisi: ['Sede già presente.'] })
      )
      const messaggi = TestBed.inject(MessageService)
      const spia = spyOn(messaggi, 'add')
      await apri()
      await compilaIndirizzo()
      scrivi('agente-dlg-piva-input', PIVA)
      await stabilizza(fixture)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(spia).toHaveBeenCalledWith(jasmine.objectContaining({ detail: 'Sede già presente.' }))
    })
  })

  describe('modifica', () => {
    beforeEach(() => agenti.get.and.returnValue(of(agente)))

    it('identificativi in sola lettura e link "Sedi"', async () => {
      await apri(agente)
      expect(fixture.debugElement.query(e => e.name === 'app-ditta-identificativi')).toBeNull()
      expect(q('agente-dlg-identificativi')!.textContent).toContain(`P.IVA ${PIVA}`)
      expect(q<HTMLInputElement>('agente-dlg-ragione')).toBeNull()
      expect(q('agente-dlg-sedi')).toBeTruthy()
      expect(q<HTMLInputElement>('agente-dlg-codice')!.value).toBe('AG1')
    })

    it('rilegge il record con GET (annullato alla riapertura)', async () => {
      const prima = new Subject<Agente>()
      agenti.get.and.returnValue(prima)
      await apri(agente)
      const seconda = new Subject<Agente>()
      agenti.get.and.returnValue(seconda)
      fixture.componentRef.setInput('visible', false)
      await stabilizza(fixture)
      fixture.componentRef.setInput('visible', true)
      await stabilizza(fixture)
      seconda.next({ ...agente, codice: 'ATTUALE' })
      prima.next({ ...agente, codice: 'TARDIVO' })
      await stabilizza(fixture)
      expect(fixture.componentInstance.form.getRawValue().codice).toBe('ATTUALE')
    })

    it('salva solo i campi cambiati più la versione', async () => {
      agenti.modifica.and.returnValue(of({ ...agente, note: 'nuove' }))
      await apri(agente)
      scrivi('agente-dlg-note', 'nuove')
      await stabilizza(fixture)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(agenti.modifica).toHaveBeenCalledOnceWith('a1', { note: 'nuove', versione: 3 })
      expect(salvati.length).toBe(1)
    })

    it('codice svuotato: manda null; sede cambiata: manda sedeId', async () => {
      agenti.modifica.and.returnValue(of(agente))
      await apri(agente)
      scrivi('agente-dlg-codice', '')
      const sel = q<HTMLSelectElement>('agente-dlg-sede')!
      sel.value = 's2'
      sel.dispatchEvent(new Event('change'))
      await stabilizza(fixture)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(agenti.modifica).toHaveBeenCalledOnceWith('a1', {
        codice: null,
        sedeId: 's2',
        versione: 3,
      })
    })

    it('nessuna modifica: chiude senza chiamare il backend', async () => {
      await apri(agente)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(agenti.modifica).not.toHaveBeenCalled()
    })

    it('409 di versione: messaggio e dialog aperto', async () => {
      agenti.modifica.and.returnValue(
        throwError(() => ({ status: 409, error: { message: 'Modificato da un collega.' } }))
      )
      await apri(agente)
      scrivi('agente-dlg-note', 'x')
      await stabilizza(fixture)
      bottone('agente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('agente-dlg-errore')!.textContent).toContain('Modificato da un collega.')
    })

    it('GET fallita: Salva disabilitato e nessun PATCH', async () => {
      agenti.get.and.returnValue(throwError(() => ({ error: { message: 'Non disponibile.' } })))
      await apri(agente)
      expect(fixture.componentInstance.puoSalvare()).toBeFalse()
      fixture.componentInstance.salva()
      expect(agenti.modifica).not.toHaveBeenCalled()
      expect(q('agente-dlg-errore')!.textContent).toContain('Non disponibile.')
    })

    it('Esc con il dialog delle sedi aperto non chiude né azzera', async () => {
      await apri(agente)
      scrivi('agente-dlg-note', 'in corso')
      fixture.componentInstance.sediAperte = true
      fixture.componentInstance.alCambioVisibilita(false)
      expect(fixture.componentInstance.form.getRawValue().note).toBe('in corso')
      fixture.componentInstance.sediAperte = false
      fixture.componentInstance.alCambioVisibilita(false)
      expect(fixture.componentInstance.form.getRawValue().note).toBe('')
    })

    it('VIEWER: Salva non è utilizzabile', async () => {
      TestBed.overrideProvider(AuthService, {
        useValue: { currentUser: () => ({ role: 'VIEWER' }) },
      })
      await apri(agente)
      expect(fixture.componentInstance.puoSalvare()).toBeFalse()
      scrivi('agente-dlg-note', 'x')
      fixture.componentInstance.salva()
      expect(agenti.modifica).not.toHaveBeenCalled()
    })

    it('chiudendo il dialog il form si azzera', async () => {
      await apri(agente)
      fixture.componentInstance.chiudi()
      expect(fixture.componentInstance.form.getRawValue().codice).toBe('')
    })
  })
})
