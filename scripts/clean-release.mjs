// 打包后清理 release：只保留各代安装包 exe，删掉 win-unpacked / 调试文件 / blockmap
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
const dir = path.resolve('release', pkg.version)
if (!fs.existsSync(dir)) process.exit(0)

for (const name of ['win-unpacked', 'builder-debug.yml', 'builder-effective-config.yaml']) {
  fs.rmSync(path.join(dir, name), { recursive: true, force: true })
}
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.blockmap')) fs.rmSync(path.join(dir, f), { force: true })
}
console.log('[clean-release] done:', dir)
