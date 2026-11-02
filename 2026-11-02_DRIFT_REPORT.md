# Drift report — 2026-11-02

Compared the working copy of `docs/designs/phase-1-listing-campaign-service.md` with `ads-agent` at `b09fa13`. Matches are omitted. The design file itself is still uncommitted.

## phase-1-listing-campaign-service.md

- The reuse paragraph says Torbit commit `ad63d643` is `git HEAD`, and that the connections store, listing-share migration, inbound router, parser, outbound sender, listing page, reallocate monitor, and rule packs are uncommitted. `HEAD` is `b09fa13`. Those files are in `be0ced0`, web Create is in `a0ca4f8`, and the WhatsApp Create edit is in `b09fa13`.
- The diagram and file item 13 still say WhatsApp and SMS Create is the next slice and that the inbound files should be left alone. WhatsApp Create is in `app/api/inbound/whatsapp/route.ts`, `lib/inbound/parser.ts`, and `lib/inbound/router.ts`.
- An SMS message with the same daily spend limit and goal is Create (`Order` item 2, path step 1). There is no SMS inbound route. Australia has no carrier webhook. The parser accepts the same body, and nothing calls it with market `AU`.
- A reply about a later card is that card, shortened, with a link. `lib/outbound/sender.ts` can render text and is not called from the WhatsApp route. The route does not send a card or a link.
- A phone approval of a later card goes through `scheduleProposal`, with a real `public.users` row, an audit row, and a trace id. A 6-digit code on the consultant line becomes `approve_code` in the HTTP JSON. The route does not call `scheduleProposal`, write an audit row, or attach a trace id.
- A stop runs at once and needs no code. `STOP` on the consultant line becomes `opt_out` in that same JSON. No listing is paused.
- Intake asks for a missing listing fact and does not build until the facts and Create are both present. A consultant-line message that is not `500 <goal>` or `800 office <goal>` is not stored and gets no reply. Market is fixed to `IN`. Sector is residential unless the second word is `office`. Those rules are not in the design.
- `CONSULTANT_WHATSAPP_PHONE_NUMBER_ID` and `LISTING_CREATE_USER_ID` are not in the design. Outside production, an empty user id falls back to the auth-bypass user.
- A consultant-line message that is not Create is not inserted into `inbound_events`. `PAUSE`, `LEASED`, and `RESUME` are logged and not executed.
- Path step 4 says `executeListingCreateCampaign` inserts the listing, the ceiling, and the share. `scheduleListingCreate` inserts the listing first and passes `listingId`. The executor inserts the listing only when `listingId` is absent. A crash between those two transactions leaves a listing with no share.
- Path step 4 says a dead worker, after a switch-on and before the id is stored, pauses campaigns that have no matching `listing_shares.external_campaign_id`. No read does that.
- Accounts says a write runs only when the connection id is `external_account_id`, and when `allowlist` is non-empty the id must also be in it. A miss pages the owner. `executeListingCreateCampaign` does not read `allowlist`.
- `writes_enabled` false blocks every write except a stop. The listing create path does not read `writes_enabled`. The share-move path does.
