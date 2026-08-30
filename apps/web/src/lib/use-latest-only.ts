import { useCallback, useRef } from "react";

/**
 * Guard against a slower earlier response overwriting a newer one.
 *
 * Every fetch that can be superseded — a filter changed twice, a typeahead
 * typed into — claims a turn before it starts, and checks it still holds that
 * turn before touching state:
 *
 * ```ts
 * const claim = useLatestOnly();
 * // …
 * const isLatest = claim();
 * const result = await fetch(...);
 * if (!isLatest()) return;
 * setResults(result);
 * ```
 *
 * `await` is where this goes wrong. Nothing about a promise resolving says it
 * is still the one being waited for, so a request that has been superseded
 * lands and writes anyway: pick January in a filter, then March, and if January
 * is slower the select says March while the table shows January.
 *
 * A ref, not state — claiming a turn must not itself cause a render, and the
 * value has to be readable by a closure created before the render that
 * superseded it. See ADR 0201.
 */
export function useLatestOnly(): () => () => boolean {
  const seq = useRef(0);
  return useCallback(() => {
    const mine = ++seq.current;
    return () => mine === seq.current;
  }, []);
}
