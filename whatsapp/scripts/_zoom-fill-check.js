const puppeteer = require('whatsapp-web.js/node_modules/puppeteer')

;(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('hel-app-zoom', '80'))
  await page.goto('http://127.0.0.1:8081/dashboard/', { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('.app-zoom-canvas')
  const r = await page.evaluate(() => {
    const canvas = document.querySelector('.app-zoom-canvas')
    const shell = document.createElement('div')
    shell.className = 'flex w-full h-app'
    shell.style.display = 'flex'
    shell.style.width = '100%'

    const side = document.createElement('aside')
    side.id = 'app-sidebar'
    side.style.cssText =
      'flex:0 0 248px;background:#fff;border-right:1px solid #ccc;min-height:100%;align-self:stretch;display:flex;flex-direction:column;'
    const admin = document.createElement('div')
    admin.style.marginTop = 'auto'
    admin.textContent = 'Admin'
    side.appendChild(admin)

    const main = document.createElement('div')
    main.style.cssText =
      'flex:1;min-width:0;min-height:100%;display:flex;flex-direction:column;background:#F5FAFC;'
    const header = document.createElement('div')
    header.id = 'top-header'
    header.style.cssText = 'height:56px;width:100%;background:#e4f6f8;flex-shrink:0;'
    const body = document.createElement('div')
    body.style.cssText = 'flex:1;background:#F5FAFC;'
    main.append(header, body)
    shell.append(side, main)
    canvas.innerHTML = ''
    canvas.appendChild(shell)

    const sr = side.getBoundingClientRect()
    const hr = header.getBoundingClientRect()
    const mr = main.getBoundingClientRect()
    const box = document.createElement('div')
    box.style.cssText = 'width:100px;height:50px;'
    side.appendChild(box)
    const scale = box.getBoundingClientRect().width / 100
    box.remove()

    return {
      zoom: getComputedStyle(canvas).zoom,
      vw: innerWidth,
      vh: innerHeight,
      sidebarBottom: sr.bottom,
      headerRight: hr.right,
      mainRight: mr.right,
      mainBottom: mr.bottom,
      scale,
      ok: {
        sideBottom: Math.abs(sr.bottom - innerHeight) <= 3,
        headerRight: Math.abs(hr.right - innerWidth) <= 4,
        mainRight: Math.abs(mr.right - innerWidth) <= 4,
        mainBottom: mr.bottom + 1 >= innerHeight - 3,
        scaleOk: Math.abs(scale - 0.8) < 0.02,
      },
    }
  })
  console.log(JSON.stringify(r, null, 2))
  const failed = Object.entries(r.ok).filter(([, v]) => !v)
  if (failed.length) {
    console.error('FAIL', failed)
    process.exit(1)
  }
  console.log('flex-shell-zoom-fill: PASS')
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
