# vite-plugin-deploy

[![NPM version](https://img.shields.io/npm/v/@oiij/vite-plugin-deploy)](https://www.npmjs.com/package/@oiij/vite-plugin-deploy)
[![GITHUB star](https://img.shields.io/github/stars/oiij/vite-plugin-deploy?style=flat)](https://github.com/oiij/vite-plugin-deploy)
[![MIT-license](https://img.shields.io/npm/l/@oiij/vite-plugin-deploy)](https://github.com/oiij/vite-plugin-deploy/blob/main/LICENSE)
[![GITHUB-language](https://img.shields.io/github/languages/top/oiij/vite-plugin-deploy)](https://github.com/oiij/vite-plugin-deploy)

A Vite plugin for deploying static files using ssh2-sftp-client.

## Features

- 🚀 Automatic deployment after build
- 🔧 Configurable connection options
- 📁 Backup remote directory before deployment
- 📊 Real-time deployment progress
- 🔍 Automatic detection of build output directory from Vite config
- 🛡️ Robust error handling and recovery
- ✅ Comprehensive test coverage with Vitest

## Install

```bash
pnpm add @oiij/vite-plugin-deploy -D
```

## Usage

```ts
// vite.config.js

import { vitePluginDeploy } from '@oiij/vite-plugin-deploy'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    // ...other plugins
    vitePluginDeploy({
      // Enable deployment (default: true)
      enable: true,

      // Local directory to deploy (default: Vite's build.outDir or 'dist')
      localDir: 'dist',

      // Remote directory to deploy to (default: /home/dist)
      remoteDir: '/home/dist',

      // Backup remote directory before deployment
      // Can be boolean or string (custom backup path)
      // Default: true (backs up to /home/dist_backup)
      backup: true,

      // SSH connection options
      connectOptions: {
        host: 'xxx.xxx.xxx.xxx',
        port: 22,
        username: 'xxx',
        password: 'xxx',
        // privateKey: '',
        // ...other options from ssh2-sftp-client
      },

      // Upload options from ssh2-sftp-client
      uploadOptions: {
        // ...upload options
      }
    }) // Please place at the end
  ]
})
```

## Configuration

### Options

| Option           | Type              | Default                         | Description                                                                                      |
| ---------------- | ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `enable`         | `boolean`         | `true`                          | Whether to enable deployment                                                                     |
| `localDir`       | `string`          | `Vite's build.outDir or 'dist'` | Local directory to deploy                                                                        |
| `remoteDir`      | `string`          | `/home/dist`                    | Remote directory to deploy to                                                                    |
| `backup`         | `boolean  string` | `true`                          | Whether to backup remote directory before deployment, or custom backup path                      |
| `connectOptions` | `object`          | `{}`                            | SSH connection options (see [ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client)) |
| `uploadOptions`  | `object`          | `{}`                            | Upload options (see [ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client))         |

## How it works

1. **Configuration Resolution**: The plugin resolves Vite config in the `configResolved` hook
2. **Build Completion**: Deployment starts after the build completes via the `closeBundle` hook
3. **Connection Establishment**: Establishes SSH connection to the remote server
4. **Backup (if enabled)**: Backs up the existing remote directory
5. **File Upload**: Uploads all files from the local directory to the remote server
6. **Progress Tracking**: Displays real-time upload progress
7. **Error Handling**: Gracefully handles errors and attempts to restore from backup if needed
8. **Connection Closure**: Ensures SSH connection is properly closed

## Tips

- **Place at the end**: Always place the plugin at the end of the plugins array to ensure it runs after all other plugins
- **Security**: For production deployments, consider using `privateKey` instead of `password` for authentication
- **Backup**: Enable backup to prevent data loss in case of deployment failures
- **Logging**: The plugin provides detailed logs during deployment for easy debugging

## License

MIT
