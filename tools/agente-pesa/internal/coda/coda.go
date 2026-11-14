// Package coda e' la coda locale delle letture gia' firmate, su file (senza database, senza cgo).
//
// Layout in <dir>: in-attesa/<sequenza 12 cifre>-<chiave>.json, inviate/, scartate/ (con
// <nome>.motivo.txt accanto) e il file "sequenza". Ogni scrittura e' atomica (tmp + fsync + rename).
// Consegna almeno una volta: l'idempotenza del server la rende esattamente una.
//
// Una lettura rifiutata dal server per un motivo che il tempo puo' risolvere (orologio, strumento
// non ancora assegnato...) e' "sospesa": resta in in-attesa/ con una data di riprova e scade, in
// scartate/, dopo ScadenzaSospese. Le sospese non bloccano le letture successive.
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

// Tempi della riprova delle letture sospese: backoff 10 min, 20, 40, poi 1 ora; scarto dopo 7 giorni.
const (
	RiprovaMin      = 10 * time.Minute
	RiprovaMax      = time.Hour
	ScadenzaSospese = 7 * 24 * time.Hour
)

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
	reSeq    = regexp.MustCompile(`^(\d{12})-[0-9a-f-]{36}\.`)
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
	// Solo per le letture sospese (rifiuto transitorio del server).
	SospesaDal   *time.Time `json:"sospesaDal,omitempty"`
	RiprovaDopo  *time.Time `json:"riprovaDopo,omitempty"`
	UltimoMotivo string     `json:"ultimoMotivo,omitempty"`
}

// Conteggi riassume la coda.
type Conteggi struct{ InAttesa, Inviate, Scartate int }

type voce struct {
	seq     int64
	chiave  string
	nome    string
	riprova time.Time // sospesa fino a questa ora (zero = pronta)
}

// Coda e' sicura per piu' goroutine di un solo processo.
type Coda struct {
	// Limite e' il massimo di elementi in attesa (default LimitePredefinito).
	Limite int
	// Adesso da' l'ora (default time.Now); l'agente ci mette il suo orologio.
	Adesso func() time.Time

	mu     sync.Mutex
	dir    string
	ordine []voce // ordinato per sequenza
	ultima int64  // ultima sequenza riservata (in memoria: il file "sequenza" non e' l'unica fonte)
}

// Dir e' la cartella della coda.
func (c *Coda) Dir() string { return c.dir }

func (c *Coda) ora() time.Time {
	if c.Adesso != nil {
		return c.Adesso()
	}
	return time.Now()
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
	for _, d := range []string{dir, sottocartella(dir, "in-attesa"), sottocartella(dir, "inviate"), sottocartella(dir, "scartate")} {
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
	c.ultima = ricostruisciSequenza(dir)
	return c, nil
}

// ricostruisciSequenza e' il massimo fra il file "sequenza" (se leggibile) e i numeri nei nomi dei
// file in in-attesa/, inviate/ e scartate/: un file mancante o corrotto non fa ripartire la
// numerazione da un valore gia' usato (il server rifiuta due letture con la stessa sequenza).
func ricostruisciSequenza(dir string) int64 {
	var max int64
	if b, err := os.ReadFile(filepath.Join(dir, "sequenza")); err == nil {
		if n, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64); err == nil && n > max {
			max = n
		}
	}
	for _, s := range []string{"in-attesa", "inviate", "scartate"} {
		es, _ := os.ReadDir(sottocartella(dir, s))
		for _, e := range es {
			if m := reSeq.FindStringSubmatch(e.Name()); m != nil {
				if n, _ := strconv.ParseInt(m[1], 10, 64); n > max {
					max = n
				}
			}
		}
	}
	return max
}

// ProssimaSequenza riserva e persiste (prima del file della lettura) il prossimo numero di sequenza.
// Parte da 1 e non viene riusato: il massimo e' tenuto in memoria e ricostruito all'apertura anche
// dai nomi dei file, quindi un file "sequenza" corrotto o perso non lo fa ripartire. Resta un solo
// caso scoperto: file perso E nessuna lettura piu' presente in nessuna cartella (inviate/ si pulisce
// dopo 30 giorni) E riavvio del processo.
func (c *Coda) ProssimaSequenza() (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ultima := c.ultima
	if n := len(c.ordine); n > 0 && c.ordine[n-1].seq > ultima {
		ultima = c.ordine[n-1].seq
	}
	ultima++
	if err := fsatomic.Scrivi(filepath.Join(c.dir, "sequenza"), []byte(strconv.FormatInt(ultima, 10)), 0o600); err != nil {
		return 0, err
	}
	c.ultima = ultima
	return ultima, nil
}

// AlzaSequenza porta il contatore ad almeno n (mai indietro) e lo persiste: serve a riallinearsi
// all'ultima sequenza nota al server quando il contatore locale e' stato perso (il server rifiuta
// una sequenza gia' usata). La prossima sequenza riservata sara' > n.
func (c *Coda) AlzaSequenza(n int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if n <= c.ultima {
		return nil
	}
	if err := fsatomic.Scrivi(filepath.Join(c.dir, "sequenza"), []byte(strconv.FormatInt(n, 10)), 0o600); err != nil {
		return err
	}
	c.ultima = n
	return nil
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

// Prossimi restituisce fino a n elementi pronti, in ordine di sequenza; le sospese non ancora
// scadute sono saltate. Un file con contenuto non valido e' spostato in scartate/ con il motivo.
// Un errore di lettura (per esempio un file tenuto aperto dall'antivirus su Windows) NON sposta
// nulla: la lettura resta dov'e', viene saltata e il primo errore e' restituito insieme agli altri
// elementi.
func (c *Coda) Prossimi(n int) ([]Elemento, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ora := c.ora()
	var out []Elemento
	var primoErr error
	for i := 0; i < len(c.ordine) && len(out) < n; {
		v := c.ordine[i]
		if ora.Before(v.riprova) {
			i++
			continue
		}
		b, err := os.ReadFile(filepath.Join(sottocartella(c.dir, "in-attesa"), v.nome))
		if err != nil {
			if primoErr == nil {
				primoErr = fmt.Errorf("lettura di %s: %w", v.nome, err)
			}
			i++
			continue
		}
		var e Elemento
		if err := json.Unmarshal(b, &e); err != nil {
			if err := c.sposta(v, "scartate", "file illeggibile: "+err.Error()); err != nil {
				return out, err
			}
			c.ordine = append(c.ordine[:i], c.ordine[i+1:]...)
			continue
		}
		if e.RiprovaDopo != nil && ora.Before(*e.RiprovaDopo) { // sospesa prima di un riavvio
			c.ordine[i].riprova = *e.RiprovaDopo
			i++
			continue
		}
		out = append(out, e)
		i++
	}
	return out, primoErr
}

// Sospendi tiene la lettura in coda dopo un rifiuto transitorio del server: la riprova avviene dopo
// un backoff (10 min, 20, 40, poi 1 ora) e, se la prima sospensione risale a oltre ScadenzaSospese,
// la lettura passa in scartate/. Restituisce true se e' stata scartata.
func (c *Coda) Sospendi(chiave, motivo string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, v := range c.ordine {
		if v.chiave != chiave {
			continue
		}
		p := filepath.Join(sottocartella(c.dir, "in-attesa"), v.nome)
		b, err := os.ReadFile(p)
		if err != nil {
			return false, err
		}
		var e Elemento
		if err := json.Unmarshal(b, &e); err != nil {
			return false, fmt.Errorf("elemento illeggibile: %w", err)
		}
		ora := c.ora().UTC()
		if e.SospesaDal == nil {
			e.SospesaDal = &ora
		}
		if ora.Sub(*e.SospesaDal) >= ScadenzaSospese {
			if err := c.sposta(v, "scartate", fmt.Sprintf("scaduta dopo 7 giorni di tentativi (%s): %s", ora.Sub(*e.SospesaDal).Round(time.Hour), motivo)); err != nil {
				return false, err
			}
			c.ordine = append(c.ordine[:i], c.ordine[i+1:]...)
			return true, nil
		}
		e.Tentativi++
		attesa := RiprovaMin
		for k := 1; k < e.Tentativi && attesa < RiprovaMax; k++ {
			attesa *= 2
		}
		if attesa > RiprovaMax {
			attesa = RiprovaMax
		}
		dopo := ora.Add(attesa)
		e.RiprovaDopo, e.UltimoMotivo = &dopo, motivo
		nuovo, err := json.Marshal(e)
		if err != nil {
			return false, err
		}
		if err := fsatomic.Scrivi(p, nuovo, 0o600); err != nil {
			return false, err
		}
		c.ordine[i].riprova = dopo
		return false, nil
	}
	return false, ErrNonTrovata
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
