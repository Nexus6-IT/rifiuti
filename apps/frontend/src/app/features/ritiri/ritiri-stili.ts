/** Stili condivisi dai dialog dei ritiri (stessi token delle pese e dei contratti). */
export const STILI_RITIRI = `
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
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
    gap: 0 var(--spacing-base);
  }
  .azioni {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-base);
  }
  .nota {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .titolo-sezione {
    font-size: var(--font-size-base);
    margin: var(--spacing-base) 0 var(--spacing-sm);
  }
`
