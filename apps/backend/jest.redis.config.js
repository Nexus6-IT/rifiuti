const base = require('./jest.config')

/**
 * Configurazione per i test di integrazione che richiedono un Redis reale:
 * comportamento temporale (finestre scorrevoli, attese risolte da un
 * rilascio concorrente) che un mock non può dimostrare senza nascondere
 * proprio i bug di corsa che il codice sotto test esiste per evitare.
 *
 * Esclusi dalla suite unitaria per la stessa ragione delle spec `postgres`:
 * in CI non esiste un Redis raggiungibile, quindi fallirebbero per assenza
 * di infrastruttura bloccando il gate di rilascio.
 */
module.exports = {
  ...base,
  testPathIgnorePatterns: [],
  testRegex: '.*\\.redis\\.spec\\.ts$',
  coverageThreshold: undefined,
}
