"use strict";

const { API_BASE_URL } = require("../constants");

/** The optional contact fields, forwarded only when the Zap provides them so the
 * payload stays lean and the API's lenient handling (e.g. missing DOB) applies. */
const OPTIONAL_FIELDS = [
  "email",
  "dateOfBirth",
  "addressLine1",
  "addressLine2",
  "addressCity",
  "addressPostcode",
  "addressCountry",
];

const perform = async (z, bundle) => {
  const contact = {
    externalId: bundle.inputData.externalId,
    firstName: bundle.inputData.firstName,
    lastName: bundle.inputData.lastName,
  };
  for (const field of OPTIONAL_FIELDS) {
    const value = bundle.inputData[field];
    if (value !== undefined && value !== null && value !== "") {
      contact[field] = value;
    }
  }

  const response = await z.request({
    method: "POST",
    url: `${API_BASE_URL}/integrations/contacts`,
    body: { contacts: [contact] },
  });

  const result = (response && response.data) || {};
  // Zapier needs an object with a stable `id` to represent the created record;
  // the externalId is that anchor. We also surface the ingest summary.
  return {
    id: contact.externalId,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors,
  };
};

module.exports = {
  key: "create_recipient",
  noun: "Recipient",
  display: {
    label: "Create or Update Recipient",
    description:
      "Adds a recipient to Kudos Cards, or updates the existing one with the same External ID. One-way import — Kudos never writes back to your app.",
  },
  operation: {
    perform,
    inputFields: [
      {
        key: "externalId",
        label: "External ID",
        type: "string",
        required: true,
        helpText:
          "A stable, unique id from your source (e.g. the contact's id in your CRM). Re-sending the same id updates the recipient instead of creating a duplicate.",
      },
      { key: "firstName", label: "First name", type: "string", required: true },
      { key: "lastName", label: "Last name", type: "string", required: true },
      { key: "email", label: "Email", type: "string", required: false },
      {
        key: "dateOfBirth",
        label: "Date of birth",
        type: "string",
        required: false,
        helpText:
          "YYYY-MM-DD. Optional — a recipient with no birthday is flagged as needing one, not rejected.",
      },
      { key: "addressLine1", label: "Address line 1", type: "string", required: false },
      { key: "addressLine2", label: "Address line 2", type: "string", required: false },
      { key: "addressCity", label: "City", type: "string", required: false },
      { key: "addressPostcode", label: "Postcode", type: "string", required: false },
      { key: "addressCountry", label: "Country", type: "string", required: false },
    ],
    sample: {
      id: "crm-123",
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    },
    outputFields: [
      { key: "id", label: "External ID" },
      { key: "created", label: "Created", type: "integer" },
      { key: "updated", label: "Updated", type: "integer" },
      { key: "skipped", label: "Skipped", type: "integer" },
    ],
  },
};
