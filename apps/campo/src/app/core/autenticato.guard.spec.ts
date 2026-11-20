import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { autenticatoGuard } from './autenticato.guard';
import { SessioneService } from './sessione.service';

describe('autenticatoGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  const esegui = () =>
    TestBed.runInInjectionContext(() => autenticatoGuard({} as never, {} as never));

  it('senza sessione rimanda al login', () => {
    const r = esegui();
    expect(r instanceof UrlTree).toBe(true);
    expect(TestBed.inject(Router).serializeUrl(r as UrlTree)).toBe('/login');
  });

  it('con sessione lascia passare', () => {
    TestBed.inject(SessioneService).salvaDaFragment('#accessToken=a&refreshToken=r');
    expect(esegui()).toBe(true);
  });
});
