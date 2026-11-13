package coda

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// orologioProva e' un'ora che il test sposta a mano.
type orologioProva struct{ t time.Time }

func (o *orologioProva) adesso() time.Time { return o.t }

func apriConOra(t *testing.T) (*Coda, string, *orologioProva) {
	t.Helper()
	c, d := apri(t)
	o := &orologioProva{t: time.Date(2026, 11, 13, 10, 0, 0, 0, time.UTC)}
	c.Adesso = o.adesso
	return c, d, o
}

func TestSospesaRestaInCodaERiprovaConBackoff(t *testing.T) {
	c, _, o := apriConOra(t)
	c.Accoda(el(1))
	c.Accoda(el(2))
	scartata, err := c.Sospendi(chiave(1), "OROLOGIO_AVANTI: pc avanti")
	if err != nil || scartata {
		t.Fatalf("scartata=%v err=%v", scartata, err)
	}
	// non scade: la 2 passa avanti, la 1 non blocca la testa
	got, _ := c.Prossimi(10)
	if len(got) != 1 || got[0].Sequenza != 2 {
		t.Fatalf("prossimi %+v", got)
	}
	if k := c.Conta(); k.InAttesa != 2 || k.Scartate != 0 {
		t.Fatalf("conteggi %+v", k)
	}
	o.t = o.t.Add(RiprovaMin - time.Second)
	if got, _ := c.Prossimi(10); len(got) != 1 {
		t.Fatalf("prima della scadenza: %+v", got)
	}
	o.t = o.t.Add(time.Second)
	got, _ = c.Prossimi(10)
	if len(got) != 2 || got[0].Sequenza != 1 || got[0].Tentativi != 1 {
		t.Fatalf("alla scadenza: %+v", got)
	}
	// backoff crescente con tetto: 10, 20, 40, 60, 60 minuti
	atteso := []time.Duration{20 * time.Minute, 40 * time.Minute, time.Hour, time.Hour}
	for _, a := range atteso {
		if _, err := c.Sospendi(chiave(1), "OROLOGIO_AVANTI"); err != nil {
			t.Fatal(err)
		}
		o.t = o.t.Add(a - time.Second)
		if got, _ := c.Prossimi(10); len(got) != 1 {
			t.Fatalf("attesa %v: troppo presto %+v", a, got)
		}
		o.t = o.t.Add(time.Second)
		if got, _ := c.Prossimi(10); len(got) != 2 {
			t.Fatalf("attesa %v: doveva essere pronta", a)
		}
	}
}

func TestSospesaSopravviveAlRiavvio(t *testing.T) {
	c, d, o := apriConOra(t)
	c.Accoda(el(1))
	c.Sospendi(chiave(1), "FUORI_PORTATA")
	c2, err := Apri(d)
	if err != nil {
		t.Fatal(err)
	}
	c2.Adesso = o.adesso
	if got, _ := c2.Prossimi(10); len(got) != 0 {
		t.Fatalf("dopo il riavvio la riprova deve restare: %+v", got)
	}
	o.t = o.t.Add(RiprovaMin)
	if got, _ := c2.Prossimi(10); len(got) != 1 {
		t.Fatalf("scaduta: %+v", got)
	}
}

func TestSospesaScadeDopoSetteGiorni(t *testing.T) {
	c, d, o := apriConOra(t)
	c.Accoda(el(1))
	if scartata, _ := c.Sospendi(chiave(1), "STRUMENTO_NON_ASSEGNATO: x"); scartata {
		t.Fatal("la prima sospensione non scarta")
	}
	o.t = o.t.Add(ScadenzaSospese + time.Minute)
	scartata, err := c.Sospendi(chiave(1), "STRUMENTO_NON_ASSEGNATO: x")
	if err != nil || !scartata {
		t.Fatalf("scartata=%v err=%v", scartata, err)
	}
	if k := c.Conta(); k.InAttesa != 0 || k.Scartate != 1 {
		t.Fatalf("conteggi %+v", k)
	}
	m, _ := os.ReadFile(filepath.Join(d, "scartate", fmt.Sprintf("%012d-%s.motivo.txt", 1, chiave(1))))
	if !strings.Contains(string(m), "STRUMENTO_NON_ASSEGNATO") || !strings.Contains(string(m), "7 giorni") {
		t.Fatalf("motivo %q", m)
	}
	if err := func() error { _, e := c.Sospendi(chiave(9), "x"); return e }(); !errors.Is(err, ErrNonTrovata) {
		t.Fatalf("errore %v", err)
	}
}

func TestSequenzaFileCorrottoRicostruitaDalleCartelle(t *testing.T) {
	c, d := apri(t)
	for i := 0; i < 3; i++ {
		c.ProssimaSequenza()
	}
	c.Accoda(el(7))
	c.Accoda(el(8))
	c.Segna(chiave(7), Accettata, "")
	c.Segna(chiave(8), Rifiutata, "x")
	for _, contenuto := range []string{"", "xyz", "-5"} {
		os.WriteFile(filepath.Join(d, "sequenza"), []byte(contenuto), 0o600)
		c2, err := Apri(d)
		if err != nil {
			t.Fatal(err)
		}
		got, err := c2.ProssimaSequenza()
		if err != nil || got != 9 {
			t.Fatalf("file %q: sequenza %d err %v, attesa 9 (max in inviate/scartate)", contenuto, got, err)
		}
	}
}

func TestSequenzaFilePersoConTuttoInInviate(t *testing.T) {
	c, d := apri(t)
	c.Accoda(el(5))
	c.Segna(chiave(5), Accettata, "")
	os.Remove(filepath.Join(d, "sequenza"))
	c2, _ := Apri(d)
	if got, err := c2.ProssimaSequenza(); err != nil || got != 6 {
		t.Fatalf("sequenza %d err %v", got, err)
	}
}

func TestSequenzaInMemoriaAncheSeIlFileSparisce(t *testing.T) {
	c, d := apri(t)
	c.ProssimaSequenza()
	c.ProssimaSequenza()
	os.Remove(filepath.Join(d, "sequenza"))
	if got, _ := c.ProssimaSequenza(); got != 3 {
		t.Fatalf("sequenza %d", got)
	}
}

func TestErroreDiLetturaNonScartaLaLettura(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root legge anche i file con permessi 000")
	}
	c, d := apri(t)
	c.Accoda(el(1))
	c.Accoda(el(2))
	p := filepath.Join(d, "in-attesa", fmt.Sprintf("%012d-%s.json", 1, chiave(1)))
	os.Chmod(p, 0)
	got, err := c.Prossimi(5)
	if err == nil {
		t.Fatal("l'errore di I/O deve essere restituito")
	}
	if len(got) != 1 || got[0].Sequenza != 2 {
		t.Fatalf("le altre letture devono passare: %+v", got)
	}
	if k := c.Conta(); k.Scartate != 0 || k.InAttesa != 2 {
		t.Fatalf("la lettura non va spostata: %+v", k)
	}
	os.Chmod(p, 0o600)
	if got, err := c.Prossimi(5); err != nil || len(got) != 2 {
		t.Fatalf("dopo il ripristino: %+v %v", got, err)
	}
}

func TestTmpRimastiInInviateEScartateCancellati(t *testing.T) {
	_, d := apri(t)
	a := filepath.Join(d, "inviate", "x.json.tmp")
	b := filepath.Join(d, "scartate", "y.motivo.txt.tmp")
	os.WriteFile(a, []byte("x"), 0o600)
	os.WriteFile(b, []byte("y"), 0o600)
	if _, err := Apri(d); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{a, b} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("%s non cancellato", p)
		}
	}
}
