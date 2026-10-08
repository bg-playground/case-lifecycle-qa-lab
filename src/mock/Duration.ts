/** Minimal ISO 8601 duration support (PnD, PTnH, PTnM) for SLA timestamps. */
export class Duration {
  static toMs(iso: string): number {
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso);
    if (!m || iso === 'P' || iso.endsWith('T')) throw new Error(`Unsupported duration: ${iso}`);
    const [, d = '0', h = '0', min = '0'] = m;
    return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60_000;
  }

  static addTo(start: Date, iso: string): string {
    return new Date(start.getTime() + Duration.toMs(iso)).toISOString();
  }
}
