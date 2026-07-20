"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const App = require("../index");
const authentication = require("../authentication");

test("registers the Create or Update Recipient action", () => {
  assert.ok(App.creates.create_recipient);
  assert.equal(App.creates.create_recipient.display.label, "Create or Update Recipient");
});

test("beforeRequest injects the x-api-key header from auth data", () => {
  const [addHeader] = App.beforeRequest;
  const req = addHeader({ headers: {} }, {}, { authData: { apiKey: "kudos_abc" } });
  assert.equal(req.headers["x-api-key"], "kudos_abc");
});

test("beforeRequest is a no-op when there is no api key yet", () => {
  const [addHeader] = App.beforeRequest;
  const req = addHeader({ headers: { a: "b" } }, {}, { authData: {} });
  assert.equal(req.headers["x-api-key"], undefined);
});

test("auth test calls GET /integrations/me and labels by account name", async () => {
  const calls = [];
  const z = {
    request: async (req) => {
      calls.push(req);
      return { data: { accountName: "Test Centre" } };
    },
  };
  await authentication.test(z, { authData: { apiKey: "kudos_test" } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/integrations\/me$/);
  assert.equal(authentication.connectionLabel, "{{json.accountName}}");
});

test("declares a pinned platformVersion", () => {
  assert.match(App.platformVersion, /^\d+\.\d+\.\d+$/);
});
