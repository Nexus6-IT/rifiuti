import { signal } from '@angular/core'
import { Subject, of, throwError } from 'rxjs'
import { ConfirmationService } from 'primeng/api'
import { caricaElenco, chiediConferma, eseguiERicarica, messaggioErrore } from './tabella-comune'

describe('tabella-comune', () => {
  describe('chiediConferma', () => {
    it('di default parla di eliminazione; i testi si possono cambiare', () => {
      const conferma = jasmine.createSpyObj<ConfirmationService>('ConfirmationService', ['confirm'])
      chiediConferma(conferma, 'Eliminare?', () => undefined)
      expect(conferma.confirm).toHaveBeenCalledWith(
        jasmine.objectContaining({ header: 'Conferma eliminazione', acceptLabel: 'Elimina' })
      )
      // azione distruttiva: accetta in rosso, Annulla in testo e col focus iniziale
      expect(conferma.confirm.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({
          acceptButtonStyleClass: 'p-button-danger',
          rejectButtonStyleClass: 'p-button-text',
          defaultFocus: 'reject',
        })
      )
      chiediConferma(conferma, 'Disattivare?', () => undefined, {
        header: 'Conferma disattivazione',
        acceptLabel: 'Disattiva',
      })
      expect(conferma.confirm.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({ header: 'Conferma disattivazione', acceptLabel: 'Disattiva' })
      )
    })
  })

  describe('chiediConferma non distruttiva', () => {
    it('con pericolosa=false il bottone non e rosso ma il focus resta su Annulla', () => {
      const conferma = jasmine.createSpyObj<ConfirmationService>('ConfirmationService', ['confirm'])
      chiediConferma(conferma, 'Rinnovare?', () => undefined, { pericolosa: false })
      const o = conferma.confirm.calls.mostRecent().args[0]
      expect(o.acceptButtonStyleClass).toBeUndefined()
      expect(o.defaultFocus).toBe('reject')
    })
  })

  const errore409 = { error: { message: 'La riga è stata modificata da un altro utente.' } }

  describe('messaggioErrore', () => {
    it('stringa o array dal backend, altrimenti il ripiego', () => {
      expect(messaggioErrore({ error: { message: 'Uno' } }, 'r')).toBe('Uno')
      expect(messaggioErrore({ error: { message: ['Uno', 'Due'] } }, 'r')).toBe('Uno Due')
      expect(messaggioErrore({}, 'r')).toBe('r')
    })
  })

  describe('caricaElenco', () => {
    it('riuscita: righe impostate e errore azzerato', () => {
      const righe = signal<number[]>([])
      const errore = signal<string | null>('vecchio')
      caricaElenco(of([1, 2]), righe, errore, 'ripiego')
      expect(righe()).toEqual([1, 2])
      expect(errore()).toBeNull()
    })

    it('errore: messaggio del backend (stringa)', () => {
      const righe = signal<number[]>([9])
      const errore = signal<string | null>(null)
      caricaElenco(
        throwError(() => errore409),
        righe,
        errore,
        'ripiego'
      )
      expect(errore()).toBe('La riga è stata modificata da un altro utente.')
      expect(righe()).toEqual([9])
    })

    it('errore: messaggio del backend (array) o ripiego', () => {
      const errore = signal<string | null>(null)
      caricaElenco(
        throwError(() => ({ error: { message: ['A', 'B'] } })),
        signal<number[]>([]),
        errore,
        'ripiego'
      )
      expect(errore()).toBe('A B')
      caricaElenco(
        throwError(() => ({})),
        signal<number[]>([]),
        errore,
        'ripiego'
      )
      expect(errore()).toBe('ripiego')
    })
  })

  describe('eseguiERicarica', () => {
    it('riuscita: ricarica senza toast', () => {
      const toast = { error: jasmine.createSpy('error') }
      const ricarica = jasmine.createSpy('ricarica')
      eseguiERicarica(of(null), toast, 'ripiego', ricarica)
      expect(ricarica).toHaveBeenCalledTimes(1)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('errore 409: toast col messaggio del backend e ricarica comunque', () => {
      const toast = { error: jasmine.createSpy('error') }
      const ricarica = jasmine.createSpy('ricarica')
      eseguiERicarica(
        throwError(() => errore409),
        toast,
        'ripiego',
        ricarica
      )
      expect(toast.error).toHaveBeenCalledWith('La riga è stata modificata da un altro utente.')
      expect(ricarica).toHaveBeenCalledTimes(1)
    })

    it('errore senza messaggio: ripiego; ricarica solo a operazione conclusa', () => {
      const toast = { error: jasmine.createSpy('error') }
      const ricarica = jasmine.createSpy('ricarica')
      const op = new Subject<void>()
      eseguiERicarica(op, toast, 'ripiego', ricarica)
      expect(ricarica).not.toHaveBeenCalled()
      op.error({})
      expect(toast.error).toHaveBeenCalledWith('ripiego')
      expect(ricarica).toHaveBeenCalledTimes(1)
    })
  })
})
