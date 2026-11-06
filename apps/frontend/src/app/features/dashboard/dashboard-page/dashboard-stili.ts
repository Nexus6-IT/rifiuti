/**
 * Stili comuni dei blocchi della Dashboard (card piatta con bordo di 1px, intestazione,
 * barre grigie di caricamento). Solo token del tema: nessun colore letterale.
 * I componenti li includono in `styles: [STILI_BLOCCO, ...]`.
 */
export const STILI_BLOCCO = `
  :host { display: block; min-width: 0; }
  .card {
    background: var(--surface-card);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    padding: 20px;
    min-width: 0;
    height: 100%;
    box-sizing: border-box;
  }
  .card__h {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .card__h h2,
  .card__h h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: var(--font-weight-semibold);
    line-height: 22px;
    letter-spacing: 0;
    color: var(--text-primary);
  }
  .meta { font-size: 12px; line-height: 16px; color: var(--text-secondary); text-align: right; }
  .vuoto { margin: 0; font-size: 14px; line-height: 20px; color: var(--text-secondary); }
  .num { font-variant-numeric: tabular-nums; }
  .mono { font-family: var(--font-family-mono); font-size: 13px; }
  /* Caricamento: barre grigie piatte, della stessa altezza del valore che sostituiscono. */
  .sk { display: block; background: var(--surface-border); border-radius: var(--radius-sm); }
  .link {
    color: var(--brand-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .link:hover { color: var(--brand-primary-dark); }
  .link:focus-visible,
  .azione:focus-visible { outline: 2px solid var(--focus-ring-color); outline-offset: 2px; border-radius: var(--radius-sm); }
  .azione {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-base);
    background: transparent;
    font: inherit;
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
    text-decoration: underline;
    text-decoration-color: var(--control-border);
    text-underline-offset: 3px;
    cursor: pointer;
    white-space: nowrap;
  }
  .azione:hover { background: var(--surface-hover); }
  @media (max-width: 575.98px) {
    .azione { min-height: 44px; }
  }
`
