import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import {
  RentriRegistroPannelloComponent,
  RentriRigaAzioniComponent,
} from './rentri-registro-pannello.component'
import {
  ElencoRegistriRentri,
  ImpostazioniRegistroRentri,
  RentriRegistroService,
} from './rentri-registro.service'
import { STATI_RENTRI, StatoRentri } from './stato-rentri'
import { ToastService } from '../../core/services/toast.service'

function registro(p: Partial<ImpostazioniRegistroRentri> = {}): ImpostazioniRegistroRentri {
  return {
    registroId: 'r1',
    descrizione: 'Sede',
    identificativoRentri: 'RABCDE12345',
    invioAutomatico: false,
    invioAutomaticoDal: null,
    perStato: {},
    nonTrasmessi: 7,
    haCertificato: true,
    ...p,
  }
}

function elenco(
  r: Partial<ImpostazioniRegistroRentri> = {},
  permessi: Partial<ElencoRegistriRentri> = {}
): ElencoRegistriRentri {
  return { registri: [registro(r)], puoConfigurare: true, puoTrasmettere: true, ...permessi }
}

const q = <T extends HTMLElement = HTMLElement>(testid: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${testid}"]`)
const clic = (testid: string): void => {
  const b = document.body.querySelector<HTMLElement>(`[data-testid="${testid}"] button`)
  expect(b).withContext(testid).not.toBeNull()
  b!.click()
}

describe('RentriRegistroPannelloComponent', () => {
  let servizio: jasmine.SpyObj<RentriRegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RentriRegistroPannelloComponent>

  function apri(e: ElencoRegistriRentri, selezionati: string[] = []): void {
    servizio.registri.and.returnValue(of(e))
    fixture = TestBed.createComponent(RentriRegistroPannelloComponent)
    fixture.componentRef.setInput('registroId', 'r1')
    fixture.componentRef.setInput('selezionati', selezionati)
    fixture.componentRef.setInput('annoCorrente', 2026)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RentriRegistroService>('RentriRegistroService', [
      'registri',
      'trasmetti',
      'trasmettiStorico',
      'allineamento',
      'imposta',
      'dichiaraGiaSuRentri',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [RentriRegistroPannelloComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RentriRegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it("registro non collegato: dice di inserire l'identificativo e offre il bottone solo all'admin", () => {
    apri(elenco({ identificativoRentri: null }))
    expect(q('rentri-non-collegato')?.textContent).toContain(
      "Registro non collegato a RENTRI: inserisci l'identificativo preso dal portale"
    )
    expect(q('rentri-impostazioni')).not.toBeNull()
    fixture.destroy()
    apri(elenco({ identificativoRentri: null }, { puoConfigurare: false }))
    expect(q('rentri-impostazioni')).toBeNull()
  })

  it('le azioni da amministratore compaiono solo se il backend dice puoConfigurare', () => {
    apri(elenco({}, { puoConfigurare: false }))
    expect(q('rentri-storico')).toBeNull()
    expect(q('rentri-impostazioni')).toBeNull()
    expect(q('rentri-trasmetti')).not.toBeNull()
  })

  it("senza puoTrasmettere non c'è il bottone Trasmetti", () => {
    apri(elenco({}, { puoTrasmettere: false }))
    expect(q('rentri-trasmetti')).toBeNull()
  })

  it('modalità e conteggi per stato con le etichette italiane; la nota Q1', () => {
    apri(
      elenco({
        invioAutomatico: true,
        invioAutomaticoDal: '2026-10-01T08:00:00.000Z',
        perStato: { TRASMESSA: 4, ATTESA_ESITO: 2, INCERTA: 1 },
      })
    )
    const t = q('rentri-pannello')!.textContent!
    expect(t).toContain('automatico')
    expect(t).toContain('01/10/2026')
    expect(q('rentri-conteggio-TRASMESSA')?.textContent).toContain('Trasmessa')
    expect(q('rentri-conteggio-TRASMESSA')?.textContent).toContain('4')
    expect(q('rentri-conteggio-ATTESA_ESITO')?.textContent).toContain("In attesa dell'esito")
    expect(q('rentri-conteggio-INCERTA')?.textContent).toContain('Esito incerto')
    expect(q('rentri-nota-obbligo')?.textContent).toContain('portale')
  })

  it('manca il certificato: lo dice, e le annotazioni restano in coda', () => {
    apri(elenco({ haCertificato: false }))
    expect(q('rentri-senza-certificato')?.textContent).toContain('certificato')
  })

  it('Trasmetti selezionati: disabilitato senza selezione', () => {
    apri(elenco())
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="rentri-trasmetti"] button')!
        .disabled
    ).toBeTrue()
  })

  it('Trasmetti: dialog di conferma col numero, 202 mostra solo "avviato", mai "trasmesso"', () => {
    servizio.trasmetti.and.returnValue(of({ accodate: 2, saltate: [], avvio: 'AVVIATO' }))
    apri(elenco(), ['m1', 'm2'])
    let aggiornato = 0
    fixture.componentInstance.aggiornato.subscribe(() => aggiornato++)
    clic('rentri-trasmetti')
    fixture.detectChanges()
    expect(q('rentri-conferma')?.textContent).toContain('2 annotazioni')
    expect(servizio.trasmetti).not.toHaveBeenCalled()
    clic('rentri-conferma-si')
    expect(servizio.trasmetti).toHaveBeenCalledWith('r1', ['m1', 'm2'])
    const testo = toast.info.calls.mostRecent().args[0]
    expect(testo).toContain('invio avviato')
    expect(testo.toLowerCase()).not.toContain('trasmesse con successo')
    expect(aggiornato).toBe(1)
  })

  it('senza certificato il 202 è un avviso, non un successo', () => {
    servizio.trasmetti.and.returnValue(of({ accodate: 1, saltate: [], avvio: 'SENZA_CERTIFICATO' }))
    apri(elenco(), ['m1'])
    clic('rentri-trasmetti')
    fixture.detectChanges()
    clic('rentri-conferma-si')
    expect(toast.warn).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('Trasmetti lo storico: conferma con anno e numero, poi POST con conferma implicita', () => {
    servizio.trasmettiStorico.and.returnValue(of({ accodate: 7, saltate: [], avvio: 'AVVIATO' }))
    apri(elenco({ nonTrasmessi: 7 }))
    clic('rentri-storico')
    fixture.detectChanges()
    const c = q('rentri-conferma')!.textContent!
    expect(c).toContain('7 annotazioni')
    expect(c).toContain('non si possono ritirare')
    clic('rentri-conferma-si')
    expect(servizio.trasmettiStorico).toHaveBeenCalledWith('r1', 2026)
  })

  it('storico: con 0 annotazioni da trasmettere la conferma è disabilitata', () => {
    apri(elenco({ nonTrasmessi: 0 }))
    clic('rentri-storico')
    fixture.detectChanges()
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="rentri-conferma-si"] button')!
        .disabled
    ).toBeTrue()
  })

  it('errore del backend nel trasmettere: messaggio verbatim', () => {
    servizio.trasmetti.and.returnValue(
      throwError(() => ({ status: 403, error: { message: 'Ruolo non ammesso.' } }))
    )
    apri(elenco(), ['m1'])
    clic('rentri-trasmetti')
    fixture.detectChanges()
    clic('rentri-conferma-si')
    expect(toast.error).toHaveBeenCalledWith('Ruolo non ammesso.')
  })

  it('Verifica allineamento: mostra i numeri, o dice che RENTRI non ha risposto', () => {
    servizio.allineamento.and.returnValue(of({ locali: 10, trasmessi: 8, suRentri: 8 }))
    apri(elenco())
    clic('rentri-allineamento')
    fixture.detectChanges()
    const t = q('rentri-allineamento-esito')!.textContent!
    expect(t).toContain('10')
    expect(t).toContain('8')
    servizio.allineamento.and.returnValue(of({ locali: 10, trasmessi: 8, suRentri: null }))
    clic('rentri-allineamento')
    fixture.detectChanges()
    expect(q('rentri-allineamento-esito')!.textContent).toContain('non ha risposto')
  })

  it('emette i permessi per la pagina (collegato, puoTrasmettere)', () => {
    servizio.registri.and.returnValue(of(elenco({}, { puoTrasmettere: false })))
    fixture = TestBed.createComponent(RentriRegistroPannelloComponent)
    let ricevuto: unknown
    fixture.componentInstance.statoChange.subscribe((s: unknown) => (ricevuto = s))
    fixture.componentRef.setInput('registroId', 'r1')
    fixture.componentRef.setInput('selezionati', [])
    fixture.componentRef.setInput('annoCorrente', 2026)
    fixture.detectChanges()
    expect(ricevuto).toEqual({ collegato: true, puoTrasmettere: false })
  })
})

describe('RentriRigaAzioniComponent', () => {
  let servizio: jasmine.SpyObj<RentriRegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RentriRigaAzioniComponent>

  function riga(stato: StatoRentri | null, motivo: string | null = null, puo = true) {
    fixture = TestBed.createComponent(RentriRigaAzioniComponent)
    fixture.componentRef.setInput('movimentoId', 'm1')
    fixture.componentRef.setInput('registroId', 'r1')
    fixture.componentRef.setInput('numero', '2026/12')
    fixture.componentRef.setInput(
      'trasmissione',
      stato ? { stato, identificativo: null, motivo } : null
    )
    fixture.componentRef.setInput('puoTrasmettere', puo)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RentriRegistroService>('RentriRegistroService', [
      'verifica',
      'togliDallaCoda',
      'trasmetti',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [RentriRigaAzioniComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RentriRegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it("mostra in colonna l'etichetta italiana di ogni stato", () => {
    const attese: Record<string, string> = {
      DA_TRASMETTERE: 'Da trasmettere',
      IN_INVIO: 'In invio',
      ATTESA_ESITO: "In attesa dell'esito",
      TRASMESSA: 'Trasmessa',
      RIFIUTATA: 'Rifiutata',
      NON_TRASMISSIBILE: 'Non trasmissibile',
      INCERTA: 'Esito incerto',
      GIA_SU_RENTRI: 'Già su RENTRI',
    }
    for (const s of STATI_RENTRI) {
      riga(s)
      expect(q('rentri-stato-m1')!.textContent).withContext(s).toContain(attese[s])
      fixture.destroy()
    }
    riga(null)
    expect(q('rentri-stato-m1')!.textContent).toContain('Non trasmessa')
  })

  it('"in attesa dell\'esito" e "incerto" non si presentano come confermate', () => {
    riga('ATTESA_ESITO')
    expect(q('rentri-stato-m1')!.textContent).not.toContain('Trasmessa')
    expect(q('rentri-stato-m1')!.textContent).not.toContain('onfermata')
    fixture.destroy()
    riga('INCERTA')
    expect(document.body.textContent).toContain('verificare')
    expect(q('rentri-verifica-m1')).not.toBeNull()
  })

  it('il tooltip accessibile riporta il motivo', () => {
    riga('RIFIUTATA', 'Codice CER non ammesso')
    expect(q('rentri-motivo-m1')!.textContent).toContain('Codice CER non ammesso')
  })

  it('azioni per stato', () => {
    riga('DA_TRASMETTERE')
    expect(q('rentri-togli-m1')).not.toBeNull()
    expect(q('rentri-verifica-m1')).toBeNull()
    expect(q('rentri-riprova-m1')).toBeNull()
    fixture.destroy()
    riga('RIFIUTATA')
    expect(q('rentri-riprova-m1')).not.toBeNull()
    fixture.destroy()
    riga('NON_TRASMISSIBILE')
    expect(q('rentri-riprova-m1')).not.toBeNull()
    fixture.destroy()
    riga('ATTESA_ESITO')
    expect(q('rentri-verifica-m1')).not.toBeNull()
    fixture.destroy()
    riga('TRASMESSA')
    expect(q('rentri-verifica-m1')).toBeNull()
    expect(q('rentri-togli-m1')).toBeNull()
  })

  it('senza puoTrasmettere nessuna azione', () => {
    riga('INCERTA', null, false)
    expect(q('rentri-verifica-m1')).toBeNull()
  })

  it('Togli dalla coda: 409 mostrato verbatim', () => {
    const msg = "È stata accodata dall'invio automatico: non si toglie a mano."
    servizio.togliDallaCoda.and.returnValue(
      throwError(() => ({ status: 409, error: { message: msg } }))
    )
    riga('DA_TRASMETTERE')
    clic('rentri-togli-m1')
    expect(toast.error).toHaveBeenCalledWith(msg)
  })

  it('Togli dalla coda riuscito: notifica la pagina', () => {
    servizio.togliDallaCoda.and.returnValue(of(undefined))
    riga('DA_TRASMETTERE')
    let cambiato = 0
    fixture.componentInstance.cambiato.subscribe(() => cambiato++)
    clic('rentri-togli-m1')
    expect(cambiato).toBe(1)
  })

  it('Verifica: mostra il messaggio del backend', () => {
    servizio.verifica.and.returnValue(
      of({ esito: 'TRASMESSA', stato: 'TRASMESSA', messaggio: 'RENTRI conferma la registrazione.' })
    )
    riga('INCERTA')
    clic('rentri-verifica-m1')
    expect(toast.info).toHaveBeenCalledWith('RENTRI conferma la registrazione.')
  })

  it('Trasmetti di nuovo: chiede conferma prima di inviare', () => {
    servizio.trasmetti.and.returnValue(of({ accodate: 1, saltate: [], avvio: 'AVVIATO' }))
    riga('RIFIUTATA')
    clic('rentri-riprova-m1')
    fixture.detectChanges()
    expect(servizio.trasmetti).not.toHaveBeenCalled()
    expect(q('rentri-riprova-conferma-m1')!.textContent).toContain('2026/12')
    clic('rentri-riprova-si-m1')
    expect(servizio.trasmetti).toHaveBeenCalledWith('r1', ['m1'])
  })
})
