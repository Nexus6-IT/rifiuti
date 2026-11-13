// Package registro e' il log dell'agente: slog in JSON, rotazione per dimensione scritta in proprio,
// e un filtro che toglie dai valori ogni token "wfpa_...".
package registro

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var reToken = regexp.MustCompile(`wfpa_[A-Za-z0-9_-]+`)

// Maschera sostituisce ogni token dell'agente con "[token]".
func Maschera(s string) string { return reToken.ReplaceAllString(s, "[token]") }

func scrub(_ []string, a slog.Attr) slog.Attr {
	switch a.Value.Kind() {
	case slog.KindString:
		return slog.String(a.Key, Maschera(a.Value.String()))
	case slog.KindAny:
		if e, ok := a.Value.Any().(error); ok {
			return slog.String(a.Key, Maschera(e.Error()))
		}
		if s, ok := a.Value.Any().(fmt.Stringer); ok {
			return slog.String(a.Key, Maschera(s.String()))
		}
	}
	return a
}

// Nuovo crea un logger JSON su w; livello: debug, info, warn, error (altro = info).
func Nuovo(w io.Writer, livello string) *slog.Logger {
	var l slog.Level
	switch strings.ToLower(livello) {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: l, ReplaceAttr: scrub}))
}

// Rotante scrive su path e ruota a maxByte: path, path.1, ... path.(file-1). Con file <= 1 tronca.
type Rotante struct {
	mu      sync.Mutex
	path    string
	maxByte int64
	file    int
	f       *os.File
	dim     int64
}

// NuovoRotante apre path in append (creando la cartella).
func NuovoRotante(path string, maxByte int64, file int) (*Rotante, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	r := &Rotante{path: path, maxByte: maxByte, file: file}
	if err := r.apri(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *Rotante) apri() error {
	f, err := os.OpenFile(r.path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	r.f, r.dim = f, info.Size()
	return nil
}

func (r *Rotante) ruota() error {
	r.f.Close()
	if r.file > 1 {
		os.Remove(fmt.Sprintf("%s.%d", r.path, r.file-1))
		for i := r.file - 2; i >= 1; i-- {
			os.Rename(fmt.Sprintf("%s.%d", r.path, i), fmt.Sprintf("%s.%d", r.path, i+1))
		}
		if err := os.Rename(r.path, r.path+".1"); err != nil {
			return err
		}
	} else if err := os.Remove(r.path); err != nil {
		return err
	}
	return r.apri()
}

func (r *Rotante) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.dim > 0 && r.dim+int64(len(p)) > r.maxByte {
		if err := r.ruota(); err != nil {
			return 0, err
		}
	}
	n, err := r.f.Write(p)
	r.dim += int64(n)
	return n, err
}

// Close chiude il file corrente.
func (r *Rotante) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.f.Close()
}
