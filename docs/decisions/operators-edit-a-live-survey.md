# Decision: a TIMS operator may edit a survey that has left draft

**Status: RULED 2026-11-11.** Owner: Federico. Built the same day (branch `operators-edit-live-survey`).

## Why it came up

Audrey (TIMS, super admin since 11 Nov), on PROCOMER's demo survey — active, 0 answers of 3
invited: *«no veo una opción de modificar una encuesta que ya está creada… sea para cambiar el
nombre o las preguntas»*, pointing at the «Modificar» button of the evaluation platform TIMS also
runs. She was right twice over: an active survey said «Solo lectura — duplique la encuesta para
cambiarlas», and **no screen could rename a survey at all**, not even a draft. The API took a new
title for a draft; nothing on screen sent one.

## The ruling

Offered as three questions, each with a recommended option; Federico chose the recommended one
every time:

| Question | Ruling |
|---|---|
| Who may edit a survey that is ACTIVE? | **Only TIMS** — super admins, like Reabrir, Excluir and deleting a company (8 Nov). A client's administrator keeps «Solo lectura». |
| On a survey nobody has answered yet (not one row, not even a partial one)? | **Name, description and questions.** The draft's own question editor, the change kept in Historial, locked again by the first stored answer. |
| On a survey that already has answers (active or closed)? | **Name and description only.** The questions stay fixed for good: the answers are stored against them. |

## What the server does — `PUT /surveys/{id}`, `SurveyEndpoints.UpdateAsync`

- A client's administrator: unchanged. Content past draft → 409 `survey_content_locked`.
- A super admin past draft (`RefuseLiveEditAsync`):
  - **archived** → 409 `survey_content_locked`, even for the name;
  - **type, language, departments, anonymity** → 409 `survey_live_edit_out_of_scope`. They stay
    draft-only decisions: anonymity is a promise already made in the invitation, and departments
    move through «Editar audiencia»;
  - **questions** only while `scheduled` or `active` (409 `survey_live_edit_out_of_scope` otherwise)
    and while NO response row exists — complete, partial or excluded (409
    `survey_content_has_responses`);
  - **title and description** in `scheduled`, `active` and `closed`, with or without answers.
- **The race with a first answer.** The edit runs in one transaction that takes `FOR UPDATE` on the
  survey row and re-checks for responses under it. Inserting a response takes `FOR KEY SHARE` on the
  same row (the `responses.survey_id` foreign key), which `FOR UPDATE` excludes. So a first answer
  either committed first — and the re-check refuses — or waits for the edit to commit and then fails
  on its own, because `question_responses.question_id` is `RESTRICT` and the questions it answered
  are gone. Never an answer silently attached to a question that was taken away. Pinned by
  `A_first_answer_being_written_holds_the_edit_back_and_then_refuses_it`.
- **The publish gate (#195) still holds** for content respondents can see: a live edit may not leave
  the survey with no questions (400 `survey_no_questions`) nor leave a text untranslated that was
  translated (400 `survey_missing_translations`). A gap that predates the edit does not block it.
- **Every effective live edit writes the next version** (`CaptureVersionAsync`, reason `republish`).
  A response resolves to its wording through `survey.Version`; until now that snapshot could be
  frozen at publish because nothing moved afterwards. Questions only move while nobody has answered,
  so every answer still resolves to the questions it was given.
- The audit row is the usual `updated` with the fields that changed, filed under the survey's
  company (a company-less operator included).

## What the screen does

- **«Editar nombre»** in the survey's header — for anyone who administers an unanswered draft, and
  for a super admin until the survey is archived. Name and description in every language the survey
  is written in; a language the description never had, left empty, stays absent. Past draft it says
  that **the invitations already sent keep the old name**, and that the change goes to Historial.
- **«Editar preguntas»** on an active or scheduled survey nobody has answered, for a super admin.
  The editor opens with a warning: the change is live for anyone who opens the survey, and a save
  is refused if somebody answers meanwhile.

## Not decided here

- A client's administrator on a `scheduled` survey: the questions editor offers itself
  (`isEditable` has always counted `scheduled`) and the server answers 409, as before this change.
- Editing an **archived** survey.
