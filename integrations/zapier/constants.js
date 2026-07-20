"use strict";

// The production Kudos API. Zapier always talks to production; a customer's
// per-account API key scopes what they can touch.
const API_BASE_URL =
  process.env.KUDOS_API_BASE_URL || "https://kudosapi-production.up.railway.app";

module.exports = { API_BASE_URL };
