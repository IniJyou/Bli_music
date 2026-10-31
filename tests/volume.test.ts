import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVolume, parseVolume, sliderToVolume, volumeToSlider } from '../src/shared/volume.ts'

test('every 0.1 percent volume level survives the curved slider round-trip', () => {
  for (let tenth = 0; tenth <= 1000; tenth++) {
    const volume = tenth / 10
    assert.equal(sliderToVolume(volumeToSlider(volume)), volume)
  }
})

test('low volume receives extra slider travel without changing percentage-to-gain semantics', () => {
  assert.equal(volumeToSlider(0), 0)
  assert.equal(volumeToSlider(1), 10)
  assert.ok(volumeToSlider(10) > 30)
  assert.equal(volumeToSlider(100), 100)
  assert.equal(sliderToVolume(10), 1)
  assert.equal(sliderToVolume(-1), 0)
  assert.equal(sliderToVolume(101), 100)
  assert.equal(normalizeVolume(.2 + .1), .3)
})

test('percentage entry accepts quiet decimal levels, bounds valid numbers and rejects incomplete input', () => {
  for (const [input, expected] of [['0.1', .1], ['.5', .5], ['1.25', 1.3], ['0', 0], ['100', 100], ['101', 100], ['-5', 0]] as const) {
    assert.equal(parseVolume(input), expected)
  }
  for (const input of ['', ' ', '.', '-', 'NaN', 'Infinity', '0x10', '1e2', '1,5', 'abc']) assert.equal(parseVolume(input), null)
})
