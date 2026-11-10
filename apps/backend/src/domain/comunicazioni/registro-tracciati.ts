import { TracciatoOrsoImpiantoMesi } from './orso/serializza-impianto-mesi'
import { RegistroTracciati } from './tracciato-comunicazione'

/** Registro dei tracciati di comunicazione disponibili. Nuovo tracciato = una riga qui. */
export const registroTracciati = new RegistroTracciati().registra(TracciatoOrsoImpiantoMesi)
