//go:build !windows

package firma

// Fuori da Windows il file e' protetto solo dai permessi 0600 (la produzione e' Windows con DPAPI).
func proteggi(b []byte) ([]byte, error)  { return b, nil }
func sproteggi(b []byte) ([]byte, error) { return b, nil }
