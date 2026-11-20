import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { GiroService } from './core/giro.service';

describe('App campo', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it("crea l'app", () => {
    expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
  });

  it('senza sessione la rotta del giro porta al login con il link SPID/CIE per il canale campo', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('WasteFlow campo');
    expect(el.querySelector('a[data-testid="accedi"]')?.getAttribute('href')).toBe(
      '/api/v1/auth/spid/login?RelayState=campo',
    );
  });
});

describe('App campo: ripresa dal background', () => {
  it('alla ripresa (visibilitychange) a giorno cambiato svuota il giro di ieri', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    const giro = TestBed.inject(GiroService);
    giro.impostaFresco(
      { data: '1999-01-01', autista: { id: 'a', nome: 'M', cognome: 'B' }, ritiri: [] },
      'x',
    );
    TestBed.createComponent(App);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(giro.corrente()).toBeNull());
  });
});
