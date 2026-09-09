import "@testing-library/jest-dom";

/**
 * The App Router hooks these components reach for. Testing Library renders a
 * component in isolation, with no router around it, so `useRouter()` would throw
 * — the mock is what makes the interactive components testable at all.
 *
 * `push` is a jest.fn so a test can assert *where* a control navigates, which is
 * exactly the assertion that would have caught the closed-status-tab bug: a
 * deadline filter carried into a screen that cannot show it.
 */
export const routerPush = jest.fn();
export const routerRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: jest.fn(),
    refresh: routerRefresh,
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  routerPush.mockClear();
  routerRefresh.mockClear();
});

/**
 * React validates HTML nesting as it renders and reports a violation through
 * `console.error` — which Jest prints and then forgets. The CRM sync summary
 * shipped a `<ul>` inside a `<p>`; React said so on every render of it, nine
 * tests covering that component passed, and CI was green. See ADR 0236.
 *
 * Invalid nesting is not cosmetic. The HTML parser closes the open element when
 * it meets one that cannot live inside it, so in server-rendered markup the
 * list and everything after it fall out of the box they were written into. It
 * is also the one class of markup mistake with an exact, machine-checked
 * definition, so it costs nothing to hold.
 *
 * Recorded and asserted after the test rather than thrown from inside
 * `console.error`: React calls it from within its own commit phase, and
 * throwing there fails the render instead of the assertion, with a stack that
 * points at React.
 */
const nestingViolations: string[] = [];
const INVALID_NESTING =
  /cannot contain a nested|cannot be a descendant of|cannot appear as a (?:child|descendant) of/i;

/**
 * React passes the element names as printf arguments, so joining the arguments
 * would record the template — "<%s> cannot contain a nested %s" — and name
 * neither element. Substituting them is what makes the failure actionable.
 */
function formatted(args: unknown[]): string {
  const [template, ...rest] = args;
  if (typeof template !== "string") return args.map((arg) => String(arg)).join(" ");
  let next = 0;
  const filled = template.replace(/%[sdioOfc]/g, (token) =>
    token === "%c" || next >= rest.length ? "" : String(rest[next++]),
  );
  return [filled, ...rest.slice(next).map((arg) => String(arg))].join(" ");
}

let consoleError: jest.SpyInstance | undefined;

beforeEach(() => {
  nestingViolations.length = 0;
  const original = console.error.bind(console);
  consoleError = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const text = formatted(args);
    if (INVALID_NESTING.test(text)) {
      nestingViolations.push(text.split("\n")[0]!);
    }
    // Still reported: this guard adds a failure, it does not swallow output.
    original(...args);
  });
});

afterEach(() => {
  consoleError?.mockRestore();
  consoleError = undefined;
  if (nestingViolations.length > 0) {
    const seen = [...new Set(nestingViolations)];
    throw new Error(`React reported invalid HTML nesting:\n  ${seen.join("\n  ")}`);
  }
});
