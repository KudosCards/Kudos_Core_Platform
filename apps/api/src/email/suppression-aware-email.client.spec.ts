import { Logger } from "@nestjs/common";
import type { EmailSuppression } from "@prisma/client";
import type { EmailSuppressionService } from "../email-suppression/email-suppression.service";
import type { EmailClient } from "./email.client";
import { SuppressionAwareEmailClient } from "./suppression-aware-email.client";

const suppression = (overrides: Partial<EmailSuppression> = {}): EmailSuppression => ({
  id: "sup-1",
  email: "gone@example.com",
  reason: "hard_bounce",
  detail: "unknown user",
  subject: null,
  messageId: null,
  occurredAt: new Date("2026-09-18T09:00:00Z"),
  firstSeenAt: new Date("2026-09-18T09:05:00Z"),
  lastSeenAt: new Date("2026-09-18T09:05:00Z"),
  clearedAt: null,
  clearedBy: null,
  createdAt: new Date("2026-09-18T09:05:00Z"),
  updatedAt: new Date("2026-09-18T09:05:00Z"),
  ...overrides,
});

describe("SuppressionAwareEmailClient", () => {
  const send = jest.fn().mockResolvedValue(undefined);
  const find = jest.fn();
  const inner = { sendTransactional: send } as unknown as EmailClient;
  const suppressions = { find } as unknown as EmailSuppressionService;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const client = new SuppressionAwareEmailClient(inner, suppressions);
  const email = { to: "gone@example.com", subject: "Reset your password" };

  beforeEach(() => {
    send.mockClear();
    find.mockReset();
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("says which email will be dropped, why, and since when", async () => {
    find.mockResolvedValue(suppression());

    await client.sendTransactional(email);

    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain("gone@example.com");
    expect(message).toContain("Reset your password");
    expect(message).toContain("hard_bounce");
    expect(message).toContain("unknown user");
    expect(message).toContain("2026-09-18");
  });

  // Brevo drops the message either way, and the attempt is what makes Brevo
  // emit the `blocked` event that keeps our record current.
  it("still sends to a blocked address", async () => {
    find.mockResolvedValue(suppression());

    await client.sendTransactional(email);

    expect(send).toHaveBeenCalledWith(email);
  });

  it("says nothing about an address we can reach", async () => {
    find.mockResolvedValue(null);

    await client.sendTransactional(email);

    expect(warn).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(email);
  });

  // A database hiccup must not cost the platform its email to gain a log line.
  it("sends anyway when the suppression lookup fails, and reports the failure", async () => {
    find.mockRejectedValue(new Error("connection terminated"));

    await expect(client.sendTransactional(email)).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledWith(email);
    expect((error.mock.calls[0] as [string])[0]).toContain("connection terminated");
  });

  it("passes a failure from the real client through untouched", async () => {
    find.mockResolvedValue(null);
    send.mockRejectedValueOnce(new Error("Brevo said no"));

    await expect(client.sendTransactional(email)).rejects.toThrow("Brevo said no");
  });
});
