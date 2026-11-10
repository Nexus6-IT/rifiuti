import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { ActivatedRoute, convertToParamMap } from '@angular/router'
import { of, throwError } from 'rxjs'
import { VerifySignaturesComponent } from './verify-signatures.component'
import {
  SignatureService,
  VerifySignaturesResponse,
} from '../../../core/services/signature.service'

describe('VerifySignaturesComponent (pagina pubblica del QR)', () => {
  let fixture: ComponentFixture<VerifySignaturesComponent>
  let servizio: jasmine.SpyObj<SignatureService>

  function avvia(firId: string | null) {
    servizio = jasmine.createSpyObj('SignatureService', ['verifySignatures'])
    TestBed.configureTestingModule({
      imports: [VerifySignaturesComponent, NoopAnimationsModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(firId ? { firId } : {}) } },
        },
        { provide: SignatureService, useValue: servizio },
      ],
    })
    fixture = TestBed.createComponent(VerifySignaturesComponent)
  }

  const esito = (allValid: boolean) => ({
    firId: 'fir-1',
    firNumber: 'FIR-2026-000001',
    allValid,
    isCompleted: true,
    signatureCount: 3,
    documentHash: 'abc',
    verifiedAt: new Date().toISOString(),
    signatures: ['PRODUCER', 'CARRIER', 'RECEIVER'].map(role => ({
      role,
      signedAt: new Date().toISOString(),
      signatureMethod: 'ECDSA-SHA256',
      certificateHash: 'c',
      documentHash: 'abc',
      hasTimestamp: false,
      isValid: allValid,
      verifiedAt: new Date().toISOString(),
    })),
  })

  it('chiama la verifica pubblica con l id del QR e mostra firme valide e completo', async () => {
    avvia('fir-1')
    servizio.verifySignatures.and.returnValue(
      of(esito(true) as unknown as VerifySignaturesResponse)
    )
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()

    expect(servizio.verifySignatures).toHaveBeenCalledWith('fir-1')
    const testo = (fixture.nativeElement as HTMLElement).textContent ?? ''
    expect(testo).toContain('FIR-2026-000001')
    expect(testo).toContain('Firme Valide')
    expect(testo).toContain('Completato')
    expect(testo).toContain('3 / 3')
  })

  it('con una firma non valida lo dice', async () => {
    avvia('fir-1')
    servizio.verifySignatures.and.returnValue(
      of(esito(false) as unknown as VerifySignaturesResponse)
    )
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Firme Non Valide')
  })

  it('FIR sconosciuto: mostra l errore', async () => {
    avvia('fir-x')
    servizio.verifySignatures.and.returnValue(
      throwError(() => ({ error: { message: 'FIR non trovato' } }))
    )
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('FIR non trovato')
  })

  it('senza id non chiama il servizio', () => {
    avvia(null)
    fixture.detectChanges()
    expect(servizio.verifySignatures).not.toHaveBeenCalled()
  })
})
