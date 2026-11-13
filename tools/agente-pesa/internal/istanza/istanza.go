// Package istanza impedisce che due agenti usino la stessa cartella dati: due driver sullo stesso
// strumento e due numerazioni di sequenza in conflitto farebbero scartare letture vere.
package istanza

import (
	"errors"
	"fmt"
)

// ErrGiaInEsecuzione e' restituito dal secondo processo che prova a prendere la cartella.
var ErrGiaInEsecuzione = errors.New("agente gia' in esecuzione su questa cartella dati (servizio o altro `esegui` attivo)")

// Blocca prende un lock esclusivo sul file path (lo crea). Il lock cade da solo se il processo
// muore. rilascia va chiamata alla fine.
func Blocca(path string) (rilascia func(), err error) {
	r, err := blocca(path)
	if err != nil {
		if errors.Is(err, ErrGiaInEsecuzione) {
			return nil, err
		}
		return nil, fmt.Errorf("lock %s: %w", path, err)
	}
	return r, nil
}
