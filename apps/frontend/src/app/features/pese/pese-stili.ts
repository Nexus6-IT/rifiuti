/** Stili condivisi dai form e dai dialog delle pese (stessi token di strumenti e automezzi). */
export const STILI_PESE = `
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-base);
  }
  .field > label,
  .field > .etichetta {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-secondary);
  }
  .req {
    color: var(--color-danger);
  }
  .field-hint {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
  .field-error {
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    color: var(--color-danger);
  }
  .griglia {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0 var(--spacing-base);
  }
  .azioni {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-base);
  }
  .avviso-manuale {
    margin: 0 0 var(--spacing-base);
    padding: var(--spacing-sm) var(--spacing-base);
    border-left: 4px solid var(--color-warning);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }
  .nota {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
`
