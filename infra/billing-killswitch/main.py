"""Billing kill switch: unlink billing from the project once spend reaches the
budget. Google Cloud has no hard spending cap, only budgets that notify; this
turns the budget's Pub/Sub notification into one.

Unlinking billing stops every paid service in the project, the accounts API
included. The static site and the scanner are unaffected. To recover, re-link
billing in the console (Billing → My projects).
"""

import base64
import json
import os

import functions_framework
from google.cloud import billing_v1

PROJECT_ID = os.environ["TARGET_PROJECT_ID"]
_client = billing_v1.CloudBillingClient()


@functions_framework.cloud_event
def stop_billing(cloud_event) -> None:
    data = json.loads(base64.b64decode(cloud_event.data["message"]["data"]))
    cost, budget = data.get("costAmount", 0), data.get("budgetAmount", 0)
    print(f"budget notification: cost={cost} budget={budget}")
    if budget <= 0 or cost < budget:
        return

    # No read first: roles/billing.projectManager can unlink billing but not
    # read it, and unlinking an already-unlinked project is a no-op.
    name = f"projects/{PROJECT_ID}"
    _client.update_project_billing_info(
        name=name, project_billing_info=billing_v1.ProjectBillingInfo(billing_account_name="")
    )
    print(f"billing disabled for {PROJECT_ID}")
