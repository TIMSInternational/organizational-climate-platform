# `docs/audits/`

This folder holds dated, measured records of what the application **is**, as distinct from
what an issue body, a runbook or a design spec says it is. Each file is pinned to a commit,
every row carries a `file:line` or a command output, and nothing in it is a plan — a gap
recorded here is a measurement, not a commitment to close it. The rest of `docs/` describes
intent (`docs/decisions/`), procedure (`docs/runbooks/`) or requirements
(`docs/requirements/`); this folder describes state, so that the next reader can tell which
of those three have gone stale without re-deriving the whole product. Audits are additive:
a later audit supersedes an earlier one by date rather than by editing it, because the
value of a stale audit is that it dates the drift.
