import { TestBed } from '@angular/core/testing'
import { MessageService } from 'primeng/api'
import { ToastService } from './toast.service'

describe('ToastService', () => {
  let service: ToastService
  let messageService: jasmine.SpyObj<MessageService>

  beforeEach(() => {
    messageService = jasmine.createSpyObj<MessageService>('MessageService', ['add', 'clear'])
    TestBed.configureTestingModule({
      providers: [{ provide: MessageService, useValue: messageService }],
    })
    service = TestBed.inject(ToastService)
  })

  const casi: Array<[string, 'success' | 'error' | 'warn' | 'info', string]> = [
    ['success', 'success', 'Fatto'],
    ['error', 'error', 'Errore'],
    ['warn', 'warn', 'Attenzione'],
    ['info', 'info', 'Informazione'],
  ]

  casi.forEach(([metodo, severity, titolo]) => {
    it(`${metodo}() usa «${titolo}» come titolo predefinito, in italiano`, () => {
      ;(service as unknown as Record<string, (d: string) => void>)[metodo]('x')

      expect(messageService.add).toHaveBeenCalledTimes(1)
      const messaggio = messageService.add.calls.mostRecent().args[0]
      expect(messaggio.severity).toBe(severity)
      expect(messaggio.summary).toBe(titolo)
      expect(messaggio.detail).toBe('x')
    })
  })

  it('un titolo passato dal chiamante vince su quello predefinito', () => {
    service.error('dettaglio', 'Invio non riuscito')

    expect(messageService.add.calls.mostRecent().args[0].summary).toBe('Invio non riuscito')
  })
})
