package trasporto

import (
	"bytes"
	"errors"
	"io"
	"os"
	"time"
)

// Lettore e' quanto serve a LettoreFrame: lettura con scadenza.
type Lettore interface {
	io.Reader
	SetDeadline(time.Time) error
}

// LettoreFrame ricompone i frame di uno strumento da letture TCP/seriali arbitrarie: un frame puo'
// arrivare spezzato, o piu' frame in una sola lettura. Delimitatore oppure lunghezza fissa.
type LettoreFrame struct {
	r       Lettore
	delim   []byte
	lung    int
	max     int
	timeout time.Duration
	buf     []byte
	tmp     []byte
	scarta  bool
	// Scartati conta i frame scartati perche' oltre il massimo.
	Scartati int
}

// NuovoLettoreFrame legge frame terminati da delim; i frame oltre max byte sono scartati.
func NuovoLettoreFrame(r Lettore, delim []byte, max int, timeout time.Duration) *LettoreFrame {
	return &LettoreFrame{r: r, delim: delim, max: max, timeout: timeout, tmp: make([]byte, 512)}
}

// NuovoLettoreLunghezzaFissa legge frame di n byte esatti.
func NuovoLettoreLunghezzaFissa(r Lettore, n int, timeout time.Duration) *LettoreFrame {
	return &LettoreFrame{r: r, lung: n, max: n, timeout: timeout, tmp: make([]byte, 512)}
}

func timeoutErr(err error) bool {
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return true
	}
	var t interface{ Timeout() bool }
	return errors.As(err, &t) && t.Timeout()
}

// Leggi restituisce il prossimo frame (senza delimitatore). Errore ErrTimeout se non arriva nulla
// entro il timeout; mai un frame vuoto.
func (l *LettoreFrame) Leggi() ([]byte, error) {
	zeri := 0
	for {
		if f, ok := l.estrai(); ok {
			return f, nil
		}
		if err := l.r.SetDeadline(time.Now().Add(l.timeout)); err != nil {
			return nil, err
		}
		n, err := l.r.Read(l.tmp)
		l.buf = append(l.buf, l.tmp[:n]...)
		if n > 0 {
			zeri = 0
		}
		if err != nil {
			if f, ok := l.estrai(); ok {
				return f, nil
			}
			if timeoutErr(err) {
				return nil, ErrTimeout
			}
			return nil, err
		}
		if n == 0 { // le letture da 0 byte si ignorano (difetto 7), ma senza girare a vuoto per sempre
			if zeri++; zeri > 100 {
				return nil, io.ErrNoProgress
			}
		}
	}
}

func (l *LettoreFrame) estrai() ([]byte, bool) {
	if l.lung > 0 {
		if len(l.buf) < l.lung {
			return nil, false
		}
		f := append([]byte(nil), l.buf[:l.lung]...)
		l.buf = l.buf[l.lung:]
		return f, true
	}
	for {
		i := bytes.Index(l.buf, l.delim)
		if l.scarta {
			if i < 0 { // si tiene solo la coda che potrebbe contenere meta' delimitatore
				if k := len(l.delim) - 1; len(l.buf) > k {
					l.buf = append([]byte(nil), l.buf[len(l.buf)-k:]...)
				}
				return nil, false
			}
			l.buf = l.buf[i+len(l.delim):]
			l.scarta = false
			continue
		}
		if i < 0 {
			if len(l.buf) > l.max {
				l.scarta = true
				l.Scartati++
				continue
			}
			return nil, false
		}
		f := append([]byte(nil), l.buf[:i]...)
		l.buf = l.buf[i+len(l.delim):]
		switch {
		case len(f) == 0:
			continue
		case len(f) > l.max:
			l.Scartati++
			continue
		}
		return f, true
	}
}
