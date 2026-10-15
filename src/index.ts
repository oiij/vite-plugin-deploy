import type { Buffer } from 'node:buffer'
import type { ConnectOptions, UploadDirOptions } from 'ssh2-sftp-client'
import type { Plugin, ResolvedConfig } from 'vite'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import ora from 'ora'
import SftpClient from 'ssh2-sftp-client'
import { create } from 'tar'

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

/** 用单引号包裹并转义 shell 参数，避免路径中的空格或特殊字符被解析 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 将字节数格式化为可读大小 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`
}

/** 远端命令执行通道，复用 ssh2-sftp-client 底层的 ssh2 连接 */
interface RemoteExecChannel {
  stderr: { on: (event: 'data', listener: (chunk: Buffer) => void) => void }
  on: ((event: 'data', listener: (chunk: Buffer) => void) => void)
    & ((event: 'close', listener: (code: number | null, signal: string | null) => void) => void)
    & ((event: 'error', listener: (error: Error) => void) => void)
}

/** 远端命令执行的默认超时（秒） */
const EXEC_TIMEOUT = 120

/** 在远端执行 shell 命令，命令以非 0 退出码结束或超时未结束时抛出错误；timeout 为 0 表示不超时 */
function execRemote(sftp: SftpClient, command: string, timeout: number): Promise<void> {
  const client = (sftp as unknown as {
    client: { exec: (command: string, callback: (err: Error | undefined, channel: RemoteExecChannel) => void) => void }
  }).client

  return new Promise((resolvePromise, reject) => {
    let settled = false
    const timer: ReturnType<typeof setTimeout> | null = timeout > 0
      ? setTimeout(() => {
          settled = true
          reject(new Error(`remote command timed out after ${timeout}s: ${command}`))
        }, timeout * 1000)
      : null

    const settle = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
      }
      callback()
    }

    client.exec(command, (err, channel) => {
      if (err) {
        settle(() => reject(err))
        return
      }

      // 必须消费 stdout，否则可读流不会进入 flowing 模式、'end' 不触发，channel 的 'close' 事件将永不发出
      let stdout = ''
      let stderr = ''
      channel.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      channel.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      channel.on('error', (error) => {
        settle(() => reject(error))
      })
      channel.on('close', (code, signal) => {
        if (code === 0) {
          settle(() => resolvePromise())
          return
        }

        const reason = code === null ? `terminated by signal ${signal}` : `exited with code ${code}`
        const output = (stderr || stdout).trim()
        settle(() => reject(new Error(`remote command ${reason}${output ? `: ${output}` : ''}`)))
      })
    })
  })
}

/**
 * 原子替换远端路径：优先使用 posix-rename 扩展（可覆盖已存在的目标），
 * 服务器不支持该扩展时退化为「先删目标再改名」。
 */
async function replaceRemotePath(sftp: SftpClient, from: string, to: string): Promise<void> {
  try {
    await sftp.posixRename(from, to)
  }
  catch {
    if (await sftp.exists(to)) {
      await sftp.rmdir(to, true)
    }
    await sftp.rename(from, to)
  }
}

/** 将本地目录打包为 tar.gz，返回压缩包路径 */
async function packArchive(localDir: string): Promise<string> {
  const archive = resolve(tmpdir(), `vite-plugin-deploy-${Date.now()}.tar.gz`)
  await create({ gzip: true, cwd: localDir, file: archive }, ['.'])
  return archive
}

export interface VitePluginDeployOptions {
  enable?: boolean
  localDir?: string
  remoteDir?: string
  backup?: boolean | string
  compress?: boolean
  execTimeout?: number
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
      const { enable = true, localDir = buildDir, remoteDir = '/home/dist', backup = true, compress = false, execTimeout = EXEC_TIMEOUT, connectOptions, uploadOptions } = options ?? {}

      if (!enable) {
        ora('deploy:disabled').info()
        return
      }

      let spinner = ora('deploy:start').start()

      /** 结束当前步骤并以独立一行输出，然后为下一步启动新的提示（不覆盖上一步） */
      const nextStep = (successMessage: string, runningMessage?: string) => {
        spinner.succeed(successMessage)
        if (runningMessage) {
          spinner = ora(runningMessage).start()
        }
      }

      if (!fs.existsSync(localDir)) {
        spinner.fail(`deploy:error localDir:${localDir} not exists`)
        return
      }

      const backupEnabled = Boolean(backup)
      const tempDir = `${remoteDir}_temp`
      const backupDir = typeof backup === 'string' && backup ? backup : `${remoteDir}_backup`
      const remoteArchive = `${tempDir}.tar.gz`

      // 路径冲突校验：避免备份目录与临时目录/目标目录互相覆盖
      if (backupEnabled && (backupDir === tempDir || backupDir === remoteDir)) {
        const conflictDir = backupDir === tempDir ? tempDir : remoteDir
        spinner.fail(`deploy:error backup dir:${backupDir} conflicts with ${conflictDir}`)
        return
      }

      const fileCount = getAllFileCount(localDir)
      let uploadCount = 0
      let uploaded = false
      let localArchive: string | null = null

      try {
        await sftp.connect({ ...connectOptions })
        nextStep('deploy:success remote connect', 'deploy:running clean up stale files')

        // 清理可能残留的临时目录与压缩包
        if (await sftp.exists(tempDir)) {
          await sftp.rmdir(tempDir, true)
        }
        if (await sftp.exists(remoteArchive)) {
          await sftp.delete(remoteArchive)
        }
        nextStep('deploy:success clean up stale files', compress ? 'deploy:running packing local dir' : 'deploy:running upload to temp dir')

        if (compress) {
          // 本地打包 -> 上传压缩包 -> 远端解压到临时目录
          localArchive = await packArchive(localDir)
          const archiveSize = fs.statSync(localArchive).size
          nextStep('deploy:success packing local dir', `deploy:running upload archive ${formatBytes(archiveSize)}`)

          await sftp.fastPut(localArchive, remoteArchive, {
            step: (transferred, _chunk, total) => {
              const percent = total ? Math.floor((transferred / total) * 100) : 0
              spinner.text = `deploy:running upload archive ${formatBytes(transferred)}/${formatBytes(total)} (${percent}%)`
            },
          })
          nextStep(`deploy:success upload archive ${formatBytes(archiveSize)}`, 'deploy:running extract archive')

          await sftp.mkdir(tempDir, true)
          await execRemote(sftp, `tar -xzf ${shellQuote(remoteArchive)} -C ${shellQuote(tempDir)}`, execTimeout)
          await sftp.delete(remoteArchive)
          nextStep('deploy:success extract archive')
        }
        else {
          // 先上传到临时目录，上传期间目标目录保持在线
          sftp.on('upload', () => {
            uploadCount++
            spinner.text = `deploy:running upload ${uploadCount}/${fileCount}`
          })
          await sftp.uploadDir(localDir, tempDir, uploadOptions)
          nextStep(`deploy:success upload ${fileCount} files to temp dir`)
        }
        uploaded = true

        // 上传完成后：先把目标目录备份，再将临时目录原子替换为目标目录
        if (backupEnabled && await sftp.exists(remoteDir)) {
          spinner = ora('deploy:running backup remote dir').start()
          await replaceRemotePath(sftp, remoteDir, backupDir)
          nextStep('deploy:success backup remote dir')
        }

        spinner = ora('deploy:running swap temp dir to remote dir').start()
        await replaceRemotePath(sftp, tempDir, remoteDir)
        spinner.succeed(`deploy:success upload ${fileCount} files dir:${localDir} to remote dir:${remoteDir}`)
      }
      catch (err) {
        spinner.fail(`deploy:error upload dir:${localDir} to remote dir:${remoteDir} error:${err}`)

        // 清理远端残留压缩包
        try {
          if (await sftp.exists(remoteArchive)) {
            await sftp.delete(remoteArchive)
          }
        }
        catch {
          // 忽略清理残留压缩包的错误
        }

        // 仅在尚未完成上传时清理临时目录；上传成功后的失败保留产物以便排查或重试
        if (!uploaded) {
          try {
            if (await sftp.exists(tempDir)) {
              await sftp.rmdir(tempDir, true)
            }
          }
          catch {
            // 忽略清理临时目录的错误
          }
        }

        // 尝试恢复备份（仅当目标目录已不存在时，避免覆盖仍完好的目标目录）
        if (backupEnabled) {
          try {
            if (await sftp.exists(backupDir) && !(await sftp.exists(remoteDir))) {
              await replaceRemotePath(sftp, backupDir, remoteDir)
              spinner.info('deploy:info restored from backup')
            }
          }
          catch (restoreErr) {
            spinner.warn(`deploy:warn failed to restore from backup: ${restoreErr}`)
          }
        }
      }
      finally {
        // 清理本地压缩包
        if (localArchive) {
          try {
            fs.rmSync(localArchive, { force: true })
          }
          catch {
            // 忽略清理本地压缩包的错误
          }
        }

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
