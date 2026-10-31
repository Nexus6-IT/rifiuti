/**
 * Tipi del dominio delle pese. Union di stringhe uguali agli enum Prisma
 * (`FontePesata`, `ModoPesatura`, `WasteMovementType`), senza importare
 * `@prisma/client`: il dominio resta puro.
 */
export type FontePesataDominio = 'STRUMENTO' | 'FILE' | 'MANUALE' | 'TARA_ANAGRAFICA'

export type ModoPesaturaDominio = 'DOPPIA' | 'TARA_ANAGRAFICA' | 'SINGOLA'

export type VersoPesata = 'CARICO' | 'SCARICO'
