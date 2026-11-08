import { TestBed } from '@angular/core/testing'
import { ActivatedRoute, convertToParamMap } from '@angular/router'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { DialogService } from 'primeng/dynamicdialog'
import { of } from 'rxjs'
import { TemporaryPermissionApiService } from '../../services/temporary-permission-api.service'
import { MyGrantsComponent } from './my-grants.component'

/** Task 15: da «Accesso non consentito» (?richiedi=<permesso>) si apre subito il dialog di richiesta. */
describe('MyGrantsComponent (arrivo da accesso negato)', () => {
  const monta = (query: Record<string, string>) => {
    const api = jasmine.createSpyObj('TemporaryPermissionApiService', ['listMyGrants'])
    api.listMyGrants.and.returnValue(of({ data: { grants: [] } }))
    TestBed.configureTestingModule({
      imports: [MyGrantsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TemporaryPermissionApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
      ],
    })
    const fixture = TestBed.createComponent(MyGrantsComponent)
    const dialog = fixture.debugElement.injector.get(DialogService)
    const open = spyOn(dialog, 'open').and.returnValue({ onClose: of(null) } as never)
    fixture.detectChanges()
    return open
  }

  it('con ?richiedi= apre il dialog', () => {
    expect(monta({ richiedi: 'fir:create:all' })).toHaveBeenCalledTimes(1)
  })

  it('senza parametro non lo apre', () => {
    expect(monta({})).not.toHaveBeenCalled()
  })
})
