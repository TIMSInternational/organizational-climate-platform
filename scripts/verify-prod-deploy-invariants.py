#!/usr/bin/env python3
"""Guard five deploy-safety properties of the service template and the deploy
workflows that are invisible to a linter (Refs #221, #300, #160, #156).

Why this exists
---------------
cfn-lint proves the template is well-formed and actionlint proves the workflow is
well-formed. Every regression below leaves both perfectly happy, and each one has a
history:

1. **The health check must point at /ready, not /health.** /health is a static literal
   that opens no database connection, so an instance that has lost Postgres passes it
   forever and is never replaced (#221). Reverting this is a one-character edit.

2. **The workflow's HEALTH_CHECK_PATH must agree with the template's default.** The
   workflow passes the parameter explicitly, so the workflow value is what deploys and
   the template default is what a reader believes. When they disagree the template is a
   lie and the lie is the safer-looking half.

3. **The readiness canary must require CONSECUTIVE successes.** It used to exit 0 on
   the first 200 of ten attempts, which #220's ~50%-failing instance passed almost
   immediately (#300). infra/aws/README.md has specified 20+ consecutive since before
   the canary implemented it.

4. **A second CORS origin must be droppable, not empty.** The additional origins are
   optional, and an optional list element cannot be expressed by passing an empty
   value: an empty exact origin binds "" into the allowlist, and an empty WILDCARD
   origin fails the host at startup outright, because CorsOriginMatcher throws on a
   pattern containing no '*'. The Fn::If/AWS::NoValue pair is what makes the index
   genuinely absent, and deleting it looks like a simplification.

5. **The staging deploy must rehearse the prod deploy (#156).** deploy-staging.yml's
   "Readiness canary" and "Verify deployed commit matches this run" steps are defined
   as VERBATIM copies of deploy-prod.yml's (env and run, byte for byte), and its
   HEALTH_CHECK_PATH must equal prod's. Every executed check in this file runs the
   PROD copy only, so a staging copy that quietly drifts -- a lower canary bar, a
   neutered assertion -- would be invisible to everything else here while making
   staging rehearse a different deploy than the one production performs.

What it asserts
---------------
Each check is run twice: once against the template as committed, and once against a
deliberately broken copy, so a checker that has stopped looking at anything (path
renamed, key moved, list not found) is reported as loudly as a real regression. That
two-directional shape is copied from scripts/verify-oidc-trust-subs.py, which exists
for the same reason on the bootstrap template.

The CloudFormation YAML shim below is deliberately a second copy of the one in that
script rather than a shared import: the two guards cover different templates and
different intrinsics, and a common module would make both harder to read than the
fifteen lines it saved.

Run locally:  python3 scripts/verify-prod-deploy-invariants.py
Runs in CI as a step of the `deploy-path-lint` job.
"""

from __future__ import annotations

import copy
import http.server
import os
import re
import subprocess
import sys
import threading
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
TEMPLATE = REPO_ROOT / "infra" / "aws" / "climate-project-api-prod-service.yml"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy-prod.yml"
STAGING_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy-staging.yml"

# Steps deploy-staging.yml must carry as verbatim copies of deploy-prod.yml's.
# Comparison is on the parsed step's `env` and `run` values, so YAML comments are
# free to differ; the executable content is not.
MIRRORED_STEP_NAMES = ("Readiness canary", "Verify deployed commit matches this run")

# App Runner's documented range for every HealthCheckConfiguration integer.
APP_RUNNER_MIN = 1
APP_RUNNER_MAX = 20

# The floor on how long an instance may keep failing /ready before App Runner replaces
# it. Replacing an instance does not fix a database outage -- a fresh instance fails the
# same probe -- so a short window turns a brief Supavisor blip into a replacement loop.
MIN_UNHEALTHY_WINDOW_SECONDS = 60

# infra/aws/README.md's acceptance criterion for #220, and the reason it is 20: the
# defect alternated 200/timeout at ~50%, so a single green probe proves nothing.
MIN_CONSECUTIVE_READY_PROBES = 20


class CfnLoader(yaml.SafeLoader):
    """SafeLoader that understands CloudFormation's `!Ref` / `!If` shorthand."""


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


def evaluate_condition(node, parameters: dict[str, str]) -> bool:
    """Evaluate the Fn::Not / Fn::Equals subset the Conditions section uses."""
    (fn, args), = node.items()
    if fn == "Fn::Not":
        return not evaluate_condition(args[0], parameters)
    if fn == "Fn::Equals":
        return resolve(args[0], parameters) == resolve(args[1], parameters)
    raise ValueError(f"unsupported condition function {fn!r}")


def resolve(node, parameters: dict[str, str]) -> str:
    if isinstance(node, str):
        return node
    if isinstance(node, dict) and set(node) == {"Ref"}:
        name = node["Ref"]
        if name not in parameters:
            raise ValueError(f"Ref to unknown parameter {name!r}")
        return parameters[name]
    raise ValueError(f"cannot resolve node: {node!r}")


def runtime_environment_variables(
    template: dict, overrides: dict[str, str] | None = None
) -> dict[str, str]:
    """Render RuntimeEnvironmentVariables the way CloudFormation would.

    Entries whose Fn::If resolves to AWS::NoValue are dropped, which is the behaviour
    the optional CORS origins depend on.
    """
    parameters = {
        name: str(spec.get("Default", ""))
        for name, spec in template["Parameters"].items()
    }
    parameters.update(overrides or {})

    conditions = {
        name: evaluate_condition(node, parameters)
        for name, node in template.get("Conditions", {}).items()
    }

    entries = template["Resources"]["AppRunnerService"]["Properties"][
        "SourceConfiguration"
    ]["ImageRepository"]["ImageConfiguration"]["RuntimeEnvironmentVariables"]

    rendered: dict[str, str] = {}
    for entry in entries:
        if isinstance(entry, dict) and set(entry) == {"Fn::If"}:
            condition_name, when_true, when_false = entry["Fn::If"]
            if condition_name not in conditions:
                raise ValueError(f"Fn::If names unknown condition {condition_name!r}")
            entry = when_true if conditions[condition_name] else when_false
            if isinstance(entry, dict) and entry.get("Ref") == "AWS::NoValue":
                continue
        rendered[entry["Name"]] = resolve(entry["Value"], parameters)
    return rendered


def health_check(template: dict) -> dict:
    return template["Resources"]["AppRunnerService"]["Properties"][
        "HealthCheckConfiguration"
    ]


def canary_step(workflow: dict) -> dict:
    for step in workflow["jobs"]["deploy"]["steps"]:
        if step.get("name") == "Readiness canary":
            return step
    raise ValueError("deploy-prod.yml has no 'Readiness canary' step")


def named_step(workflow: dict, workflow_label: str, name: str) -> dict:
    for step in workflow["jobs"]["deploy"]["steps"]:
        if step.get("name") == name:
            return step
    raise ValueError(f"{workflow_label} has no {name!r} step")


# --------------------------------------------------------------------------------
# The checks. Each returns a list of problems; empty means the invariant holds.
# --------------------------------------------------------------------------------

def check_health_check_path(template: dict, workflow: dict) -> list[str]:
    problems = []
    default = template["Parameters"]["HealthCheckPath"].get("Default")
    if default != "/ready":
        problems.append(
            f"HealthCheckPath default is {default!r}, expected '/ready'. "
            "A static /health cannot observe the database, so a database-broken "
            "instance passes it forever and is never replaced (#221)."
        )

    workflow_path = workflow["env"].get("HEALTH_CHECK_PATH")
    if workflow_path != default:
        problems.append(
            f"deploy-prod.yml sets HEALTH_CHECK_PATH={workflow_path!r} but the template "
            f"defaults HealthCheckPath to {default!r}. The workflow passes the parameter "
            "explicitly, so the workflow value is what deploys and the template default "
            "is only what a reader believes."
        )
    return problems


def check_health_check_thresholds(template: dict) -> list[str]:
    config = health_check(template)
    problems = []

    if config.get("Protocol") != "HTTP":
        problems.append(
            f"HealthCheckConfiguration Protocol is {config.get('Protocol')!r}; TCP would "
            "only prove the port is open, which is what /health already over-promised."
        )

    for key in ("Interval", "Timeout", "HealthyThreshold", "UnhealthyThreshold"):
        value = config.get(key)
        if not isinstance(value, int) or not APP_RUNNER_MIN <= value <= APP_RUNNER_MAX:
            problems.append(
                f"HealthCheckConfiguration {key} is {value!r}; App Runner accepts "
                f"integers {APP_RUNNER_MIN}-{APP_RUNNER_MAX} and rejects the stack "
                "outright otherwise."
            )

    if isinstance(config.get("HealthyThreshold"), int) and config["HealthyThreshold"] < 2:
        problems.append(
            "HealthyThreshold is 1, which declares an instance healthy on a single 200. "
            "Against #220's ~50%-intermittent failure that is a coin flip -- the same "
            "'one green probe proves nothing' error the deploy canary had (#300)."
        )

    interval = config.get("Interval")
    unhealthy = config.get("UnhealthyThreshold")
    if isinstance(interval, int) and isinstance(unhealthy, int):
        window = interval * unhealthy
        if window < MIN_UNHEALTHY_WINDOW_SECONDS:
            problems.append(
                f"Interval x UnhealthyThreshold is {window}s, under the "
                f"{MIN_UNHEALTHY_WINDOW_SECONDS}s floor. Now that the probe touches "
                "Postgres, a window this short lets a brief pooler blip start replacing "
                "instances -- and a replacement instance fails the same probe."
            )
    return problems


class _AlternatingReady(http.server.BaseHTTPRequestHandler):
    """/ready as #220's instance actually behaved: 200, fail, 200, fail."""

    counter = 0

    def do_GET(self):
        status = 200 if _AlternatingReady.counter % 2 == 0 else 503
        _AlternatingReady.counter += 1
        self._respond(status)

    def _respond(self, status: int):
        body = b'{"service":"climate-project-api"}'
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class _HealthyReady(_AlternatingReady):
    def do_GET(self):
        self._respond(200)


def run_canary(workflow: dict, handler, deadline_seconds: int) -> int:
    """Execute the shipped canary `run:` block against a local /ready and return its
    exit code.

    The loop is taken from the workflow rather than reimplemented, so this tests what
    deploys. Only the pacing is overridden -- REQUIRED_CONSECUTIVE, the constant the
    check is about, is left at whatever the workflow says.
    """
    step = canary_step(workflow)
    server = http.server.HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        base = f"http://127.0.0.1:{server.server_port}"
        script = step["run"].replace("${{ steps.service.outputs.base_url }}", base)
        if "${{" in script:
            raise ValueError(
                "the canary step uses a workflow expression this check does not "
                "substitute, so it cannot be executed here"
            )
        env = dict(os.environ)
        env.update({k: str(v) for k, v in step.get("env", {}).items()})
        env["PROBE_INTERVAL_SECONDS"] = "0"
        env["DEADLINE_SECONDS"] = str(deadline_seconds)
        return subprocess.run(
            ["bash", "-c", script], env=env, capture_output=True, text=True
        ).returncode
    finally:
        server.shutdown()
        server.server_close()


def check_readiness_canary(workflow: dict) -> list[str]:
    step = canary_step(workflow)
    problems = []

    required = step.get("env", {}).get("REQUIRED_CONSECUTIVE")
    if not isinstance(required, int) or required < MIN_CONSECUTIVE_READY_PROBES:
        problems.append(
            f"Readiness canary requires {required!r} consecutive successes, under the "
            f"{MIN_CONSECUTIVE_READY_PROBES} that infra/aws/README.md specifies. #220's "
            "instance alternated 200/timeout at ~50%, so a low bar passes a broken "
            "deploy (#300)."
        )

    # The constant above is necessary but not sufficient: a loop that requires 20
    # successes without RESETTING on failure counts twenty successes eventually, which
    # the alternating instance also reaches. Grepping the shell for the reset proved
    # vacuous -- the initialiser matches the same pattern -- so the loop is executed
    # against the failure it exists to reject instead.
    # 10s, not 2s. A correct canary can never pass this server however long it runs, so
    # the length is not what makes the assertion sound -- it is sized for the DETECTION
    # direction, where a canary with no reset has to accumulate 20 successes at a 50%
    # hit rate, i.e. ~40 probes. Measured at 16ms per probe, so 10s is a ~15x margin;
    # 2s was inside the noise of a loaded machine and produced a flaky pass.
    _AlternatingReady.counter = 0
    if run_canary(workflow, _AlternatingReady, deadline_seconds=10) == 0:
        problems.append(
            "The canary PASSED against a /ready that alternates 200 and 503. That is "
            "#220's exact signature, so the run counter is not being reset on failure "
            "and the gate counts total successes rather than consecutive ones (#300)."
        )

    # And the other direction, so the check above cannot be satisfied by a canary that
    # simply never passes anything.
    if run_canary(workflow, _HealthyReady, deadline_seconds=30) != 0:
        problems.append(
            "The canary FAILED against a /ready that always returns 200. Whatever it is "
            "now measuring, it is not readiness -- and it will fail every deploy."
        )
    return problems


def check_optional_cors_origins(template: dict) -> list[str]:
    problems = []

    absent = runtime_environment_variables(template)
    for key in ("Cors__AllowedOrigins__1", "Cors__AllowedWildcardOrigins__1"):
        if key in absent:
            problems.append(
                f"{key} is present with no additional origin configured (value "
                f"{absent[key]!r}). An empty exact origin binds '' into the allowlist, "
                "and an empty wildcard origin fails the host at startup because "
                "CorsOriginMatcher rejects a pattern with no '*'."
            )

    present = runtime_environment_variables(
        template,
        {
            "CorsAllowedOrigin": "https://climate.example.com",
            "CorsAllowedWildcardOrigin": "https://*.vercel.app",
            "CorsAdditionalAllowedOrigin": "https://second.example.com",
            "CorsAdditionalAllowedWildcardOrigin": "https://*.staging.example.com",
        },
    )
    expected = {
        "Cors__AllowedOrigins__0": "https://climate.example.com",
        "Cors__AllowedOrigins__1": "https://second.example.com",
        "Cors__AllowedWildcardOrigins__0": "https://*.vercel.app",
        "Cors__AllowedWildcardOrigins__1": "https://*.staging.example.com",
    }
    for key, value in expected.items():
        if present.get(key) != value:
            problems.append(
                f"With a second origin supplied, {key} rendered {present.get(key)!r}, "
                f"expected {value!r}. Index 0 alone means a custom domain DISPLACES the "
                "vercel.app previews rather than joining them (#160)."
            )
    return problems


def check_staging_mirrors_prod(prod: dict, staging: dict) -> list[str]:
    problems = []

    prod_path = prod["env"].get("HEALTH_CHECK_PATH")
    staging_path = staging["env"].get("HEALTH_CHECK_PATH")
    if staging_path != prod_path:
        problems.append(
            f"deploy-staging.yml sets HEALTH_CHECK_PATH={staging_path!r} but "
            f"deploy-prod.yml sets {prod_path!r}. Staging exists to rehearse the "
            "production deploy path; probing a different path rehearses a different "
            "one (#221)."
        )

    for name in MIRRORED_STEP_NAMES:
        try:
            staging_step = named_step(staging, "deploy-staging.yml", name)
        except ValueError as exc:
            problems.append(str(exc))
            continue
        prod_step = named_step(prod, "deploy-prod.yml", name)
        if (
            staging_step.get("env", {}) != prod_step.get("env", {})
            or staging_step.get("run") != prod_step.get("run")
        ):
            problems.append(
                f"deploy-staging.yml step {name!r} is not a verbatim copy of "
                "deploy-prod.yml's: env and run must match byte for byte. The "
                "executed canary checks in this script run the PROD copy only, so a "
                "drifted staging copy is otherwise unguarded. Keep them identical -- "
                "or extract the shared shell into scripts/ and point both at it in "
                "the same change as updating this check."
            )
    return problems


# --------------------------------------------------------------------------------
# Detection: each check, run against a copy broken in the specific way it guards.
# --------------------------------------------------------------------------------

def break_health_check_path(template: dict, workflow: dict):
    template = copy.deepcopy(template)
    template["Parameters"]["HealthCheckPath"]["Default"] = "/health"
    return template, workflow


def break_health_check_thresholds(template: dict, workflow: dict):
    template = copy.deepcopy(template)
    health_check(template)["HealthyThreshold"] = 1
    health_check(template)["Interval"] = 1
    return template, workflow


def break_readiness_canary(template: dict, workflow: dict):
    workflow = copy.deepcopy(workflow)
    canary_step(workflow)["env"]["REQUIRED_CONSECUTIVE"] = 1
    return template, workflow


def break_readiness_canary_reset(template: dict, workflow: dict):
    """Delete the reset while leaving REQUIRED_CONSECUTIVE at 20 -- the regression the
    constant alone cannot see, and the reason this check executes the loop.

    The initialiser and the reset are the same assignment at different indentation, so
    only the indented one (inside the loop body) is removed.
    """
    workflow = copy.deepcopy(workflow)
    step = canary_step(workflow)
    step["run"] = re.sub(r"\n(\s+)consecutive=0\b", r"\n\1:", step["run"], count=1)
    return template, workflow


def break_staging_canary_bar(staging: dict) -> dict:
    """Lower the staging canary's bar while leaving prod's alone -- the drift the
    mirror check exists to catch, invisible to every executed check because those
    run the prod copy."""
    staging = copy.deepcopy(staging)
    canary_step(staging)["env"]["REQUIRED_CONSECUTIVE"] = 1
    return staging


def break_staging_verify_commit(staging: dict) -> dict:
    """Neuter the staging deployed-commit assertion: same failure family as #158,
    reintroduced on one workflow only."""
    staging = copy.deepcopy(staging)
    step = named_step(
        staging, "deploy-staging.yml", "Verify deployed commit matches this run"
    )
    step["run"] = step["run"].replace("exit 1", "true")
    return staging


STAGING_DETECTIONS = [
    ("staging canary bar lowered", break_staging_canary_bar),
    ("staging commit assertion neutered", break_staging_verify_commit),
]


def break_optional_cors_origins(template: dict, workflow: dict):
    """Replace the Fn::If entries with plain always-present ones -- the simplification
    that reintroduces the empty-value bug."""
    template = copy.deepcopy(template)
    entries = template["Resources"]["AppRunnerService"]["Properties"][
        "SourceConfiguration"
    ]["ImageRepository"]["ImageConfiguration"]["RuntimeEnvironmentVariables"]
    for index, entry in enumerate(entries):
        if isinstance(entry, dict) and set(entry) == {"Fn::If"}:
            entries[index] = entry["Fn::If"][1]
    return template, workflow


CHECKS = [
    ("health check targets /ready", lambda t, w: check_health_check_path(t, w)),
    ("health check thresholds", lambda t, w: check_health_check_thresholds(t)),
    ("readiness canary", lambda t, w: check_readiness_canary(w)),
    ("optional second CORS origin", lambda t, w: check_optional_cors_origins(t)),
]

# One entry per regression that has to stay visible, which is not one per check: the
# canary check has two independent ways of going wrong (too low a bar, and no reset),
# and only the second justifies executing the loop rather than reading a constant.
DETECTIONS = [
    ("health check path reverted", CHECKS[0][1], break_health_check_path),
    ("health check thresholds loosened", CHECKS[1][1], break_health_check_thresholds),
    ("canary bar lowered", CHECKS[2][1], break_readiness_canary),
    ("canary reset removed", CHECKS[2][1], break_readiness_canary_reset),
    ("CORS origin made unconditional", CHECKS[3][1], break_optional_cors_origins),
]


def main() -> int:
    template = yaml.load(TEMPLATE.read_text(), Loader=CfnLoader)
    workflow = yaml.safe_load(WORKFLOW.read_text())
    staging_workflow = yaml.safe_load(STAGING_WORKFLOW.read_text())

    failed = False

    for label, check, breaker in DETECTIONS:
        broken_template, broken_workflow = breaker(template, workflow)
        print(f"detection: {label:34s} ... ", end="", flush=True)
        if not check(broken_template, broken_workflow):
            print("FAIL")
            sys.stderr.write(
                f"\nThe check accepted '{label}'. It is not verifying anything, so a\n"
                "passing run means nothing. Most likely the property it reads moved and\n"
                "the lookup now returns a default.\n"
            )
            failed = True
        else:
            print("ok (the regression is detected)")

    for label, breaker in STAGING_DETECTIONS:
        print(f"detection: {label:34s} ... ", end="", flush=True)
        if not check_staging_mirrors_prod(workflow, breaker(staging_workflow)):
            print("FAIL")
            sys.stderr.write(
                f"\nThe mirror check accepted '{label}'. It is not comparing anything,\n"
                "so a passing run means nothing. Most likely a step was renamed and the\n"
                "lookup no longer finds it.\n"
            )
            failed = True
        else:
            print("ok (the regression is detected)")

    if failed:
        return 1

    print()
    for label, check in CHECKS:
        print(f"{label:44s} ... ", end="", flush=True)
        problems = check(template, workflow)
        if problems:
            print("FAIL")
            sys.stderr.write("\n")
            for problem in problems:
                sys.stderr.write(f"  {problem}\n")
            failed = True
        else:
            print("ok")

    print(f"{'staging mirrors the prod deploy steps':44s} ... ", end="", flush=True)
    problems = check_staging_mirrors_prod(workflow, staging_workflow)
    if problems:
        print("FAIL")
        sys.stderr.write("\n")
        for problem in problems:
            sys.stderr.write(f"  {problem}\n")
        failed = True
    else:
        print("ok")

    if failed:
        sys.stderr.write(
            "\nThese are production-safety invariants, not style rules. If a change to\n"
            "one is intentional, change the constant in this script in the same commit\n"
            "and say why in the message.\n"
        )
        return 1

    print("\nProduction deploy invariants verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
