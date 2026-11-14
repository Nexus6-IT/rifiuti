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

func TestRotazioneFallitaNonBloccaPerSempreLaScrittura(t *testing.T) {
	d := filepath.Join(t.TempDir(), "log")
	p := filepath.Join(d, "agente-pesa.log")
	r, err := NuovoRotante(p, 50, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	// la rotazione fallisce: la destinazione e' una cartella non vuota
	os.MkdirAll(filepath.Join(p+".1", "x"), 0o755)
	linea := []byte(strings.Repeat("a", 40) + "\n")
	r.Write(linea)
	r.Write(linea) // supera la soglia: la rotazione fallisce
	for i := 0; i < 3; i++ {
		if _, err := r.Write(linea); err != nil {
			t.Fatalf("scrittura %d dopo una rotazione fallita: %v", i, err)
		}
	}
}
