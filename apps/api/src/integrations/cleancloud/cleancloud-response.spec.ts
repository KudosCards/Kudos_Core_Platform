import { BadGatewayException } from "@nestjs/common";
import { extractCustomers } from "./cleancloud-response";

const ALICE = { customerID: "1", customerName: "Alice Archer" };
const BEN = { customerID: 2, customerName: "Ben Baker" };

/**
 * CleanCloud documents that a date-range response "is structured differently"
 * from a single-customer one, and does not print the difference. These are the
 * shapes that sentence could mean — all of them are accepted, and anything else
 * fails loudly rather than importing nothing and calling it a success.
 */
describe("extractCustomers", () => {
  it("reads a bare array", () => {
    expect(extractCustomers([ALICE, BEN])).toEqual([ALICE, BEN]);
  });

  it.each(["Customers", "customers", "customerList", "data", "results"])(
    "reads a list under %s",
    (key) => {
      expect(extractCustomers({ [key]: [ALICE, BEN] })).toEqual([ALICE, BEN]);
    },
  );

  it("reads a named map keyed by customer id", () => {
    expect(extractCustomers({ Customers: { "1": ALICE, "2": BEN } })).toEqual([ALICE, BEN]);
  });

  it("reads a bare map keyed by customer id", () => {
    expect(extractCustomers({ "1": ALICE, "2": BEN })).toEqual([ALICE, BEN]);
  });

  it("reads a single customer returned at the top level", () => {
    expect(extractCustomers(ALICE)).toEqual([ALICE]);
  });

  it("treats an empty object as a window nobody signed up in", () => {
    // A quiet month is an ordinary answer, and must not read as a shape we
    // failed to parse.
    expect(extractCustomers({})).toEqual([]);
    expect(extractCustomers([])).toEqual([]);
  });

  it("drops entries that carry no customer id", () => {
    // The id is the key the whole sync dedupes on; a row without one cannot be
    // re-synced to itself, so it is not a customer as far as we are concerned.
    expect(extractCustomers([ALICE, { customerName: "Nameless" }, BEN])).toEqual([ALICE, BEN]);
  });

  it.each(["Error", "error", "message", "errorMessage"])(
    "surfaces an error reported under %s on a 200",
    (key) => {
      // An API that answers every request 200 and puts the failure in the body
      // would otherwise produce a silent, permanently empty import.
      expect(() => extractCustomers({ [key]: "Invalid API token" })).toThrow(BadGatewayException);
      expect(() => extractCustomers({ [key]: "Invalid API token" })).toThrow(/Invalid API token/);
    },
  );

  it("does not mistake a success message alongside the customers for a failure", () => {
    expect(extractCustomers({ message: "success", Customers: [ALICE] })).toEqual([ALICE]);
  });

  it("names the keys it actually got when it recognises nothing", () => {
    // The point of this message: one live call turns an unknown envelope into a
    // one-line fix instead of a guess.
    expect(() => extractCustomers({ totalCount: 4, payload: "…" })).toThrow(
      /keys: totalCount, payload/,
    );
  });

  it("refuses a body that is not an object at all", () => {
    expect(() => extractCustomers("Invalid token")).toThrow(BadGatewayException);
    expect(() => extractCustomers(null)).toThrow(BadGatewayException);
  });
});
