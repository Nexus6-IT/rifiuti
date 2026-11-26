/**
 * Porta verso l'avviso «il tuo giro e' cambiato» (web push dell'app campo, P7). Il servizio dei
 * ritiri non conosce il push: chiama la porta, se c'e', dopo aver confermato la scrittura. Un guasto
 * dell'avviso non deve mai far fallire (ne rallentare) una modifica al ritiro.
 */
export interface NotificaGiroPorta {
  notificaGiroModificato(tenantId: string, autistaIds: string[]): Promise<unknown>
}
export const NOTIFICA_GIRO = Symbol('NOTIFICA_GIRO')
