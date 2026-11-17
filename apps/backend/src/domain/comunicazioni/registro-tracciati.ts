import { TracciatoCobat } from './cobat/serializza-cobat'
import { TracciatoConou } from './conou/serializza-conou'
import { TracciatoOrr } from './orr/serializza-orr'
import {
  TracciatoOrsoImpiantoMesi,
  TracciatoOrsoImpiantoMesiDettagliata,
} from './orso/serializza-impianto-mesi'
import { RegistroTracciati } from './tracciato-comunicazione'

/** Registro dei tracciati di comunicazione disponibili. Nuovo tracciato = una riga qui. */
export const registroTracciati = new RegistroTracciati()
  .registra(TracciatoOrsoImpiantoMesi)
  .registra(TracciatoOrsoImpiantoMesiDettagliata)
  .registra(TracciatoConou)
  .registra(TracciatoCobat)
  .registra(TracciatoOrr)
