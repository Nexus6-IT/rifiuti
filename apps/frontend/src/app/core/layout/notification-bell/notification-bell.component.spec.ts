import { fakeAsync, tick, TestBed, discardPeriodicTasks } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { NotificationBellComponent } from './notification-bell.component'

describe('NotificationBellComponent: polling', () => {
  it('dopo due ricreazioni (passaggi dei 992px) resta un solo polling attivo', fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent, HttpClientTestingModule],
    })
    const http = TestBed.inject(HttpTestingController)

    const crea = () => {
      const f = TestBed.createComponent(NotificationBellComponent)
      f.detectChanges()
      return f
    }
    const a = crea()
    a.destroy()
    const b = crea()
    b.destroy()
    const c = crea()
    // Le tre richieste iniziali: si chiudono.
    http.match(r => r.url.endsWith('/unread-count')).forEach(r => r.flush({ count: 0 }))

    tick(30000)
    expect(http.match(r => r.url.endsWith('/unread-count')).length).toBe(1)

    c.destroy()
    tick(30000)
    http.expectNone(r => r.url.endsWith('/unread-count'))
    discardPeriodicTasks()
  }))
})
