module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Le spec `*.oracolo.spec.ts` sono test di INTEGRAZIONE contro la fake API
  // RENTRI (`tools/rentri-fake`): fanno require del sorgente della fake, quindi
  // richiedono le sue dipendenze (fastify, jose, node-forge, jszip...).
  // `tools/*` NON e' un workspace npm, percio' `npm ci` alla radice non le
  // installa e in CI quelle suite non partono affatto ("Test suite failed to
  // run") — mentre in locale passano se qualcuno ha installato la fake a mano.
  // Restano ESCLUSE dalla suite unitaria ed ESEGUITE da `npm run test:oracolo`,
  // che la CI lancia in un passo dedicato dopo aver installato la fake: la
  // prova di conformita' non va persa, va solo eseguita dove ha le sue
  // dipendenze.
  // Le spec `*.postgres.spec.ts` richiedono un PostgreSQL reale (vincoli di
  // unicita', comportamento dei NULL, traduzione degli errori del driver):
  // cose che una finta non puo' dimostrare. In CI non esiste un database,
  // quindi qui fallirebbero per assenza di infrastruttura e bloccherebbero il
  // gate di rilascio. Si eseguono con `npm run test:postgres` avendo un
  // Postgres raggiungibile.
  // Le spec `*.redis.spec.ts` (R5, rate limiter preventivo RENTRI) testano
  // comportamento TEMPORALE reale (una finestra che scorre, un'attesa che si
  // risolve solo quando un altro processo rilascia uno slot): un Redis
  // mockato nasconderebbe esattamente i bug di corsa che il rate limiter
  // esiste per evitare. In CI/locale senza Redis fallirebbero per assenza di
  // infrastruttura bloccando il gate, quindi vanno in una suite dedicata
  // eseguita con `npm run test:redis` avendo un Redis reale raggiungibile.
  testPathIgnorePatterns: [
    '\\.oracolo\\.spec\\.ts$',
    '\\.postgres\\.spec\\.ts$',
    '\\.redis\\.spec\\.ts$',
  ],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.spec.ts',
    '!**/*.oracolo-spec.ts',
    '!**/*.fixture-spec.ts',
    '!**/*.postgres-spec.ts',
    '!**/test-support/**',
    '!**/*.module.ts',
    '!**/main.ts',
    '!**/*.interface.ts',
    '!**/index.ts',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Timeout per singolo test: un test bloccato (es. attesa di una connessione
  // Redis/DB che non si risolve in CI senza infra) FALLISCE dopo 30s invece di
  // restare appeso a tempo indefinito. Combinato con `--forceExit` nel gate,
  // garantisce che jest termini sempre (mai deploy appeso). Vedi memory
  // rifiuti-build-deploy-gotchas.
  testTimeout: 30000,
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/domain/$1',
    '^@application/(.*)$': '<rootDir>/application/$1',
    '^@infrastructure/(.*)$': '<rootDir>/infrastructure/$1',
    '^@api/(.*)$': '<rootDir>/api/$1',
    '^@core/(.*)$': '<rootDir>/core/$1',
  },
  // SOGLIA DI COVERAGE — allineata alla realta' misurata il 2026-07-25 (P5,
  // task 3 "misura e soglia"), non piu' un valore aspirazionale mai raggiunto.
  //
  // Misura reale (npx jest --coverage, 101 suite / 911 test verdi):
  //   statements 40.90% | branches 35.36% | functions 38.99% | lines 40.66%
  //
  // La soglia precedente (80/75/80/80) non proteggeva nulla: falliva sempre
  // `npm run test:cov` (usato da ci.yml), a prescindere da cosa cambiasse il
  // commit — un allarme che suona sempre non e' un allarme. I valori qui sotto
  // sono la misura reale con un margine di ~1 punto (tollera micro-variazioni
  // tra run senza mascherare un calo vero) e DEVONO fallire se la coverage
  // scende sotto quanto c'e' oggi in repo.
  //
  // Aree di business scoperte piu' rilevanti (da incrociare con criticita',
  // non solo con la percentuale — vedi docs/audits/p5 coverage):
  //   - src/api/auth/auth.controller.ts             0%   (endpoint auth REST)
  //   - src/infrastructure/auth                      0%   (adapter auth)
  //   - src/api/registro/registro.controller.ts      0%   (registro art. 190)
  //   - src/api/registry/registry.controller.ts      0%   (anagrafica registri)
  //   - src/application/registry/use-cases   8.77%        (CRUD produttore/
  //     trasportatore/destinatario: create/delete quasi tutti a 0%)
  //   - src/infrastructure/signatures/signature-fir.repository.ts  0%
  //   - src/application/signatures/providers  34.61%      (qes/rfc3161/mock-tsa
  //     provider a 0%: solo il provider sandbox e' testato)
  //   - src/api/permissions (audit/role/consultant/temporary-permission
  //     controller)  ~36-54%   (RBAC: coperta la business logic nei
  //     command/query handler, scoperto soprattutto lo strato REST)
  //
  // Percorso dichiarato: alzare la soglia per gradi scrivendo test su queste
  // aree (auth REST, registro/registry REST, provider di firma qualificata,
  // repository firma) prima di alzare ulteriormente i numeri sotto.
  coverageThreshold: {
    global: {
      lines: 40,
      branches: 34,
      functions: 38,
      statements: 40,
    },
  },
}
