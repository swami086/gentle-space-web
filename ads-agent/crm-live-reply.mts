import { readFileSync } from "node:fs";
import { resolve } from "node:path";
for (const line of readFileSync(resolve(".env.local"), "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("="); if (i < 0) continue;
  const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[k] === undefined) process.env[k] = v;
}
import { draftCrmChatReply } from "./lib/decision-engine/crm-chat.ts";

// mock getSession via dynamic — crm-chat imports dal; set env and call
const { getSession } = await import("./lib/auth/dal.ts").catch(() => ({ getSession: async () => null }));

let reply = "";
let deltas = "";
for await (const ev of draftCrmChatReply({ history: [], userMessage: "List all the opportunities in the CRM" })) {
  if (ev.type === "delta") deltas += ev.content;
  if (ev.type === "done") reply = ev.reply;
}
console.log("---REPLY---");
console.log(reply);
console.log("---CHECKS---");
console.log("has_Query_list", /Query\(\s*"list_opportunities"/.test(reply));
console.log("has_OpportunityList", /OpportunityList\(/.test(reply));
console.log("has_OpportunityCard", /OpportunityCard\(/.test(reply));
console.log("looks_fat_card", /OpportunityCard\([^)]{200,}/.test(reply));
console.log("excess_msg", /takes 6 arg|got 18|excess dropped/i.test(reply));
console.log("unscored_only", reply.includes("UNSCORED") && !/OpportunityList|Query/.test(reply));
