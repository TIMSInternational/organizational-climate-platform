// db-restore-rehearsal.sh restores a PRODUCTION dump onto a laptop. The two properties that make
// that acceptable are the ones these tests pin: what it creates it removes, however it exits, and
// it never removes anything it did not create. The third is the verdict: a restore whose table set
// or migration history differs from the code must not exit 0.
//
// The real script runs against stubbed `docker`, `pg_restore`, `psql`, `createdb`, `pg_isready` and
// `chown` on PATH: no Docker daemon, no Postgres, no dump. The expected migration set is read from
// the working tree here, independently of the script's own `git ls-tree`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/db-restore-rehearsal.sh');
const CODE_MIGRATIONS = readdirSync(join(REPO, 'src/ClimateProject.Infrastructure/Migrations'))
  .filter((f) => /^\d{14}_.*\.cs$/.test(f) && !f.endsWith('.Designer.cs'))
  .map((f) => f.replace(/\.cs$/, ''))
  .sort();
const NEWEST = CODE_MIGRATIONS[CODE_MIGRATIONS.length - 1];

const STUBS = {
  docker: `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$STUB_LOG"
state="$STUB_DIR/containers"; mkdir -p "$state"
cmd="$1"; shift
case "$cmd" in
  container) [ -f "$state/$2" ] && exit 0; exit 1 ;;
  run)
    while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2 ;; *) shift ;; esac; done
    : > "$state/$name"; echo fakeid ;;
  exec)
    while [ $# -gt 0 ]; do case "$1" in -i) shift ;; -u|-e) shift 2 ;; *) break ;; esac; done
    shift; exec "$@" ;;
  cp) case "$2" in *rehearsal.list) cp "$1" "$STUB_DIR/copied.list" ;; esac ;;
  rm) for a in "$@"; do case "$a" in -*) ;; *) rm -f "$state/$a" ;; esac; done ;;
esac
exit 0
`,
  pg_restore: `#!/usr/bin/env bash
printf 'pg_restore %s\\n' "$*" >> "$STUB_LOG"
case "$*" in
  *--version*) echo "pg_restore (PostgreSQL) 17.11" ;;
  *--list*)
    echo ";     Dumped from database version: 17.6"
    echo ";     Dumped by pg_dump version: 17.11"
    echo "5; 2615 2200 SCHEMA - public pg_database_owner"
    i=0; while [ "$i" -lt "\${STUB_TOC_TABLES:-3}" ]; do i=$((i+1)); echo "$((100+i)); 0 $((16000+i)) TABLE DATA public t$i postgres"; done ;;
  *) if [ "\${STUB_RESTORE_RC:-0}" != 0 ]; then echo 'pg_restore: error: role "service_role" does not exist' >&2; exit "$STUB_RESTORE_RC"; fi ;;
esac
exit 0
`,
  psql: `#!/usr/bin/env bash
printf 'psql %s\\n' "$*" >> "$STUB_LOG"
args="$*"; input=""
case " $args " in *" -c "*) ;; *) input="$(cat)" ;; esac
case "$args $input" in
  *"show server_version"*) echo "17.11" ;;
  *"from pg_database where datname"*) [ "\${STUB_DB_EXISTS:-0}" = 1 ] && echo 1 ;;
  *'\\gexec'*) printf 'companies\\t4\\nusers\\t153\\n' ;;
  *"'companies'"*) printf 'companies\\t4\\nusers\\t153\\n' ;;
  *'"MigrationId"'*) printf '%s\\n' "$STUB_MIGRATIONS" ;;
  *"information_schema.tables"*) echo "\${STUB_RESTORED_TABLES:-3}" ;;
esac
exit 0
`,
  createdb: `#!/usr/bin/env bash
printf 'createdb %s\\n' "$*" >> "$STUB_LOG"
`,
  pg_isready: `#!/usr/bin/env bash
exit 0
`,
  chown: `#!/usr/bin/env bash
exit 0
`,
};

function run(args, env = {}, { precreateContainer } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'restore-rehearsal-'));
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  if (precreateContainer) {
    mkdirSync(join(dir, 'containers'), { recursive: true });
    writeFileSync(join(dir, 'containers', precreateContainer), '');
  }
  const dump = join(dir, 'climate-20261118T013417Z.dump');
  writeFileSync(dump, 'not a real archive; every reader of it is stubbed');
  const expanded = args.map((a) => (a === '<DUMP>' ? dump : a));
  const res = spawnSync('bash', [SCRIPT, ...expanded], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      // Always the stubs: unset, the script would find a real Homebrew postgresql@NN on a Mac and
      // put it ahead of them on PATH.
      PG_BIN: dir,
      PGHOST: '',
      STUB_DIR: dir,
      STUB_LOG: log,
      STUB_MIGRATIONS: CODE_MIGRATIONS.join('\n'),
      ...env,
    },
  });
  const copied = join(dir, 'copied.list');
  return {
    ...res,
    dir,
    dump,
    calls: readFileSync(log, 'utf8'),
    copiedList: existsSync(copied) ? readFileSync(copied, 'utf8') : null,
    containerExists: (name) => existsSync(join(dir, 'containers', name)),
  };
}

const DB = 'climate_restore_drill';
const NAME = `climate-restore-${DB}`;
const DRILL = ['--container', '--delete-dump', '<DUMP>', DB];

test('a matching restore exits 0, and the container and the dump are gone afterwards', () => {
  const r = run(DRILL);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /REHEARSAL MATCHES/);
  assert.match(r.stdout, new RegExp(`newest in the dump\\s+${NEWEST}`));
  assert.match(r.stdout, new RegExp(`newest in the code\\s+${NEWEST}`));
  assert.match(r.calls, /docker run -d --name climate-restore-climate_restore_drill --network none/);
  assert.doesNotMatch(r.calls, /docker run[^\n]* -p /, 'no port may be published');
  assert.match(r.calls, new RegExp(`docker rm -f -v ${NAME}`));
  assert.equal(r.containerExists(NAME), false, 'the container must be removed');
  assert.equal(existsSync(r.dump), false, '--delete-dump must delete the dump');
});

test('every client tool runs inside the container, none on the host', () => {
  const r = run(DRILL);
  assert.equal(r.status, 0, r.stderr);
  const execs = r.calls.split('\n').filter((l) => l.startsWith('docker exec'));
  for (const tool of ['pg_restore', 'psql', 'createdb']) {
    assert.ok(execs.some((l) => l.includes(` ${tool} `) || l.endsWith(` ${tool}`)), `${tool} did not run in the container`);
  }
});

test('the use-list drops CREATE SCHEMA public and keeps every TABLE DATA entry', () => {
  const r = run(DRILL, { STUB_TOC_TABLES: '5', STUB_RESTORED_TABLES: '5' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.copiedList, 'no use-list was copied into the container');
  assert.doesNotMatch(r.copiedList, /SCHEMA - public/);
  assert.equal((r.copiedList.match(/ TABLE DATA public /g) || []).length, 5);
});

test('a migration in the code that the dump lacks DIFFERS and exits 3, and cleanup still runs', () => {
  const r = run(DRILL, { STUB_MIGRATIONS: CODE_MIGRATIONS.slice(0, -1).join('\n') });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /in the code, not applied in the dump:\n\s+\S+/);
  assert.match(r.stdout, new RegExp(`in the code, not applied in the dump:\\n\\s+${NEWEST}`));
  assert.doesNotMatch(r.stdout, /REHEARSAL MATCHES/);
  assert.equal(r.containerExists(NAME), false);
  assert.equal(existsSync(r.dump), false);
});

test('a migration applied in the dump that the code lacks DIFFERS, even when the counts agree', () => {
  // The local dev database measured 2026-11-18 had 78 history rows and HEAD 78 migration files, yet
  // two of each were different migrations: a count comparison would have called that a match.
  const swapped = [...CODE_MIGRATIONS.slice(0, -1), '20990101000000_FromAnUnmergedBranch'];
  const r = run(DRILL, { STUB_MIGRATIONS: swapped.join('\n') });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /applied in the dump, absent from the code:\n\s+20990101000000_FromAnUnmergedBranch/);
});

test('fewer restored tables than TABLE DATA entries DIFFERS and exits 3', () => {
  const r = run(DRILL, { STUB_TOC_TABLES: '3', STUB_RESTORED_TABLES: '2' });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /2 public base tables restored \/ 3 TABLE DATA entries in the dump\s+-> DIFFERS/);
});

test('pg_restore errors exit 1, and the container and the dump are still removed', () => {
  const r = run(DRILL, { STUB_RESTORE_RC: '1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /pg_restore: exit 1 in \d+s, 1 error\(s\)/);
  assert.equal(r.containerExists(NAME), false);
  assert.equal(existsSync(r.dump), false);
});

test('without --delete-dump the dump is kept', () => {
  const r = run(['--container', '<DUMP>', DB]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(r.dump), true);
  assert.equal(r.containerExists(NAME), false, 'the container is removed regardless');
});

test('a container name already taken is refused, and that container is never touched', () => {
  const r = run(DRILL, {}, { precreateContainer: NAME });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /already exists, and this script removes only what it creates/);
  assert.doesNotMatch(r.calls, /docker (run|rm|exec)/);
  assert.equal(r.containerExists(NAME), true, 'a container this script did not create was removed');
});

test('a non-local PGHOST is refused before anything runs, and the dump is kept', () => {
  const r = run(DRILL, { PGHOST: 'aws-0-us-east-1.pooler.supabase.com' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is not local/);
  assert.equal(r.calls.trim(), '', 'nothing should have been called');
  assert.equal(existsSync(r.dump), true, 'an argument error must not cost the operator the dump');
});

test('the dev database name is refused', () => {
  const r = run(['--container', '<DUMP>', 'climate_project']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /climate_project is the dev database/);
  assert.equal(r.calls.trim(), '');
});

test('host mode restores into the local server and never calls docker', () => {
  const r = run(['<DUMP>', DB]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.calls, /^docker /m);
  assert.match(r.calls, /^createdb climate_restore_drill$/m);
  assert.match(r.stdout, /When done:\s+dropdb climate_restore_drill/);
  assert.equal(existsSync(r.dump), true);
});
