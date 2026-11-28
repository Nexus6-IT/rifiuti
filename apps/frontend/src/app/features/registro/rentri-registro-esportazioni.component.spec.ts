import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { RentriRegistroEsportazioniComponent } from './rentri-registro-esportazioni.component'
import {
  ElencoEsportazioni,
  EsitoGenerazione,
  EsportazioneRegistro,
  RentriEsportazioniService,
} from './rentri-esportazioni.service'
import { ToastService } from '../../core/services/toast.service'

function esp(p: Partial<EsportazioneRegistro> = {}): EsportazioneRegistro {
  return {
    id: 'e1',
    anno: 2026,
    progressivoDa: 1,
    progressivoA: 3,
    numeroRegistrazioni: 3,
    dataCreazione: '2026-04-02T08:00:00.000Z',
    stato: 'VALIDATA',
    firmato: true,
    digestAbbreviato: 'AbCdEf123456',
    precedenteId: null,
    messaggi: [],
    creataDa: 'u1',
    ...p,
  }
}
const elenco = (
  esportazioni: EsportazioneRegistro[],
  automaticaAttiva = false
): ElencoEsportazioni => ({ esportazioni, automaticaAttiva })

const q = <T extends HTMLElement = HTMLElement>(testid: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${testid}"]`)
const clic = (testid: string) => q(testid)!.querySelector('button')!.click()

describe('RentriRegistroEsportazioniComponent (eREGI E7)', () => {
  let servizio: jasmine.SpyObj<RentriEsportazioniService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RentriRegistroEsportazioniComponent>

  function monta(
    lista: ElencoEsportazioni,
    permessi: { puoGenerare?: boolean; puoSostituire?: boolean } = {}
  ): void {
    servizio.elenco.and.returnValue(of(lista))
    fixture = TestBed.createComponent(RentriRegistroEsportazioniComponent)
    fixture.componentRef.setInput('registroId', 'r1')
    fixture.componentRef.setInput('puoGenerare', permessi.puoGenerare ?? true)
    fixture.componentRef.setInput('puoSostituire', permessi.puoSostituire ?? false)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RentriEsportazioniService>('RentriEsportazioniService', [
      'elenco',
      'genera',
      'rivalida',
      'sostituisci',
      'scarica',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [RentriRegistroEsportazioniComponent],
      providers: [
        provideNoopAnimations(),
        { provide: RentriEsportazioniService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  describe('elenco', () => {
    it('legge le esportazioni del registro e mostra intervallo, stato e digest', () => {
      monta(elenco([esp()]))
      expect(servizio.elenco).toHaveBeenCalledOnceWith('r1')
      const riga = q('rentri-esp-riga-e1')!
      expect(riga.textContent).toContain('2026')
      expect(riga.textContent).toContain('1')
      expect(riga.textContent).toContain('3')
      expect(riga.textContent).toContain('AbCdEf123456')
      expect(q('rentri-esp-stato-e1')!.textContent).toContain('Validata')
    })

    it('senza esportazioni: lo dice, e non scrive «valida»', () => {
      monta(elenco([]))
      expect(q('rentri-esp-vuoto')!.textContent).toContain('Nessuna esportazione')
    })

    it('errore di lettura: messaggio del backend, nessun elenco', () => {
      servizio.elenco.and.returnValue(
        throwError(() => ({ error: { message: 'Il registro non esiste.' } }))
      )
      fixture = TestBed.createComponent(RentriRegistroEsportazioniComponent)
      fixture.componentRef.setInput('registroId', 'r1')
      fixture.detectChanges()
      expect(q('rentri-esp-errore')!.textContent).toContain('Il registro non esiste.')
      expect(q('rentri-esp-riga-e1')).toBeNull()
    })

    it('cambiando registro rilegge l elenco', () => {
      monta(elenco([esp()]))
      servizio.elenco.and.returnValue(of(elenco([esp({ id: 'e9' })])))
      fixture.componentRef.setInput('registroId', 'r2')
      fixture.detectChanges()
      expect(servizio.elenco).toHaveBeenCalledWith('r2')
      expect(q('rentri-esp-riga-e9')).not.toBeNull()
      expect(q('rentri-esp-riga-e1')).toBeNull()
    })

    it('stati: una esportazione GENERATA o in validazione non si presenta come valida', () => {
      monta(
        elenco([
          esp({ id: 'a', stato: 'GENERATA' }),
          esp({ id: 'b', stato: 'IN_VALIDAZIONE' }),
          esp({ id: 'c', stato: 'VALIDAZIONE_NON_DISPONIBILE' }),
        ])
      )
      for (const id of ['a', 'b', 'c']) {
        expect(q('rentri-esp-stato-' + id)!.textContent).not.toMatch(/^\s*Validata\s*$/)
      }
      expect(q('rentri-esp-stato-b')!.textContent).toContain('In validazione')
      expect(q('rentri-esp-stato-c')!.textContent).toContain('non disponibile')
    })

    it('rifiutata e avvisi: mostra i messaggi di RENTRI (codice, tipo, campo)', () => {
      monta(
        elenco([
          esp({
            id: 'r',
            stato: 'RIFIUTATA',
            messaggi: [{ codice: 'E123', tipo: 'Errore', campo: 'Registrazioni/Q' }],
          }),
          esp({
            id: 'v',
            stato: 'VALIDATA_CON_AVVISI',
            messaggi: [{ codice: 'W9', tipo: 'Avvertimento', campo: null }],
          }),
        ])
      )
      expect(q('rentri-esp-messaggi-r')!.textContent).toContain('E123')
      expect(q('rentri-esp-messaggi-r')!.textContent).toContain('Registrazioni/Q')
      expect(q('rentri-esp-messaggi-v')!.textContent).toContain('W9')
      expect(q('rentri-esp-stato-r')!.textContent).toContain('Rifiutata')
    })

    it('le sostituite restano visibili come tali e non hanno azioni oltre allo scarico', () => {
      monta(elenco([esp({ id: 's', stato: 'SOSTITUITA' })]), {
        puoGenerare: true,
        puoSostituire: true,
      })
      expect(q('rentri-esp-stato-s')!.textContent).toContain('Sostituita')
      expect(q('rentri-esp-rivalida-s')).toBeNull()
      expect(q('rentri-esp-sostituisci-s')).toBeNull()
      expect(q('rentri-esp-scarica-s')).not.toBeNull()
    })
  })

  describe('generazione automatica', () => {
    it('spenta: dice di generare a mano', () => {
      monta(elenco([], false))
      expect(q('rentri-esp-automatica')!.textContent).toContain('non è attiva')
    })
    it('accesa: lo dice', () => {
      monta(elenco([], true))
      expect(q('rentri-esp-automatica')!.textContent).toContain('attiva')
      expect(q('rentri-esp-automatica')!.textContent).not.toContain('non è attiva')
    })
  })

  describe('Genera esportazione', () => {
    it('visibile solo a chi può trasmettere', () => {
      monta(elenco([]), { puoGenerare: false })
      expect(q('rentri-esp-genera')).toBeNull()
    })

    it('creata: avvisa quante registrazioni, rilegge l elenco', () => {
      monta(elenco([]))
      servizio.genera.and.returnValue(
        of({
          esito: 'CREATA',
          esportazione: {
            id: 'e2',
            anno: 2026,
            progressivoDa: 1,
            progressivoA: 3,
            numeroRegistrazioni: 3,
          },
          fermataA: null,
        })
      )
      servizio.elenco.calls.reset()
      servizio.elenco.and.returnValue(of(elenco([esp({ id: 'e2' })])))
      clic('rentri-esp-genera')
      fixture.detectChanges()
      expect(servizio.genera).toHaveBeenCalledOnceWith('r1')
      expect(toast.success).toHaveBeenCalled()
      expect(toast.success.calls.mostRecent().args[0]).toContain('3')
      expect(servizio.elenco).toHaveBeenCalledTimes(1)
      expect(q('rentri-esp-riga-e2')).not.toBeNull()
    })

    it('creata ma ferma a un numero: avviso con il motivo', () => {
      monta(elenco([]))
      servizio.genera.and.returnValue(
        of({
          esito: 'CREATA',
          esportazione: {
            id: 'e2',
            anno: 2026,
            progressivoDa: 1,
            progressivoA: 3,
            numeroRegistrazioni: 3,
          },
          fermataA: { anno: 2026, progressivo: 4, motivi: ['Dato mancante: codice CER'] },
        })
      )
      clic('rentri-esp-genera')
      expect(toast.warn).toHaveBeenCalled()
      expect(toast.warn.calls.mostRecent().args[0]).toContain('4')
      expect(toast.warn.calls.mostRecent().args[0]).toContain('Dato mancante: codice CER')
    })

    it('niente da esportare: avviso informativo, non un errore', () => {
      monta(elenco([esp()]))
      servizio.genera.and.returnValue(of({ esito: 'NIENTE_DA_ESPORTARE', esportazione: null }))
      clic('rentri-esp-genera')
      expect(toast.info).toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('bloccata a un numero: dice dove e perché', () => {
      monta(elenco([]))
      servizio.genera.and.returnValue(
        of({ esito: 'BLOCCATA', anno: 2026, progressivo: 7, motivi: ['Manca la causale'] })
      )
      clic('rentri-esp-genera')
      expect(toast.warn.calls.mostRecent().args[0]).toContain('7')
      expect(toast.warn.calls.mostRecent().args[0]).toContain('Manca la causale')
    })

    it('errore del backend (es. certificato mancante): messaggio verbatim', () => {
      monta(elenco([]))
      servizio.genera.and.returnValue(
        throwError(() => ({ error: { message: 'Manca il certificato RENTRI dell’azienda.' } }))
      )
      clic('rentri-esp-genera')
      expect(toast.error).toHaveBeenCalledWith('Manca il certificato RENTRI dell’azienda.')
    })

    it('mentre lavora il pulsante e spento (nessun doppio invio)', () => {
      monta(elenco([]))
      const risposta = new Subject<EsitoGenerazione>()
      servizio.genera.and.returnValue(risposta)
      clic('rentri-esp-genera')
      fixture.detectChanges()
      expect(q('rentri-esp-genera')!.querySelector('button')!.disabled).toBeTrue()
      risposta.next({ esito: 'NIENTE_DA_ESPORTARE', esportazione: null })
      risposta.complete()
      fixture.detectChanges()
      expect(q('rentri-esp-genera')!.querySelector('button')!.disabled).toBeFalse()
    })
  })

  describe('Scarica XML', () => {
    it('scarica il file firmato e lo salva col nome del backend', () => {
      monta(elenco([esp()]))
      const blob = new Blob(['<reg:Registro/>'])
      servizio.scarica.and.returnValue(of({ blob, nomeFile: 'REN_x.SignedR.xml' }))
      const salva = spyOn(fixture.componentInstance as any, 'salva')
      clic('rentri-esp-scarica-e1')
      expect(servizio.scarica).toHaveBeenCalledOnceWith('e1')
      expect(salva).toHaveBeenCalledWith(blob, 'REN_x.SignedR.xml')
    })

    it('senza nome dal backend usa un nome di ripiego', () => {
      monta(elenco([esp()]))
      servizio.scarica.and.returnValue(of({ blob: new Blob(['x']), nomeFile: null }))
      const salva = spyOn(fixture.componentInstance as any, 'salva')
      clic('rentri-esp-scarica-e1')
      expect((salva.calls.mostRecent().args[1] as string).endsWith('.xml')).toBeTrue()
    })

    it('errore: toast, nessun file', () => {
      monta(elenco([esp()]))
      servizio.scarica.and.returnValue(throwError(() => ({ status: 404 })))
      const salva = spyOn(fixture.componentInstance as any, 'salva')
      clic('rentri-esp-scarica-e1')
      expect(toast.error).toHaveBeenCalled()
      expect(salva).not.toHaveBeenCalled()
    })
  })

  describe('Riprova la validazione', () => {
    it('solo per GENERATA, IN_VALIDAZIONE e VALIDAZIONE_NON_DISPONIBILE, e solo a chi può trasmettere', () => {
      monta(
        elenco([
          esp({ id: 'a', stato: 'GENERATA' }),
          esp({ id: 'b', stato: 'IN_VALIDAZIONE' }),
          esp({ id: 'c', stato: 'VALIDAZIONE_NON_DISPONIBILE' }),
          esp({ id: 'd', stato: 'VALIDATA' }),
          esp({ id: 'e', stato: 'RIFIUTATA' }),
        ])
      )
      for (const id of ['a', 'b', 'c']) expect(q('rentri-esp-rivalida-' + id)).not.toBeNull()
      for (const id of ['d', 'e']) expect(q('rentri-esp-rivalida-' + id)).toBeNull()
      fixture.destroy()
      monta(elenco([esp({ id: 'a', stato: 'GENERATA' })]), { puoGenerare: false })
      expect(q('rentri-esp-rivalida-a')).toBeNull()
    })

    it('chiama il backend, avvisa dell esito e rilegge', () => {
      monta(elenco([esp({ id: 'a', stato: 'IN_VALIDAZIONE' })]))
      servizio.rivalida.and.returnValue(of({ id: 'a', stato: 'VALIDATA', messaggi: [] }))
      servizio.elenco.calls.reset()
      clic('rentri-esp-rivalida-a')
      expect(servizio.rivalida).toHaveBeenCalledOnceWith('a')
      expect(toast.success).toHaveBeenCalled()
      expect(servizio.elenco).toHaveBeenCalledTimes(1)
    })

    it('ancora in validazione o rifiutata: non annuncia un successo', () => {
      monta(elenco([esp({ id: 'a', stato: 'IN_VALIDAZIONE' })]))
      servizio.rivalida.and.returnValue(of({ id: 'a', stato: 'IN_VALIDAZIONE', messaggi: [] }))
      clic('rentri-esp-rivalida-a')
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalled()
      servizio.rivalida.and.returnValue(of({ id: 'a', stato: 'RIFIUTATA', messaggi: [] }))
      clic('rentri-esp-rivalida-a')
      expect(toast.warn).toHaveBeenCalled()
    })
  })

  describe('Sostituisci da qui', () => {
    it('solo per una rifiutata e solo per l amministratore', () => {
      monta(elenco([esp({ id: 'r', stato: 'RIFIUTATA' }), esp({ id: 'v' })]), {
        puoGenerare: true,
        puoSostituire: true,
      })
      expect(q('rentri-esp-sostituisci-r')).not.toBeNull()
      expect(q('rentri-esp-sostituisci-v')).toBeNull()
      fixture.destroy()
      monta(elenco([esp({ id: 'r', stato: 'RIFIUTATA' })]), {
        puoGenerare: true,
        puoSostituire: false,
      })
      expect(q('rentri-esp-sostituisci-r')).toBeNull()
    })

    it('chiede conferma prima di agire; «No» non chiama il backend', () => {
      monta(elenco([esp({ id: 'r', stato: 'RIFIUTATA' })]), { puoSostituire: true })
      clic('rentri-esp-sostituisci-r')
      fixture.detectChanges()
      expect(servizio.sostituisci).not.toHaveBeenCalled()
      expect(q('rentri-esp-sostituisci-conferma-r')).not.toBeNull()
      clic('rentri-esp-sostituisci-no-r')
      fixture.detectChanges()
      expect(servizio.sostituisci).not.toHaveBeenCalled()
      expect(q('rentri-esp-sostituisci-conferma-r')).toBeNull()
    })

    it('conferma: sostituisce, dice quante e rilegge', () => {
      monta(elenco([esp({ id: 'r', stato: 'RIFIUTATA' })]), { puoSostituire: true })
      servizio.sostituisci.and.returnValue(of({ sostituite: 2, ultimaValidaId: null }))
      servizio.elenco.calls.reset()
      clic('rentri-esp-sostituisci-r')
      fixture.detectChanges()
      clic('rentri-esp-sostituisci-si-r')
      expect(servizio.sostituisci).toHaveBeenCalledOnceWith('r')
      expect(toast.success.calls.mostRecent().args[0]).toContain('2')
      expect(servizio.elenco).toHaveBeenCalledTimes(1)
    })

    it('409 del backend: messaggio verbatim, la conferma si chiude', () => {
      monta(elenco([esp({ id: 'r', stato: 'RIFIUTATA' })]), { puoSostituire: true })
      servizio.sostituisci.and.returnValue(
        throwError(() => ({
          error: { message: 'Si può sostituire solo una esportazione rifiutata.' },
        }))
      )
      clic('rentri-esp-sostituisci-r')
      fixture.detectChanges()
      clic('rentri-esp-sostituisci-si-r')
      fixture.detectChanges()
      expect(toast.error).toHaveBeenCalledWith('Si può sostituire solo una esportazione rifiutata.')
      expect(q('rentri-esp-sostituisci-conferma-r')).toBeNull()
    })
  })
})
