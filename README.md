# vite-plugin-deploy

[![NPM version](https://img.shields.io/npm/v/@oiij/ts-starter)](https://www.npmjs.com/package/@oiij/ts-starter)
[![GITHUB star](https://img.shields.io/github/stars/oiij/ts-starter?style=flat)](https://github.com/oiij/ts-starter)
[![MIT-license](https://img.shields.io/npm/l/@oiij/ts-starter)](https://github.com/Eiog/@oiij/ts-starter/blob/main/LICENSE)
[![GITHUB-language](https://img.shields.io/github/languages/top/oiij/ts-starter)](https://github.com/oiij/ts-starter)

Features:

- Bundle with [tsdown](https://github.com/rolldown/tsdown)
- Test with [vitest](https://vitest.dev)

# Install

```bash
pnpm add vite-plugin-deploy -D
```

# Usage

```ts
// vite.config.js
import { defineConfig } from 'vite'
import { vitePluginDeploy } from 'vite-plugin-deploy'

export default defineConfig({
  plugins: [
    // ...plugins
    vitePluginDeploy({
      port: 22,
      host: 'xxx.xxx.xxx.xxx',
      username: 'xxx',
      password: 'xxx',
      //   privateKey:'',
      // ...options, //https://github.com/theophilusx/ssh2-sftp-client
      localDir: 'dist', // 本地路径 默认为 dist
      remoteDir: '/home/dist', // 远程路径 默认为 /home/dist
      backup: '/home/dist_backup'// 备份远程路径 默认为 /home/dist_backup boolean|string
    })// 请放到最后
  ]
})

```

## License

MIT
