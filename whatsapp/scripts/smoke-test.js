const axios = require('axios')

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8081'

async function run() {
  const health = await axios.get(`${baseUrl.replace(/\/$/, '')}/health`)
  console.log('health:', health.data)
}

run().catch((error) => {
  console.error(error.response?.data || error.message)
  process.exit(1)
})
