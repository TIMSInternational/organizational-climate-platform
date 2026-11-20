import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  RespondentContentByLocale,
  RespondentContentEntry,
  RespondentContentView,
} from '../features/surveys/api/respondentContent'

/**
 * The server's registry of what a client may override (`RespondentContentRegistry.cs`), read
 * from the C# source itself — so a web test that walks "every screen key" walks the keys the
 * server will actually put in a payload, and a key added there without a reader here fails a
 * test instead of shipping as an editor that lies. Tests only.
 *
 * Reads the two entry shapes the file uses: `Screen("key", "group", MaxLength, "placeholder", …)`
 * and `new(ConstName, RespondentContentKinds.Kind, "group", MaxLength, …)`. Email entries are
 * read too (their kind is kept), so a caller filters.
 */
const REGISTRY = join(
  process.cwd(),
  '..',
  'src',
  'ClimateProject.Application',
  'RespondentContent',
  'RespondentContentRegistry.cs',
)

export function registryEntries(): RespondentContentEntry[] {
  const source = readFileSync(REGISTRY, 'utf8')
  const strings = new Map<string, string>()
  for (const match of source.matchAll(/public const string (\w+) = "([^"]*)";/g)) strings.set(match[1], match[2])
  const ints = new Map<string, number>()
  for (const match of source.matchAll(/public const int (\w+) = (\d+);/g)) ints.set(match[1], Number(match[2]))
  const length = (name: string) => ints.get(name) ?? 1000

  const entries: { at: number; entry: RespondentContentEntry }[] = []
  // The key is a literal or one of the file's `const string`s (`Screen(DemographicsIntro, …)`).
  for (const match of source.matchAll(/\bScreen\((?:"([^"]+)"|([A-Z]\w*)), "([\w.]+)", (\w+)((?:, "\w+")*)\)/g)) {
    const key = match[1] ?? strings.get(match[2]) ?? match[2]
    const placeholders = [...match[5].matchAll(/"(\w+)"/g)].map((p) => p[1])
    entries.push({
      at: match.index,
      entry: entry(key, 'screen', match[3], length(match[4]), placeholders, null),
    })
  }
  for (const match of source.matchAll(/new\((\w+), RespondentContentKinds\.(Screen|Email|Display), "([\w.]+)", ([\w.]+), (\w+)([^;\n]*)/g)) {
    const key = strings.get(match[1]) ?? match[1]
    const kind = match[2].toLowerCase() as RespondentContentEntry['kind']
    const placeholders = match[5] === 'EmailPlaceholders' ? ['survey', 'company'] : []
    // An entry may continue on the next line (`LegacyColumn: …`); read up to the next entry.
    const rest = source.slice(match.index + match[0].length).split(/\n\s*(?:Screen\(|new\(|\];|\/\/)/)[0]
    const legacy = /LegacyColumn: RespondentContentLegacyColumns\.(\w+)/.exec(match[6] + rest)?.[1] ?? null
    const made = entry(key, kind, match[3], length(match[4].split('.').pop() ?? ''), placeholders, legacy)
    if (kind === 'display') {
      made.values = ['justify', 'start']
      made.defaultValue = 'justify'
    }
    entries.push({ at: match.index, entry: made })
  }
  return entries.sort((a, b) => a.at - b.at).map(({ entry: e }) => e)
}

function entry(
  key: string,
  kind: RespondentContentEntry['kind'],
  group: string,
  maxLength: number,
  placeholders: string[],
  legacyColumn: string | null,
): RespondentContentEntry {
  return {
    key,
    kind,
    group,
    maxLength,
    placeholders,
    values: [],
    defaultValue: null,
    legacyColumn,
    requiresEveryLocale: legacyColumn !== null,
  }
}

/** The registry's screen keys, in its order. */
export function registryScreenKeys(): string[] {
  return registryEntries()
    .filter((e) => e.kind === 'screen')
    .map((e) => e.key)
}

export function emptyByLocale(): RespondentContentByLocale {
  return { es: {}, en: {}, '*': {} }
}

/** A `GET …/respondent-content` payload, as `toRespondentContentView` returns it. */
export function contentView(over: Partial<RespondentContentView> = {}): RespondentContentView {
  return {
    level: 'company',
    companyId: 'c1',
    surveyId: null,
    language: 'es',
    requiredLocales: ['es'],
    editable: true,
    surveyStatus: null,
    entries: registryEntries(),
    companyValues: emptyByLocale(),
    surveyValues: null,
    effective: emptyByLocale(),
    ...over,
  }
}
