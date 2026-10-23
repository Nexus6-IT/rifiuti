/** Messaggio per l'operatore dopo la registrazione di un movimento. */
export function messaggioMovimentoRegistrato(m: {
  progressiveNumber: number
  progressiveYear: number
  fuoriTermine?: boolean
  giaRegistrato?: boolean
}): string {
  const numero = `${m.progressiveYear}/${m.progressiveNumber}`
  if (m.giaRegistrato) {
    return `Il FIR era già registrato nel movimento ${numero}: nessun nuovo movimento creato`
  }
  return (
    `Movimento ${numero} registrato` +
    (m.fuoriTermine ? ' — ATTENZIONE: fuori termine di legge' : '')
  )
}
