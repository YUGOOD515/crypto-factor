// Minimal typings for flubber (no bundled declarations).
declare module 'flubber' {
  export interface InterpolateOptions {
    /** Maximum distance between added points when matching shapes; false disables. */
    maxSegmentLength?: number | false;
    /** Return path strings (default true) or arrays of points. */
    string?: boolean;
  }
  export function interpolate(
    fromShape: string,
    toShape: string,
    options?: InterpolateOptions,
  ): (t: number) => string;
  const flubber: { interpolate: typeof interpolate };
  export default flubber;
}