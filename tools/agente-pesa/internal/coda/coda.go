// Package coda e' la coda locale delle letture gia' firmate, su file (senza database, senza cgo).
//
// Layout in <dir>: in-attesa/<sequenza 12 cifre>-<chiave>.json, inviate/, scartate/ (con
// <nome>.motivo.txt accanto) e il file "sequenza". Ogni scrittura e' atomica (tmp + fsync + rename).
// Consegna almeno una volta: l'idempotenza del server la rende esattamente una.
package coda

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"wasteflow/agente-pesa/internal/fsatomic"
)

// LimitePredefinito: oltre questo numero di file in attesa l'agente smette di accettare letture.
const LimitePredefinito = 100_000

// Esito dice cosa ha risposto il server per un elemento.
type Esito int

const (
	Accettata Esito = iota
	GiaRicevuta
	Rifiutata
)

var (
	ErrCodaPiena  = errors.New("coda piena: lettura non accodata")
	ErrNonTrovata = errors.New("elemento non presente in coda")
	ErrDuplicato  = errors.New("elemento gia' in coda")

	reNome   = regexp.MustCompile(`^(\d{12})-([0-9a-f-]{36})\.json$`)
	reChiave = regexp.MustCompile(`^[0-9a-f-]{36}$`)
)

// Elemento e' una lettura firmata in coda.
type Elemento struct {
	PayloadB64        string    `json:"payloadB64"`
	FirmaB64          string    `json:"firmaB64"`
	ChiaveIdempotenza string    `json:"chiaveIdempotenza"`
	Sequenza          int64     `json:"sequenza"`
	CreataIl          time.Time `json:"creataIl"`
	Tentativi         int       `json:"tentativi"`
}

// Conteggi riassume la coda.
type Conteggi struct{ InAttesa, Inviate, Scartate int }

type voce struct {
	seq    int64
	chiave string
	nome   string
}

// Coda e' sicura per piu' goroutine di un solo processo.
type Coda struct {
	// Limite e' il massimo di elementi in attesa (default LimitePredefinito).
	Limite int

	mu     sync.Mutex
	dir    string
	ordine []voce // ordinato per sequenza
}

func sottocartella(dir, n string) string { return filepath.Join(dir, n) }

// Apri apre (o crea) la coda in dir: cancella i .tmp lasciati da un crash e ricostruisce l'indice.
func Apri(dir string) (*Coda, error) {
	for _, s := range []string{"in-attesa", "inviate", "scartate"} {
		if err := os.MkdirAll(sottocartella(dir, s), 0o700); err != nil {
			return nil, err
		}
	}
	c := &Coda{Limite: LimitePredefinito, dir: dir}
	for _, d := range []string{dir, sottocartella(dir, "in-attesa")} {
		es, err := os.ReadDir(d)
		if err != nil {
			return nil, err
		}
		for _, e := range es {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".tmp") {
				if err := os.Remove(filepath.Join(d, e.Name())); err != nil {
					return nil, err
				}
			}
		}
	}
	es, err := os.ReadDir(sottocartella(dir, "in-attesa"))
	if err != nil {
		return nil, err
	}
	for _, e := range es {
		m := reNome.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		seq, _ := strconv.ParseInt(m[1], 10, 64)
		c.ordine = append(c.ordine, voce{seq: seq, chiave: m[2], nome: e.Name()})
	}
	sort.Slice(c.ordine, func(i, j int) bool { return c.ordine[i].nome < c.ordine[j].nome })
	return c, nil
}

// ProssimaSequenza riserva e persiste (prima del file della lettura) il prossimo numero di sequenza.
// Parte da 1 e non viene mai riusato, neppure dopo un crash o la perdita del file "sequenza".
func (c *Coda) ProssimaSequenza() (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var ultima int64
	p := filepath.Join(c.dir, "sequenza")
	if b, err := os.ReadFile(p); err == nil {
		n, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
		if err != nil {
			return 0, fmt.Errorf("file sequenza illeggibile: %w", err)
		}
		ultima = n
	} else if !errors.Is(err, os.ErrNotExist) {
		return 0, err
	}
	if n := len(c.ordine); n > 0 && c.ordine[n-1].seq > ultima {
		ultima = c.ordine[n-1].seq
	}
	ultima++
	if err := fsatomic.Scrivi(p, []byte(strconv.FormatInt(ultima, 10)), 0o600); err != nil {
		return 0, err
	}
	return ultima, nil
}

// Accoda scrive l'elemento in modo atomico.
func (c *Coda) Accoda(l Elemento) error {
	if l.Sequenza < 1 || !reChiave.MatchString(l.ChiaveIdempotenza) {
		return errors.New("elemento non valido: sequenza o chiave")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, v := range c.ordine {
		if v.chiave == l.ChiaveIdempotenza {
			return ErrDuplicato
		}
	}
	if len(c.ordine) >= c.Limite {
		return ErrCodaPiena
	}
	if l.CreataIl.IsZero() {
		l.CreataIl = time.Now().UTC()
	}
	b, err := json.Marshal(l)
	if err != nil {
		return err
	}
	nome := fmt.Sprintf("%012d-%s.json", l.Sequenza, l.ChiaveIdempotenza)
	if err := fsatomic.Scrivi(filepath.Join(sottocartella(c.dir, "in-attesa"), nome), b, 0o600); err != nil {
		return err
	}
	v := voce{seq: l.Sequenza, chiave: l.ChiaveIdempotenza, nome: nome}
	i := sort.Search(len(c.ordine), func(i int) bool { return c.ordine[i].nome >= nome })
	c.ordine = append(c.ordine, voce{})
	copy(c.ordine[i+1:], c.ordine[i:])
	c.ordine[i] = v
	return nil
}

// Prossimi restituisce fino a n elementi, in ordine di sequenza. Un file illeggibile e' spostato
// in scartate/ con il motivo e saltato.
func (c *Coda) Prossimi(n int) ([]Elemento, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []Elemento
	for i := 0; i < len(c.ordine) && len(out) < n; {
		v := c.ordine[i]
		b, err := os.ReadFile(filepath.Join(sottocartella(c.dir, "in-attesa"), v.nome))
		var e Elemento
		if err == nil {
			err = json.Unmarshal(b, &e)
		}
		if err != nil {
			if err := c.sposta(v, "scartate", "file illeggibile: "+err.Error()); err != nil {
				return out, err
			}
			c.ordine = append(c.ordine[:i], c.ordine[i+1:]...)
			continue
		}
		out = append(out, e)
		i++
	}
	return out, nil
}

func (c *Coda) sposta(v voce, dest, motivo string) error {
	da := filepath.Join(sottocartella(c.dir, "in-attesa"), v.nome)
	a := filepath.Join(sottocartella(c.dir, dest), v.nome)
	if err := os.Rename(da, a); err != nil {
		return err
	}
	now := time.Now()
	_ = os.Chtimes(a, now, now)
	if dest == "scartate" {
		return fsatomic.Scrivi(a[:len(a)-len(".json")]+".motivo.txt", []byte(motivo+"\n"), 0o600)
	}
	return nil
}

// Segna registra l'esito del server: accettata o gia' ricevuta -> inviate/, rifiutata -> scartate/.
func (c *Coda) Segna(chiave string, esito Esito, motivo string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, v := range c.ordine {
		if v.chiave != chiave {
			continue
		}
		dest := "inviate"
		if esito == Rifiutata {
			dest = "scartate"
		}
		if err := c.sposta(v, dest, motivo); err != nil {
			return err
		}
		c.ordine = append(c.ordine[:i], c.ordine[i+1:]...)
		return nil
	}
	return ErrNonTrovata
}

// ContaCartella conta inviate e scartate leggendo la cartella (sicuro anche con l'agente acceso:
// non tocca nulla); InAttesa conta i file .json in in-attesa/.
func ContaCartella(dir string) Conteggi {
	conta := func(s string) int {
		es, _ := os.ReadDir(sottocartella(dir, s))
		n := 0
		for _, e := range es {
			if strings.HasSuffix(e.Name(), ".json") {
				n++
			}
		}
		return n
	}
	return Conteggi{InAttesa: conta("in-attesa"), Inviate: conta("inviate"), Scartate: conta("scartate")}
}

// Conta riassume la coda.
func (c *Coda) Conta() Conteggi {
	k := ContaCartella(c.dir)
	c.mu.Lock()
	k.InAttesa = len(c.ordine)
	c.mu.Unlock()
	return k
}

// Pulisci toglie dalle inviate gli elementi piu' vecchi di oltre (le scartate restano per l'analisi).
func (c *Coda) Pulisci(oltre time.Duration) error {
	d := sottocartella(c.dir, "inviate")
	es, err := os.ReadDir(d)
	if err != nil {
		return err
	}
	limite := time.Now().Add(-oltre)
	for _, e := range es {
		info, err := e.Info()
		if err != nil || info.ModTime().After(limite) {
			continue
		}
		if err := os.Remove(filepath.Join(d, e.Name())); err != nil {
			return err
		}
	}
	return nil
}
