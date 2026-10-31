// Offline conversion of our own vector art. Run with the installed Electron only.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const root = resolve(__dirname, '..')
const runtime = resolve(root, '.cache/asset-renderer')
mkdirSync(runtime, { recursive: true })
app.setPath('userData', runtime)
app.setPath('sessionData', runtime)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html,<html><body></body></html>')
  const render = async (svg, size) => {
    const data = await window.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=${size};canvas.getContext('2d').drawImage(image,0,0,${size},${size});return canvas.toDataURL('image/png').split(',')[1]})()`)
    return Buffer.from(data, 'base64')
  }
  const icon = readFileSync(resolve(root, 'src/renderer/src/assets/coffee.svg'), 'utf8')
  mkdirSync(resolve(root, 'resources'), { recursive: true })
  writeFileSync(resolve(root, 'resources/coffee.png'), await render(icon, 512))
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = []
  for (const size of sizes) images.push(await render(icon, size))
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, index) => {
    const pos = 6 + index * 16
    header[pos] = header[pos + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, pos + 4); header.writeUInt16LE(32, pos + 6)
    header.writeUInt32LE(images[index].length, pos + 8); header.writeUInt32LE(offset, pos + 12)
    offset += images[index].length
  })
  writeFileSync(resolve(root, 'resources/coffee.ico'), Buffer.concat([header, ...images]))
  for (const [name, frequency, seed] of [['paper-grain', '.73', 0], ['paper-bloom', '.009 .014', 15]]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><filter id="f"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="3" stitchTiles="stitch" seed="${seed}"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#f)"/></svg>`
    writeFileSync(resolve(root, `src/renderer/src/assets/${name}.png`), await render(svg, 512))
  }
  console.log('Generated coffee PNG/ICO and static paper textures locally; no network access.')
  window.destroy(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
