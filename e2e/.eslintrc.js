/**
 * Override locale per la cartella e2e/.
 *
 * Il progetto TypeScript di questa cartella (tsconfig.json) NON è mai stato
 * incluso in .eslintrc.json alla radice: quel file dichiara
 * "parserOptions.project" alla radice: quel valore elenca solo i tsconfig
 * sotto apps/<nome-app>/, quindi i file sotto questa cartella non risultavano
 * mai analizzati — nessun gate CI li lintava (vedi ci.yml, job "e2e").
 *
 * Non basta aggiungere "./e2e/tsconfig.json" a quell'array: i percorsi in
 * parserOptions.project sono risolti relativamente alla CWD del processo
 * eslint (o a tsconfigRootDir, se impostato), non alla posizione del file
 * .eslintrc. Il job "backend" della CI invoca eslint da apps/backend/ (per un
 * motivo analogo, documentato lì): un valore relativo alla radice del repo
 * risolverebbe lì dentro in apps/backend/e2e/tsconfig.json, inesistente, e
 * romperebbe quel gate con "Parsing error" su ogni file (verificato).
 *
 * Fissando qui tsconfigRootDir a __dirname (assoluto, dipende solo dalla
 * posizione di QUESTO file, mai dalla CWD di chi invoca eslint) l'override si
 * applica correttamente a prescindere da dove gira il comando eslint.
 */
module.exports = {
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
}
