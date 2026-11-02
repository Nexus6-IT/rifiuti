import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { MESSAGGIO_CONCORRENTE } from './errori-azione'
import { EsitoImpostazione } from './listino.model'
import { ListinoService } from './listino.service'
import { ProvvigioniScontiDialogComponent } from './provvigioni-sconti-dialog.component'

describe('ProvvigioniScontiDialogComponent', () => {
  let fixture: ComponentFixture<ProvvigioniScontiDialogComponent>
  let provvigioni: jasmine.Spy
  let sconti: jasmine.Spy
  let eventi: string[]

  async function apri() {
    fixture = TestBed.createComponent(ProvvigioniScontiDialogComponent)
    eventi = []
    fixture.componentInstance.applicata.subscribe(() => eventi.push('applicata'))
    fixture.componentInstance.ricarica.subscribe(() => eventi.push('ricarica'))
    fixture.componentInstance.visibleChange.subscribe(v => eventi.push(`visibile:${v}`))
    fixture.componentRef.setInput('contrattoId', 'cc1')
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }
  const tipoSconto = async () => {
    q<HTMLInputElement>('ps-azione-sconto')!.click()
    await stabilizza(fixture)
  }
  const avanti = async () => {
    bottone('ps-avanti')!.click()
    await stabilizza(fixture)
  }
  const applica = async () => {
    bottone('ps-applica')!.click()
    await stabilizza(fixture)
  }

  beforeEach(() => {
    provvigioni = jasmine
      .createSpy('provvigioni')
      .and.returnValue(of({ aggiornate: 5, speciali: 2, escluse: 1 }))
    sconti = jasmine
      .createSpy('sconti')
      .and.returnValue(of({ aggiornate: 3, speciali: 0, escluse: 0 }))
    TestBed.configureTestingModule({
      imports: [ProvvigioniScontiDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { azioni: { provvigioni, sconti } } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('l’avviso sulle righe a prezzo speciale c’è subito', async () => {
    await apri()
    expect(q('ps-avviso')!.textContent).toContain('prezzo speciale')
  })

  it('provvigione: virgola → punto, tipo scelto, conferma prima di scrivere', async () => {
    await apri()
    scrivi('ps-provvigione', '2,5')
    await stabilizza(fixture)
    await avanti()
    expect(q('ps-conferma')!.textContent).toContain('2,5')
    expect(provvigioni).not.toHaveBeenCalled()
    await applica()
    expect(provvigioni).toHaveBeenCalledOnceWith('cc1', {
      provvigione: '2.5',
      tipoProvvigione: 'SCONTATO',
    })
    expect(eventi).toContain('applicata')
  })

  it('esito coi conteggi, le speciali da sistemare a mano', async () => {
    await apri()
    scrivi('ps-provvigione', '3')
    await stabilizza(fixture)
    await avanti()
    await applica()
    expect(q('ps-esito')!.textContent).toContain('Righe aggiornate: 5')
    expect(q('ps-esito-speciali')!.textContent).toContain('2')
    expect(q('ps-esito-speciali')!.textContent).toContain('a mano')
    expect(q('ps-esito-escluse')!.textContent).toContain('1')
  })

  it('provvigione col punto: errore sul campo e "Avanti" spento', async () => {
    await apri()
    scrivi('ps-provvigione', '2.5')
    await stabilizza(fixture)
    expect(q('ps-errore-provvigione')!.textContent).toContain('Usa la virgola per i decimali')
    expect(bottone('ps-avanti')!.disabled).toBeTrue()
  })

  it('provvigione vuota: svuota provvigione e tipo (R45) e lo dice', async () => {
    await apri()
    expect(q('ps-svuota')).not.toBeNull()
    await avanti()
    expect(q('ps-conferma')!.textContent).toContain('svuotati')
    await applica()
    expect(provvigioni).toHaveBeenCalledOnceWith('cc1', {
      provvigione: null,
      tipoProvvigione: null,
    })
  })

  it('sconto: cascata con la virgola normalizzata, attuale e nuovo', async () => {
    await apri()
    await tipoSconto()
    scrivi('ps-sconto-attuale', '10+5,5')
    scrivi('ps-sconto-nuovo', '12')
    await stabilizza(fixture)
    await avanti()
    await applica()
    expect(sconti).toHaveBeenCalledOnceWith('cc1', { scontoAttuale: '10+5.5', scontoNuovo: '12' })
    expect(q('ps-esito')!.textContent).toContain('Righe aggiornate: 3')
  })

  it('sconto: punto vietato in entrambi i campi, vuoti non si salvano', async () => {
    await apri()
    await tipoSconto()
    expect(bottone('ps-avanti')!.disabled).toBeTrue()
    scrivi('ps-sconto-attuale', '10.5')
    scrivi('ps-sconto-nuovo', '1.2')
    await stabilizza(fixture)
    expect(q('ps-errore-attuale')!.textContent).toContain('Usa la virgola')
    expect(q('ps-errore-nuovo')!.textContent).toContain('Usa la virgola')
    expect(bottone('ps-avanti')!.disabled).toBeTrue()
  })

  it('409 con "Ricarica"; 400 con gli errori strutturati', async () => {
    provvigioni.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'Contratto annullato.' } }))
    )
    await apri()
    scrivi('ps-provvigione', '3')
    await stabilizza(fixture)
    await avanti()
    await applica()
    expect(q('ps-errore')!.textContent).toContain('Contratto annullato.')
    bottone('ps-ricarica')!.click()
    expect(eventi).toContain('ricarica')
    provvigioni.and.returnValue(
      throwError(() => ({
        status: 400,
        error: { errori: [{ campo: 'provvigione', messaggio: 'Formula errata.' }] },
      }))
    )
    await avanti()
    await applica()
    expect(q('ps-errore-provvigione-backend')!.textContent).toContain('Formula errata.')
    expect(q('ps-ricarica')).toBeNull()
  })

  it('durante l’invio né Esc né Annulla chiudono', async () => {
    const lenta = new Subject<EsitoImpostazione>()
    provvigioni.and.returnValue(lenta)
    await apri()
    scrivi('ps-provvigione', '3')
    await stabilizza(fixture)
    await avanti()
    await applica()
    expect(bottone('ps-chiudi')!.disabled).toBeTrue()
    fixture.componentInstance.chiudi()
    fixture.componentInstance.applica()
    expect(eventi.filter(e => e.startsWith('visibile'))).toEqual([])
    expect(provvigioni).toHaveBeenCalledTimes(1)
  })

  it('400 su scontoNuovo: l’errore sta sotto quel campo e sparisce modificandolo', async () => {
    sconti.and.returnValue(
      throwError(() => ({
        status: 400,
        error: {
          errori: [{ campo: 'scontoNuovo', messaggio: 'Specificare entrambi gli sconti.' }],
        },
      }))
    )
    await apri()
    await tipoSconto()
    scrivi('ps-sconto-attuale', '10')
    scrivi('ps-sconto-nuovo', '12')
    await stabilizza(fixture)
    await avanti()
    await applica()
    expect(q('ps-errore-nuovo-backend')!.textContent).toContain('Specificare entrambi gli sconti.')
    expect(q('ps-errore')).toBeNull()
    scrivi('ps-sconto-nuovo', '11')
    await stabilizza(fixture)
    expect(q('ps-errore-nuovo-backend')).toBeNull()
  })

  it('il testo "Specificare entrambi gli sconti." anche senza campo va sotto lo sconto nuovo', async () => {
    sconti.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Specificare entrambi gli sconti.' } }))
    )
    await apri()
    await tipoSconto()
    scrivi('ps-sconto-attuale', '10')
    scrivi('ps-sconto-nuovo', '12')
    await stabilizza(fixture)
    await avanti()
    await applica()
    expect(q('ps-errore-nuovo-backend')).not.toBeNull()
  })

  describe('409, focus e campi (M1, M3, M11)', () => {
    const conErrore = async (err: object) => {
      provvigioni.and.returnValue(throwError(() => err))
      await apri()
      scrivi('ps-provvigione', '3')
      await stabilizza(fixture)
      await avanti()
      await applica()
    }

    it('409 di dato scritto: messaggio, niente "Ricarica"', async () => {
      await conErrore({
        status: 409,
        error: { error: 'DETRAZIONE_GIA_PRESENTE', message: 'Detrazione già presente.' },
      })
      expect(q('ps-errore')!.textContent).toContain('Detrazione già presente.')
      expect(q('ps-ricarica')).toBeNull()
    })

    it('operazione concorrente: testo unico, niente "Ricarica"', async () => {
      await conErrore({
        status: 409,
        error: { error: 'OPERAZIONE_CONCORRENTE', message: 'altro testo' },
      })
      expect(q('ps-errore')!.textContent).toContain(MESSAGGIO_CONCORRENTE)
      expect(q('ps-ricarica')).toBeNull()
    })

    it('al passo di conferma il focus va al riepilogo', async () => {
      await apri()
      scrivi('ps-provvigione', '3')
      await stabilizza(fixture)
      await avanti()
      await new Promise(r => setTimeout(r))
      expect(document.activeElement).toBe(q('ps-conferma'))
    })

    it('il campo con l’errore è legato al suo messaggio (aria-describedby)', async () => {
      await apri()
      scrivi('ps-provvigione', '3.5')
      await stabilizza(fixture)
      const campo = q('ps-provvigione')!
      expect(campo.getAttribute('aria-invalid')).toBe('true')
      expect(campo.getAttribute('aria-describedby')).toBe('ps-errore-provvigione')
      expect(document.getElementById('ps-errore-provvigione')).not.toBeNull()
    })
  })
})
