package istanza

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestSecondoLockRifiutatoEPoiLibero(t *testing.T) {
	p := filepath.Join(t.TempDir(), "agente-pesa.lock")
	r1, err := Blocca(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Blocca(p); !errors.Is(err, ErrGiaInEsecuzione) {
		t.Fatalf("secondo lock: %v", err)
	}
	r1()
	r2, err := Blocca(p)
	if err != nil {
		t.Fatalf("dopo il rilascio: %v", err)
	}
	r2()
}
