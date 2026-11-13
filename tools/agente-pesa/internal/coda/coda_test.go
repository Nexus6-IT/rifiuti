package coda

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func chiave(n int) string { return fmt.Sprintf("00000000-0000-4000-8000-%012d", n) }

func el(seq int64) Elemento {
	return Elemento{PayloadB64: "cA==", FirmaB64: "cw==", ChiaveIdempotenza: chiave(int(seq)), Sequenza: seq}
}

func apri(t *testing.T) (*Coda, string) {
	t.Helper()
	d := t.TempDir()
	c, err := Apri(d)
	if err != nil {
		t.Fatal(err)
	}
	return c, d
}

func TestOrdineDiSequenzaAnzicheDiCreazione(t *testing.T) {
	c, _ := apri(t)
	for _, s := range []int64{5, 3, 4, 10, 2} {
		if err := c.Accoda(el(s)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := c.Prossimi(3)
	if err != nil || len(got) != 3 || got[0].Sequenza != 2 || got[1].Sequenza != 3 || got[2].Sequenza != 4 {
		t.Fatalf("prossimi %+v err %v", got, err)
	}
	if k := c.Conta(); k.InAttesa != 5 {
		t.Fatalf("conteggi %+v", k)
	}
}

func TestTmpDaCrashCancellatiEMaiRestituiti(t *testing.T) {
	c, d := apri(t)
	c.Accoda(el(1))
	tmp := filepath.Join(d, "in-attesa", fmt.Sprintf("%012d-%s.json.tmp", 2, chiave(2)))
	os.WriteFile(tmp, []byte(`{"troncato`), 0o600)
	os.WriteFile(filepath.Join(d, "sequenza.tmp"), []byte("9"), 0o600)
	c2, err := Apri(d)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Fatal(".tmp non cancellato")
	}
	if _, err := os.Stat(filepath.Join(d, "sequenza.tmp")); !os.IsNotExist(err) {
		t.Fatal("sequenza.tmp non cancellato")
	}
	got, _ := c2.Prossimi(10)
	if len(got) != 1 || got[0].Sequenza != 1 {
		t.Fatalf("prossimi %+v", got)
	}
}

func TestEsitiSpostanoLeLetture(t *testing.T) {
	c, d := apri(t)
	for s := int64(1); s <= 3; s++ {
		c.Accoda(el(s))
	}
	if err := c.Segna(chiave(1), Accettata, ""); err != nil {
		t.Fatal(err)
	}
	if err := c.Segna(chiave(2), Rifiutata, "FUORI_PORTATA: troppo"); err != nil {
		t.Fatal(err)
	}
	if err := c.Segna(chiave(9), Accettata, ""); !errors.Is(err, ErrNonTrovata) {
		t.Fatalf("errore %v", err)
	}
	k := c.Conta()
	if k.InAttesa != 1 || k.Inviate != 1 || k.Scartate != 1 {
		t.Fatalf("conteggi %+v", k)
	}
	motivo, err := os.ReadFile(filepath.Join(d, "scartate", fmt.Sprintf("%012d-%s.motivo.txt", 2, chiave(2))))
	if err != nil || string(motivo) != "FUORI_PORTATA: troppo\n" {
		t.Fatalf("motivo %q err %v", motivo, err)
	}
}

func TestRiaperturaSenzaPerditeNeDuplicati(t *testing.T) {
	c, d := apri(t)
	for s := int64(1); s <= 4; s++ {
		c.Accoda(el(s))
	}
	c.Segna(chiave(1), GiaRicevuta, "")
	c2, err := Apri(d) // "crash": un'altra istanza riparte dalla cartella
	if err != nil {
		t.Fatal(err)
	}
	got, _ := c2.Prossimi(10)
	if len(got) != 3 || got[0].Sequenza != 2 || got[2].Sequenza != 4 {
		t.Fatalf("prossimi %+v", got)
	}
	if err := c2.Accoda(el(3)); !errors.Is(err, ErrDuplicato) {
		t.Fatalf("errore %v", err)
	}
}

func TestSequenzaPersistitaEMaiRiusata(t *testing.T) {
	c, d := apri(t)
	for want := int64(1); want <= 3; want++ {
		if got, err := c.ProssimaSequenza(); err != nil || got != want {
			t.Fatalf("sequenza %d err %v, attesa %d", got, err, want)
		}
	}
	c2, _ := Apri(d)
	if got, _ := c2.ProssimaSequenza(); got != 4 {
		t.Fatalf("dopo la riapertura: %d", got)
	}
	// file "sequenza" perso ma lettura 9 in coda: non si riparte da 1
	c2.Accoda(el(9))
	os.Remove(filepath.Join(d, "sequenza"))
	if got, _ := c2.ProssimaSequenza(); got != 10 {
		t.Fatalf("sequenza senza file: %d", got)
	}
}

func TestCodaPiena(t *testing.T) {
	c, _ := apri(t)
	c.Limite = 2
	c.Accoda(el(1))
	c.Accoda(el(2))
	if err := c.Accoda(el(3)); !errors.Is(err, ErrCodaPiena) {
		t.Fatalf("errore %v", err)
	}
	c.Segna(chiave(1), Accettata, "")
	if err := c.Accoda(el(3)); err != nil {
		t.Fatalf("dopo uno spazio libero: %v", err)
	}
}

func TestPulisciToglieSoloGliInviatiVecchi(t *testing.T) {
	c, d := apri(t)
	for s := int64(1); s <= 3; s++ {
		c.Accoda(el(s))
	}
	c.Segna(chiave(1), Accettata, "")
	c.Segna(chiave(2), Accettata, "")
	c.Segna(chiave(3), Rifiutata, "x")
	vecchio := time.Now().Add(-31 * 24 * time.Hour)
	os.Chtimes(filepath.Join(d, "inviate", fmt.Sprintf("%012d-%s.json", 1, chiave(1))), vecchio, vecchio)
	os.Chtimes(filepath.Join(d, "scartate", fmt.Sprintf("%012d-%s.json", 3, chiave(3))), vecchio, vecchio)
	if err := c.Pulisci(30 * 24 * time.Hour); err != nil {
		t.Fatal(err)
	}
	if k := c.Conta(); k.Inviate != 1 || k.Scartate != 1 {
		t.Fatalf("conteggi %+v", k)
	}
}

func TestFileIllegibileScartato(t *testing.T) {
	c, d := apri(t)
	c.Accoda(el(1))
	c.Accoda(el(2))
	os.WriteFile(filepath.Join(d, "in-attesa", fmt.Sprintf("%012d-%s.json", 1, chiave(1))), []byte("{rotto"), 0o600)
	got, err := c.Prossimi(5)
	if err != nil || len(got) != 1 || got[0].Sequenza != 2 {
		t.Fatalf("prossimi %+v err %v", got, err)
	}
	if k := c.Conta(); k.Scartate != 1 || k.InAttesa != 1 {
		t.Fatalf("conteggi %+v", k)
	}
}
