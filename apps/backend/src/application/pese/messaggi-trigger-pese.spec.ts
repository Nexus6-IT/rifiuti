import { readFileSync } from 'fs'
import { join } from 'path'
import { MSG_TRIGGER } from './messaggi-trigger-pese'

const MIGRATIONS = join(__dirname, '../../../prisma/migrations')
const sql = ['20261101600000_pese_modello_dati', '20261101600100_pese_cancellazione_e_indici']
  .map(m => readFileSync(join(MIGRATIONS, m, 'migration.sql'), 'utf8'))
  .join('\n')

describe('messaggi dei trigger delle pese', () => {
  it.each(Object.entries(MSG_TRIGGER))(
    '%s e` sollevato dalla migration col testo esatto',
    (_n, msg) => {
      // nel SQL l'apice e` raddoppiato dentro la stringa
      expect(sql).toContain(`RAISE EXCEPTION '${msg.replace(/'/g, "''")}'`)
    }
  )
})
