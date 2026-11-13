//go:build !windows

package firma

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCustodeScritturaLetturaPermessi(t *testing.T) {
	_, priv, err := NuovaCoppia()
	if err != nil {
		t.Fatal(err)
	}
	c := Custode{Percorso: filepath.Join(t.TempDir(), "credenziali.bin")}
	in := Credenziali{AgenteID: "a", Token: "wfpa_x", Privata: priv}
	if err := c.Salva(in); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(c.Percorso)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("permessi %v err %v", info.Mode().Perm(), err)
	}
	out, err := c.Carica()
	if err != nil || out.Token != "wfpa_x" || !bytes.Equal(out.Privata, priv) {
		t.Fatalf("credenziali %+v err %v", out, err)
	}
}

func TestCustodeRifiutaIncompleteEMancanti(t *testing.T) {
	c := Custode{Percorso: filepath.Join(t.TempDir(), "x.bin")}
	if err := c.Salva(Credenziali{AgenteID: "a"}); err == nil {
		t.Fatal("attesa un errore per credenziali incomplete")
	}
	if _, err := c.Carica(); err == nil {
		t.Fatal("attesa un errore per file mancante")
	}
}
