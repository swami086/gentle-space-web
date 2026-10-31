# Australian market and competition: lead-to-meeting agent service for real estate agents

> **Context note, 2026-10-30.** This research covers Australian sales and leasing in general. Phase 1 ([concepts_brief.md](concepts_brief.md)) covers leases only, with India first. The seller-paid advertising and Rex benchmark material applies to sales, not to Phase 1.

* **Date:** 2026-10-30
* **Scope:** Australian residential and commercial real estate agents, both independent and employed by agencies.
* **Method:** Firecrawl web searches on 2026-10-30. Vendor claims are quoted from vendor pages and have not been tested.

## Who the customer is

"All real estate agents" covers groups with different buyers of software and different owners of the data:

* **Agents employed by an agency (most residential sales agents).** The agency usually picks and pays for the CRM (Rex, VaultRE, Agentbox, Box+Dice), the portal subscriptions (realestate.com.au, Domain), and often the advertising tools. The individual agent works inside those systems. Selling to this agent means either selling to the principal or working beside the agency CRM without replacing it.
* **Independent agents and small principals.** They pick their own tools. They have the fewest staff, so they are the ones most likely to buy an agent that calls and books for them. There are fewer of them.
* **Property managers, buyer's agents, commercial leasing agents.** Each has a different "meeting": a rental inspection, a buyer's brief, a commercial site tour. The questions that qualify a lead differ for each.

In most Australian home sales the seller pays the marketing cost up front, separate from commission, through Vendor Paid Advertising, whether or not the home sells ([Unreserved](https://www.unreservedrealestate.com.au/articles/real-estate-advertising-costs/)). The listing's ad budget is therefore the seller's money, and the seller expects a report on it.

## Where Australian leads come from

Rex's own lead-generation guide lists the property portals (realestate.com.au and Domain) as the source of buyer enquiry volume, and the agency website and social campaigns as secondary sources ([Rex](https://www.rexsoftware.com/products/real-estate-ai)). A service that only collects Meta and Google lead forms misses most buyer enquiries on a residential listing. The Australian AI qualifiers below take in portal enquiries through the enquiry emails the portals send.

## Competitors by step of the chain

| Step | Product | What it does (vendor's claim) |
| --- | --- | --- |
| Listing photos to social and display ads | [Rex Reach](https://www.rexsoftware.com/products/real-estate-marketing) | Pulls listing data from the Rex CRM, generates "any of 27" ad designs and several variations, runs them on Facebook, Instagram and Google Display, optimises during the campaign, and produces a report for the seller. Used at LJ Hooker and Raine & Horne offices. Price on request. |
| Portal-run social ads | [realestate.com.au Audience Maximiser](https://customer.realestate.com.au/residential/audience-maximiser/) | The portal promotes the listing and agent profile on other sites and on social media using its own buyer data, with boosts before an inspection or auction and after a sale. |
| AI call to every enquiry, qualify, book | [LeadTrack AI](https://leadtrackai.io/real-estate) | Calls a portal, website or Facebook lead-ad enquiry within 60 seconds, asks price range, finance pre-approval, suburbs and timeline, and books the inspection or appraisal into the CRM. States alignment with the Privacy Act, Spam Act and Do Not Call Register Act. |
| AI phone for agencies | [Voxworks](https://www.voxworks.ai/real-estate) | Answers buyer enquiries and books inspections. Says it screens outbound calls against the Do Not Call Register and collects consent first. |
| AI answering service | Ring Jenny ([LinkedIn listing](https://www.linkedin.com/pulse/best-ai-answering-service-real-estate-companies-lunacal-kkrge)) | Australia-specific AI answering for agencies, property managers, buyer's agents and leasing. |
| Inspection booking | [Inspect Real Estate](https://www.inspectrealestate.com.au/) | Agent-branded online booking for inspections. Reports 227,534,759 enquiries processed. |
| CRM with AI prospecting | [Rex AI](https://www.rexsoftware.com/products/real-estate-ai), [Cotality RiTA](https://www.cotality.com/au/products/rita) | Suggests who to call and drafts follow-up messages for the agent to review and send. |

## What is not covered by one product

No single product found in these searches does all of: turn listing photos into Meta and Google campaigns, call and message every lead to qualify it, send the agent one verified-lead message on WhatsApp or SMS, and phone people to arrange the meeting. The chain is covered today by combining two products, for example Rex Reach for ads plus LeadTrack AI for calling and booking. An agency on Rex already has the first half in its CRM.

## What this means for the service

* **A new entrant competes against a two-product bundle, not against nothing.** The case for switching is that one service owns the whole chain and reports the result per listing, from ad spend to booked meeting. That claim fails if the service only accepts its own ad leads and ignores portal enquiries.
* **Agency-employed agents bring a system-of-record problem.** If the agency uses Rex or VaultRE, the verified lead and the booked inspection must land there, or the agent works in two places.
* **Seller reporting is a selling point.** The seller paid for the campaign. Rex Reach already gives "shareable vendor-ready reports". A report that shows ad spend, enquiries, qualified leads and inspections booked is the evidence an agent shows the seller.
* **Compliance is part of the product.** Outbound calls are checked against the Do Not Call Register. Marketing SMS and email need consent, sender identification and an unsubscribe under the Spam Act ([Trillet](https://trillet.ai/blogs/australia-do-not-call-register-and-ai-voice-calls)). The Australian competitors advertise this on their pages.
* **Meta housing targeting limits do not apply** to ads aimed only at Australian audiences ([LeadSync](https://leadsync.me/blog/special-ad-category-meta/)).

## Delivering the service as a ChatGPT or Claude connector

Both assistants load outside tools through the Model Context Protocol (MCP). One remote MCP server can serve both.

* **ChatGPT.** Apps are built with OpenAI's Apps SDK, which runs on MCP. They are submitted from the OpenAI Platform Dashboard, reviewed, and then listed in the in-ChatGPT app directory ([Tallyfy](https://tallyfy.com/how-to-submit-mcp-app-openai-chatgpt/)). Submission checks the MCP server and verifies the domain through `/.well-known/openai-apps-challenge` ([OpenAI](https://developers.openai.com/plugins/deploy/submission)). Tools can return a user interface that runs in an iframe inside ChatGPT through the MCP Apps bridge ([OpenAI](https://developers.openai.com/plugins/build/chatgpt-ui)).
* **Claude.** A remote MCP server can be added as a custom connector. Claude connects to it from Anthropic's cloud, usually after an OAuth sign-in ([Claude Support](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)). Directory submission happens in Claude.ai organisation admin settings and needs a Team or Enterprise organisation. Submissions are scanned for policy and normally enter as community connectors. Tool changes on the live server do not need resubmission ([Sunpeak](https://sunpeak.ai/blogs/claude-connector-directory-submission/)).
* **Authentication both expect.** Streamable HTTP transport; OAuth 2.1 with PKCE S256; protected resource metadata (RFC 9728); dynamic client registration (RFC 7591); a form-urlencoded token endpoint; and a 401 response that tells the client where to sign in ([Medium guide](https://medium.com/@TheTechDude/how-to-submit-to-anthropic-connectors-directory-the-full-guide-da0bfed4d21c)).
* **Shared UI standard.** MCP Apps (SEP-1865) is the extension that lets tools render forms and dashboards inside both Claude and ChatGPT ([MCP blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)). One builder reports using an MCP App as a drop zone for file uploads ([Reddit](https://www.reddit.com/r/mcp/comments/1w1jtu9/file_uploads_with_mcp_what_are_people_doing/)). That is an anecdote, not documented behaviour.

### Real-estate connectors found

* [realestate.com.au live in ChatGPT](https://customer.realestate.com.au/news-insights/realestatecomau-live-in-chatgpt/): buyers search residential listings inside ChatGPT. This is consumer-facing, not a tool for agents.
* [AscendixRE xRE Connector](https://ascendix.com/blog/claude-ai-use-cases-commercial-real-estate/): an MCP connector that lets Claude read and write a commercial real estate CRM. US-focused.
* No Australian agent-facing connector for ads, lead qualification or booking was found in these searches. That is not proof none exists.

### Limits of the connector model

* A connector runs only when the agent is in a chat and the assistant decides to call a tool. It cannot call a lead within a minute at 10 pm or send the agent a WhatsApp. Calling, qualifying, booking and the handoff message still have to run on the service's own servers. The connector is where the agent starts a campaign, approves spend, changes rules and reads results.
* Listing in either directory does not bring customers by itself. Distribution still depends on agents already using ChatGPT or Claude for work.
* Both platforms review submissions. Their policies on tools that spend money or trigger outbound calls were not checked here.
