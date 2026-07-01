module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.spec.ts',
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
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 75,
      functions: 80,
      statements: 80,
    },
  },
}
