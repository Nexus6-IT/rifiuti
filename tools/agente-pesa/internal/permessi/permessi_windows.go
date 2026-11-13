//go:build windows

package permessi

import (
	"fmt"
	"os"
	"os/exec"
)

// SID noti, indipendenti dalla lingua di Windows.
const (
	sidAdministrators = "*S-1-5-32-544"
	sidSystem         = "*S-1-5-18"
)

func cartella(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return icacls(dir, "/inheritance:r",
		"/grant", sidAdministrators+`:(OI)(CI)F`,
		"/grant", sidSystem+`:(OI)(CI)F`)
}

// Concedi aggiunge all'account (per esempio l'account virtuale del servizio) il permesso di
// modifica sulla cartella gia' ristretta.
func Concedi(dir, account string) error {
	return icacls(dir, "/grant", account+`:(OI)(CI)M`)
}

func icacls(dir string, args ...string) error {
	out, err := exec.Command("icacls", append([]string{dir}, args...)...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls: %w: %s", err, out)
	}
	return nil
}
