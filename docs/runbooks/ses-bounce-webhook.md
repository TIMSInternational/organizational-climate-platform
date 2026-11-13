# SES bounce webhook — connecting it

What it is: `POST /webhooks/ses` (`SesWebhookEndpoints.cs`) stores the bounces, complaints and
rejections Amazon SES reports for this product's mail, so the delivery audit
(`GET /admin/companies/{id}/delivery-audit`, button "Auditoría de envíos (solo TIMS)" on the
super-admin surveys list once a company is picked) can say who never received the email.

## Facts it rests on (measured 2026-11-02, read-only, profile `claude` = account 747814092517)

- The app sends through configuration set `tims-transactional`, which publishes
  BOUNCE / COMPLAINT / REJECT / RENDERING_FAILURE to SNS
  `arn:aws:sns:us-east-1:747814092517:tims-ses-transactional-events`.
  Its only subscriber was the Lambda `bounce-handler`; it stays.
- The set is shared with other products, so the app stamps `X-SES-MESSAGE-TAGS: app=climate`
  on its own mail and the webhook keeps only events carrying that tag, and only for addresses
  that belong to a user in this database.
- Another app in the same account already receives its own topic over HTTPS
  (`pca-ses-events` → `https://pca.nexadev.ai/api/ses-events`), so the pattern is established.

## Order

1. Deploy the release that carries the webhook. `deploy-prod.yml` applies
   `Email__SesEventsTopicArn` from `infra/aws/climate-project-api-prod-service.yml`.
   Check: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.climate.timsint.com/webhooks/ses -d '{}'`
   answers **400** (configured, body is not an SNS message). A **404** means the topic is not set.
2. Subscribe the endpoint (an AWS WRITE in the sending account — a person does this, not the agent):

       aws sns subscribe --region us-east-1 --profile claude --topic-arn arn:aws:sns:us-east-1:747814092517:tims-ses-transactional-events --protocol https --notification-endpoint https://api.climate.timsint.com/webhooks/ses

   SNS immediately posts a signed SubscriptionConfirmation; the webhook verifies it and visits
   the SubscribeURL itself. Nothing else to click.
3. Confirm it took (read-only):

       aws sns list-subscriptions-by-topic --region us-east-1 --profile claude --topic-arn arn:aws:sns:us-east-1:747814092517:tims-ses-transactional-events

   The https row must show a real SubscriptionArn, not `PendingConfirmation`. CloudWatch Logs
   for the API carry `SES webhook subscription confirmation: True`.

## What it does not cover

- Events from before step 2. The audit's first sheet says from when bounces are recorded.
- Mail accepted and then filtered to spam or quarantine by the receiving organisation: to SES
  that is a delivery. Those people appear as "Sin señal todavía".
- Undo: `aws sns unsubscribe --region us-east-1 --profile claude --subscription-arn` with the ARN
  from step 3, or blank `Email__SesEventsTopicArn` (the route then answers 404).
