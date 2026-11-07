import { isAbsolute, resolve, sep } from 'node:path'

interface PathOptions {
  packaged: boolean
  project: string
  defaultHome: string
  override?: string
}

export function appPaths(options: PathOptions) {
  if (options.override && !isAbsolute(options.override)) throw new Error('BLI_MUSIC_HOME must be an absolute directory.')
  if (!options.packaged && !options.override) return {
    data: resolve(options.project, '.data'),
    runtime: resolve(options.project, '.cache/runtime/player'),
  }
  const home = resolve(options.override || options.defaultHome)
  const application = resolve(options.project).toLowerCase()
  const selected = home.toLowerCase()
  if (options.packaged && (selected === application || selected.startsWith(application + sep))) {
    throw new Error('The installed application data must be outside its application directory.')
  }
  return { data: resolve(home, 'data'), runtime: resolve(home, 'cache') }
}
