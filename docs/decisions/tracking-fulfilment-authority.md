# Declaring a tracking plan fulfilled is an administrator's act

**Ruled 2026-09-14. Owner: Federico.** Settled for the authority rule. The evidence
requirement it was asked alongside is **open** and scoped at the end.

The client's words were "sólo puede marcar como cumplido Diego". A person cannot be the rule —
Diego leaves, Diego is on holiday, a second Diego is hired — so it is expressed as a role.

## What changed

`POST /api/planes-accion/{id}/cumplir` required `AccessLevel.Write`. Write admits **the node's
own leader**, so until today the leader of an area could declare that area's own plans met.

It now requires a new, strictly narrower `AccessLevel.Approve`, which only
`Roles.Admin` (`company_admin`, `super_admin`) satisfies.

## Why a new level rather than a role check at the endpoint

`PlanAccessHandler` is the one place that answers "may this principal act on this plan". A role
check written inline at `MarcarCumplidoAsync` would be a second, competing answer to the same
question, and the next endpoint would copy whichever it found first.

## Why the leader is excluded, when the leader runs the area

A leader records progress, moves the commitment date, edits the method — all Write. Fulfilment
is a different kind of statement: it asserts the commitment was **met**, and it closes the plan
out of the `DailySemaforoWorker` sweep (`.Where(p => !p.Cumplido)`), so a fulfilled plan stops
being chased.

The person best placed to report progress is the person least able to audit it. That is the
whole content of the client's rule, and it is why the separation is worth a level of its own.

The `responsable_ejecucion` was already read-only and stays so.

## How it is defended

| Guard | What it pins |
|---|---|
| `PlanAccessHandlerTests.An_admin_may_declare_a_plan_fulfilled` | both admin roles pass `Approve` |
| `PlanAccessHandlerTests.The_nodes_own_leader_may_write_the_plan_but_not_declare_it_fulfilled` | **the case that carries the rule** |
| `PlanAccessHandlerTests.The_responsable_de_ejecucion_may_not_declare_their_own_plan_fulfilled` | Read yes, Approve no |
| `PlanesAccionEndpointsTests.MarcarCumplido_refuses_the_nodes_own_leader_who_may_still_write_the_plan` | the same rule at the HTTP seam |

**The leader is the only principal whose two answers differ** — admins pass both levels,
strangers fail both. So every guard above asserts Write AND Approve on the same caller: a case
that only checked the refusal would also pass if the leader had simply lost all access.

**Mutation-proved 2026-09-14.** Neutering the exclusion (`Level == Approve && false`) compiles
— `Build succeeded, 0 Error(s)`, no `CS0162` — and turns the unit case and the integration case
red together. Suite after restoring: **99 unit, 70 integration, 0 failed.**

`MarcarCumplido_happy_path` had to change with the rule: it signed in as the node's leader, and
that is now precisely the refusal case. It signs in as a `company_admin`.

## Open: the evidence that should accompany fulfilment

The same request asked that people attach "texto o archivo como documento para probar" before a
plan is marked met. Only half of that is possible today.

- **Text exists.** `BitacoraEntry` carries `Comentario` beside `AvanceAnterior`/`AvanceNuevo`.
- **Files do not exist anywhere in this product.** Measured: no `IFormFile`, no S3 client and no
  `AWS::S3::Bucket` in `infra/aws/`, in either solution.

So file evidence is not a gap in tracking, it is a subsystem the product has never had: a
bucket, its IAM, an upload endpoint with size and type limits, a retention rule, and a GDPR
answer — `SubjectDataMap` exists precisely because personal data has to be locatable per
subject, and a document uploaded as proof on a climate platform will contain some.

**It should not be built as a side effect of this ruling.** Recorded here so the next reader
knows the authority half shipped and the evidence half did not.
