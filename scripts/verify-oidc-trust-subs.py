#!/usr/bin/env python3
"""Guard the OIDC trust policy in climate-project-api-bootstrap.yml (Refs #68).

Why this exists
---------------
The live `climate-project-github-deploy-prod` role trusts four `sub` claims. Two
of them are ID-qualified (`repo:OWNER@<ownerId>/REPO@<repoId>:...`), and those two
are the ones GitHub's tokens actually present — the name-based pair alone can
never match, which is how the first production deploy failed at
`sts:AssumeRoleWithWebIdentity`.

Those two entries were added to IAM by hand and, for a while, existed *only* in
IAM. Redeploying the bootstrap stack from a template that emitted the name-based
pair alone would have silently deleted them and broken every deploy again. The
template now emits all four, and this script is what keeps it that way: nothing
else in CI would notice a template edit that drops them, because cfn-lint checks
that the policy is well-formed, not that it is correct.

What it asserts
---------------
1. Rendering the template's `sub` list against its own parameter defaults
   produces EXACTLY the four subs the live role trusts — no more, no fewer.
2. The check itself still fails when the ID-qualified pair is removed. A checker
   that passes vacuously (wrong path walked, list not found, comparison against
   an empty set) is indistinguishable from a correct template, so both directions
   are asserted, the same way `scripts/verify-secret-scanning.sh` does.

Run locally:  python3 scripts/verify-oidc-trust-subs.py
Runs in CI as a step of the `deploy-path-lint` job.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - environment problem, not a template problem
    sys.stderr.write(
        "PyYAML is not installed.\n"
        "  pip install cfn-lint   (pulls in PyYAML, and is what the CI job installs)\n"
    )
    raise SystemExit(127)

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = REPO_ROOT / "infra" / "aws" / "climate-project-api-bootstrap.yml"

# The trust policy as it exists in the production account, read back from IAM with
# `aws iam get-role --role-name climate-project-github-deploy-prod` on 2026-08-05.
# The template is expected to reproduce this exactly.
EXPECTED_SUBS = {
    "repo:TIMSInternational@305569681/organizational-climate-platform@1317724282"
    ":ref:refs/heads/main",
    "repo:TIMSInternational@305569681/organizational-climate-platform@1317724282"
    ":environment:production",
    "repo:TIMSInternational/organizational-climate-platform:ref:refs/heads/main",
    "repo:TIMSInternational/organizational-climate-platform:environment:production",
}

SUB_CLAIM_KEY = "token.actions.githubusercontent.com:sub"


class CfnLoader(yaml.SafeLoader):
    """SafeLoader that understands CloudFormation's `!Ref` / `!Sub` shorthand.

    PyYAML rejects unknown `!Tag`s outright, so the short forms are mapped back to
    their `Fn::`-prefixed long forms, which is exactly what CloudFormation does
    before evaluating a template.
    """


def _multi_constructor(loader: yaml.Loader, tag_suffix: str, node: yaml.Node):
    key = tag_suffix if tag_suffix == "Ref" else f"Fn::{tag_suffix}"
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node, deep=True)
    else:
        value = loader.construct_mapping(node, deep=True)
    return {key: value}


CfnLoader.add_multi_constructor("!", _multi_constructor)


def render(node, parameters: dict[str, str]) -> str:
    """Evaluate the intrinsic-function subset the trust policy uses."""
    if isinstance(node, str):
        return node
    if not isinstance(node, dict) or len(node) != 1:
        raise ValueError(f"cannot render node: {node!r}")

    (fn, args), = node.items()

    if fn == "Ref":
        if args not in parameters:
            raise ValueError(f"Ref to unknown parameter {args!r}")
        return parameters[args]

    if fn == "Fn::Sub":
        if isinstance(args, str):
            template, extra = args, {}
        else:
            template, extra_raw = args
            extra = {k: render(v, parameters) for k, v in extra_raw.items()}
        out = template
        for name, value in {**parameters, **extra}.items():
            out = out.replace("${" + name + "}", value)
        if "${" in out:
            raise ValueError(f"unresolved substitution in {out!r}")
        return out

    if fn == "Fn::Split":
        raise ValueError("Fn::Split must be consumed by Fn::Select")

    if fn == "Fn::Select":
        index, source = args
        if not (isinstance(source, dict) and "Fn::Split" in source):
            raise ValueError(f"unsupported Fn::Select source: {source!r}")
        delimiter, target = source["Fn::Split"]
        return render(target, parameters).split(delimiter)[int(index)]

    raise ValueError(f"unsupported intrinsic function {fn!r}")


def rendered_subs(template: dict) -> set[str]:
    """Render every `sub` the GitHubDeployRole trust policy allows."""
    parameters = {
        name: str(spec["Default"])
        for name, spec in template["Parameters"].items()
        if "Default" in spec
    }

    role = template["Resources"]["GitHubDeployRole"]
    statements = role["Properties"]["AssumeRolePolicyDocument"]["Statement"]

    subs: set[str] = set()
    for statement in statements:
        entries = statement.get("Condition", {}).get("StringLike", {}).get(SUB_CLAIM_KEY)
        if entries is None:
            continue
        if isinstance(entries, (str, dict)):
            entries = [entries]
        for entry in entries:
            subs.add(render(entry, parameters))
    return subs


def check(template: dict) -> list[str]:
    """Return a list of problems; empty means the template matches live IAM."""
    actual = rendered_subs(template)
    problems = []
    for missing in sorted(EXPECTED_SUBS - actual):
        problems.append(f"MISSING sub: {missing}")
    for unexpected in sorted(actual - EXPECTED_SUBS):
        problems.append(f"UNEXPECTED sub: {unexpected}")
    return problems


def strip_id_qualified(template: dict) -> dict:
    """A copy of the template with the ID-qualified subs removed.

    This is the regression the guard exists to catch: exactly what redeploying the
    pre-#68 template would have done to the live role.
    """
    mutated = copy.deepcopy(template)
    statements = mutated["Resources"]["GitHubDeployRole"]["Properties"][
        "AssumeRolePolicyDocument"
    ]["Statement"]
    parameters = {
        name: str(spec["Default"])
        for name, spec in mutated["Parameters"].items()
        if "Default" in spec
    }
    for statement in statements:
        condition = statement.get("Condition", {}).get("StringLike", {})
        if SUB_CLAIM_KEY not in condition:
            continue
        condition[SUB_CLAIM_KEY] = [
            entry
            for entry in condition[SUB_CLAIM_KEY]
            if "@" not in render(entry, parameters)
        ]
    return mutated


def main() -> int:
    template = yaml.load(TEMPLATE.read_text(), Loader=CfnLoader)

    # 1. Detection check: would this script notice the regression it guards against?
    print("detection check   ... ", end="")
    if not check(strip_id_qualified(template)):
        print("FAIL")
        sys.stderr.write(
            "\nThis checker accepted a template with the ID-qualified subs removed.\n"
            "It is not actually verifying anything — a passing run means nothing.\n"
            "Most likely the trust policy moved and rendered_subs() now walks a path\n"
            "that no longer exists, returning an empty set.\n"
        )
        return 1
    print("ok (removing the ID-qualified subs is detected)")

    # 2. The real check.
    print("trust policy      ... ", end="")
    problems = check(template)
    if problems:
        print("DRIFT")
        sys.stderr.write(
            f"\n{TEMPLATE.relative_to(REPO_ROOT)} no longer renders the trust policy\n"
            "that the live climate-project-github-deploy-prod role carries:\n\n"
        )
        for problem in problems:
            sys.stderr.write(f"  {problem}\n")
        sys.stderr.write(
            "\nDeploying this template would rewrite the live role's trust policy to\n"
            "match, so a missing ID-qualified sub means the next production deploy\n"
            "fails at sts:AssumeRoleWithWebIdentity. See infra/aws/README.md.\n"
            "If the change is intentional, update EXPECTED_SUBS in this script in the\n"
            "same commit and say why.\n"
        )
        return 1
    print(f"ok ({len(EXPECTED_SUBS)} subs match live IAM)")

    print("\nOIDC trust policy verified: template reproduces the live role exactly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
