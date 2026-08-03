"""Generic static unpacker for the loader's obfuscation layers.

Every transformation here is a pure string operation reimplementing the
sample's own decoders. No attacker code is ever executed.
"""
import re
import sys


def shuffle(s, seed, c1, c2, c3, c4, c5):
    z = len(s)
    if z == 0:
        return s
    f = list(s)
    x = seed
    for m in range(z):
        a = x * (m + c1) + x % c2
        w = x * (m + c3) + x % c4
        f[a % z], f[w % z] = f[w % z], f[a % z]
        x = (a + w) % c5
    return "".join(f)


def find_shuffle(src, fname=None):
    """Locate a shuffle function and return (name, params)."""
    pat = r"function (\w+)\(\w+\)\{var \w+=(\d+);"
    for m in re.finditer(pat, src):
        name, seed = m.group(1), int(m.group(2))
        if fname and name != fname:
            continue
        tail = src[m.end():m.end() + 400]
        aw = re.search(r"=\w+\*\(\w+\+(\d+)\)\+\(?\w+%(\d+)\)?;var \w+=\w+\*\(\w+\+(\d+)\)\+\(?\w+%(\d+)\)?;", tail)
        fm = re.search(r"=\(\w+\+\w+\)%(\d+)", tail)
        if aw and fm:
            return name, (seed, *(int(g) for g in aw.groups()), int(fm.group(1)))
    return None, None


def js_unescape(s):
    return re.sub(
        r"\\(x[0-9a-fA-F]{2}|.)",
        lambda m: chr(int(m.group(1)[1:], 16)) if m.group(1).startswith("x")
        else {"n": "\n", "t": "\t", "r": "\r"}.get(m.group(1), m.group(1)),
        s,
    )


def quoted_literal(src, start):
    """Read a JS single- or double-quoted literal beginning at src[start]."""
    q = src[start]
    assert q in "\"'", f"not a quote at {start}: {src[start]!r}"
    i = start + 1
    out = []
    while i < len(src):
        if src[i] == "\\":
            out.append(src[i:i + 2])
            i += 2
            continue
        if src[i] == q:
            break
        out.append(src[i])
        i += 1
    return js_unescape("".join(out)), i


def parse_decompressor(src):
    """Pull the dictionary-decompressor constants out of its decoded body."""
    g = int(re.search(r"var \w+=(\d+),\w+=(\d+),\w+=(\d+);", src).group(1))
    gyi = re.search(r"var (\w+)=(\d+),(\w+)=(\d+),(\w+)=(\d+);", src)
    g, y, i = int(gyi.group(2)), int(gyi.group(4)), int(gyi.group(6))
    d = re.search(r'var \w+="([a-z]+)"', src).group(1)
    e = [int(x) for x in re.search(r"var \w+=\[([\d,]+)\]", src).group(1).split(",")]
    incs = re.search(r"\w+\+=(\d+);\w+\+=(\d+);\w+\+=(\d+);", src)
    g += int(incs.group(1)); y += int(incs.group(2)); i += int(incs.group(3))
    z_extra = [int(x) for x in re.search(r"var \w+=\[([\d,]+)\]\.concat", src).group(1).split(",")]
    return g, y, i, d, e, z_extra


def decompress(arg, g, y, i, d, e, z_extra):
    t = {v: k + 1 for k, v in enumerate(e)}
    c = arg.split(" ")
    for m in range(len(c) - 1, -1, -1):
        a = c[m]
        u = None
        l = 0
        r = len(a)
        n = 0
        while n < r:
            j = ord(a[n])
            p = t.get(j)
            if p:
                if n + 1 >= r:
                    n += 1
                    continue
                b = (p - 1) * y + ord(a[n + 1]) - g
                s = n
                n += 1
            elif j == i:
                if n + 2 >= r:
                    n += 1
                    continue
                b = y * (len(e) - g + ord(a[n + 1])) + ord(a[n + 2]) - g
                s = n
                n += 2
            else:
                n += 1
                continue
            if u is None:
                u = []
            if s > l:
                u.append(a[l:s])
            idx = b + 1
            u.append(c[idx] if 0 <= idx < len(c) else f"<<OOB:{b}>>")
            l = n + 1
            n += 1
        if u is not None:
            if l < r:
                u.append(a[l:])
            c[m] = "".join(u)
    h = c[0]
    z = z_extra + e
    f = chr(46)
    for k in range(len(z)):
        h = h.replace(f + d[k], chr(z[k]))
    return h.replace(f + "!", f)


def string_table(data, seed, c1, c2, c3, c4, c5):
    """The `%`/`#1`/`#0` string-table pattern."""
    sh = shuffle(data, seed, c1, c2, c3, c4, c5)
    g = chr(127)
    return sh.replace("%", g).replace("#1", "%").replace("#0", "#").split(g)


def unpack_stage(src):
    """Run the shuffle -> Function-body -> decompress pipeline on one stage."""
    name, params = find_shuffle(src)
    if not name:
        raise SystemExit("no shuffle function found")
    probe = re.search(re.escape(name) + r"\('([^']+)'\)\.substr|" + re.escape(name) + r'\("([^"]+)"\)\.substr', src)
    if probe:
        pstr = probe.group(1) or probe.group(2)
        print(f"[+] {name} params={params} probe={shuffle(pstr, *params)[:11]!r}", file=sys.stderr)

    # the decompressor body: the long literal shuffled and passed to Function
    lits = []
    for m in re.finditer(r"var (\w+)=(['\"])", src):
        lit, end = quoted_literal(src, m.end() - 1)
        lits.append((m.group(1), lit, m.start()))
    lits.sort(key=lambda x: -len(x[1]))
    body = shuffle(lits[0][1], *params)
    dparams = parse_decompressor(body)
    print(f"[+] decompressor consts g={dparams[0]} y={dparams[1]} i={dparams[2]} e={len(dparams[4])}", file=sys.stderr)

    # the payload: the literal inside <shuffle>('...') that is NOT the probe
    best = None
    for m in re.finditer(re.escape(name) + r"\(['\"]", src):
        lit, end = quoted_literal(src, m.end() - 1)
        if best is None or len(lit) > len(best):
            best = lit
    print(f"[+] payload literal {len(best)} chars", file=sys.stderr)
    return decompress(shuffle(best, *params), *dparams)


if __name__ == "__main__":
    sys.stdout.write(unpack_stage(open(sys.argv[1]).read()))
