import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

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
    expect(el.querySelector('a[data-test="accedi"]')?.getAttribute('href')).toBe(
      '/api/v1/auth/spid/login?RelayState=campo',
    );
  });
});
