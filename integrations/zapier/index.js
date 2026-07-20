"use strict";

const authentication = require("./authentication");
const createRecipient = require("./creates/create-recipient");

/** Attach the customer's API key to every outbound request. Keeping this in one
 * middleware means no individual operation has to remember the header. */
const addApiKeyHeader = (request, z, bundle) => {
  if (bundle.authData && bundle.authData.apiKey) {
    request.headers = request.headers || {};
    request.headers["x-api-key"] = bundle.authData.apiKey;
  }
  return request;
};

module.exports = {
  version: require("./package.json").version,
  // Pinned Zapier platform version; `zapier` CLI validates it at push time.
  platformVersion: "15.5.1",

  authentication,
  beforeRequest: [addApiKeyHeader],

  creates: {
    [createRecipient.key]: createRecipient,
  },
};
