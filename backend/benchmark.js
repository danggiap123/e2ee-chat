const bcrypt = require('bcrypt')

async function main() {
    const start = Date.now()
    const result = await bcrypt.hash('testpassword', 12)
    console.log('Hash:', result)
    console.log(Date.now() - start + 'ms')
}

main()