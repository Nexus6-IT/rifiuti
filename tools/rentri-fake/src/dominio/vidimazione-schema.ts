import { SCHEMA_EFIR, DEFINIZIONI_EFIR } from './schema-efir'
import { SCHEMA_BLOCCO, DEFINIZIONI_BLOCCO } from './schema-blocco'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * `vidimazione-formulari` non dichiara alcun `requestBody` (v. commento di
 * testata di `routes/vidimazione.ts`): questi validatori NON filtrano
 * richieste in ingresso come `validaTrasmissioneDati`/`validaElencoMovimenti`,
 * servono a verificare che le RISPOSTE costruite dalla fake (`aEfirModel`/
 * `aBloccoModel`) restino conformi a `EfirModel`/`BloccoModel` — la stessa
 * guardia di fedelta', spostata dal corpo della richiesta al corpo della
 * risposta perche' qui non c'e' altro da validare.
 */
export const validaEfirModel = creaValidatoreContratto(SCHEMA_EFIR, DEFINIZIONI_EFIR)
export const validaBloccoModel = creaValidatoreContratto(SCHEMA_BLOCCO, DEFINIZIONI_BLOCCO)
