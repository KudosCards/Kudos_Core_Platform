"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const createRecipient = require("../creates/create-recipient");

/** A fake `z` that records requests and returns a canned response. */
function fakeZ(response) {
  const calls = [];
  return {
    calls,
    z: {
      request: async (req) => {
        calls.push(req);
        return response;
      },
    },
  };
}

test("posts a single, wrapped contact to /integrations/contacts", async () => {
  const { z, calls } = fakeZ({ data: { created: 1, updated: 0, skipped: 0, errors: [] } });
  const bundle = {
    authData: { apiKey: "kudos_test" },
    inputData: {
      externalId: "crm-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
    },
  };

  const result = await createRecipient.operation.perform(z, bundle);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/integrations\/contacts$/);
  assert.deepEqual(calls[0].body.contacts, [
    { externalId: "crm-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  ]);
  assert.equal(result.id, "crm-1");
  assert.equal(result.created, 1);
});

test("omits optional fields that are blank or missing", async () => {
  const { z, calls } = fakeZ({ data: { created: 1, updated: 0, skipped: 0, errors: [] } });
  const bundle = {
    authData: { apiKey: "kudos_test" },
    inputData: { externalId: "crm-2", firstName: "Grace", lastName: "Hopper", email: "" },
  };

  await createRecipient.operation.perform(z, bundle);

  const contact = calls[0].body.contacts[0];
  assert.deepEqual(Object.keys(contact), ["externalId", "firstName", "lastName"]);
});

test("forwards address + DOB when provided", async () => {
  const { z, calls } = fakeZ({ data: { created: 1, updated: 0, skipped: 0, errors: [] } });
  const bundle = {
    authData: { apiKey: "kudos_test" },
    inputData: {
      externalId: "crm-3",
      firstName: "Alan",
      lastName: "Turing",
      dateOfBirth: "1912-06-23",
      addressPostcode: "M1 1AA",
    },
  };

  await createRecipient.operation.perform(z, bundle);

  const contact = calls[0].body.contacts[0];
  assert.equal(contact.dateOfBirth, "1912-06-23");
  assert.equal(contact.addressPostcode, "M1 1AA");
});

test("requires externalId, firstName and lastName as input fields", () => {
  const required = createRecipient.operation.inputFields
    .filter((f) => f.required)
    .map((f) => f.key);
  assert.deepEqual(required.sort(), ["externalId", "firstName", "lastName"]);
});
