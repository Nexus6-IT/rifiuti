// Ruoli ammessi sulle rotte del pezzo clienti/contratti (D17): moduli condivisi da tutti i
// controller di `api/clienti`, invece di importarli da un controller a caso (R38).
export const RUOLI_LETTURA = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'] as const
export const RUOLI_SCRITTURA = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'] as const
