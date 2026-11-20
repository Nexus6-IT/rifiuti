import { CHIAVE_NONCE, consumaNonceAccesso, generaNonceAccesso } from './nonce-accesso';

describe('nonce di accesso (anti login-CSRF)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('genera un nonce base64url di 22 caratteri, diverso a ogni volta, e lo ricorda', () => {
    const a = generaNonceAccesso();
    const b = generaNonceAccesso();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
    expect(localStorage.getItem(CHIAVE_NONCE)).toContain(b as string);
  });

  it('il nonce giusto viene accettato UNA volta sola', () => {
    const n = generaNonceAccesso() as string;
    expect(consumaNonceAccesso(n)).toBe(true);
    expect(consumaNonceAccesso(n)).toBe(false);
    expect(localStorage.getItem(CHIAVE_NONCE)).toBeNull();
  });

  it.each([null, '', 'sbagliato', 'x'.repeat(22)])(
    'rifiuta %p e butta comunque il nonce salvato',
    (ricevuto) => {
      const n = generaNonceAccesso() as string;
      expect(consumaNonceAccesso(ricevuto)).toBe(false);
      expect(localStorage.getItem(CHIAVE_NONCE)).toBeNull();
      expect(consumaNonceAccesso(n)).toBe(false);
    },
  );

  it('senza nonce salvato nulla e accettabile', () => {
    expect(consumaNonceAccesso('AbC_def-1234567890xyz1')).toBe(false);
    expect(consumaNonceAccesso(null)).toBe(false);
  });

  it('scade dopo 15 minuti', () => {
    vi.useFakeTimers();
    const n = generaNonceAccesso() as string;
    vi.advanceTimersByTime(16 * 60_000);
    expect(consumaNonceAccesso(n)).toBe(false);
  });

  it('senza localStorage non si genera nulla (fail closed) e nulla e accettato', () => {
    const spia = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(generaNonceAccesso()).toBeNull();
    spia.mockRestore();
    expect(consumaNonceAccesso('AbC_def-1234567890xyz1')).toBe(false);
  });
});
