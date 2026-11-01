import { signal } from '@angular/core'
import { Subject, of, throwError } from 'rxjs'
import { Pagina } from '../clienti.model'
import { caricaElenco, caricaPagina, eseguiERicarica, messaggioErrore } from './tabella-comune'

describe('tabella-comune', () => {
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

  describe('caricaPagina', () => {
    it('riuscita: righe e totale (non solo la pagina) e errore azzerato', () => {
      const righe = signal<string[]>([])
      const totale = signal(0)
      const errore = signal<string | null>('vecchio')
      const pagina: Pagina<string> = { elementi: ['a', 'b'], totale: 57 }
      caricaPagina(of(pagina), righe, totale, errore, 'ripiego')
      expect(righe()).toEqual(['a', 'b'])
      expect(totale()).toBe(57)
      expect(errore()).toBeNull()
    })

    it('errore: messaggio e totale invariato', () => {
      const totale = signal(5)
      const errore = signal<string | null>(null)
      caricaPagina(
        throwError(() => errore409),
        signal<string[]>([]),
        totale,
        errore,
        'ripiego'
      )
      expect(errore()).toBe('La riga è stata modificata da un altro utente.')
      expect(totale()).toBe(5)
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
