package firma

import "os"

func leggi(p string) ([]byte, error) { return os.ReadFile(p) }
