import type { ConnectOptions, UploadDirOptions } from 'ssh2-sftp-client'
import type { Plugin } from 'vite'
import fs from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import ora from 'ora'
import SftpClient from 'ssh2-sftp-client'

function getAllFileCount(dir: string) {
  let count = 0
  function getFileCount(dir: string) {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      const stat = fs.statSync(resolve(dir, file))
      if (stat.isDirectory()) {
        getFileCount(resolve(dir, file))
      }
      else {
        count++
      }
    }
  }
  getFileCount(dir)
  return count
}

export type VitePluginDeployOptions = ConnectOptions & {
  localDir?: string
  remoteDir?: string
  backup?: boolean | string
  uploadOptions?: UploadDirOptions
}
const sftp = new SftpClient()
export function vitePluginDeploy(options?: VitePluginDeployOptions): Plugin {
  return {
    name: 'vite-plugin-deploy',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const { localDir = 'dist', remoteDir = '/home/dist', backup = true, uploadOptions, ..._options } = options ?? {}
      const backupDir = typeof backup === 'boolean' ? `${remoteDir}_backup` : `${backup}`
      const localPath = resolve(process.cwd(), localDir)
      const fileCount = getAllFileCount(localPath)
      let uploadCount = 0
      const spinner = ora('deploy:start').start()
      if (!fs.existsSync(localPath)) {
        spinner.fail(`deploy:error localDir:${localDir} not exists`)
        return
      }
      try {
        sftp.on('upload', () => {
          uploadCount++
          spinner.text = `deploy:running upload ${uploadCount}/${fileCount}`
        })
        await sftp.connect(_options)
        spinner.text = `deploy:running remote connect success`
        if (backup) {
          if (await sftp.exists(remoteDir)) {
            try {
              await sftp.rmdir(backupDir, true)
              spinner.text = `deploy:running remove backup dir success`
            }
            catch { }
            await sftp.rename(remoteDir, backupDir)
            spinner.text = `deploy:running rename remote dir success`
          }
        }
        await sftp.uploadDir(localPath, remoteDir, uploadOptions)
        sftp.end()
        spinner.succeed(`deploy:success upload ${fileCount} files dir:${localDir} to remote dir:${remoteDir}`)
      }
      catch (err) {
        spinner.fail(`deploy:error upload dir:${localDir} to remote dir:${remoteDir} error:${err}`)
        await sftp.rename(backupDir, remoteDir)
        sftp.end()
      }
    },
  }
}
