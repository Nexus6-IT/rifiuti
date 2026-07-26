const base = require('./jest.config')

/**
 * Configurazione per i test di integrazione che richiedono un PostgreSQL
 * reale: vincoli di unicita', comportamento dei NULL, traduzione degli errori
 * del driver in errori di dominio. Sono cose che una finta non puo'
 * dimostrare, ma che senza database non possono nemmeno partire.
 *
 * Esclusi dalla suite unitaria per la stessa ragione delle spec `oracolo`:
 * in CI non esiste un database, quindi fallirebbero per assenza di
 * infrastruttura bloccando il gate di rilascio.
 */
module.exports = {
  ...base,
  testPathIgnorePatterns: [],
  testRegex: '.*\.postgres\.spec\.ts$',
  coverageThreshold: undefined,
}
