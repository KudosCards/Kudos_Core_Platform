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
