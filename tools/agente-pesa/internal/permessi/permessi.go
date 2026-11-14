// Package permessi limita l'accesso alla cartella dati, che contiene la chiave privata e il token.
package permessi

// Cartella crea dir se manca e la riserva agli amministratori (e a SYSTEM su Windows) senza
// ereditare i permessi del genitore: su Windows C:\ProgramData e' leggibile da tutti gli utenti
// locali, e il file delle credenziali (DPAPI di macchina, decifrabile da qualunque utente locale)
// e' protetto solo da questa ACL. Va chiamata PRIMA di scrivere qualunque segreto.
func Cartella(dir string) error { return cartella(dir) }
