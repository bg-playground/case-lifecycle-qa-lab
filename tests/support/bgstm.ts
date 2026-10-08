/**
 * BGSTM traceability helpers.
 *
 * Follows the convention used by bg-playground/bgstm-playwright-frameworks:
 * one Playwright annotation of type 'bgstm:requirement' per requirement,
 * whose description is the requirement's external ID (REQ-<AREA>-NNN, as in
 * the BGSTM worked examples). Test titles start with the BGSTM test case ID
 * (TC-<AREA>-NNN). The mapping table is in the README.
 */
export class Bgstm {
  static requirement(id: `REQ-${string}`): { type: 'bgstm:requirement'; description: string } {
    return { type: 'bgstm:requirement', description: id };
  }
}
