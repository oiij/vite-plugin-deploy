# vite-plugin-deploy

[![NPM version](https://img.shields.io/npm/v/@oiij/vite-plugin-deploy)](https://www.npmjs.com/package/@oiij/vite-plugin-deploy)
[![GITHUB star](https://img.shields.io/github/stars/oiij/vite-plugin-deploy?style=flat)](https://github.com/oiij/vite-plugin-deploy)
[![MIT-license](https://img.shields.io/npm/l/@oiij/vite-plugin-deploy)](https://github.com/oiij/vite-plugin-deploy/blob/main/LICENSE)
[![GITHUB-language](https://img.shields.io/github/languages/top/oiij/vite-plugin-deploy)](https://github.com/oiij/vite-plugin-deploy)

一个基于 ssh2-sftp-client 的 Vite 部署插件，用于将构建产物部署到远端服务器。

## 功能特性

- 🚀 构建完成后自动部署（通过 Vite 的 `closeBundle` 钩子）
- 🔍 自动识别 Vite 的构建输出目录
- 📦 可选压缩上传——打包成单个 `tar.gz`，一次上传，远端解压
- 📁 通过临时目录交换实现原子部署（目标目录不会出现半成品）
- 🛡️ 远端备份，失败时自动回滚
- 📊 实时进度：逐文件计数，或压缩包大小与传输百分比
- 🔧 可配置的 SSH 连接与上传参数

## 安装

```bash
pnpm add @oiij/vite-plugin-deploy -D
```

## 使用

```ts
// vite.config.ts

import { vitePluginDeploy } from '@oiij/vite-plugin-deploy'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    // ...其他插件
    vitePluginDeploy({
      // 是否启用部署（默认 true）
      enable: true,

      // 本地待部署目录（默认取 Vite 的 build.outDir 或 'dist'）
      localDir: 'dist',

      // 远端目标目录（默认 /home/dist）
      remoteDir: '/home/dist',

      // 部署期间的备份（上传后、切换前执行）
      // 可为布尔值或字符串（自定义备份路径）
      // 默认 true（备份到 /home/dist_backup）
      backup: true,

      // 将本地目录打包为 tar.gz，上传压缩包并在远端解压
      // 需要远端存在 tar 命令
      // 默认 false
      compress: false,

      // SSH 连接参数
      connectOptions: {
        host: 'xxx.xxx.xxx.xxx',
        port: 22,
        username: 'xxx',
        password: 'xxx',
        // privateKey: '',
        // ...ssh2-sftp-client 的其他参数
      },

      // ssh2-sftp-client 的上传参数
      uploadOptions: {
        // ...上传参数
      }
    }) // 请放在插件列表末尾
  ]
})
```

## 配置

### 配置项

| 配置项           | 类型              | 默认值                          | 说明                                                                                                     |
| ---------------- | ----------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `enable`         | `boolean`         | `true`                          | 是否启用部署                                                                                             |
| `localDir`       | `string`          | Vite 的 `build.outDir` 或 `dist` | 本地待部署目录                                                                                           |
| `remoteDir`      | `string`          | `/home/dist`                    | 远端目标目录                                                                                             |
| `backup`         | `boolean  string` | `true`                          | 是否在部署期间备份（上传后、切换前执行），或自定义备份路径                                               |
| `compress`       | `boolean`         | `false`                         | 将本地目录打包为 `tar.gz`，上传压缩包并在远端解压（需远端存在 `tar` 命令）                               |
| `connectOptions` | `object`          | `{}`                            | SSH 连接参数（见 [ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client)）                  |
| `uploadOptions`  | `object`          | `{}`                            | 上传参数（见 [ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client)）                      |

## 工作原理

插件在 Vite 的 `closeBundle` 钩子中执行，此时构建产物已写入磁盘。

### 1. 准备阶段

- 解析 `localDir`（默认取 Vite 的 `build.outDir`，兜底 `dist`）与 `remoteDir`（默认 `/home/dist`）。
- 校验 `localDir` 存在，然后推导远端辅助路径：

| 路径     | 值                                          | 用途                          |
| -------- | ------------------------------------------- | ----------------------------- |
| 临时目录 | `${remoteDir}_temp`                         | 新构建的暂存区                |
| 备份目录 | `${remoteDir}_backup`（或自定义 `backup`）  | 保留旧构建用于回滚            |
| 压缩包   | `${remoteDir}_temp.tar.gz`                  | 压缩上传（仅 `compress: true`） |

- 若备份路径与临时目录或目标目录冲突，提前中止。

### 2. 上传到临时目录

建立 SFTP 连接，清理上一次运行残留的 `${remoteDir}_temp` 或压缩包，然后暂存新构建：

- `compress: false`：用 `uploadDir` 逐个上传文件，显示 `upload n/total` 进度。
- `compress: true`：用 `tar` 库把 `localDir` 打包为本地 `tar.gz`，通过单次 `fastPut` 上传（显示压缩包大小与 `transferred/total (percent)` 进度），再在远端用 `tar -xzf <archive> -C <tempDir>` 解压。

此阶段目标目录始终在线。

### 3. 备份与原子切换

- 若 `backup` 启用且目标存在，先把当前 `remoteDir` 移动到备份目录。
- 再把临时目录原子地移动到 `remoteDir`（优先 `posix-rename` 扩展；服务器不支持时降级为「先删目标再改名」）。

### 4. 错误处理与回滚

| 失败场景                          | 清理                                   | 恢复                                       |
| --------------------------------- | -------------------------------------- | ------------------------------------------ |
| 打包 / 上传 / 解压失败            | 删除临时目录（目标目录未受影响）       | 无需恢复                                   |
| 上传成功但备份或切换失败          | 保留临时目录以便排查 / 重试            | 目标缺失时把备份还原回 `remoteDir`         |

- 压缩模式下：本地压缩包始终删除；远端压缩包在成功或失败时都会清理。
- SSH 连接始终会被关闭。

### 5. 进度与日志

- `compress: false`：`upload n/total` 逐个统计已传输文件。
- `compress: true`：先显示压缩包大小，再实时显示 `transferred/total (percent)`。

## 提示

- **放在末尾**：请始终把插件放在 plugins 数组的末尾，确保它在其他插件之后执行。
- **安全**：生产环境建议使用 `privateKey` 代替 `password` 认证。
- **备份**：开启备份可在部署失败时防止数据丢失。
- **日志**：部署过程中插件会输出详细日志，便于排查问题。
- **压缩**：`compress: true` 需要远端存在 `tar` 命令，能显著加速大量小文件的部署。

## 许可证

MIT
