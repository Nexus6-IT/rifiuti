import { ComponentFixture, TestBed } from '@angular/core/testing'
import { Subject, of, throwError } from 'rxjs'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { MessageService } from 'primeng/api'
import { ClienteDialogComponent } from './cliente-dialog.component'
import { ClientiService } from './clienti.service'
import { ListinoService } from '../listino/listino.service'
import { TabelleFatturazioneService } from './tabelle-fatturazione.service'
import { Agente, Cliente } from './clienti.model'
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
  ragioneSociale: 'Verdi Servizi S.r.l.',
  partitaIva: PIVA,
  codiceFiscale: null,
  partitaIvaDaVerificare: false,
  privato: false,
  sedi: [sede('s1', { principale: true }), sede('s2', { via: 'Via Milano', citta: 'Milano' })],
  ruoli: {},
}

const COND = { id: 'c1', codice: '30FM', descrizione: '30 gg fine mese', attiva: true }
const CONTO = {
  id: 'k1',
  codice: 'BP',
  descrizione: 'Banca Popolare',
  ibanMascherato: 'IT60 **** 3456',
}
const SPESA_INC = {
  id: 'p1',
  tipo: 'INCASSO',
  codice: 'INC',
  descrizione: 'Incasso',
  importo: '2.00',
}
const SPESA_BOLLO = {
  id: 'b1',
  tipo: 'BOLLO',
  codice: 'BOL',
  descrizione: 'Bollo',
  importo: '2.00',
}
const REG = { id: 'r1', codice: 'V1', descrizione: 'Vendite', ricevuteSplit: false }
const REG_SPLIT = { id: 'r2', codice: 'V2', descrizione: 'Ricevute split', ricevuteSplit: true }

const rif = (id: string, codice: string, descrizione: string) => ({ id, codice, descrizione })

const cliente: Cliente = {
  id: 'cl1',
  versione: 4,
  attivo: true,
  codice: 'CL1',
  codiceDestinatario: 'ABCDEFG',
  pecFatturazione: null,
  riferimentoAmministrazione: 'RIF1',
  iban: 'IT60X0542811101000000123456',
  contoCorrenteId: 'k1',
  condizionePagamentoId: 'c1',
  esigibilitaIva: 'IMMEDIATA',
  registroIvaId: 'r1',
  speseIncassoId: 'p1',
  bolloId: 'b1',
  agenteId: 'a1',
  ritenutaPercentuale: '10.00',
  nome: null,
  cognome: null,
  note: 'note vecchie',
  ditta: {
    id: 'd1',
    ragioneSociale: 'Verdi Servizi S.r.l.',
    partitaIva: PIVA,
    codiceFiscale: null,
    privato: false,
  },
  sedeFatturazione: sede('s1', { principale: true }),
  condizionePagamento: rif('c1', '30FM', '30 gg fine mese'),
  contoCorrente: rif('k1', 'BP', 'Banca Popolare'),
  registroIva: rif('r1', 'V1', 'Vendite'),
  speseIncasso: rif('p1', 'INC', 'Incasso'),
  bollo: rif('b1', 'BOL', 'Bollo'),
  agente: rif('a1', 'AG1', 'Rossi Provvigioni'),
  contratti: 2,
  eliminabile: false,
}

const agenteNuovo: Agente = {
  id: 'a9',
  versione: 1,
  attivo: true,
  codice: null,
  note: null,
  ditta: { id: 'd9', ragioneSociale: 'Nuovo Agente', partitaIva: PIVA, codiceFiscale: null },
  sede: sede('s9'),
  clienti: 0,
  contratti: 0,
  eliminabile: true,
}

describe('ClienteDialogComponent', () => {
  let fixture: ComponentFixture<ClienteDialogComponent>
  let clienti: { get: jasmine.Spy; crea: jasmine.Spy; modifica: jasmine.Spy }
  let agenti: { list: jasmine.Spy }
  let tab: Record<'condizioni' | 'conti' | 'spese' | 'registri', { list: jasmine.Spy }>
  let registry: jasmine.SpyObj<RegistryService>
  let salvati: Cliente[]
  let visibilita: boolean[]

  async function apri(c: Cliente | null = null) {
    fixture = TestBed.createComponent(ClienteDialogComponent)
    salvati = []
    visibilita = []
    fixture.componentInstance.salvato.subscribe(v => salvati.push(v))
    fixture.componentInstance.visibleChange.subscribe(v => visibilita.push(v))
    fixture.componentRef.setInput('cliente', c)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  const valore = (id: string) => q<HTMLSelectElement>(id)!.value
  function scegli(id: string, v: string) {
    const sel = q<HTMLSelectElement>(id)!
    sel.value = v
    sel.dispatchEvent(new Event('change'))
  }
  const sub = (selettore: string) =>
    fixture.debugElement.queryAll(e => e.name === selettore).map(e => e.componentInstance)

  async function compilaDitta() {
    scrivi('cliente-dlg-ragione', 'Bianchi Srl')
    scrivi('cliente-dlg-via', 'Via Torino')
    scrivi('cliente-dlg-civico', '5')
    scrivi('cliente-dlg-cap', '10100')
    scrivi('cliente-dlg-comune', 'Torino')
    scrivi('cliente-dlg-provincia', 'TO')
    await stabilizza(fixture)
  }

  function ruolo(role: string) {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
  }

  beforeEach(() => {
    clienti = {
      get: jasmine.createSpy('get'),
      crea: jasmine.createSpy('crea'),
      modifica: jasmine.createSpy('modifica'),
    }
    agenti = { list: jasmine.createSpy('list').and.returnValue(of({ elementi: [], totale: 0 })) }
    tab = {
      condizioni: { list: jasmine.createSpy('c').and.returnValue(of([COND])) },
      conti: { list: jasmine.createSpy('k').and.returnValue(of([CONTO])) },
      spese: {
        list: jasmine
          .createSpy('s')
          .and.callFake((f: { tipo: string }) =>
            of(f.tipo === 'BOLLO' ? [SPESA_BOLLO] : [SPESA_INC])
          ),
      },
      registri: { list: jasmine.createSpy('r').and.returnValue(of([REG, REG_SPLIT])) },
    }
    registry = jasmine.createSpyObj('RegistryService', ['cercaDitta', 'getDitta'])
    registry.cercaDitta.and.returnValue(of({ ditta: null }))
    registry.getDitta.and.returnValue(of(DITTA))
    TestBed.configureTestingModule({
      imports: [ClienteDialogComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ClientiService, useValue: { clienti, agenti } },
        { provide: TabelleFatturazioneService, useValue: tab },
        { provide: ListinoService, useValue: { codiciIva: { list: () => of([]) } } },
        { provide: RegistryService, useValue: registry },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  describe('nuovo', () => {
    it('usa app-ditta-ruolo-form con tipo "cliente"', async () => {
      await apri()
      const f = sub('app-ditta-ruolo-form')[0]
      expect(f.tipo).toBe('cliente')
    })

    it('note: massimo 2000 caratteri, con contatore', async () => {
      await apri()
      expect(q<HTMLInputElement>('cliente-dlg-note')!.getAttribute('maxlength')).toBe('2000')
      expect(q('cliente-dlg-note-contatore')!.textContent).toContain('0/2000')
      scrivi('cliente-dlg-note', 'abc')
      await stabilizza(fixture)
      expect(q('cliente-dlg-note-contatore')!.textContent).toContain('3/2000')
    })

    it('ditta trovata: ragione sociale bloccata e scelta della sede', async () => {
      registry.cercaDitta.and.returnValue(of({ ditta: DITTA }))
      await apri()
      scrivi('cliente-dlg-piva-input', PIVA)
      q('cliente-dlg-piva-input')!.dispatchEvent(new Event('blur'))
      await stabilizza(fixture)
      expect(q<HTMLInputElement>('cliente-dlg-ragione')!.disabled).toBeTrue()
      expect(q('cliente-dlg-sede-s2')).toBeTruthy()
      expect(q('cliente-dlg-sede-nuova')).toBeTruthy()
    })

    it('privato (solo CF): compaiono nome e cognome, obbligatori', async () => {
      await apri()
      expect(q('cliente-dlg-nome')).toBeNull()
      await compilaDitta()
      scrivi('cliente-dlg-cf-input', CF_PERSONA)
      await stabilizza(fixture)
      expect(q('cliente-dlg-nome')).toBeTruthy()
      expect(q('cliente-dlg-cognome')).toBeTruthy()
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.crea).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain(
        'Per un cliente persona fisica indica nome e cognome.'
      )
    })

    it('privato con nome e cognome: li manda; con la partita IVA non li manda', async () => {
      clienti.crea.and.returnValue(of({ cliente, dittaEsistente: false, avvisi: [] }))
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-cf-input', CF_PERSONA)
      await stabilizza(fixture)
      scrivi('cliente-dlg-nome', 'Mario')
      scrivi('cliente-dlg-cognome', 'Rossi')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      const corpo = clienti.crea.calls.mostRecent().args[0]
      expect(corpo.nome).toBe('Mario')
      expect(corpo.cognome).toBe('Rossi')
      expect(corpo.codiceFiscale).toBe(CF_PERSONA)
    })

    it('codice destinatario: la PEC si abilita solo con 0000000 o vuoto', async () => {
      await apri()
      const pec = () => q<HTMLInputElement>('cliente-dlg-pec-fatt')!
      expect(pec().disabled).toBeFalse()
      scrivi('cliente-dlg-codice-dest', 'abcdefg')
      await stabilizza(fixture)
      expect(pec().disabled).toBeTrue()
      scrivi('cliente-dlg-codice-dest', '0000000')
      await stabilizza(fixture)
      expect(pec().disabled).toBeFalse()
      scrivi('cliente-dlg-codice-dest', '')
      await stabilizza(fixture)
      expect(pec().disabled).toBeFalse()
    })

    it('riferimento amministrazione disabilitato senza codice (e con 0000000)', async () => {
      await apri()
      const rifer = () => q<HTMLInputElement>('cliente-dlg-rif-amm')!
      expect(rifer().disabled).toBeTrue()
      scrivi('cliente-dlg-codice-dest', 'UFABC1')
      await stabilizza(fixture)
      expect(rifer().disabled).toBeFalse()
      scrivi('cliente-dlg-codice-dest', '0000000')
      await stabilizza(fixture)
      expect(rifer().disabled).toBeTrue()
    })

    it("IBAN con spazi accettato: parte com'è, la validazione resta al backend", async () => {
      clienti.crea.and.returnValue(of({ cliente, dittaEsistente: false, avvisi: [] }))
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      scrivi('cliente-dlg-iban', 'IT60 X054 2811 1010 0000 0123 456')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.crea.calls.mostRecent().args[0].iban).toBe('IT60 X054 2811 1010 0000 0123 456')
    })

    it('select delle sole voci attive: spese per tipo, registri senza ricevute split', async () => {
      await apri()
      expect(tab.condizioni.list).toHaveBeenCalledWith()
      expect(tab.spese.list).toHaveBeenCalledWith({ tipo: 'INCASSO' })
      expect(tab.spese.list).toHaveBeenCalledWith({ tipo: 'BOLLO' })
      const testi = (id: string) =>
        Array.from(q<HTMLSelectElement>(id)!.options).map(o => o.textContent!.trim())
      expect(testi('cliente-dlg-registro').join('|')).toContain('V1')
      expect(testi('cliente-dlg-registro').join('|')).not.toContain('V2')
      expect(testi('cliente-dlg-spese').join('|')).toContain('INC')
      expect(testi('cliente-dlg-bollo').join('|')).toContain('BOL')
      expect(testi('cliente-dlg-condizione').join('|')).toContain('30FM')
      expect(testi('cliente-dlg-conto').join('|')).toContain('BP')
    })

    it('crea con il corpo di R37 e i riferimenti scelti', async () => {
      clienti.crea.and.returnValue(of({ cliente, dittaEsistente: false, avvisi: [] }))
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      scrivi('cliente-dlg-codice', 'CL9')
      scrivi('cliente-dlg-codice-dest', 'abcdefg')
      scrivi('cliente-dlg-ritenuta', '2,5')
      scrivi('cliente-dlg-note', 'prima nota')
      scegli('cliente-dlg-condizione', 'c1')
      scegli('cliente-dlg-conto', 'k1')
      scegli('cliente-dlg-spese', 'p1')
      scegli('cliente-dlg-bollo', 'b1')
      scegli('cliente-dlg-registro', 'r1')
      scegli('cliente-dlg-esigibilita', 'SCISSIONE')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.crea).toHaveBeenCalledOnceWith({
        ragioneSociale: 'Bianchi Srl',
        partitaIva: PIVA,
        indirizzo: {
          via: 'Via Torino',
          civico: '5',
          cap: '10100',
          comune: 'Torino',
          provincia: 'TO',
        },
        codice: 'CL9',
        codiceDestinatario: 'ABCDEFG',
        ritenutaPercentuale: '2.5',
        note: 'prima nota',
        condizionePagamentoId: 'c1',
        contoCorrenteId: 'k1',
        speseIncassoId: 'p1',
        bolloId: 'b1',
        registroIvaId: 'r1',
        esigibilitaIva: 'SCISSIONE',
      })
      expect(salvati).toEqual([cliente])
    })

    it('agente: autocomplete sugli agenti attivi, la scelta finisce nel corpo', async () => {
      agenti.list.and.returnValue(of({ elementi: [agenteNuovo], totale: 1 }))
      clienti.crea.and.returnValue(of({ cliente, dittaEsistente: false, avvisi: [] }))
      await apri()
      fixture.componentInstance.opzioni.cercaAgenti({ query: 'nuo' })
      expect(agenti.list).toHaveBeenCalledWith(
        jasmine.objectContaining({ testo: 'nuo', soloAttivi: true })
      )
      fixture.componentInstance.opzioni.scegliAgente({ id: 'a9', etichetta: 'Nuovo Agente' })
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.crea.calls.mostRecent().args[0].agenteId).toBe('a9')
    })

    it('400 CLIENTE_NON_VALIDO: messaggi del backend, dialog aperto', async () => {
      clienti.crea.and.returnValue(
        throwError(() => ({
          status: 400,
          error: { error: 'CLIENTE_NON_VALIDO', message: ['Primo errore.', 'Secondo errore.'] },
        }))
      )
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('cliente-dlg-errore')!.textContent).toContain('Primo errore. Secondo errore.')
      expect(visibilita).not.toContain(false)
      expect(salvati).toEqual([])
    })

    it('risposta con avvisi (ditta esistente): toast informativo', async () => {
      clienti.crea.and.returnValue(
        of({ cliente, dittaEsistente: true, avvisi: ['Sede già presente.'] })
      )
      const spia = spyOn(TestBed.inject(MessageService), 'add')
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(spia).toHaveBeenCalledWith(jasmine.objectContaining({ detail: 'Sede già presente.' }))
    })

    it('doppio clic: una sola chiamata', async () => {
      clienti.crea.and.returnValue(new Subject<unknown>())
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      await stabilizza(fixture)
      fixture.componentInstance.salva()
      fixture.componentInstance.salva()
      expect(clienti.crea).toHaveBeenCalledTimes(1)
    })

    it('senza identificativi o indirizzo non salva', async () => {
      await apri()
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.crea).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain('Indica la partita IVA o il codice fiscale.')
    })

    it('chiudendo il dialog il form si azzera', async () => {
      await apri()
      scrivi('cliente-dlg-note', 'x')
      fixture.componentInstance.chiudi()
      expect(fixture.componentInstance.form.getRawValue().note).toBe('')
    })
  })

  describe('aggiunta in linea', () => {
    const casi = [
      {
        nome: 'condizione',
        bottone: 'cliente-dlg-nuova-condizione',
        etichetta: 'Nuova condizione',
        selettore: 'app-condizione-pagamento-dialog',
        indice: 0,
        campo: 'cliente-dlg-condizione',
        nuovo: { ...COND, id: 'cN', codice: 'NUOVA' },
      },
      {
        nome: 'conto',
        bottone: 'cliente-dlg-nuovo-conto',
        etichetta: 'Nuovo conto',
        selettore: 'app-conto-corrente-dialog',
        indice: 0,
        campo: 'cliente-dlg-conto',
        nuovo: { ...CONTO, id: 'kN', codice: 'NUOVO' },
      },
      {
        nome: 'spese di incasso',
        bottone: 'cliente-dlg-nuove-spese',
        etichetta: 'Nuova spesa di incasso',
        selettore: 'app-spesa-accessoria-dialog',
        indice: 0,
        tipo: 'INCASSO',
        campo: 'cliente-dlg-spese',
        nuovo: { ...SPESA_INC, id: 'pN', codice: 'NUOVA' },
      },
      {
        nome: 'bollo',
        bottone: 'cliente-dlg-nuovo-bollo',
        etichetta: 'Nuovo bollo',
        selettore: 'app-spesa-accessoria-dialog',
        indice: 1,
        tipo: 'BOLLO',
        campo: 'cliente-dlg-bollo',
        nuovo: { ...SPESA_BOLLO, id: 'bN', codice: 'NUOVO' },
      },
      {
        nome: 'registro',
        bottone: 'cliente-dlg-nuovo-registro',
        etichetta: 'Nuovo registro',
        selettore: 'app-registro-iva-dialog',
        indice: 0,
        campo: 'cliente-dlg-registro',
        nuovo: { ...REG, id: 'rN', codice: 'NUOVO' },
      },
    ]

    for (const c of casi) {
      describe(c.nome, () => {
        it(`"${c.etichetta}" apre il sub-dialog e la voce salvata finisce nel campo`, async () => {
          await apri()
          expect(bottone(c.bottone)!.textContent).toContain(c.etichetta)
          expect(sub(c.selettore)[c.indice].visible).toBeFalse()
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          const dlg = sub(c.selettore)[c.indice]
          expect(dlg.visible).toBeTrue()
          if (c.tipo) expect(dlg.tipo).toBe(c.tipo)
          dlg.salvato.emit(c.nuovo)
          dlg.visibleChange.emit(false)
          await stabilizza(fixture)
          expect(valore(c.campo)).toBe(c.nuovo.id)
          expect(sub(c.selettore)[c.indice].visible).toBeFalse()
        })

        it('Esc nel sub-dialog non chiude il dialog del cliente e non perde il form', async () => {
          await apri()
          scrivi('cliente-dlg-note', 'in corso')
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          fixture.componentInstance.alCambioVisibilita(false)
          expect(visibilita).toEqual([])
          expect(fixture.componentInstance.form.getRawValue().note).toBe('in corso')
          sub(c.selettore)[c.indice].visibleChange.emit(false)
          await stabilizza(fixture)
          fixture.componentInstance.alCambioVisibilita(false)
          expect(visibilita).toEqual([false])
        })

        it(`chiuso il sub-dialog, il focus torna al pulsante "${c.etichetta}"`, async () => {
          await apri()
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          sub(c.selettore)[c.indice].visibleChange.emit(false)
          await stabilizza(fixture)
          await new Promise(r => setTimeout(r))
          expect(document.activeElement).toBe(bottone(c.bottone))
        })
      })
    }

    it('agente: "Nuovo agente" apre il dialog dell\'agente e la scelta finisce nel campo', async () => {
      await apri()
      bottone('cliente-dlg-nuovo-agente')!.click()
      await stabilizza(fixture)
      const dlg = sub('app-agente-dialog')[0]
      expect(dlg.visible).toBeTrue()
      dlg.salvato.emit(agenteNuovo)
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(fixture.componentInstance.form.getRawValue().agenteId).toBe('a9')
      expect(fixture.componentInstance.opzioni.agenteSelezionato?.etichetta).toBe('Nuovo Agente')
      await new Promise(r => setTimeout(r))
      expect(document.activeElement).toBe(bottone('cliente-dlg-nuovo-agente'))
    })

    it('agente: Esc nel sub-dialog non chiude il dialog del cliente', async () => {
      await apri()
      bottone('cliente-dlg-nuovo-agente')!.click()
      await stabilizza(fixture)
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([])
    })

    it('agente: modello svuotato senza onClear (blur con forceSelection) toglie anche agenteId', async () => {
      await apri()
      fixture.componentInstance.opzioni.scegliAgente({ id: 'a9', etichetta: 'Nuovo Agente' })
      expect(fixture.componentInstance.form.getRawValue().agenteId).toBe('a9')
      fixture.componentInstance.opzioni.cambiaModelloAgente(null)
      expect(fixture.componentInstance.form.getRawValue().agenteId).toBe('')
      fixture.componentInstance.opzioni.cambiaModelloAgente('testo digitato')
      expect(fixture.componentInstance.form.getRawValue().agenteId).toBe('')
      fixture.componentInstance.opzioni.cambiaModelloAgente({ id: 'a9', etichetta: 'Nuovo Agente' })
      expect(fixture.componentInstance.form.getRawValue().agenteId).toBe('a9')
    })

    it('registro delle ricevute split creato in linea: messaggio chiaro e nessuna selezione', async () => {
      const spia = spyOn(TestBed.inject(MessageService), 'add')
      await apri()
      bottone('cliente-dlg-nuovo-registro')!.click()
      await stabilizza(fixture)
      const dlg = sub('app-registro-iva-dialog')[0]
      dlg.salvato.emit({ ...REG_SPLIT, id: 'rS' })
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(valore('cliente-dlg-registro')).toBe('')
      expect(spia).toHaveBeenCalledWith(
        jasmine.objectContaining({
          detail: jasmine.stringMatching(/ricevute split: non utilizzabile qui/),
        })
      )
    })

    it('VIEWER: nessun pulsante "Nuovo …" e Salva non utilizzabile', async () => {
      ruolo('VIEWER')
      await apri()
      for (const c of casi) expect(q(c.bottone)).toBeNull()
      expect(q('cliente-dlg-nuovo-agente')).toBeNull()
      expect(fixture.componentInstance.puoSalvare()).toBeFalse()
    })
  })

  describe('modifica', () => {
    beforeEach(() => clienti.get.and.returnValue(of(cliente)))

    it('identificativi e indirizzo in sola lettura, link "Sedi"', async () => {
      await apri(cliente)
      expect(sub('app-ditta-ruolo-form').length).toBe(0)
      expect(q('cliente-dlg-identificativi')!.textContent).toContain(`P.IVA ${PIVA}`)
      expect(q('cliente-dlg-ragione')).toBeNull()
      expect(q('cliente-dlg-sedi')).toBeTruthy()
      expect(sub('app-sedi-ditta-dialog')[0].visible).toBeFalse()
      bottone('cliente-dlg-sedi')!.click()
      await stabilizza(fixture)
      expect(sub('app-sedi-ditta-dialog')[0].visible).toBeTrue()
      expect(valore('cliente-dlg-sede')).toBe('s1')
    })

    it('mostra i valori letti, anche di una voce ormai disattivata', async () => {
      tab.condizioni.list.and.returnValue(of([]))
      await apri(cliente)
      expect(valore('cliente-dlg-condizione')).toBe('c1')
      expect(valore('cliente-dlg-registro')).toBe('r1')
      expect(q<HTMLInputElement>('cliente-dlg-codice')!.value).toBe('CL1')
      expect(q<HTMLInputElement>('cliente-dlg-ritenuta')!.value).toBe('10')
      expect(q<HTMLInputElement>('cliente-dlg-rif-amm')!.value).toBe('RIF1')
      expect(fixture.componentInstance.opzioni.agenteSelezionato?.etichetta).toBe(
        'Rossi Provvigioni'
      )
    })

    it('rilegge il cliente con GET (risposta in ritardo scartata)', async () => {
      const prima = new Subject<Cliente>()
      clienti.get.and.returnValue(prima)
      await apri(cliente)
      const seconda = new Subject<Cliente>()
      clienti.get.and.returnValue(seconda)
      fixture.componentRef.setInput('visible', false)
      await stabilizza(fixture)
      fixture.componentRef.setInput('visible', true)
      await stabilizza(fixture)
      seconda.next({ ...cliente, codice: 'ATTUALE' })
      prima.next({ ...cliente, codice: 'TARDIVO' })
      await stabilizza(fixture)
      expect(fixture.componentInstance.form.getRawValue().codice).toBe('ATTUALE')
    })

    it('Salva disabilitato finché la GET non riesce', async () => {
      const lettura = new Subject<Cliente>()
      clienti.get.and.returnValue(lettura)
      await apri(cliente)
      expect(fixture.componentInstance.puoSalvare()).toBeFalse()
      fixture.componentInstance.salva()
      expect(clienti.modifica).not.toHaveBeenCalled()
      lettura.next(cliente)
      await stabilizza(fixture)
      expect(fixture.componentInstance.puoSalvare()).toBeTrue()
    })

    it('GET fallita: Salva disabilitato, messaggio del backend', async () => {
      clienti.get.and.returnValue(throwError(() => ({ error: { message: 'Non disponibile.' } })))
      await apri(cliente)
      expect(fixture.componentInstance.puoSalvare()).toBeFalse()
      fixture.componentInstance.salva()
      expect(clienti.modifica).not.toHaveBeenCalled()
      expect(q('cliente-dlg-errore')!.textContent).toContain('Non disponibile.')
    })

    it('salva in modifica manda solo i campi cambiati più versione', async () => {
      clienti.modifica.and.returnValue(of({ ...cliente, note: 'nuove' }))
      await apri(cliente)
      scrivi('cliente-dlg-note', 'nuove')
      scegli('cliente-dlg-esigibilita', 'DIFFERITA')
      scrivi('cliente-dlg-iban', '')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.modifica).toHaveBeenCalledOnceWith('cl1', {
        note: 'nuove',
        esigibilitaIva: 'DIFFERITA',
        iban: null,
        versione: 4,
      })
      expect(salvati.length).toBe(1)
    })

    it('sede di fatturazione cambiata: manda sedeId', async () => {
      clienti.modifica.and.returnValue(of(cliente))
      await apri(cliente)
      scegli('cliente-dlg-sede', 's2')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.modifica).toHaveBeenCalledOnceWith('cl1', { sedeId: 's2', versione: 4 })
    })

    it('nessun cambiamento: nessuna chiamata e avviso "Nessuna modifica da salvare"', async () => {
      const spia = spyOn(TestBed.inject(MessageService), 'add')
      await apri(cliente)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.modifica).not.toHaveBeenCalled()
      expect(spia).toHaveBeenCalledWith(
        jasmine.objectContaining({ detail: 'Nessuna modifica da salvare.' })
      )
    })

    it('400: messaggi del backend, dialog aperto', async () => {
      clienti.modifica.and.returnValue(
        throwError(() => ({
          status: 400,
          error: {
            error: 'CLIENTE_NON_VALIDO',
            message: 'La PEC per la fattura elettronica non è valida.',
          },
        }))
      )
      await apri(cliente)
      scrivi('cliente-dlg-note', 'x')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('cliente-dlg-errore')!.textContent).toContain('La PEC per la fattura elettronica')
      expect(visibilita).not.toContain(false)
    })

    it('409 MODIFICATO_NEL_FRATTEMPO: toast ed emette salvato per ricaricare', async () => {
      clienti.modifica.and.returnValue(
        throwError(() => ({
          status: 409,
          error: {
            error: 'CLIENTE_MODIFICATO_NEL_FRATTEMPO',
            message: 'Modificato da un collega.',
          },
        }))
      )
      const spia = spyOn(TestBed.inject(MessageService), 'add')
      await apri(cliente)
      scrivi('cliente-dlg-note', 'x')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(spia).toHaveBeenCalledWith(
        jasmine.objectContaining({ severity: 'error', detail: 'Modificato da un collega.' })
      )
      expect(salvati.length).toBe(1)
      expect(visibilita).toContain(false)
    })

    it('PEC esistente: digitando 0000000 carattere per carattere la PEC resta e non viene inviata a null', async () => {
      clienti.get.and.returnValue(
        of({ ...cliente, codiceDestinatario: null, pecFatturazione: 'fatture@verdi.it' })
      )
      clienti.modifica.and.returnValue(of(cliente))
      await apri(cliente)
      const pec = () => q<HTMLInputElement>('cliente-dlg-pec-fatt')!
      expect(pec().value).toBe('fatture@verdi.it')
      for (const parziale of ['0', '00', '000', '0000', '00000', '000000']) {
        scrivi('cliente-dlg-codice-dest', parziale)
        await stabilizza(fixture)
        // con un codice parziale il campo è disabilitato ma conserva il valore
        expect(pec().disabled).toBeTrue()
        expect(pec().value).toBe('fatture@verdi.it')
      }
      scrivi('cliente-dlg-codice-dest', '0000000')
      await stabilizza(fixture)
      expect(pec().disabled).toBeFalse()
      expect(pec().value).toBe('fatture@verdi.it')
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      const corpo = clienti.modifica.calls.mostRecent().args[1]
      expect(corpo.codiceDestinatario).toBe('0000000')
      expect(corpo.pecFatturazione).toBeUndefined()
    })

    it('codice destinatario vero: PEC e riferimento non ammessi non partono, quello ammesso sì', async () => {
      clienti.get.and.returnValue(
        of({
          ...cliente,
          codiceDestinatario: null,
          pecFatturazione: 'fatture@verdi.it',
          riferimentoAmministrazione: null,
        })
      )
      clienti.modifica.and.returnValue(of(cliente))
      await apri(cliente)
      scrivi('cliente-dlg-codice-dest', 'UFABC1')
      scrivi('cliente-dlg-rif-amm', 'RIF9')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.modifica).toHaveBeenCalledOnceWith('cl1', {
        codiceDestinatario: 'UFABC1',
        pecFatturazione: null,
        riferimentoAmministrazione: 'RIF9',
        versione: 4,
      })
    })

    it('VIEWER: Salva non è utilizzabile e niente link "Sedi"', async () => {
      ruolo('VIEWER')
      await apri(cliente)
      expect(fixture.componentInstance.puoSalvare()).toBeFalse()
      expect(q('cliente-dlg-sedi')).toBeNull()
      fixture.componentInstance.salva()
      expect(clienti.modifica).not.toHaveBeenCalled()
    })

    it('Esc con il dialog delle sedi aperto non chiude né azzera', async () => {
      await apri(cliente)
      scrivi('cliente-dlg-note', 'in corso')
      bottone('cliente-dlg-sedi')!.click()
      await stabilizza(fixture)
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([])
      expect(fixture.componentInstance.form.getRawValue().note).toBe('in corso')
    })

    it('chiudendo il dialog il form si azzera', async () => {
      await apri(cliente)
      fixture.componentInstance.chiudi()
      expect(fixture.componentInstance.form.getRawValue().codice).toBe('')
    })
  })

  describe('listino e provvigione predefinita', () => {
    const conProvvigione: Cliente = {
      ...cliente,
      listino: 3,
      provvigionePredefinita: '5.00',
      tipoProvvigionePredefinita: 'LORDO',
    }

    it('listino: nessuno più i listini da 1 a 6; tipo disabilitato senza provvigione', async () => {
      await apri()
      const opzioni = Array.from(q<HTMLSelectElement>('cliente-dlg-listino')!.options).map(
        o => o.value
      )
      expect(opzioni).toEqual(['', '1', '2', '3', '4', '5', '6'])
      expect(q<HTMLSelectElement>('cliente-dlg-tipo-provvigione')!.disabled).toBeTrue()
      scrivi('cliente-dlg-provvigione', '4,5')
      await stabilizza(fixture)
      expect(q<HTMLSelectElement>('cliente-dlg-tipo-provvigione')!.disabled).toBeFalse()
      scrivi('cliente-dlg-provvigione', '')
      await stabilizza(fixture)
      expect(q<HTMLSelectElement>('cliente-dlg-tipo-provvigione')!.disabled).toBeTrue()
    })

    it('nuovo: manda listino, provvigione con il punto e il tipo', async () => {
      clienti.crea.and.returnValue(of({ cliente, dittaEsistente: false, avvisi: [] }))
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      scegli('cliente-dlg-listino', '2')
      scrivi('cliente-dlg-provvigione', '4,5')
      await stabilizza(fixture)
      scegli('cliente-dlg-tipo-provvigione', 'SCONTATO')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      const corpo = clienti.crea.calls.mostRecent().args[0]
      expect(corpo.listino).toBe(2)
      expect(corpo.provvigionePredefinita).toBe('4.5')
      expect(corpo.tipoProvvigionePredefinita).toBe('SCONTATO')
    })

    it('nuovo senza i tre campi: non li manda', async () => {
      clienti.crea.and.returnValue(of({ cliente, dittaEsistente: false, avvisi: [] }))
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      const corpo = clienti.crea.calls.mostRecent().args[0]
      expect('listino' in corpo).toBeFalse()
      expect('provvigionePredefinita' in corpo).toBeFalse()
      expect('tipoProvvigionePredefinita' in corpo).toBeFalse()
    })

    it('modifica: mostra i valori letti', async () => {
      clienti.get.and.returnValue(of(conProvvigione))
      await apri(conProvvigione)
      expect(valore('cliente-dlg-listino')).toBe('3')
      expect(q<HTMLInputElement>('cliente-dlg-provvigione')!.value).toBe('5,00')
      expect(valore('cliente-dlg-tipo-provvigione')).toBe('LORDO')
    })

    describe('ritenuta e provvigione: la virgola è obbligatoria (decisione di Graziano)', () => {
      for (const [campo, testid, chiave] of [
        ['ritenuta', 'cliente-dlg-ritenuta', 'ritenutaPercentuale'],
        ['provvigione', 'cliente-dlg-provvigione', 'provvigionePredefinita'],
      ] as const) {
        it(`${campo}: "1.000" è rifiutato, errore sul campo e Salva bloccato`, async () => {
          clienti.get.and.returnValue(of(conProvvigione))
          clienti.modifica.and.returnValue(of(conProvvigione))
          await apri(conProvvigione)
          scrivi(testid, '1.000')
          await stabilizza(fixture)
          expect(q(`${testid}-errore`)!.textContent).toContain('Usa la virgola per i decimali')
          expect(q(testid)!.getAttribute('aria-describedby')).toBe(`${testid}-errore`)
          fixture.componentInstance.salva()
          expect(clienti.modifica).not.toHaveBeenCalled()
          expect(bottone('cliente-dlg-salva')!.disabled).toBeTrue()
        })

        it(`${campo}: "1000,5" parte come "1000.5"`, async () => {
          clienti.get.and.returnValue(of(conProvvigione))
          clienti.modifica.and.returnValue(of(conProvvigione))
          await apri(conProvvigione)
          scrivi(testid, '1000,5')
          await stabilizza(fixture)
          bottone('cliente-dlg-salva')!.click()
          await stabilizza(fixture)
          expect(clienti.modifica.calls.mostRecent().args[1][chiave]).toBe('1000.5')
        })

        it(`${campo}: alla riapertura 1000 si legge "1000", senza migliaia`, async () => {
          const letto = { ...conProvvigione, [chiave]: '1000' }
          clienti.get.and.returnValue(of(letto))
          await apri(letto)
          expect(q<HTMLInputElement>(testid)!.value).toBe('1000')
        })
      }
    })

    it('modifica: senza cambiare i tre campi non li manda', async () => {
      clienti.get.and.returnValue(of(conProvvigione))
      clienti.modifica.and.returnValue(of(conProvvigione))
      await apri(conProvvigione)
      scrivi('cliente-dlg-note', 'nuova')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.modifica.calls.mostRecent().args[1]).toEqual({ note: 'nuova', versione: 4 })
    })

    it('modifica: azzerare la provvigione azzera anche il tipo (R26), il listino a nessuno è null', async () => {
      clienti.get.and.returnValue(of(conProvvigione))
      clienti.modifica.and.returnValue(of(conProvvigione))
      await apri(conProvvigione)
      scegli('cliente-dlg-listino', '')
      scrivi('cliente-dlg-provvigione', '')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.modifica.calls.mostRecent().args[1]).toEqual({
        listino: null,
        provvigionePredefinita: null,
        tipoProvvigionePredefinita: null,
        versione: 4,
      })
    })

    it('modifica: cambio del solo tipo', async () => {
      clienti.get.and.returnValue(of(conProvvigione))
      clienti.modifica.and.returnValue(of(conProvvigione))
      await apri(conProvvigione)
      scegli('cliente-dlg-tipo-provvigione', 'SCONTATO')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.modifica.calls.mostRecent().args[1]).toEqual({
        tipoProvvigionePredefinita: 'SCONTATO',
        versione: 4,
      })
    })

    it('cascata: spazi tolti e tutte le virgole in punti, anche a due decimali', async () => {
      clienti.crea.and.returnValue(of({ cliente, dittaEsistente: false, avvisi: [] }))
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      scrivi('cliente-dlg-provvigione', ' 10,5 + 2,25 ')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.crea.calls.mostRecent().args[0].provvigionePredefinita).toBe('10.5+2.25')
    })

    it('modifica: la cascata già salvata, riscritta con spazi o virgole, non è una modifica', async () => {
      const salvata = { ...conProvvigione, provvigionePredefinita: '10.5+2.5' }
      clienti.get.and.returnValue(of(salvata))
      await apri(salvata)
      scrivi('cliente-dlg-provvigione', '10,5 + 2,5')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(clienti.modifica).not.toHaveBeenCalled()
    })

    it('digitando una provvigione il tipo vuoto parte da "sul prezzo scontato"', async () => {
      await apri()
      expect(valore('cliente-dlg-tipo-provvigione')).toBe('')
      scrivi('cliente-dlg-provvigione', '5')
      await stabilizza(fixture)
      expect(valore('cliente-dlg-tipo-provvigione')).toBe('SCONTATO')
      scegli('cliente-dlg-tipo-provvigione', 'LORDO')
      scrivi('cliente-dlg-provvigione', '55')
      await stabilizza(fixture)
      expect(valore('cliente-dlg-tipo-provvigione')).toBe('LORDO')
    })

    it('i campi senza errore non puntano a un messaggio che non c’è (voce 30)', async () => {
      await apri()
      for (const id of [
        'cliente-dlg-ritenuta',
        'cliente-dlg-listino',
        'cliente-dlg-provvigione',
        'cliente-dlg-tipo-provvigione',
      ]) {
        expect(q(id)!.getAttribute('aria-describedby')).withContext(id).toBeNull()
      }
    })

    it('il tipo preimpostato toglie l’errore rimasto sul tipo (voce 28)', async () => {
      clienti.crea.and.returnValue(
        throwError(() => ({
          status: 400,
          error: {
            error: 'CLIENTE_NON_VALIDO',
            message: ['Indica su cosa si calcola la provvigione del cliente.'],
          },
        }))
      )
      await apri()
      await compilaDitta()
      scrivi('cliente-dlg-piva-input', PIVA)
      scrivi('cliente-dlg-provvigione', '5')
      await stabilizza(fixture)
      scegli('cliente-dlg-tipo-provvigione', '')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('cliente-dlg-tipo-provvigione-errore')).not.toBeNull()
      scrivi('cliente-dlg-provvigione', '')
      await stabilizza(fixture)
      scrivi('cliente-dlg-provvigione', '7')
      await stabilizza(fixture)
      expect(valore('cliente-dlg-tipo-provvigione')).toBe('SCONTATO')
      expect(q('cliente-dlg-tipo-provvigione-errore')).toBeNull()
    })

    it('la provvigione accetta al massimo 20 caratteri', async () => {
      await apri()
      expect(q('cliente-dlg-provvigione')!.getAttribute('maxlength')).toBe('20')
    })

    it('VIEWER: i tre campi sono in sola lettura', async () => {
      ruolo('VIEWER')
      clienti.get.and.returnValue(of(conProvvigione))
      await apri(conProvvigione)
      expect(q<HTMLSelectElement>('cliente-dlg-listino')!.disabled).toBeTrue()
      expect(q<HTMLInputElement>('cliente-dlg-provvigione')!.disabled).toBeTrue()
      expect(q<HTMLSelectElement>('cliente-dlg-tipo-provvigione')!.disabled).toBeTrue()
    })

    it('400 sul listino e sulla provvigione: il messaggio sta sul campo, il resto in fondo', async () => {
      clienti.get.and.returnValue(of(conProvvigione))
      clienti.modifica.and.returnValue(
        throwError(() => ({
          status: 400,
          error: {
            error: 'CLIENTE_NON_VALIDO',
            message: [
              'Il listino del cliente va da 1 a 6.',
              'Indica su cosa si calcola la provvigione del cliente.',
              'La PEC non è valida.',
            ],
          },
        }))
      )
      await apri(conProvvigione)
      scrivi('cliente-dlg-note', 'x')
      await stabilizza(fixture)
      bottone('cliente-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('cliente-dlg-listino-errore')!.textContent).toContain('va da 1 a 6')
      expect(q('cliente-dlg-tipo-provvigione-errore')!.textContent).toContain('Indica su cosa')
      expect(q('cliente-dlg-listino')!.getAttribute('aria-invalid')).toBe('true')
      // Correggere il campo toglie il suo errore.
      scegli('cliente-dlg-listino', '2')
      await stabilizza(fixture)
      expect(q('cliente-dlg-listino-errore')).toBeNull()
      expect(q('cliente-dlg-errore')!.textContent).toContain('La PEC non è valida.')
      expect(q('cliente-dlg-errore')!.textContent).not.toContain('listino')
      expect(visibilita).not.toContain(false)
    })
  })
})
