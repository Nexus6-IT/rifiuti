package trasporto

import (
	"bytes"
	"errors"
	"io"
	"net"
	"testing"
	"time"
)

type finto struct {
	pezzi [][]byte
}

func (f *finto) Read(p []byte) (int, error) {
	if len(f.pezzi) == 0 {
		return 0, io.EOF
	}
	n := copy(p, f.pezzi[0])
	f.pezzi = f.pezzi[1:]
	return n, nil
}
func (f *finto) SetDeadline(time.Time) error { return nil }

func TestFrameSpezzatoInTreLetture(t *testing.T) {
	l := NuovoLettoreFrame(&finto{pezzi: [][]byte{[]byte("ST,GS"), []byte(",  12"), []byte("34.50kg\r\n")}}, []byte("\r\n"), 256, time.Second)
	f, err := l.Leggi()
	if err != nil || string(f) != "ST,GS,  1234.50kg" {
		t.Fatalf("frame %q err %v", f, err)
	}
}

func TestDueFrameInUnaLettura(t *testing.T) {
	l := NuovoLettoreFrame(&finto{pezzi: [][]byte{[]byte("A\nB\nC")}}, []byte("\n"), 256, time.Second)
	for _, atteso := range []string{"A", "B"} {
		f, err := l.Leggi()
		if err != nil || string(f) != atteso {
			t.Fatalf("atteso %q, ottenuto %q err %v", atteso, f, err)
		}
	}
	if _, err := l.Leggi(); !errors.Is(err, io.EOF) { // "C" non e' terminato: mai restituito
		t.Fatalf("atteso EOF, ottenuto %v", err)
	}
}

func TestLettureDaZeroByteIgnorate(t *testing.T) {
	l := NuovoLettoreFrame(&finto{pezzi: [][]byte{{}, []byte("AB"), {}, {}, []byte("\n")}}, []byte("\n"), 256, time.Second)
	f, err := l.Leggi()
	if err != nil || string(f) != "AB" {
		t.Fatalf("frame %q err %v", f, err)
	}
}

func TestFrameOltreMaxScartato(t *testing.T) {
	grande := bytes.Repeat([]byte("X"), 40)
	l := NuovoLettoreFrame(&finto{pezzi: [][]byte{grande[:20], grande[20:], []byte("\nBUONO\n")}}, []byte("\n"), 16, time.Second)
	f, err := l.Leggi()
	if err != nil || string(f) != "BUONO" {
		t.Fatalf("frame %q err %v", f, err)
	}
	if l.Scartati != 1 {
		t.Fatalf("scartati %d", l.Scartati)
	}
}

func TestFrameCompletoMaTroppoLungoScartato(t *testing.T) {
	l := NuovoLettoreFrame(&finto{pezzi: [][]byte{[]byte("0123456789ABCDEFGH\nOK\n")}}, []byte("\n"), 8, time.Second)
	f, err := l.Leggi()
	if err != nil || string(f) != "OK" || l.Scartati != 1 {
		t.Fatalf("frame %q err %v scartati %d", f, err, l.Scartati)
	}
}

func TestLunghezzaFissa(t *testing.T) {
	l := NuovoLettoreLunghezzaFissa(&finto{pezzi: [][]byte{[]byte("ABC"), []byte("DEFG")}}, 3, time.Second)
	for _, a := range []string{"ABC", "DEF"} {
		if f, err := l.Leggi(); err != nil || string(f) != a {
			t.Fatalf("atteso %q, ottenuto %q err %v", a, f, err)
		}
	}
}

func TestTimeoutSenzaDati(t *testing.T) {
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	l := NuovoLettoreFrame(a, []byte("\n"), 256, 30*time.Millisecond)
	f, err := l.Leggi()
	if !errors.Is(err, ErrTimeout) || f != nil {
		t.Fatalf("frame %q err %v", f, err)
	}
}
