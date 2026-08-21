import type { LegalDoc } from "./types";

/**
 * Kudos Cards Privacy Policy. Verbatim from the approved document
 * (last updated 13 August 2026), with the "Who We Are" placeholders filled in
 * from the company details given in the document's Contact Us section
 * (registered office, company number and contact email). Update the wording
 * here when the legal team revises it, and bump `updated`.
 */
export const PRIVACY: LegalDoc = {
  title: "Privacy Policy",
  updated: "13 August 2026",
  intro: [
    {
      kind: "p",
      text: 'Kudos Cards Ltd ("Kudos Cards", "we", "us" or "our") respects your privacy and is committed to protecting personal information.',
    },
    {
      kind: "p",
      text: "This Privacy Policy explains how personal information is collected, used, stored and shared when you visit our website, create an account or use the Kudos Cards platform.",
    },
    {
      kind: "p",
      text: "It also explains how we handle information that our business customers upload about their own contacts and recipients.",
    },
  ],
  sections: [
    {
      n: 1,
      heading: "Who We Are",
      blocks: [
        {
          kind: "p",
          text: "Kudos Cards Ltd provides a platform that enables businesses and organisations to manage contacts and events and create, personalise, schedule and send physical greeting cards.",
        },
        {
          kind: "p",
          text: "Kudos Cards Ltd, United Kingdom. Registered office: Darlington DL1 1GB. Company number: 16349929. Privacy email: info@kudoscards.co.uk.",
        },
      ],
    },
    {
      n: 2,
      heading: "Our Data Protection Roles",
      blocks: [
        {
          kind: "p",
          text: "Our role under data protection law depends upon why particular personal information is being processed.",
        },
        { kind: "h3", text: "When Kudos Cards is the controller" },
        {
          kind: "p",
          text: "Kudos Cards will generally act as the data controller for information relating directly to our customers and users where we decide why and how that information is processed.",
        },
        { kind: "p", text: "This includes information used for purposes such as:" },
        {
          kind: "ul",
          items: [
            "creating and administering accounts;",
            "managing subscriptions;",
            "taking payments;",
            "providing customer support;",
            "maintaining security;",
            "complying with our legal obligations; and",
            "communicating with our customers about the Kudos Cards service.",
          ],
        },
        { kind: "h3", text: "When Kudos Cards is the processor" },
        { kind: "p", text: "Our customers may upload personal information about other people, such as their:" },
        {
          kind: "ul",
          items: [
            "customers;",
            "students;",
            "parents;",
            "employees;",
            "members;",
            "supporters; or",
            "other contacts.",
          ],
        },
        {
          kind: "p",
          text: "The customer decides which individuals to add to Kudos Cards and why cards are being sent to them.",
        },
        {
          kind: "p",
          text: "In these circumstances, the customer will generally be the data controller and Kudos Cards will act as a data processor, processing the information on the customer's instructions to provide the Kudos Cards service.",
        },
        {
          kind: "p",
          text: "Questions from a recipient about why an organisation has uploaded their information should therefore normally be directed to that organisation.",
        },
      ],
    },
    {
      n: 3,
      heading: "Information We May Process",
      blocks: [
        { kind: "h3", text: "Account information" },
        {
          kind: "p",
          text: "When you create or operate a Kudos Cards account, we may process information including:",
        },
        {
          kind: "ul",
          items: [
            "first name;",
            "last name;",
            "email address;",
            "telephone number;",
            "organisation details;",
            "billing information;",
            "shipping information;",
            "account credentials; and",
            "subscription information.",
          ],
        },
        { kind: "h3", text: "Recipient and contact information" },
        { kind: "p", text: "Customers can add information about contacts individually or through bulk imports." },
        { kind: "p", text: "Depending upon the information supplied by the customer, this may include:" },
        {
          kind: "ul",
          items: [
            "first name;",
            "last name;",
            "date of birth;",
            "postal address;",
            "city;",
            "postcode;",
            "email address;",
            "contact status;",
            "associated events;",
            "card order information;",
            "dispatch dates; and",
            "previous card activity.",
          ],
        },
        { kind: "h3", text: "Order information" },
        { kind: "p", text: "We may process:" },
        {
          kind: "ul",
          items: [
            "cards ordered;",
            "card designs;",
            "personalised messages;",
            "recipient information;",
            "quantities;",
            "delivery information;",
            "order status;",
            "dispatch information; and",
            "transaction information.",
          ],
        },
        { kind: "h3", text: "Support information" },
        {
          kind: "p",
          text: "If you contact us for support, we may process your name, contact details and the contents of your request together with information needed to investigate the issue.",
        },
        { kind: "h3", text: "Technical information" },
        {
          kind: "p",
          text: "When you use our website or platform, we may collect technical information such as:",
        },
        {
          kind: "ul",
          items: [
            "IP address;",
            "browser type;",
            "device information;",
            "login and activity information;",
            "security information; and",
            "cookies or similar technologies.",
          ],
        },
        {
          kind: "p",
          text: "Further information about cookies may be provided through our Cookie Policy or cookie controls.",
        },
      ],
    },
    {
      n: 4,
      heading: "How We Receive Information",
      blocks: [
        { kind: "p", text: "We may receive information:" },
        {
          kind: "ul",
          items: [
            "directly from you;",
            "from the organisation that created your account;",
            "from customers using the Kudos Cards platform;",
            "through contact imports;",
            "when orders are created;",
            "when you contact support;",
            "automatically when you use our website or platform; and",
            "from service providers involved in providing our services.",
          ],
        },
      ],
    },
    {
      n: 5,
      heading: "How We Use Personal Information",
      blocks: [
        { kind: "p", text: "Where we act as controller, we may use personal information to:" },
        {
          kind: "ul",
          items: [
            "create and administer accounts;",
            "authenticate users;",
            "provide the Kudos Cards service;",
            "manage subscriptions;",
            "process payments;",
            "fulfil orders;",
            "communicate about accounts and orders;",
            "provide customer support;",
            "protect the security of the platform;",
            "detect misuse or fraud;",
            "improve and maintain our services;",
            "maintain appropriate business and financial records; and",
            "comply with legal and regulatory requirements.",
          ],
        },
      ],
    },
    {
      n: 6,
      heading: "Processing Recipient Information",
      blocks: [
        {
          kind: "p",
          text: "A central part of Kudos Cards is allowing organisations to manage important dates and send personalised physical cards.",
        },
        { kind: "p", text: "When a customer uploads recipient information, we may process it to:" },
        {
          kind: "ul",
          items: [
            "store and manage contacts;",
            "create birthday events from dates of birth;",
            "create other customer-defined events;",
            "calculate or manage dispatch dates;",
            "personalise cards;",
            "generate multiple personalised cards;",
            "address cards;",
            "create orders;",
            "arrange printing;",
            "arrange postage and delivery;",
            "maintain dispatch and order records; and",
            "provide the customer with relevant platform functionality.",
          ],
        },
        {
          kind: "p",
          text: "We process this information to provide services to the customer and in accordance with the customer's instructions.",
        },
        { kind: "p", text: "Kudos Cards does not obtain ownership of a customer's contact database." },
      ],
    },
    {
      n: 7,
      heading: "Lawful Bases",
      blocks: [
        {
          kind: "p",
          text: "Where Kudos Cards acts as controller, the lawful basis we rely upon will depend upon the processing concerned.",
        },
        { kind: "p", text: "These may include:" },
        { kind: "h3", text: "Contract" },
        {
          kind: "p",
          text: "Processing necessary to provide services requested by our customers, administer accounts, subscriptions and orders.",
        },
        { kind: "h3", text: "Legitimate interests" },
        {
          kind: "p",
          text: "We may process information where necessary for legitimate business interests, including:",
        },
        {
          kind: "ul",
          items: [
            "maintaining and improving the service;",
            "securing our systems;",
            "preventing fraud and misuse;",
            "managing customer relationships; and",
            "operating our business effectively,",
          ],
        },
        {
          kind: "p",
          text: "provided those interests are not overridden by the rights and interests of affected individuals.",
        },
        { kind: "h3", text: "Legal obligation" },
        {
          kind: "p",
          text: "We may process information where necessary to comply with legal obligations, including accounting, taxation and regulatory requirements.",
        },
        { kind: "h3", text: "Consent" },
        {
          kind: "p",
          text: "Where consent is required, we will request it appropriately and you may withdraw that consent.",
        },
        {
          kind: "p",
          text: "Where we act purely as a processor for customer-uploaded recipient information, the customer is responsible for determining the appropriate lawful basis for that processing.",
        },
      ],
    },
    {
      n: 8,
      heading: "Dates of Birth",
      blocks: [
        {
          kind: "p",
          text: "The Kudos Cards platform allows customers to record dates of birth so that birthday events and associated card activity can be managed.",
        },
        {
          kind: "p",
          text: "A customer's decision to collect and upload an individual's date of birth is made by that customer.",
        },
        {
          kind: "p",
          text: "Customers should only upload information that is necessary and lawful for their intended use of Kudos Cards.",
        },
      ],
    },
    {
      n: 9,
      heading: "Children's Information",
      blocks: [
        {
          kind: "p",
          text: "Kudos Cards is a business service and is not intended to be used directly by children.",
        },
        {
          kind: "p",
          text: "However, organisations using Kudos Cards may upload information relating to children or young people, for example where an educational organisation sends birthday or achievement cards to its students.",
        },
        {
          kind: "p",
          text: "Where a customer uploads this information, the customer is responsible for ensuring that it has an appropriate lawful basis and has met its transparency and other data-protection obligations.",
        },
        {
          kind: "p",
          text: "Kudos Cards processes such information on the customer's instructions for the purpose of providing the requested service.",
        },
        { kind: "p", text: "Customers should avoid uploading unnecessary information about children." },
      ],
    },
    {
      n: 10,
      heading: "Sharing Personal Information",
      blocks: [
        {
          kind: "p",
          text: "We may share information with trusted service providers where necessary to operate Kudos Cards.",
        },
        {
          kind: "p",
          text: "Depending upon the service being provided, these may include providers of:",
        },
        {
          kind: "ul",
          items: [
            "cloud hosting and database infrastructure;",
            "authentication and platform infrastructure;",
            "payment processing;",
            "printing and fulfilment;",
            "postal and delivery services;",
            "email and communications;",
            "customer support;",
            "analytics and monitoring; and",
            "professional services.",
          ],
        },
        { kind: "p", text: "We only provide information reasonably necessary for the relevant service." },
        {
          kind: "p",
          text: "We may also disclose information where required by law, regulation, court order or another lawful authority.",
        },
      ],
    },
    {
      n: 11,
      heading: "Printing and Postal Fulfilment",
      blocks: [
        {
          kind: "p",
          text: "Recipient names, addresses, card content and other necessary order information may be provided to printing, fulfilment or postal providers where required to produce and deliver cards.",
        },
        { kind: "p", text: "Only information required to fulfil the relevant order should be provided." },
      ],
    },
    {
      n: 12,
      heading: "Payment Information",
      blocks: [
        { kind: "p", text: "Payments may be handled by third-party payment providers." },
        {
          kind: "p",
          text: "Payment providers may process payment-card and transaction information under their own privacy arrangements.",
        },
        {
          kind: "p",
          text: "Kudos Cards does not need to store complete card details where payment information is handled directly by the payment provider.",
        },
      ],
    },
    {
      n: 13,
      heading: "Sub-Processors",
      blocks: [
        {
          kind: "p",
          text: "Where Kudos Cards acts as a processor, we may use third-party providers to help deliver the service.",
        },
        { kind: "p", text: "These providers may act as sub-processors." },
        {
          kind: "p",
          text: "We will take appropriate steps to ensure that sub-processors handling personal information are subject to appropriate contractual and data-protection requirements.",
        },
        {
          kind: "p",
          text: "Where required, further information about our sub-processors can be made available to business customers.",
        },
      ],
    },
    {
      n: 14,
      heading: "International Transfers",
      blocks: [
        {
          kind: "p",
          text: "Some technology providers may process or store information outside the United Kingdom.",
        },
        {
          kind: "p",
          text: "Where personal information is transferred internationally, we will take appropriate measures required by applicable data-protection law to protect that information.",
        },
        {
          kind: "p",
          text: "These may include recognised adequacy arrangements or appropriate contractual safeguards.",
        },
      ],
    },
    {
      n: 15,
      heading: "How Long We Keep Information",
      blocks: [
        {
          kind: "p",
          text: "We retain personal information only for as long as reasonably necessary for the purpose for which it was collected and to satisfy applicable legal, accounting, contractual and regulatory requirements.",
        },
        {
          kind: "p",
          text: "Retention periods vary according to the type of information and why it is being processed.",
        },
        {
          kind: "p",
          text: "Customer-uploaded contact information will generally be retained while required to provide the customer's service and dealt with in accordance with our contractual obligations when the service ends.",
        },
        {
          kind: "p",
          text: "Certain records, including transaction and accounting records, may need to be retained for longer periods where required by law.",
        },
        {
          kind: "p",
          text: "Temporary files generated by some platform functions may be automatically deleted after a defined period.",
        },
      ],
    },
    {
      n: 16,
      heading: "Security",
      blocks: [
        {
          kind: "p",
          text: "We take appropriate technical and organisational measures designed to protect personal information against:",
        },
        {
          kind: "ul",
          items: [
            "unauthorised access;",
            "accidental loss;",
            "destruction;",
            "alteration;",
            "disclosure; and",
            "misuse.",
          ],
        },
        {
          kind: "p",
          text: "Measures may include appropriate access controls, authentication, encryption, monitoring, backups and restrictions on access to personal information.",
        },
        {
          kind: "p",
          text: "No internet-based system can guarantee absolute security, but we continually seek to maintain security appropriate to the nature of the information being processed.",
        },
      ],
    },
    {
      n: 17,
      heading: "Personal Data Breaches",
      blocks: [
        { kind: "p", text: "We maintain procedures for responding to suspected personal-data breaches." },
        {
          kind: "p",
          text: "Where Kudos Cards acts as a processor and becomes aware of a personal-data breach affecting customer-controlled information, we will notify the relevant customer without undue delay in accordance with our legal and contractual obligations.",
        },
      ],
    },
    {
      n: 18,
      heading: "Your Data Protection Rights",
      blocks: [
        { kind: "p", text: "Depending upon the circumstances, individuals may have rights including:" },
        {
          kind: "ul",
          items: [
            "access to their personal information;",
            "correction of inaccurate information;",
            "deletion of information;",
            "restriction of processing;",
            "objection to certain processing; and",
            "data portability.",
          ],
        },
        { kind: "p", text: "These rights are subject to applicable legal conditions and exemptions." },
        { kind: "h3", text: "If you are a Kudos Cards customer or user" },
        { kind: "p", text: "You can contact us using the details below." },
        { kind: "h3", text: "If your information was uploaded by one of our customers" },
        {
          kind: "p",
          text: "The organisation that uploaded your information will generally be the controller.",
        },
        {
          kind: "p",
          text: "You should normally contact that organisation first regarding your data-protection rights.",
        },
        {
          kind: "p",
          text: "We will provide reasonable assistance to our customer where necessary for it to respond to your request.",
        },
      ],
    },
    {
      n: 19,
      heading: "Deleting or Updating Contact Information",
      blocks: [
        {
          kind: "p",
          text: "Customers can manage information held within their Kudos Cards accounts, including updating or deleting contacts where platform functionality permits.",
        },
        {
          kind: "p",
          text: "Deleting a contact may also remove or affect associated birthday and event information.",
        },
        {
          kind: "p",
          text: "Some information may remain in backups or records for a limited period where technically or legally necessary.",
        },
      ],
    },
    {
      n: 20,
      heading: "Marketing Communications",
      blocks: [
        {
          kind: "p",
          text: "Where permitted by law, we may contact our customers and prospective customers about Kudos Cards services.",
        },
        {
          kind: "p",
          text: "You can unsubscribe from marketing communications using the unsubscribe mechanism provided or by contacting us.",
        },
        {
          kind: "p",
          text: "Service messages concerning your account, orders, security or subscription are not marketing communications and may still be sent where necessary.",
        },
      ],
    },
    {
      n: 21,
      heading: "Cookies",
      blocks: [
        {
          kind: "p",
          text: "Our website and platform may use cookies and similar technologies for purposes such as:",
        },
        {
          kind: "ul",
          items: [
            "maintaining sessions;",
            "authentication;",
            "security;",
            "remembering preferences;",
            "measuring platform performance; and",
            "understanding website usage.",
          ],
        },
        {
          kind: "p",
          text: "The first five of those are strictly necessary: without them you could not log in or stay logged in, and we do not ask for consent to set them.",
        },
        {
          kind: "p",
          text: "To understand website usage we use Google Analytics, which is not strictly necessary. It is switched off until you agree. On your first visit we ask, and nothing is stored for analytics unless you choose Accept — choosing Reject is one click, exactly as Accept is. Your choice is remembered in your browser, and you can change it by clearing your browser storage for this site, which makes us ask again.",
        },
        {
          kind: "p",
          text: "Google Analytics sets cookies in your browser and processes usage data on our behalf, including a truncated record of your IP address. It tells us things like which pages are visited and which cards are viewed. It does not tell us who you are, and we do not use it to advertise to you.",
        },
      ],
    },
    {
      n: 22,
      heading: "Third-Party Websites",
      blocks: [
        { kind: "p", text: "Our website or platform may contain links to third-party websites." },
        {
          kind: "p",
          text: "We are not responsible for the privacy practices of websites operated independently from Kudos Cards.",
        },
        {
          kind: "p",
          text: "You should review the privacy information provided by those organisations.",
        },
      ],
    },
    {
      n: 23,
      heading: "Changes to This Privacy Policy",
      blocks: [
        {
          kind: "p",
          text: "We may update this Privacy Policy to reflect changes in our services, technology, business practices or legal requirements.",
        },
        { kind: "p", text: "The latest version will be published on our website or platform." },
        { kind: "p", text: "Where appropriate, we may notify users of significant changes." },
      ],
    },
    {
      n: 24,
      heading: "Contact Us",
      blocks: [
        {
          kind: "p",
          text: "Questions about privacy or the way we handle personal information can be sent to:",
        },
        {
          kind: "p",
          text: "Kudos Cards Ltd. Email: info@kudoscards.co.uk. Registered office: Darlington DL1 1GB. Company number: 16349929.",
        },
      ],
    },
    {
      n: 25,
      heading: "Complaints",
      blocks: [
        {
          kind: "p",
          text: "If you have concerns about how Kudos Cards has handled personal information, please contact us first so that we can investigate.",
        },
        {
          kind: "p",
          text: "You also have the right to complain to the Information Commissioner's Office (ICO), the UK's data-protection regulator.",
        },
        { kind: "p", text: "Further information is available from the ICO at ico.org.uk." },
      ],
    },
  ],
};
