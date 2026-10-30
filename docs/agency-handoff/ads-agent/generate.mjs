#!/usr/bin/env node
/**
 * Generates Linear CSV + ENGINEERING-HANDOFF.docx + ISSUES.docx from linear-issues.json.
 * Run: node generate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageNumber,
  Footer,
  AlignmentType,
  PageBreak,
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "linear-issues.json"), "utf8"));

const PHASE_LABEL = {
  "EPIC-A": "Phase A — Meta",
  "EPIC-B": "Phase B — Google Ads",
  "EPIC-C": "Phase C — Desk + Hermes",
  "EPIC-D": "Phase D — Backlog",
};

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function issueDescription(issue) {
  const ac = (issue.acceptanceCriteria || []).map((c, i) => `${i + 1}. ${c}`).join("\n");
  const links = (issue.specLinks || []).map((l) => `- ${l}`).join("\n");
  const blocked = (issue.blockedBy || []).length
    ? `Blocked by: ${issue.blockedBy.join(", ")}`
    : "Blocked by: —";
  return [
    issue.description.trim(),
    "",
    "## Acceptance criteria",
    ac,
    "",
    "## Spec / code links",
    links || "- —",
    "",
    blocked,
    "",
    `Epic: ${issue.epic}`,
    `Issue ID: ${issue.id}`,
    `Baseline: ${data.meta.baselineShort} (${data.meta.baselineCommit})`,
  ].join("\n");
}

function writeCsv(filename, rows) {
  const header = ["Title", "Description", "Priority", "Status", "Estimate", "Labels"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.Title),
        csvEscape(row.Description),
        csvEscape(row.Priority),
        csvEscape(row.Status),
        csvEscape(row.Estimate ?? ""),
        csvEscape(row.Labels),
      ].join(","),
    );
  }
  fs.writeFileSync(path.join(__dirname, filename), lines.join("\n"), "utf8");
}

const epicRows = data.epics.map((e) => ({
  Title: e.title,
  Description: e.description,
  Priority: e.priority,
  Status: "Backlog",
  Estimate: "",
  Labels: e.labels.join(", "),
}));

const issueRows = data.issues.map((issue) => ({
  Title: `[${issue.id}] ${issue.title}`,
  Description: issueDescription(issue),
  Priority: issue.priority,
  Status: issue.status || "Backlog",
  Estimate: issue.estimate ?? "",
  Labels: issue.labels.join(", "),
}));

writeCsv("linear-epics.csv", epicRows);
writeCsv("linear-issues.csv", issueRows);

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 160 },
    ...opts,
    children: [new TextRun({ text, size: 20, ...opts.run })],
  });
}

function h(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true })],
  });
}

function bullet(text) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [new TextRun({ text: `• ${text}`, size: 18 })],
  });
}

function metaLine(label, value) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 18 }),
      new TextRun({ text: String(value ?? "—"), size: 18 }),
    ],
  });
}

function cell(text, bold = false, width = 2250) {
  return new TableCell({
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    },
    width: { size: width, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(text ?? ""), bold, size: 16 })],
      }),
    ],
  });
}

function footer(label) {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `${label} · `, size: 16, color: "666666" }),
          new TextRun({ text: "Page ", size: 16, color: "666666" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "666666" }),
        ],
      }),
    ],
  });
}

/** Full issue body paragraphs (shared by handoff appendix + ISSUES.docx). */
function issueBody(issue, { headingLevel = HeadingLevel.HEADING_2 } = {}) {
  const out = [];
  out.push(h(`[${issue.id}] ${issue.title}`, headingLevel));
  out.push(metaLine("Epic", `${issue.epic} (${PHASE_LABEL[issue.epic] || issue.epic})`));
  out.push(metaLine("Priority", issue.priority));
  out.push(metaLine("Status", issue.status || "Backlog"));
  out.push(metaLine("Estimate", issue.estimate ?? "—"));
  out.push(metaLine("Labels", (issue.labels || []).join(", ")));
  out.push(
    metaLine(
      "Blocked by",
      (issue.blockedBy || []).length ? issue.blockedBy.join(", ") : "—",
    ),
  );

  out.push(h("Description", HeadingLevel.HEADING_3));
  for (const line of String(issue.description || "").trim().split(/\n/)) {
    if (line.startsWith("## ")) {
      out.push(h(line.replace(/^##\s+/, ""), HeadingLevel.HEADING_4));
    } else if (line.startsWith("- ")) {
      out.push(bullet(line.slice(2)));
    } else if (line.trim() === "") {
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    } else {
      out.push(p(line));
    }
  }

  out.push(h("Acceptance criteria", HeadingLevel.HEADING_3));
  const ac = issue.acceptanceCriteria || [];
  if (!ac.length) {
    out.push(p("—"));
  } else {
    ac.forEach((c, i) => out.push(bullet(`${i + 1}. ${c}`)));
  }

  out.push(h("Spec / code links", HeadingLevel.HEADING_3));
  const links = issue.specLinks || [];
  if (!links.length) {
    out.push(p("—"));
  } else {
    links.forEach((l) => out.push(bullet(l)));
  }

  return out;
}

function issuesIndexTable() {
  const rows = [
    new TableRow({
      children: [
        cell("ID", true, 1200),
        cell("Title", true, 4200),
        cell("Epic", true, 1400),
        cell("Priority", true, 1100),
        cell("Est.", true, 800),
      ],
    }),
    ...data.issues.map(
      (issue) =>
        new TableRow({
          children: [
            cell(issue.id, false, 1200),
            cell(issue.title, false, 4200),
            cell(issue.epic, false, 1400),
            cell(issue.priority, false, 1100),
            cell(issue.estimate ?? "—", false, 800),
          ],
        }),
    ),
  ];
  return new Table({ width: { size: 9000, type: WidthType.DXA }, rows });
}

function issuesByEpicBlocks({ pageBreakBeforeFirst = false } = {}) {
  const blocks = [];
  let first = true;
  for (const epic of data.epics) {
    const issues = data.issues.filter((i) => i.epic === epic.id);
    if (!issues.length) continue;

    if (!first || pageBreakBeforeFirst) {
      blocks.push(
        new Paragraph({
          children: [new PageBreak()],
        }),
      );
    }
    first = false;

    blocks.push(h(PHASE_LABEL[epic.id] || epic.title, HeadingLevel.HEADING_1));
    blocks.push(p(epic.description));
    blocks.push(metaLine("Epic ID", epic.id));
    blocks.push(metaLine("Priority", epic.priority));
    blocks.push(p(`Issues in this phase: ${issues.map((i) => i.id).join(", ")}`));

    for (const issue of issues) {
      blocks.push(...issueBody(issue));
    }
  }
  return blocks;
}

const phaseTable = new Table({
  width: { size: 9000, type: WidthType.DXA },
  rows: [
    new TableRow({ children: [cell("Phase", true, 1500), cell("Focus", true, 7500)] }),
    new TableRow({
      children: [
        cell("A", false, 1500),
        cell("Meta Marketing API sandbox dogfood (create_campaign)", false, 7500),
      ],
    }),
    new TableRow({
      children: [
        cell("B", false, 1500),
        cell("Google Ads test-customer dogfood (OAuth + dual MCP + Approve)", false, 7500),
      ],
    }),
    new TableRow({
      children: [
        cell("C", false, 1500),
        cell("Desk + Hermes Copilot reliability (Reticle, MCP, UX)", false, 7500),
      ],
    }),
    new TableRow({
      children: [
        cell("D", false, 1500),
        cell("Broader backlog (Meta funnel, UI nits, agent ops docs)", false, 7500),
      ],
    }),
  ],
});

const handoffChildren = [
  h("ads-agent — Engineering Handoff", HeadingLevel.TITLE),
  p("External agency continuation pack (ads-agent only)."),
  p(`Generated: ${data.meta.generatedAt}`),
  p(`Repository: ${data.meta.repo}`),
  p(`Baseline commit: ${data.meta.baselineShort} (${data.meta.baselineCommit})`),
  p(`Linear project label: ${data.meta.linearProjectLabel}`),

  h("1. Purpose & out of scope", HeadingLevel.HEADING_1),
  p(
    "This pack equips engineers to continue ads-agent development without prior chat context. Scope is the ads-agent Next.js service and its MCP/Hermes/Bifrost dependencies — not the marketing site, Broker Field iOS, or Sourcegraph ops.",
  ),
  p(
    "Out of scope for this engagement unless separately contracted: production Coolify/Twenty multi-tenant cutovers; unsupervised agent execution; committing production secrets.",
  ),

  h("2. Locked product decisions", HeadingLevel.HEADING_1),
  bullet("Agentic Desk Alternative C: Mission Control = inbox + Ask + Surfaces. / is Desk."),
  bullet("Ask via ⌘J / nav Ask — not a FAB sidecar (rejected)."),
  bullet("Never unsupervised Ads mutations — human Approve gate retained."),
  bullet("Google Ads writes only via write MCP (:8769) after Approve — not advertised to chat."),
  bullet(
    "Hermes Copilot: strip narration server-side via hermes-strip.ts (never import hermes-library into RSC/API).",
  ),

  h("3. Architecture map", HeadingLevel.HEADING_1),
  p(
    "Admin UI: Next.js on :3030 (npm run dev). Auth: Google OAuth via auth-service, or local AUTH_BYPASS=1 (non-production only).",
  ),
  p(
    "Data: consolidated Postgres (docker-compose.listings.yml → :5433). Pool search_path must include adsagent (lib/db/client.ts) or metering/Approve fails.",
  ),
  p(
    "Decision cycle: worker scripts propose changes → Desk inbox → operator Approve/Reject → executor (lib/executor/execute.ts).",
  ),
  p(
    "AI: Bifrost → Vertex for default Copilot/rationale; Hermes API (:8642) when Hermes mode on. OpenUI Renderer for structured replies.",
  ),
  p(
    "MCP: Twenty :8765; Google Ads read :8766 / write :8769; app-data-mcp :8767 (required for Hermes CRM/analytics tools).",
  ),
  p(
    "Meta today: facebook-nodejs-business-sdk in lib/connectors/meta.ts (direct). Hosted Meta MCP (mcp.facebook.com/ads) is documented future, not wired.",
  ),

  h("4. What is already shipped (know this before changing)", HeadingLevel.HEADING_1),
  bullet(
    "daafcef — Agentic Desk UI, Hermes strip/normalize, search_path pin, AUTH_BYPASS, proposal kind normalize.",
  ),
  bullet(
    "9e1af94 lineage — Google Ads gate integrity (read/write MCP split, finalUrl ready gate, dogfood checklist).",
  ),
  bullet("Reticle instrumented under ads-agent/; Hermes Ask→send verified (assistant bubble clean)."),
  bullet("Meta connector create/pause/budget exist but META_* env was empty at handoff — Phase A unblocks."),

  h("5. Access model & secrets", HeadingLevel.HEADING_1),
  p(data.meta.accessModel),
  p(
    "Never commit .env.local. Env names (fill locally): META_*, GOOGLE_ADS_*, TWENTY_*, BIFROST_*, HERMES_API_SERVER_*, DATABASE_URL, AUTH_BYPASS (dev only), MCP_ORG_ID, PLATFORM_ORG_ID. See ads-agent/.env.example.",
  ),

  h("6. Local boot (agency laptop)", HeadingLevel.HEADING_1),
  bullet("From repo root: docker compose -f docker-compose.listings.yml up -d"),
  bullet("cd ads-agent && npm install && cp .env.example .env.local (fill) && npm run migrate"),
  bullet(
    "docker compose up -d bifrost google-ads-mcp google-ads-mcp-write twenty-mcp-gateway app-data-mcp (as needed)",
  ),
  bullet("npm run dev → http://localhost:3030 ; AUTH_BYPASS=1 for local admin"),
  bullet("npm run worker:proposals for Approve undo/execute path"),
  bullet("Hermes: ensure Hermes container :8642 + app-data-mcp :8767; restart Hermes after MCP comes up"),
  bullet("Tests: npm test (Node 22 recommended; Node 20 may fail vitest/rolldown)"),

  h("7. Delivery phases & Linear import", HeadingLevel.HEADING_1),
  phaseTable,
  p(""),
  p(
    "Import order: (1) linear-epics.csv into Linear team/project ads-agent, (2) linear-issues.csv. Columns: Title, Description, Priority, Status, Estimate, Labels. Priority values: Urgent|High|Medium|Low. Labels comma-separated. Full machine-readable mirror: linear-issues.json. Standalone issue catalog: ISSUES.docx.",
  ),
  p(`Issue count: ${data.issues.length} stories + ${data.epics.length} epics.`),

  h("8. Critical risks", HeadingLevel.HEADING_1),
  bullet("Meta create is campaign-shell only — no Ad Set/Ad; sandbox Insights often empty."),
  bullet("Meta dailyBudgetInr × 100 may mismatch sandbox currency — fix before relying on budgets."),
  bullet("Google invalid_grant until refresh token rotated (client-owned)."),
  bullet("Hermes without app-data-mcp → MCP parked → bad replies."),
  bullet("Importing hermes-library into API routes → createContext RSC crash — use hermes-strip.ts."),
  bullet("AUTH_BYPASS must stay false in production."),

  h("9. Definition of Done (agency)", HeadingLevel.HEADING_1),
  bullet("Phase A: Settings Meta green + Desk Approve meta create_campaign → externalId on sandbox."),
  bullet("Phase B: smoke:google-ads-surfaces green + Google dogfood checklist completes on test customer."),
  bullet("Phase C: Reticle Desk Approve flow verified:yes; Hermes send remains clean; search_path tests green."),
  bullet("All PRs reference Linear issue IDs; no secrets in git; README/runbook updated when ops steps change."),

  h("10. Key paths (index)", HeadingLevel.HEADING_1),
  bullet("Desk: components/desk/*, lib/desk/*, app/(admin)/page.tsx"),
  bullet("Copilot/Hermes: components/copilot/*, lib/decision-engine/hermes-chat.ts, lib/openui/hermes-strip.ts"),
  bullet("Executor: lib/executor/execute.ts ; Meta: lib/connectors/meta.ts ; Google MCP: mcp/google-ads-server/"),
  bullet(
    "Specs: docs/superpowers/specs/2026-09-20-ads-agent-agentic-desk-design.md ; 2026-09-18-ads-agent-gate-integrity-dogfood-design.md ; 2026-08-03-ads-automation-agent-design.md",
  ),
  bullet("Product voice: ads-agent/.agents/product-marketing.md"),

  h("11. Artifact checklist", HeadingLevel.HEADING_1),
  bullet("ENGINEERING-HANDOFF.docx — this document (narrative + full issue catalog in §12)"),
  bullet("ISSUES.docx — standalone issues catalog (same stories; easier to share alone)"),
  bullet("linear-epics.csv / linear-issues.csv — Linear CSV import"),
  bullet("linear-issues.json — source of truth + AC arrays"),
  bullet("README.md — import instructions"),

  // —— Appendix: all issues ——
  new Paragraph({ children: [new PageBreak()] }),
  h("12. Full issue catalog", HeadingLevel.HEADING_1),
  p(
    `All ${data.issues.length} Linear-ready stories with acceptance criteria. Same content as ISSUES.docx. Source: linear-issues.json @ baseline ${data.meta.baselineShort}.`,
  ),
  h("Issue index", HeadingLevel.HEADING_2),
  issuesIndexTable(),
  p(""),
  ...issuesByEpicBlocks({ pageBreakBeforeFirst: true }),
];

const handoffDoc = new Document({
  creator: "Gentle Space — ads-agent agency handoff",
  title: "ads-agent Engineering Handoff for External Agency",
  description: `Baseline ${data.meta.baselineShort}`,
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
        },
      },
      footers: { default: footer("ads-agent engineering handoff") },
      children: handoffChildren,
    },
  ],
});

const issuesDoc = new Document({
  creator: "Gentle Space — ads-agent agency handoff",
  title: "ads-agent Linear Issues Catalog",
  description: `${data.issues.length} issues · baseline ${data.meta.baselineShort}`,
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
        },
      },
      footers: { default: footer("ads-agent issues catalog") },
      children: [
        h("ads-agent — Linear Issues Catalog", HeadingLevel.TITLE),
        p("Standalone issue list for agency / Linear import review. ads-agent scope only."),
        p(`Generated: ${data.meta.generatedAt}`),
        p(`Repository: ${data.meta.repo}`),
        p(`Baseline: ${data.meta.baselineShort} (${data.meta.baselineCommit})`),
        p(`Label: ${data.meta.linearProjectLabel}`),
        p(`Counts: ${data.epics.length} epics · ${data.issues.length} issues`),
        p("Companion: ENGINEERING-HANDOFF.docx (architecture + same catalog in §12)."),

        h("Issue index", HeadingLevel.HEADING_1),
        issuesIndexTable(),
        p(""),

        h("Epics", HeadingLevel.HEADING_1),
        ...data.epics.flatMap((e) => [
          h(e.title, HeadingLevel.HEADING_2),
          metaLine("ID", e.id),
          metaLine("Priority", e.priority),
          metaLine("Labels", e.labels.join(", ")),
          p(e.description),
        ]),

        ...issuesByEpicBlocks({ pageBreakBeforeFirst: true }),
      ],
    },
  ],
});

const handoffBuf = await Packer.toBuffer(handoffDoc);
fs.writeFileSync(path.join(__dirname, "ENGINEERING-HANDOFF.docx"), handoffBuf);

const issuesBuf = await Packer.toBuffer(issuesDoc);
fs.writeFileSync(path.join(__dirname, "ISSUES.docx"), issuesBuf);

console.log(
  `Wrote ENGINEERING-HANDOFF.docx, ISSUES.docx, linear-epics.csv (${epicRows.length}), linear-issues.csv (${issueRows.length})`,
);
