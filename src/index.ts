import type { ConnectOptions, UploadDirOptions } from 'ssh2-sftp-client'
import type { Plugin, ResolvedConfig } from 'vite'
import fs from 'node:fs'
import { resolve } from 'node:path'
import ora from 'ora'
import SftpClient from 'ssh2-sftp-client'

function getAllFileCount(dir: string): number {
  let count = 0

  function traverseDir(currentDir: string) {
    try {
      const files = fs.readdirSync(currentDir)
      for (const file of files) {
        const filePath = resolve(currentDir, file)
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
          traverseDir(filePath)
        }
        else {
          count++
        }
      }
    }
    catch (error) {
      console.error(`Error reading directory ${currentDir}:`, error)
    }
  }

  traverseDir(dir)
  return count
}

export type VitePluginDeployOptions = {
  enable?: boolean
  localDir?: string
  remoteDir?: string
  backup?: boolean | string
  connectOptions?: ConnectOptions
  uploadOptions?: UploadDirOptions
}
export function vitePluginDeploy(options?: VitePluginDeployOptions): Plugin {
  let viteConfig: ResolvedConfig | null = null

  return {
    name: 'vite-plugin-deploy',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      viteConfig = config
    },

    async closeBundle() {
      const sftp = new SftpClient()
      const buildDir = viteConfig?.build.outDir ?? 'dist'
      const { enable = true, localDir = buildDir, remoteDir = '/home/dist', backup = true, connectOptions, uploadOptions } = options ?? {}

      if (!enable) {
        ora('deploy:disabled').info()
        return
      }

      const backupDir = typeof backup === 'boolean' ? `${remoteDir}_backup` : backup
      const fileCount = getAllFileCount(localDir)
      let uploadCount = 0
      const spinner = ora('deploy:start').start()

      if (!fs.existsSync(localDir)) {
        spinner.fail(`deploy:error localDir:${localDir} not exists`)
        return
      }

      try {
        sftp.on('upload', () => {
          uploadCount++
          spinner.text = `deploy:running upload ${uploadCount}/${fileCount}`
        })

        await sftp.connect({ ...connectOptions })
        spinner.text = `deploy:running remote connect success`

        if (backup) {
          if (await sftp.exists(remoteDir)) {
            try {
              await sftp.rmdir(backupDir, true)
              spinner.text = `deploy:running remove backup dir success`
            }
            catch {
              // 忽略删除备份目录的错误
            }

            await sftp.rename(remoteDir, backupDir)
            spinner.text = `deploy:running rename remote dir success`
          }
        }

        await sftp.uploadDir(localDir, remoteDir, uploadOptions)
        spinner.succeed(`deploy:success upload ${fileCount} files dir:${localDir} to remote dir:${remoteDir}`)
      }
      catch (err) {
        spinner.fail(`deploy:error upload dir:${localDir} to remote dir:${remoteDir} error:${err}`)

        // 尝试恢复备份
        if (backup) {
          try {
            if (await sftp.exists(backupDir)) {
              await sftp.rename(backupDir, remoteDir)
              spinner.info('deploy:info restored from backup')
            }
          }
          catch (restoreErr) {
            spinner.warn(`deploy:warn failed to restore from backup: ${restoreErr}`)
          }
        }
      }
      finally {
        // 确保关闭连接
        try {
          await sftp.end()
        }
        catch {
          // 忽略关闭连接的错误
        }
      }
    },
  }
}
