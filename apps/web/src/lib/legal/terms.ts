import type { LegalDoc } from "./types";

/**
 * Kudos Cards Terms & Conditions. Verbatim from the approved document
 * (last updated 13 August 2026). Update the wording here when the legal team
 * revises it, and bump `updated`.
 */
export const TERMS: LegalDoc = {
  title: "Terms & Conditions",
  updated: "13 August 2026",
  intro: [
    {
      kind: "p",
      text: 'These Terms and Conditions ("Terms") govern the use of the Kudos Cards website, platform and related services provided by Kudos Cards Ltd ("Kudos Cards", "we", "us" or "our").',
    },
    {
      kind: "p",
      text: "By creating an account, purchasing cards, subscribing to a plan or otherwise using the Kudos Cards platform, you agree to these Terms.",
    },
  ],
  sections: [
    {
      n: 1,
      heading: "About Kudos Cards",
      blocks: [
        {
          kind: "p",
          text: "Kudos Cards provides a platform that enables businesses and organisations to manage contacts, important dates and events and to create, personalise, schedule and send physical greeting cards.",
        },
        { kind: "p", text: "Our services may include:" },
        {
          kind: "ul",
          items: [
            "storing and managing contact information;",
            "importing contacts;",
            "managing birthdays and other events;",
            "creating and personalising cards;",
            "creating cards for multiple recipients;",
            "scheduling or managing card dispatches;",
            "processing card orders;",
            "arranging printing and postage;",
            "providing subscription-based platform features; and",
            "providing related account, support and reporting functionality.",
          ],
        },
      ],
    },
    {
      n: 2,
      heading: "Business Use",
      blocks: [
        {
          kind: "p",
          text: "Kudos Cards is primarily intended for use by businesses, educational organisations, clubs, charities and other organisations.",
        },
        {
          kind: "p",
          text: "If you create an account on behalf of an organisation, you confirm that you have authority to accept these Terms on its behalf.",
        },
        {
          kind: "p",
          text: "You are responsible for ensuring that anyone accessing the platform through your organisation complies with these Terms.",
        },
      ],
    },
    {
      n: 3,
      heading: "Your Account",
      blocks: [
        {
          kind: "p",
          text: "You must provide accurate information when creating and maintaining your account.",
        },
        { kind: "p", text: "You are responsible for:" },
        {
          kind: "ul",
          items: [
            "maintaining the confidentiality of your login details;",
            "activity carried out through your account;",
            "keeping your account information accurate and current; and",
            "notifying us promptly if you believe your account has been accessed without permission.",
          ],
        },
        {
          kind: "p",
          text: "We may suspend access where we reasonably believe an account has been compromised or is being used unlawfully.",
        },
      ],
    },
    {
      n: 4,
      heading: "Contact and Recipient Data",
      blocks: [
        {
          kind: "p",
          text: "The platform allows you to upload and store information about individuals to whom you may wish to send cards.",
        },
        { kind: "p", text: "Depending on the information you provide, this may include:" },
        {
          kind: "ul",
          items: [
            "first and last name;",
            "date of birth;",
            "postal address;",
            "email address;",
            "contact status;",
            "events associated with that person; and",
            "information relating to cards and dispatches.",
          ],
        },
        {
          kind: "p",
          text: "You are responsible for ensuring that you have an appropriate lawful basis and authority to provide this information to Kudos Cards and to instruct us to process it.",
        },
        {
          kind: "p",
          text: "You must provide any privacy information required by law to the individuals whose information you upload.",
        },
        {
          kind: "p",
          text: "When we process recipient data solely for the purpose of providing the Kudos Cards service on your instructions, you will generally act as the data controller and Kudos Cards will act as your data processor.",
        },
        {
          kind: "p",
          text: "Further information is contained in our Privacy Policy and, where applicable, our Data Processing Agreement.",
        },
      ],
    },
    {
      n: 5,
      heading: "Contact Imports",
      blocks: [
        { kind: "p", text: "You may upload multiple contacts using supported import files." },
        {
          kind: "p",
          text: "You are responsible for checking the accuracy and suitability of information before uploading it.",
        },
        {
          kind: "p",
          text: "Where the platform uses identifiers such as email addresses to identify or update existing contacts, you are responsible for ensuring the information supplied is correct.",
        },
        {
          kind: "p",
          text: "Kudos Cards is not responsible for cards being sent incorrectly because of inaccurate, incomplete, duplicated or outdated information supplied by you.",
        },
      ],
    },
    {
      n: 6,
      heading: "Birthdays, Events and Dispatch Dates",
      blocks: [
        {
          kind: "p",
          text: "The platform may automatically create events from information you provide, including birthdays generated from contact dates of birth.",
        },
        {
          kind: "p",
          text: "The platform may also calculate suggested dispatch dates based upon event dates and configured working-day rules.",
        },
        { kind: "p", text: "These tools are provided to assist you with managing card sending." },
        {
          kind: "p",
          text: "Although we aim to operate these features accurately, you remain responsible for reviewing your contacts, events, orders and dispatch information.",
        },
        {
          kind: "p",
          text: "A displayed dispatch date does not guarantee delivery by a particular date.",
        },
      ],
    },
    {
      n: 7,
      heading: "Automated and Scheduled Sending",
      blocks: [
        {
          kind: "p",
          text: "Where an automated or scheduled sending feature is available and you enable it, you authorise Kudos Cards to process the relevant order or dispatch in accordance with the settings and information in your account.",
        },
        { kind: "p", text: "You are responsible for reviewing:" },
        {
          kind: "ul",
          items: [
            "recipient information;",
            "delivery addresses;",
            "event dates;",
            "card selections;",
            "personalised messages;",
            "dispatch settings; and",
            "any other relevant order information.",
          ],
        },
        {
          kind: "p",
          text: "You should update or disable scheduled activity promptly if circumstances change.",
        },
        {
          kind: "p",
          text: "Once an order has entered production or dispatch, it may no longer be possible to amend or cancel it.",
        },
      ],
    },
    {
      n: 8,
      heading: "Card Personalisation",
      blocks: [
        {
          kind: "p",
          text: "You are responsible for all text, images, logos, designs and other content that you upload or submit.",
        },
        {
          kind: "p",
          text: "You confirm that you have the necessary rights and permissions to use that content.",
        },
        { kind: "p", text: "You must not use Kudos Cards to create or distribute material that:" },
        {
          kind: "ul",
          items: [
            "is unlawful;",
            "infringes another person's intellectual property rights;",
            "is defamatory;",
            "is threatening or harassing;",
            "contains unlawful discriminatory material;",
            "is obscene or otherwise illegal; or",
            "is intended to facilitate fraud or other unlawful activity.",
          ],
        },
        {
          kind: "p",
          text: "We may refuse to produce or dispatch content where we reasonably believe it breaches these Terms or applicable law.",
        },
      ],
    },
    {
      n: 9,
      heading: "Printed Colours and Appearance",
      blocks: [
        {
          kind: "p",
          text: "Physical printing can differ from colours displayed on a monitor, phone or other screen.",
        },
        {
          kind: "p",
          text: "Minor differences in colour, positioning, trimming, finish or appearance may occur as part of normal printing and manufacturing tolerances.",
        },
        { kind: "p", text: "Such reasonable variations do not constitute a defect." },
      ],
    },
    {
      n: 10,
      heading: "Orders",
      blocks: [
        { kind: "p", text: "You are responsible for reviewing an order before submitting it." },
        {
          kind: "p",
          text: "An order is not accepted until payment has been successfully authorised and we have accepted the order.",
        },
        {
          kind: "p",
          text: "Once a personalised card has entered production, changes or cancellations may not be possible.",
        },
        {
          kind: "p",
          text: "We reserve the right to reject or cancel an order where there has been an obvious pricing or technical error, payment failure, suspected fraud or another reasonable operational or legal reason.",
        },
        {
          kind: "p",
          text: "If we cancel an order after taking payment and the cancellation is not caused by your breach of these Terms, the appropriate amount will be refunded.",
        },
      ],
    },
    {
      n: 11,
      heading: "Prices and VAT",
      blocks: [
        { kind: "p", text: "Prices will be displayed through the website or platform." },
        {
          kind: "p",
          text: "Prices may be shown inclusive or exclusive of VAT as indicated at the point of purchase.",
        },
        { kind: "p", text: "Applicable VAT will be charged where required by law." },
        {
          kind: "p",
          text: "Postage, delivery or other applicable charges will be displayed before the order is confirmed.",
        },
        {
          kind: "p",
          text: "We may change our prices from time to time. Price changes will not retrospectively affect completed card orders.",
        },
      ],
    },
    {
      n: 12,
      heading: "Postage and Delivery",
      blocks: [
        {
          kind: "p",
          text: "Kudos Cards may use Royal Mail or other postal and delivery providers.",
        },
        {
          kind: "p",
          text: "Delivery estimates are estimates rather than guarantees unless we expressly state otherwise.",
        },
        {
          kind: "p",
          text: "Once an item has been handed to the postal carrier, delivery is dependent upon that carrier's network and circumstances outside our reasonable control.",
        },
        {
          kind: "p",
          text: "Kudos Cards is not responsible for delays caused by postal operators, incorrect addresses supplied by customers, industrial action, severe weather or other circumstances outside our reasonable control.",
        },
        {
          kind: "p",
          text: "Nothing in this clause limits rights which cannot legally be excluded.",
        },
      ],
    },
    {
      n: 13,
      heading: "Subscriptions",
      blocks: [
        { kind: "p", text: "Some features may require a paid subscription." },
        {
          kind: "p",
          text: "Available plans, prices and included features will be displayed before purchase.",
        },
        {
          kind: "p",
          text: "Depending upon the plan selected, subscriptions may include different:",
        },
        {
          kind: "ul",
          items: [
            "contact allowances;",
            "card pricing or discounts;",
            "platform functionality;",
            "export capabilities;",
            "design capabilities;",
            "support levels; and",
            "other features.",
          ],
        },
        {
          kind: "p",
          text: "Subscriptions may automatically renew until cancelled where stated at the point of purchase.",
        },
        {
          kind: "p",
          text: "You can manage your subscription through your account where this functionality is available.",
        },
      ],
    },
    {
      n: 14,
      heading: "Upgrading and Downgrading",
      blocks: [
        { kind: "p", text: "You may be able to upgrade or downgrade your subscription." },
        {
          kind: "p",
          text: "Changing plans may change the functionality and limits available to your account.",
        },
        {
          kind: "p",
          text: "For example, moving to a plan with a lower contact allowance may result in contacts above that allowance becoming unavailable until your allowance increases again.",
        },
        {
          kind: "p",
          text: "Any pricing consequences of changing plan will be shown or communicated when the change is made.",
        },
      ],
    },
    {
      n: 15,
      heading: "Cancellation of Subscriptions",
      blocks: [
        {
          kind: "p",
          text: "You may cancel a recurring subscription through the account functionality provided or by contacting us.",
        },
        {
          kind: "p",
          text: "Unless otherwise stated when you subscribe, cancellation prevents future renewal but does not normally retrospectively refund amounts already paid for a subscription period that has begun.",
        },
        { kind: "p", text: "Any statutory rights applicable to you remain unaffected." },
      ],
    },
    {
      n: 16,
      heading: "Personalised Products and Refunds",
      blocks: [
        {
          kind: "p",
          text: "Many products supplied through Kudos Cards are personalised or produced to your specification.",
        },
        {
          kind: "p",
          text: "Once production has commenced, personalised products ordinarily cannot be changed or cancelled simply because you change your mind.",
        },
        {
          kind: "p",
          text: "If a product is defective, damaged, materially different from the order accepted by us, or we have otherwise failed to provide the service with reasonable care and skill, please contact us promptly so we can investigate.",
        },
        {
          kind: "p",
          text: "Where appropriate, we may offer a replacement, reprint, refund or another suitable remedy.",
        },
        {
          kind: "p",
          text: "Nothing in these Terms removes rights that cannot lawfully be excluded.",
        },
      ],
    },
    {
      n: 17,
      heading: "Payments",
      blocks: [
        { kind: "p", text: "Payments may be processed by third-party payment providers." },
        {
          kind: "p",
          text: "You authorise us and our payment providers to collect amounts properly due under your orders or subscription.",
        },
        {
          kind: "p",
          text: "Kudos Cards does not need to directly store complete payment-card details where these are handled by our payment provider.",
        },
      ],
    },
    {
      n: 18,
      heading: "Platform Availability",
      blocks: [
        {
          kind: "p",
          text: "We aim to provide a reliable service but do not guarantee uninterrupted availability.",
        },
        { kind: "p", text: "We may temporarily suspend or restrict access for:" },
        {
          kind: "ul",
          items: [
            "maintenance;",
            "updates;",
            "security;",
            "technical failures;",
            "infrastructure problems; or",
            "circumstances outside our reasonable control.",
          ],
        },
        { kind: "p", text: "We may change and improve platform functionality from time to time." },
      ],
    },
    {
      n: 19,
      heading: "Customer Responsibilities",
      blocks: [
        { kind: "p", text: "You are responsible for ensuring that:" },
        {
          kind: "ul",
          items: [
            "information supplied to Kudos Cards is accurate;",
            "recipient addresses are correct;",
            "you have authority to process and upload recipient data;",
            "card content is appropriate and lawful;",
            "important dates are correct;",
            "orders are reviewed before submission; and",
            "your use of the service complies with applicable law.",
          ],
        },
      ],
    },
    {
      n: 20,
      heading: "Intellectual Property",
      blocks: [
        {
          kind: "p",
          text: "The Kudos Cards platform, software, branding, website content and associated intellectual property belong to Kudos Cards Ltd or its licensors unless stated otherwise.",
        },
        {
          kind: "p",
          text: "These Terms do not transfer ownership of our intellectual property to you.",
        },
        { kind: "p", text: "You retain ownership of content that you upload to the platform." },
        {
          kind: "p",
          text: "You grant us the limited rights necessary to process, reproduce, print and otherwise use that content for the purpose of providing the service you have requested.",
        },
      ],
    },
    {
      n: 21,
      heading: "Data Protection",
      blocks: [
        { kind: "p", text: "Each party must comply with applicable data protection law." },
        {
          kind: "p",
          text: "Where Kudos Cards processes personal data on your behalf, we will process that information in accordance with your documented instructions and applicable data protection requirements.",
        },
        {
          kind: "p",
          text: "Further information about our use of personal information is contained in our Privacy Policy.",
        },
        { kind: "p", text: "Additional data-processing terms may apply where required." },
      ],
    },
    {
      n: 22,
      heading: "Suspension and Termination",
      blocks: [
        { kind: "p", text: "We may suspend or terminate access where you:" },
        {
          kind: "ul",
          items: [
            "materially breach these Terms;",
            "fail to pay amounts properly due;",
            "use the service unlawfully;",
            "create a security risk;",
            "misuse the platform; or",
            "use the service in a way that could materially harm Kudos Cards, our systems or other users.",
          ],
        },
        {
          kind: "p",
          text: "Where reasonably possible, we will provide an opportunity to resolve the issue before terminating the service.",
        },
      ],
    },
    {
      n: 23,
      heading: "Liability",
      blocks: [
        {
          kind: "p",
          text: "Nothing in these Terms excludes or limits liability where doing so would be unlawful, including liability for fraud or fraudulent misrepresentation or death or personal injury caused by negligence.",
        },
        {
          kind: "p",
          text: "Subject to those exceptions, Kudos Cards will not be liable for indirect or consequential losses or for loss of profits, revenue, anticipated savings, goodwill or business opportunity arising from use of the service.",
        },
        {
          kind: "p",
          text: "We will not be responsible for losses caused by information or instructions supplied incorrectly by the customer or by events outside our reasonable control.",
        },
      ],
    },
    {
      n: 24,
      heading: "Changes to These Terms",
      blocks: [
        {
          kind: "p",
          text: "We may update these Terms where necessary to reflect changes to the platform, our services, the law or our business practices.",
        },
        {
          kind: "p",
          text: "The latest version will be made available through our website or platform.",
        },
        {
          kind: "p",
          text: "Where a change materially affects an ongoing paid subscription, we will take reasonable steps to bring it to your attention.",
        },
      ],
    },
    {
      n: 25,
      heading: "Governing Law",
      blocks: [
        { kind: "p", text: "These Terms are governed by the laws of England and Wales." },
        {
          kind: "p",
          text: "The courts of England and Wales will have jurisdiction, subject to any mandatory legal rights that provide otherwise.",
        },
      ],
    },
    {
      n: 26,
      heading: "Contact Us",
      blocks: [
        { kind: "p", text: "Questions about these Terms can be sent to:" },
        {
          kind: "p",
          text: "Kudos Cards Ltd, United Kingdom. Email: info@kudoscards.co.uk. Company number: 16349929. Registered office: Darlington DL1 1GB.",
        },
      ],
    },
  ],
};
