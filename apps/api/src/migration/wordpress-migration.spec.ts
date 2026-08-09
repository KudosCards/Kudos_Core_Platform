import {
  buildAccountPlan,
  buildAllAccountPlans,
  groupContactsByUser,
  indexSubscriptionsByCustomerUser,
  mapContactStatus,
  mapContactToRecipient,
  normalizeEmail,
  parseDateOfBirth,
  parseSubscriptionMeta,
  parseWooTimestamp,
  type RawContactRow,
} from "./wordpress-migration";

/** A synthetic contacts row — never real migration data. */
function row(overrides: Partial<RawContactRow> = {}): RawContactRow {
  return {
    account_name: "Test Centre",
    legacy_contact_id: "100",
    legacy_user_id: "50",
    first_name: "Ada",
    last_name: "Lovelace",
    gender: "female",
    date_of_birth: "2015-06-01",
    contact_status: "active",
    contact_type: "student",
    address_line_1: "1 Byron Street",
    city: "London",
    postcode: "SW1A 1AA",
    email: "",
    ...overrides,
  } as RawContactRow;
}

const FIXED_TODAY = new Date("2026-08-09T00:00:00Z");

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Owner@Example.CO.UK ")).toBe("owner@example.co.uk");
  });
  it("treats the blank@blank.com placeholder and empties as no email", () => {
    expect(normalizeEmail("blank@blank.com")).toBeNull();
    expect(normalizeEmail("BLANK@BLANK.COM")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("mapContactStatus", () => {
  it("maps former to archived and everything else to active", () => {
    expect(mapContactStatus("former")).toBe("archived");
    expect(mapContactStatus("FORMER")).toBe("archived");
    expect(mapContactStatus("active")).toBe("active");
    expect(mapContactStatus("")).toBe("active");
  });
});

describe("parseDateOfBirth", () => {
  it("accepts a valid past date", () => {
    expect(parseDateOfBirth("2015-06-01", FIXED_TODAY)).toEqual({
      value: "2015-06-01",
      warning: null,
    });
  });
  it("returns null (no warning) for an empty value", () => {
    expect(parseDateOfBirth("", FIXED_TODAY)).toEqual({ value: null, warning: null });
  });
  it("drops a malformed date with a warning", () => {
    const result = parseDateOfBirth("01/06/2015", FIXED_TODAY);
    expect(result.value).toBeNull();
    expect(result.warning).toContain("Unparseable");
  });
  it("drops a future date with a warning", () => {
    const result = parseDateOfBirth("2030-02-26", FIXED_TODAY);
    expect(result.value).toBeNull();
    expect(result.warning).toContain("Future");
  });
});

describe("mapContactToRecipient", () => {
  it("maps every field and keys on the legacy contact id", () => {
    const { recipient, warnings } = mapContactToRecipient(
      row({ legacy_contact_id: "307", email: "parent@example.com" }),
      FIXED_TODAY,
    );
    expect(warnings).toEqual([]);
    expect(recipient).toEqual({
      externalId: "307",
      firstName: "Ada",
      lastName: "Lovelace",
      dateOfBirth: "2015-06-01",
      email: "parent@example.com",
      addressLine1: "1 Byron Street",
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
      status: "active",
    });
  });
  it("archives former contacts and drops placeholder emails", () => {
    const { recipient } = mapContactToRecipient(
      row({ contact_status: "former", email: "blank@blank.com" }),
      FIXED_TODAY,
    );
    expect(recipient.status).toBe("archived");
    expect(recipient.email).toBeNull();
  });
  it("keeps the contact but warns when the DOB is unusable", () => {
    const { recipient, warnings } = mapContactToRecipient(
      row({ legacy_contact_id: "9", date_of_birth: "2099-01-01" }),
      FIXED_TODAY,
    );
    expect(recipient.dateOfBirth).toBeNull();
    expect(warnings[0]).toContain("contact 9");
  });
});

describe("parseSubscriptionMeta", () => {
  const tsv = [
    "subscription_id\tmeta_key\tmeta_value",
    "2377\t_billing_email\towner@example.com",
    "2377\t_customer_user\t92",
    "2377\t_stripe_customer_id\tcus_ABC",
    "2377\t_schedule_next_payment\t2026-08-19 22:33:23",
    "2377\t_billing_address_index\tName\tWith\tTabs",
    "",
  ].join("\n");

  it("groups meta by subscription id and preserves tabs in values", () => {
    const bySub = parseSubscriptionMeta(tsv);
    const meta = bySub.get("2377")!;
    expect(meta._billing_email).toBe("owner@example.com");
    expect(meta._customer_user).toBe("92");
    expect(meta._billing_address_index).toBe("Name\tWith\tTabs");
  });

  it("indexes subscriptions by customer_user and rejects collisions", () => {
    const byCustomer = indexSubscriptionsByCustomerUser(parseSubscriptionMeta(tsv));
    expect(byCustomer.get("92")!.subscriptionId).toBe("2377");

    const dup = parseSubscriptionMeta(["1\t_customer_user\t7", "2\t_customer_user\t7"].join("\n"));
    expect(() => indexSubscriptionsByCustomerUser(dup)).toThrow(/customer_user 7/);
  });
});

describe("parseWooTimestamp", () => {
  it("converts a Woo timestamp to ISO (UTC) and handles empties", () => {
    expect(parseWooTimestamp("2026-08-19 22:33:23")).toBe("2026-08-19T22:33:23.000Z");
    expect(parseWooTimestamp("0")).toBeNull();
    expect(parseWooTimestamp("")).toBeNull();
  });
});

describe("buildAccountPlan", () => {
  const meta: Record<string, string> = {
    _billing_email: "Owner@Example.co.uk",
    _billing_first_name: "Chris",
    _billing_last_name: "Baptist",
    _customer_user: "50",
    _stripe_customer_id: "cus_ABC",
    _stripe_source_id: "pm_TEST",
    _schedule_next_payment: "2026-08-19 22:33:23",
  };

  it("joins contacts to a subscription into a complete plan", () => {
    const plan = buildAccountPlan(
      "50",
      [row({ legacy_contact_id: "1" }), row({ legacy_contact_id: "2", contact_status: "former" })],
      { subscriptionId: "2377", meta },
      FIXED_TODAY,
    );
    expect(plan.accountName).toBe("Test Centre");
    expect(plan.owner.email).toBe("owner@example.co.uk");
    expect(plan.stripeCustomerId).toBe("cus_ABC");
    expect(plan.stripePaymentMethodId).toBe("pm_TEST");
    expect(plan.syntheticSubscriptionId).toBe("wc_sub_2377");
    expect(plan.nextPaymentAt).toBe("2026-08-19T22:33:23.000Z");
    expect(plan.recipients).toHaveLength(2);
    expect(plan.recipients[1]!.status).toBe("archived");
  });

  it("throws when the subscription has no billing email", () => {
    expect(() =>
      buildAccountPlan("50", [row()], { subscriptionId: "9", meta: { _customer_user: "50" } }),
    ).toThrow(/no billing email/);
  });

  it("de-duplicates repeated legacy contact ids, keeping the last", () => {
    const plan = buildAccountPlan(
      "50",
      [
        row({ legacy_contact_id: "1", first_name: "Old" }),
        row({ legacy_contact_id: "1", first_name: "New" }),
      ],
      { subscriptionId: "2377", meta },
      FIXED_TODAY,
    );
    expect(plan.recipients).toHaveLength(1);
    expect(plan.recipients[0]!.firstName).toBe("New");
    expect(plan.warnings.some((w) => w.includes("Duplicate legacy_contact_id"))).toBe(true);
  });
});

describe("buildAllAccountPlans", () => {
  it("builds one plan per contacts group", () => {
    const contacts = [row({ legacy_user_id: "50", legacy_contact_id: "1" })];
    const byUser = groupContactsByUser(contacts);
    const subs = indexSubscriptionsByCustomerUser(
      parseSubscriptionMeta(
        ["50-sub\t_customer_user\t50", "50-sub\t_billing_email\to@e.com"].join("\n"),
      ),
    );
    const plans = buildAllAccountPlans(byUser, subs, FIXED_TODAY);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.owner.email).toBe("o@e.com");
  });

  it("throws when a contacts group has no matching subscription", () => {
    const byUser = groupContactsByUser([row({ legacy_user_id: "999" })]);
    expect(() => buildAllAccountPlans(byUser, new Map(), FIXED_TODAY)).toThrow(
      /No subscription found/,
    );
  });
});
