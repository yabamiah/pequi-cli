#!/usr/bin/env node

import { run } from '../src/main.js'

run(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Erro: ${message}\n`)
  process.exitCode = 1
})
