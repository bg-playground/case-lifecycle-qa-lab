import { expect, test } from '@playwright/test';
import { Bgstm } from '../support/bgstm.js';
import { CASE_TYPE_ID, DxApiClient, VALID_INTAKE } from '../support/DxApiClient.js';

test(
  'TC-CLM-002 API client creates a claim and submits the Intake assignment',
  { annotation: [Bgstm.requirement('REQ-CLM-002')], tag: ['@api', '@lifecycle'] },
  async ({ request }) => {
    await test.step('the API rejects calls without a bearer token', async () => {
      const anonymous = await request.post('/prweb/api/application/v2/cases', { data: { caseTypeID: CASE_TYPE_ID } });
      expect(anonymous.status()).toBe(401);
    });

    const token = await DxApiClient.token(request);

    const created = await test.step('create case', async () => {
      const call = await DxApiClient.createCase(request, token);
      expect(call.response.status()).toBe(201);
      expect(call.eTag).not.toBe('');
      const info = call.body.data.caseInfo;
      expect(info.businessID).toMatch(/^C-\d+$/);
      expect(info.stageID).toBe('Intake');
      expect(info.stages.map((s) => s.ID)).toEqual(['Intake', 'Triage', 'Assessment', 'Settlement', 'Resolution']);
      expect(call.body.nextAssignmentInfo?.ID).toBe(info.assignments[0]?.ID);
      expect(info.assignments[0]?.sla?.deadline).toBeTruthy();
      return call;
    });

    const assignmentID = created.body.nextAssignmentInfo!.ID;

    const opened = await test.step('get assignment', async () => {
      const call = await DxApiClient.getAssignment(request, token, assignmentID);
      expect(call.response.status()).toBe(200);
      expect(call.eTag).toBe(created.eTag);
      expect(call.body.uiResources.form?.name).toBe('IntakeForm');
      return call;
    });

    await test.step('submit assignment action with If-Match', async () => {
      const actionID = opened.body.data.caseInfo.assignments[0]!.actions[0]!.ID;
      expect(actionID).toBe('CollectIncidentDetails');
      const submitted = await DxApiClient.read(await DxApiClient.submit(request, token, assignmentID, actionID, opened.eTag, VALID_INTAKE));
      expect(submitted.response.status()).toBe(200);
      expect(submitted.eTag).not.toBe(opened.eTag);
      const info = submitted.body.data.caseInfo;
      expect(info.stageID).toBe('Triage');
      expect(info.stages.find((s) => s.ID === 'Intake')?.visited_status).toBe('completed');
      expect(info.assignments[0]?.name).toBe('Assign severity');
      expect(info.content).toMatchObject({ policyNumber: VALID_INTAKE.policyNumber });
    });
  },
);
