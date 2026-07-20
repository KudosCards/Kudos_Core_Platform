"use strict";

const { API_BASE_URL } = require("./constants");

/**
 * Validates the API key by calling GET /integrations/me. A 200 means the key is
 * good; the returned account name labels the connection in the Zapier UI. A 401
 * surfaces as "your key didn't work" without leaking anything.
 */
const test = (z) => z.request({ url: `${API_BASE_URL}/integrations/me` });

module.exports = {
  type: "custom",
  // One field: the per-account Kudos API key.
  fields: [
    {
      key: "apiKey",
      type: "string",
      required: true,
      label: "Kudos API key",
      helpText:
        "Create one on your Kudos Cards **Integrations** page (API keys → Create key). It starts with `kudos_` and is shown only once.",
    },
  ],
  test,
  // Show the account name (from /integrations/me) as the connection label.
  connectionLabel: "{{json.accountName}}",
};
