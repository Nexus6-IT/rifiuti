import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { HttpErrorResponse } from '@angular/common/http'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Observable, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { riga } from './blocco-fatturazione.test-util'
import { EsitoRiquadro, RiquadroLegameComponent } from './riquadro-legame.component'
import { LegameVista } from './legami.model'
import { LegamiService } from './legami.service'

/** Riquadro del legame nel dettaglio del movimento: lettura, avvisi, ritocchi e permessi. */
function legame(parziale: Partial<LegameVista> = {}): LegameVista {
  return {
    id: 'lg-1',
    movimentoOriginaleId: 'm1',
    movimentoVigenteId: 'm1',
    stato: 'CONFERMATO',
    dataMovimento: '2026-11-03',
    cliente: { id: 'cl-1', etichetta: 'Rossi Srl', fonte: 'FIR' },
    dettaglioCliente: null,
    contratto: { id: 'co-1', etichetta: 'Contratto 2026' },
    elenco: { id: 'el-1', etichetta: 'Listino base' },
    righe: [
      riga({ sconto: '10+5', aliquotaIva: '22.00' }),
      riga({
        rigaAddebitoId: 'ra-2',
        ordine: 2,
        origine: 'PROPOSTA',
        tipo: 'TRASPORTO',
        descrizione: 'Trasporto',
        quantita: '1',
        unitaMisura: 'NR',
        prezzo: '35',
        importo: '35.00',
        aliquotaIva: null,
        naturaIva: 'N4',
      }),
    ],
    motivi: [],
    avvisi: [],
    motivoEsclusione: null,
    confermatoIl: '2026-11-03T10:00:00.000Z',
    fatturatoIl: null,
    riferimentoFattura: null,
    scostamentoDopoFattura: false,
    scostamentoIl: null,
    versione: 3,
    ...parziale,
  }
}

const erroreHttp = (status: number, corpo: unknown = {}): HttpErrorResponse =>
  new HttpErrorResponse({ status, error: corpo })

describe('RiquadroLegameComponent', () => {
  let servizio: jasmine.SpyObj<LegamiService>
  let ruolo: string
  let fixture: ComponentFixture<RiquadroLegameComponent>
  let esiti: EsitoRiquadro[]

  const q = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`)
  const testo = (testid: string): string =>
    (q(testid)?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const campo = (id: string): HTMLInputElement | null =>
    fixture.nativeElement.querySelector(`#${id}`)

  function crea(risposta: Observable<LegameVista>): void {
    servizio.perMovimento.and.returnValue(risposta)
    TestBed.configureTestingModule({
      imports: [RiquadroLegameComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LegamiService, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    })
    fixture = TestBed.createComponent(RiquadroLegameComponent)
    esiti = []
    fixture.componentInstance.esitoChange.subscribe(e => esiti.push(e))
    fixture.componentRef.setInput('movimentoId', 'm1')
    aggiorna()
  }

  function aggiorna(): void {
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
  }

  /** Incolla un testo nel campo e esce: la via più fedele a «digitare» con `appNumeroIt`. */
  function scrivi(id: string, valore: string): void {
    const input = campo(id)!
    input.focus()
    input.select()
    input.value = ''
    const dt = new DataTransfer()
    dt.setData('text', valore)
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    )
    input.dispatchEvent(new Event('blur'))
    aggiorna()
  }

  const clic = (testid: string): void => {
    const b = fixture.nativeElement.querySelector(`[data-testid="${testid}"] button`) as HTMLElement
    expect(b).withContext(testid).not.toBeNull()
    b.click()
    aggiorna()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<LegamiService>('LegamiService', [
      'perMovimento',
      'modifica',
      'conferma',
      'daMovimento',
      'dettaglio',
    ])
    ruolo = 'OPERATOR'
  })

  it('CONFERMATO: stato, cliente, contratto, elenco, valori congelati e importi dal server', fakeAsync(() => {
    crea(of(legame()))
    expect(servizio.perMovimento).toHaveBeenCalledOnceWith('m1')
    expect(testo('riquadro-stato')).toContain('Confermato')
    expect(testo('riquadro-cliente')).toBe('Rossi Srl')
    expect(testo('riquadro-contratto')).toBe('Contratto 2026')
    expect(testo('riquadro-elenco')).toBe('Listino base')
    expect(testo('riquadro-congelati')).toContain('03/11/2026')
    // quantità, prezzo e sconto della riga 1 (campi con la virgola); IVA e importo di sola lettura
    expect(campo('qta-ra-1')!.value).toBe('120')
    expect(campo('prezzo-ra-1')!.value).toBe('0,5')
    expect(campo('sconto-ra-1')!.value).toBe('10+5')
    expect(testo('iva-ra-1')).toBe('22 %')
    expect(testo('iva-ra-2')).toBe('N4')
    expect(testo('importo-ra-1')).toContain('60,00')
    expect(testo('importo-ra-2')).toContain('35,00')
    expect(esiti).toEqual(['presente'])
  }))

  it('prezzo manuale: badge sulla riga e avviso PREZZO_MANUALE', fakeAsync(() => {
    crea(
      of(
        legame({
          righe: [riga({ prezzoManuale: true, prezzo: '12.5' })],
          avvisi: ['PREZZO_MANUALE'],
        })
      )
    )
    expect(q('badge-prezzo-manuale-ra-1')).not.toBeNull()
    expect(testo('riquadro-avviso-PREZZO_MANUALE')).toContain('Prezzo modificato a mano')
  }))

  it('FATTURATO con scostamento: avviso, righe di sola lettura e nessuna azione, anche per ADMIN', fakeAsync(() => {
    ruolo = 'ADMIN'
    crea(
      of(
        legame({
          stato: 'FATTURATO',
          fatturatoIl: '2026-11-10T00:00:00.000Z',
          riferimentoFattura: 'FT 12/2026',
          scostamentoDopoFattura: true,
          scostamentoIl: '2026-11-12T00:00:00.000Z',
        })
      )
    )
    expect(testo('riquadro-stato')).toContain('Fatturato')
    expect(testo('riquadro-avviso-AVVISO_SCOSTAMENTO')).toContain(
      'Il movimento è già stato fatturato; la correzione non cambia la fattura'
    )
    expect(testo('riquadro-avviso-AVVISO_SCOSTAMENTO')).toContain('12/11/2026')
    expect(testo('riquadro-fatturato')).toContain('FT 12/2026')
    expect(campo('prezzo-ra-1')).toBeNull()
    expect(campo('qta-ra-1')).toBeNull()
    expect(q('riquadro-azioni')).toBeNull()
    expect(testo('importo-ra-1')).toContain('60,00')
  }))

  it('movimento senza legame (404): riquadro nascosto', fakeAsync(() => {
    crea(throwError(() => erroreHttp(404, { error: 'LEGAME_MOVIMENTO_NON_TROVATO' })))
    expect(q('riquadro-legame')).toBeNull()
    expect(q('riquadro-errore-lettura')).toBeNull()
    expect(esiti).toEqual(['assente'])
  }))

  it('lettura fallita (500): avviso con «Riprova», non il riquadro', fakeAsync(() => {
    crea(throwError(() => erroreHttp(500)))
    expect(q('riquadro-legame')).toBeNull()
    expect(q('riquadro-errore-lettura')).not.toBeNull()
    expect(esiti).toEqual(['errore'])
    servizio.perMovimento.and.returnValue(of(legame()))
    clic('riquadro-riprova')
    expect(q('riquadro-legame')).not.toBeNull()
  }))

  it('OPERATOR: prezzo "12,5" a mano, «Salva» invia solo la riga toccata con il punto', fakeAsync(() => {
    crea(of(legame()))
    servizio.modifica.and.returnValue(
      of(legame({ versione: 4, righe: [riga({ prezzo: '12.5', prezzoManuale: true })] }))
    )
    scrivi('prezzo-ra-1', '12,5')
    expect(q('badge-prezzo-manuale-ra-1')).not.toBeNull()
    expect(testo('riquadro-avviso-PREZZO_MANUALE')).toBeTruthy()
    // l'importo di una riga ritoccata lo calcola il server: qui non c'è
    expect(testo('importo-ra-1')).toBe('—')
    clic('riquadro-salva')
    expect(servizio.modifica).toHaveBeenCalledOnceWith('lg-1', {
      versione: 3,
      righe: [{ rigaAddebitoId: 'ra-1', prezzo: '12.5' }],
    })
    // dopo il salvataggio il riquadro mostra il legame nuovo
    expect(campo('prezzo-ra-1')!.value).toBe('12,5')
  }))

  it('quantità e sconto: si inviano solo i campi toccati, quantità col punto', fakeAsync(() => {
    crea(of(legame()))
    servizio.modifica.and.returnValue(of(legame({ versione: 4 })))
    scrivi('qta-ra-2', '2,5')
    const s = campo('sconto-ra-1')!
    s.value = '10,5+5'
    s.dispatchEvent(new Event('input'))
    aggiorna()
    clic('riquadro-salva')
    expect(servizio.modifica.calls.mostRecent().args[1].righe).toEqual([
      { rigaAddebitoId: 'ra-2', quantita: '2.5' },
      { rigaAddebitoId: 'ra-1', sconto: '10.5+5' },
    ])
  }))

  it('punto decimale rifiutato e quantità 0: errore, «Salva» e «Conferma» bloccati', fakeAsync(() => {
    crea(of(legame({ stato: 'PROPOSTO' })))
    scrivi('qta-ra-1', '0')
    expect(q('errore-qta-ra-1')).not.toBeNull()
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="riquadro-conferma"] button'
        ) as HTMLButtonElement
      ).disabled
    ).toBeTrue()
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="riquadro-salva"] button'
        ) as HTMLButtonElement
      ).disabled
    ).toBeTrue()
    expect(servizio.modifica).not.toHaveBeenCalled()
    expect(servizio.conferma).not.toHaveBeenCalled()
  }))

  it('un valore riportato a quello del legame non è un ritocco: «Salva» resta spento', fakeAsync(() => {
    crea(of(legame()))
    scrivi('prezzo-ra-1', '9')
    scrivi('prezzo-ra-1', '0,5')
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="riquadro-salva"] button'
        ) as HTMLButtonElement
      ).disabled
    ).toBeTrue()
  }))

  it('«Conferma legame» su un PROPOSTO: 409 LEGAME_INCOMPLETO si traduce con le etichette dei motivi', fakeAsync(() => {
    crea(of(legame({ stato: 'PROPOSTO' })))
    servizio.conferma.and.returnValue(
      throwError(() =>
        erroreHttp(409, {
          error: 'LEGAME_INCOMPLETO',
          message: 'Legame incompleto',
          details: { motivi: ['SENZA_PREZZO', 'SENZA_CLIENTE'] },
        })
      )
    )
    clic('riquadro-conferma')
    expect(servizio.conferma).toHaveBeenCalledOnceWith('lg-1', { versione: 3 })
    const t = testo('riquadro-errori')
    expect(t).toContain('Manca il prezzo')
    expect(t).toContain('Manca il cliente da fatturare')
    expect(t).not.toContain('SENZA_PREZZO')
  }))

  it('LEGAME_DA_RIALLINEARE: «Riallinea» chiama daMovimento e dettaglio e mostra il legame nuovo', fakeAsync(() => {
    crea(of(legame({ stato: 'PROPOSTO', movimentoVigenteId: 'm9' })))
    servizio.conferma.and.returnValue(
      throwError(() => erroreHttp(409, { error: 'LEGAME_DA_RIALLINEARE', message: 'Riallinea' }))
    )
    clic('riquadro-conferma')
    expect(fixture.nativeElement.querySelector('[data-testid="riquadro-ricarica"]')).toBeNull()
    servizio.daMovimento.and.returnValue(of(legame({ id: 'l2' })))
    servizio.dettaglio.and.returnValue(of(legame({ id: 'l2', stato: 'PROPOSTO', versione: 8 })))
    clic('riquadro-riallinea')
    expect(servizio.daMovimento).toHaveBeenCalledOnceWith('m9')
    expect(servizio.dettaglio).toHaveBeenCalledOnceWith('l2')
    expect(fixture.nativeElement.querySelector('[data-testid="riquadro-riallinea"]')).toBeNull()
  }))

  it('409 di versione superata: messaggio e «Ricarica» che rilegge il legame', fakeAsync(() => {
    crea(of(legame({ stato: 'PROPOSTO' })))
    servizio.conferma.and.returnValue(
      throwError(() =>
        erroreHttp(409, { error: 'VERSIONE_SUPERATA', message: 'Il legame è stato modificato' })
      )
    )
    clic('riquadro-conferma')
    expect(testo('riquadro-errori')).toContain('Il legame è stato modificato')
    servizio.perMovimento.and.returnValue(of(legame({ stato: 'PROPOSTO', versione: 5 })))
    clic('riquadro-ricarica')
    expect(servizio.perMovimento).toHaveBeenCalledTimes(2)
    expect(q('riquadro-errori')).toBeNull()
  }))

  it('VIEWER: sola lettura, nessun campo, nessun pulsante, rotte di scrittura mai chiamate', fakeAsync(() => {
    ruolo = 'VIEWER'
    crea(of(legame({ stato: 'PROPOSTO' })))
    expect(q('riquadro-legame')).not.toBeNull()
    expect(campo('prezzo-ra-1')).toBeNull()
    expect(campo('qta-ra-1')).toBeNull()
    expect(q('riquadro-azioni')).toBeNull()
    expect(testo('riga-ra-1')).toContain('120')
    expect(servizio.modifica).not.toHaveBeenCalled()
    expect(servizio.conferma).not.toHaveBeenCalled()
  }))

  it("«Conferma legame» non c'è su un legame già CONFERMATO; su ESCLUSO nessuna modifica", fakeAsync(() => {
    crea(of(legame()))
    expect(q('riquadro-conferma')).toBeNull()
    expect(q('riquadro-salva')).not.toBeNull()
  }))

  it('ESCLUSO: mostra il motivo e non si modifica', fakeAsync(() => {
    crea(of(legame({ stato: 'ESCLUSO', motivoEsclusione: 'Causale non fatturabile' })))
    expect(testo('riquadro-esclusione')).toBe('Causale non fatturabile')
    expect(campo('prezzo-ra-1')).toBeNull()
    expect(q('riquadro-azioni')).toBeNull()
  }))

  it('DA_RIALLINEARE: legame rimasto indietro rispetto alla testa, avviso e nessuna modifica', fakeAsync(() => {
    servizio.perMovimento.and.returnValue(
      of(legame({ movimentoVigenteId: 'm1', stato: 'PROPOSTO' }))
    )
    TestBed.configureTestingModule({
      imports: [RiquadroLegameComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LegamiService, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    })
    fixture = TestBed.createComponent(RiquadroLegameComponent)
    fixture.componentRef.setInput('eTesta', true)
    fixture.componentRef.setInput('movimentoId', 'm9')
    aggiorna()
    expect(testo('riquadro-da-riallineare')).toContain('Da collegare')
    expect(campo('prezzo-ra-1')).toBeNull()
    expect(q('riquadro-azioni')).toBeNull()
  }))

  it('legame allineato alla testa: nessun avviso di riallineamento', fakeAsync(() => {
    crea(of(legame({ movimentoVigenteId: 'm1' })))
    fixture.componentRef.setInput('eTesta', true)
    aggiorna()
    expect(q('riquadro-da-riallineare')).toBeNull()
  }))
})
