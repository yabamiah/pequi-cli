import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArgs } from '../src/args.js'

test('parseArgs separa posicionais, valores e booleanos', () => {
  assert.deepEqual(
    parseArgs(['diagram', 'push', 'docs/a.mmd', '--title', 'Arquitetura', '--json', '--project=abc']),
    {
      positionals: ['diagram', 'push', 'docs/a.mmd'],
      flags: { title: 'Arquitetura', json: true, project: 'abc' },
    },
  )
})
