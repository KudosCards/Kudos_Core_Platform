/** Single source of truth — was previously duplicated across create-recipient.dto.ts and csv-row.util.ts. */
export const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
