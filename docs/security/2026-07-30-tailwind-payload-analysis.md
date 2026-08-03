# Incident analysis — obfuscated payload in `tailwind.config.js`

**Analysed:** 2026-08-03 · **Issue:** #72 · **Siblings:** #70 (rotation), #71 (traffic audit)

The payload was **statically analysed, never executed.** Its decoders were reimplemented
as pure string transformations in Python and run against the bytes recovered from git
history. Nothing in this document required running the sample, and nothing here is a
copy of it — see [Retrieving the sample](#retrieving-the-sample).

---

## Summary

The payload is a **blockchain dead-drop loader**, the pattern usually called
*EtherHiding*. It carries no malicious logic of its own. Its entire job is to read an
address from a public blockchain, fetch attacker-supplied JavaScript from a second
chain, decrypt it, and run it — once in-process via `eval`, and once as a **detached
`node -e` child process with output discarded.**

**The consequence that matters: the final stage was never in the repository.** It was
whatever the attacker had published on-chain at the moment of each build. Static
analysis therefore *cannot* establish what was stolen, and no amount of further
analysis of this sample will. Assuming total compromise of everything the build
environment could read is the only defensible position — which is what #70 already
says.

**Exposure window.** Present from the baseline import commit (`40fc19a`) until removal
(`81363af`, 2026-07-29). `tailwind.config.js` is `require()`d on every build and dev
run, so it executed on **every local build and every production deploy** in that
window.

---

## Execution chain

1. **Capture the module system.** Stores `require` as `global['r']` and `module` as
   `global['m']`. This is necessary because the later stages are built with the
   `Function` constructor, which has no closure scope and so cannot see `require`
   directly.

2. **Multi-stage unpacking.** Three nested layers, each a character-shuffle cipher
   seeded with a different constant, plus a dictionary/back-reference decompressor.
   The innermost stage is assembled with `Function(...)` — invisible to static
   bundler analysis and to grep.

3. **Rate limit.** Records `global['_p_t']`; returns early if it ran in the last 30
   seconds. Reduces noise and repeat detonation within a single build.

4. **Resolve the dead drop (per chain, two chains run):**
   - `GET https://api.trongrid.io/v1/accounts/<TRON_ADDRESS>/transactions?only_confirmed=true&only_from=true&limit=1`
   - take `data[0].raw_data.data`, hex-decode to UTF-8, **reverse the string**
   - on failure, fall back to
     `GET https://fullnode.mainnet.aptoslabs.com/v1/accounts/<ADDRESS>/transactions?limit=1`
     and read `[0].payload.arguments[0]`

5. **Fetch the stage from BSC.** JSON-RPC `POST` of `eth_getTransactionByHash` with the
   value from step 4 to `bsc-dataseed.binance.org`, falling back to
   `bsc-rpc.publicnode.com`. Takes `result.input`, strips `0x`, hex-decodes to UTF-8,
   and splits on the literal `?.?`, keeping the second field.

6. **Decrypt.** Repeating-key XOR against a 16-character key (one per chain).

7. **Execute, twice, two ways:**
   - Chain A: `eval(source)` — in-process, inherits the build's full environment
   - Chain B: `require('child_process').spawn('node', ['-e', "global['_V']='…';" + source],
     { detached: true, stdio: 'ignore', windowsHide: true })`
     — **survives the parent process, produces no console output, hidden on Windows.**
     If `spawn` errors, it falls back to `eval(source)`.

---

## Indicators of compromise

Use these for the #71 traffic and log audit. Any of the four hostnames appearing in a
Vercel build log, an egress log, or DNS telemetry inside the exposure window is a
detonation.

### Network

| Host | Role |
|---|---|
| `api.trongrid.io` | dead-drop pointer (primary) |
| `fullnode.mainnet.aptoslabs.com` | dead-drop pointer (fallback) |
| `bsc-dataseed.binance.org` | stage delivery (primary) |
| `bsc-rpc.publicnode.com` | stage delivery (fallback) |

None of these has any legitimate reason to appear in this project's traffic — the
product touches no blockchain.

### On-chain addresses

```
TRON   TMfKQEd7TJJa5xNZJZ2Lep838vrzrs7mAP
TRON   TXfxHUet9pJVU1BgVkBAbrES4YUc1nGzcG
BSC tx 0xbe037400670fbf1c32364f762975908dc43eeb38759263e7dfcdabc76380811e
BSC tx 0x3f0e5781d0855fb460661ac63257376db1941b2bb522499e4757ecb3ebd5dce3
```

The BSC transactions can be inspected on a public explorer to recover the stage that
was live at the time — the most direct route to learning what actually ran, and worth
doing before the attacker rotates them.

### Host artefacts

- Globals `_V`, `_p_t`, `C`, `r`, `m` set on `globalThis`
- A detached `node -e` process with no stdio, parented to a build or dev server
- Obfuscation markers `_$_c266`, `_$af1390258`, `_$_2369`
- Delimiter `?.?`; XOR keys `2[gWfGj;<:-93Z^C` and `m6:tTh^D)cBz?NM]`

### Hiding technique

The payload was appended to the **same line** as `module.exports = config;`, behind
**2184 bytes of whitespace**, so it sits far off the right edge in an editor and the
file reads as normal at a glance. Total file 16 KB; payload 4820 bytes.

---

## Repository status

Verified by scanning working trees and **all reachable history** in all three repos
for the indicators above:

| Repo | Working tree | History | Notes |
|---|---|---|---|
| `organizational-climate-platform` | clean | **clean** | the payload never entered the new repo |
| `climate-project` | clean | **present** | `tailwind.config.js` at `40fc19a`; removed by `81363af` |
| `climate-tracking` | clean | clean | |

**`climate-project` history still contains a live sample.** It is unreachable from any
branch tip, but `git checkout 40fc19a` — or any tool that walks history — restores a
file that detonates on the next build. Before that repo is archived or handed to
anyone, either purge the blob or make the risk explicit in its README.

### Note on the new stack's Tailwind

`organizational-climate-platform` adopted Tailwind in #74. This is **not** a
reintroduction of the attack surface:

- Tailwind v4 is configured in CSS (`web/src/styles/theme.css` via `@theme`). **There
  is no `tailwind.config.js` in this repo**, so the file that carried the payload has
  no counterpart here.
- All Tailwind packages resolve to `registry.npmjs.org` at official versions (4.3.3).
- Exactly one dependency in the tree declares an install script: `fsevents`, the
  standard macOS file watcher.

---

## What this means for the sibling issues

### #70 — rotation

The analysis **confirms** the existing scope rather than narrowing it. Because the
executed stage came from off-repo and is unknowable retrospectively, every secret the
build and runtime environments could read must be treated as compromised. Two points
worth adding to that issue:

- Chain A ran **in-process inside the build**, so anything in the build environment —
  Vercel environment variables in particular — was directly readable.
- Chain B **outlived the build** as a detached process, so exposure is not bounded by
  build duration.

### #71 — traffic audit

Grep build logs and any egress telemetry for the four hostnames. Absence in Vercel
logs is weak evidence: `stdio: 'ignore'` means the child produced no output, and
outbound HTTPS from a build container is not logged by default. **Treat "no evidence"
as "no telemetry", not as "no detonation."**

### #72 — this document

Complete, with one deliberate deviation: the issue asked for *sandbox* analysis.
Static reimplementation of the decoders achieved the same result — full recovery of
the loader's logic and every indicator — with no risk of live detonation or of
alerting the operator that the sample is being examined. Executing it would also have
added nothing, since the stage it fetches today need not be the stage it fetched then.

The one thing static analysis cannot recover is the stage itself. The BSC transaction
inputs listed above are the way to get it, and that is an explorer lookup rather than
a sandbox run.

---

## Retrieving the sample

Deliberately not copied into this repo — documenting an incident should not
redistribute the malware.

```sh
# in a clone of TIMSInternational/climate-project
git show 40fc19a:tailwind.config.js > /tmp/sample.js   # DO NOT run a build in that tree
```

The payload begins after `module.exports = config;` on the last line, past the
whitespace padding.
