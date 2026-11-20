import { TestBed } from '@angular/core/testing';
import { CHIAVE_NONCE } from '../core/nonce-accesso';
import { LoginPagina } from './login';

describe('LoginPagina', () => {
  beforeEach(() => localStorage.clear());

  it('il link SPID porta RelayState campo.<nonce> e il nonce e quello ricordato', () => {
    const f = TestBed.createComponent(LoginPagina);
    f.detectChanges();
    const href = (f.nativeElement as HTMLElement)
      .querySelector('a[data-testid="accedi"]')
      ?.getAttribute('href') as string;
    const m = /^\/api\/v1\/auth\/spid\/login\?RelayState=campo\.([A-Za-z0-9_-]{22})$/.exec(href);
    expect(m).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(CHIAVE_NONCE) as string).nonce).toBe(m?.[1]);
  });

  it('ogni apertura della pagina genera un nonce nuovo', () => {
    const a = TestBed.createComponent(LoginPagina);
    a.detectChanges();
    const n1 = localStorage.getItem(CHIAVE_NONCE);
    const b = TestBed.createComponent(LoginPagina);
    b.detectChanges();
    expect(localStorage.getItem(CHIAVE_NONCE)).not.toBe(n1);
  });

  it('se il browser non puo ricordare il nonce non offre l accesso e lo spiega', () => {
    const spia = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const f = TestBed.createComponent(LoginPagina);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('a[data-testid="accedi"]')).toBeNull();
    expect(el.querySelector('[data-testid="no-storage"]')?.textContent).toContain('privata');
    spia.mockRestore();
  });
});
