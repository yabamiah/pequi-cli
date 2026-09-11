export function parseArgs(argv) {
  const positionals = []
  const flags = {}

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }

    const [rawName, inlineValue] = argument.slice(2).split('=', 2)
    const name = rawName.replaceAll('-', '_')
    if (inlineValue !== undefined) {
      flags[name] = inlineValue
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags[name] = next
      index += 1
    } else {
      flags[name] = true
    }
  }

  return { positionals, flags }
}

export function flagString(flags, name) {
  const value = flags[name.replaceAll('-', '_')]
  return typeof value === 'string' ? value : undefined
}

export function flagBoolean(flags, name) {
  return flags[name.replaceAll('-', '_')] === true
}
