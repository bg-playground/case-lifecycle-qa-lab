import { expect, test } from '@playwright/test';
import { Bgstm } from '../support/bgstm.js';
import { DxApiClient, VALID_INTAKE } from '../support/DxApiClient.js';

test(
  'TC-CLM-003 a stale If-Match version is rejected with 409 Conflict',
  { annotation: [Bgstm.requirement('REQ-CLM-003')], tag: ['@api', '@concurrency'] },
  async ({ request }) => {
    const token = await DxApiClient.token(request);
    const created = await DxApiClient.createCase(request, token);
    expect(created.response.status()).toBe(201);
    const assignmentID = created.body.nextAssignmentInfo!.ID;
    const actionID = created.body.data.caseInfo.assignments[0]!.actions[0]!.ID;

    // Two users open the same assignment and hold the same version.
    const userA = await DxApiClient.getAssignment(request, token, assignmentID);
    const userB = await DxApiClient.getAssignment(request, token, assignmentID);
    expect(userA.eTag).toBe(userB.eTag);

    // User A saves a draft, which creates a new version.
    const saved = await DxApiClient.read(await DxApiClient.save(request, token, assignmentID, actionID, userA.eTag, { description: 'Draft from user A' }));
    expect(saved.response.status()).toBe(200);
    expect(saved.eTag).not.toBe(userA.eTag);

    // User B submits with the old version: 409, and nothing changes.
    const stale = await DxApiClient.submit(request, token, assignmentID, actionID, userB.eTag, VALID_INTAKE);
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ errorClassification: 'Conflict' });

    // An update with no If-Match at all is refused too (this mock answers 428).
    const missing = await DxApiClient.submit(request, token, assignmentID, actionID, null, VALID_INTAKE);
    expect(missing.status()).toBe(428);

    const after = await DxApiClient.getAssignment(request, token, assignmentID);
    expect(after.eTag).toBe(saved.eTag);
    expect(after.body.data.caseInfo.stageID).toBe('Intake');
    expect(after.body.data.caseInfo.content).toMatchObject({ description: 'Draft from user A' });

    // User B refreshes, retries with the current version and succeeds.
    const retried = await DxApiClient.submit(request, token, assignmentID, actionID, after.eTag, VALID_INTAKE);
    expect(retried.status()).toBe(200);
  },
);
