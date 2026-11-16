// Stub per jest: tedious (driver di mssql) carica @azure/identity anche se l'autenticazione
// Azure non si usa, e quel pacchetto distribuisce ESM che jest non trasforma.
module.exports = {}
