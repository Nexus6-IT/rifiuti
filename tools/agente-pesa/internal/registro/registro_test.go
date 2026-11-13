package registro

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotazioneAllaSoglia(t *testing.T) {
	p := filepath.Join(t.TempDir(), "log", "agente-pesa.log")
	r, err := NuovoRotante(p, 100, 3)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	for i := 1; i <= 5; i++ {
		fmt.Fprintf(r, "riga %d %s\n", i, strings.Repeat("x", 50))
	}
	for _, f := range []string{p, p + ".1", p + ".2"} {
		if _, err := os.Stat(f); err != nil {
			t.Errorf("manca %s", f)
		}
	}
	if _, err := os.Stat(p + ".3"); err == nil {
		t.Error("esiste una copia in piu'")
	}
	b, _ := os.ReadFile(p)
	if !strings.Contains(string(b), "riga 5") || strings.Contains(string(b), "riga 4") {
		t.Errorf("file corrente: %q", b)
	}
}

func TestTokenMascheratoNeiValoriEdErrori(t *testing.T) {
	var buf bytes.Buffer
	l := Nuovo(&buf, "info")
	l.Info("invio con wfpa_ABCdef-123", "token", "wfpa_SEGRETO_xyz", "err", errors.New("401 per wfpa_SEGRETO_xyz"))
	l.Debug("non scritto")
	s := buf.String()
	if strings.Contains(s, "SEGRETO") || strings.Contains(s, "ABCdef") {
		t.Fatalf("token nel log: %s", s)
	}
	if strings.Count(s, "[token]") != 3 || strings.Contains(s, "non scritto") {
		t.Fatalf("log inatteso: %s", s)
	}
}
