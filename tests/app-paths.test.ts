import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { appPaths } from '../src/main/app-paths.ts'

const defaults = { packaged: true, project: resolve('.artifacts/p5/install'),
  defaultHome: resolve('.artifacts/p5/independent-data') }

test('installed data and cache stay independent of the executable and version', () => {
  const first = appPaths(defaults)
  const upgrade = appPaths({ ...defaults, project: resolve('.artifacts/p5/upgrade/resources/app.asar') })
  assert.deepEqual(first, upgrade)
  assert.equal(first.data, resolve(defaults.defaultHome, 'data'))
  assert.equal(first.runtime, resolve(defaults.defaultHome, 'cache'))
})

test('development retains its data layout and a selected home is checked before use', () => {
  const project = resolve('.artifacts/p5/development')
  assert.deepEqual(appPaths({ ...defaults, project, packaged: false }), {
    data: resolve(project, '.data'), runtime: resolve(project, '.cache/runtime/player'),
  })
  assert.throws(() => appPaths({ ...defaults, override: 'relative' }))
  assert.throws(() => appPaths({ ...defaults, override: defaults.project }))
})
