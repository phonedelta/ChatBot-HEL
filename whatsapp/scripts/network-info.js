/**
 * Print LAN URLs for the dashboard/API.
 * Run: npm run network:info
 */
const os = require('os')

const port = Number(process.env.PORT || 8081)
const host = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0'

function listNetworkAddresses() {
  const addresses = new Set()
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue
      addresses.add(entry.address)
    }
  }
  return Array.from(addresses)
}

console.log('ChatBot HEL — accès réseau')
console.log(`HOST=${host}  PORT=${port}`)
console.log('')
console.log(`Local:   http://127.0.0.1:${port}/dashboard`)
const addresses = listNetworkAddresses()
if (!addresses.length) {
  console.log('Réseau:  (aucune adresse IPv4 LAN détectée)')
} else {
  for (const address of addresses) {
    console.log(`Réseau:  http://${address}:${port}/dashboard`)
  }
}
console.log('')
console.log('Même Wi‑Fi / LAN requis. Autorisez le port dans le pare-feu Windows si besoin.')
