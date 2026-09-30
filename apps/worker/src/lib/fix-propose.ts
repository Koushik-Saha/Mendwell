import {
  AI_DAILY_GENERATIONS_PER_ORG,
  AI_GENERATIONS_PER_RUN,
  billingState,
  connectorSecretContext,
  ConnectorError,
  createConnectorClient,
  decideBucket,
  decrypt,
  fixCategoryForRule,
  unsafeOrgId,
  wooProtectedUrls,
  type AltFixValue,
  type ConnectorClient,
  type ConnectorStatus,
  type ConnectorTransport,
  type FixCategory,
  type Keyring,
  type LinkFixValue,
  type MetaFixValue,
  type OrgId,
} from "@mendwell/core";
import { createRepositories, type Db, type Repositories } from "@mendwell/db";
import { ALT_PROMPT_VERSION, generateAltText, generateMeta, MAX_ATTEMPTS, META_PROMPT_VERSION, type ModelClient, type Usage } from "@mendwell/generators";
import { connectorTransport, createSafeFetch, type Resolver, type SafeFetch, type TestAllow } from "@mendwell/scanner";
import { logger } from "@trigger.dev/sdk";
import { chromium, type Browser } from "playwright";
import { loadImageForModel } from "./image";
import { readPageContext, type PageContext } from "./page-context";

/**
 * fix.propose (PROJECT_SPEC §3 DECIDE + PROPOSE). For open, fixable issues that have never had a
 * fix: gather context from the live page, generate text (alt, meta) or resolve a link
 * deterministically, validate, bucket by policy, and record a fix as pending approval or
 * auto-approved. Nothing is written to the site here; fix.apply does that.
 *
 * The model only ever supplies text. Which fix, which post, which attachment, which href and
 * which bucket are all decided by this code and packages/core (hard rule 5).
 */

export type FixProposePayload = { orgId: string; siteId: string; scanId: string };

export type ProposeDeps = {
  db: Db;
  keyring: Keyring | null;
  /** Null when no Anthropic key is configured: only deterministic (link) fixes are proposed. */
  ai: { client: ModelClient; visionModel: string; textModel: string } | null;
  userAgent: string;
  net?: { resolver?: Resolver; testAllow?: TestAllow };
  browser?: Browser;
  /** Tests inject a transport that talks to a fake connector. */
  connectorTransport?: ConnectorTransport;
  /** When true, proposals (which spend AI) need a subscription that allows fixes. */
  billingEnabled?: boolean;
  now?: () => Date;
};

export type ProposeOutcome =
  | { status: "skipped"; reason: string }
  | { status: "done"; proposed: number; auto: number; approval: number; noFix: Record<string, number>; aiCalls: number; autoFixIds: string[] };

/** Rules this task acts on. External links are approval-only suggestions, not built yet. */
const PROPOSE_RULES = [
  "image-alt",
  "meta-title-missing",
  "meta-title-duplicate",
  "meta-title-too-long",
  "meta-description-missing",
  "meta-description-duplicate",
  "meta-description-too-long",
  "link-broken-internal",
];

/** A failed attempt (validator gave up, nothing resolvable…) is retried after a week at most. */
const RETRY_AFTER_MS = 7 * 24 * 3_600_000;
const CANDIDATES_PER_RUN = 100;
const DAY_MS = 24 * 3_600_000;

type Candidate = Awaited<ReturnType<Repositories["fixRecords"]["proposalCandidates"]>>[number];

type Proposal = {
  issue: Candidate;
  category: FixCategory;
  value: AltFixValue | MetaFixValue | LinkFixValue;
  needsReview: boolean;
  generatorModel: string | null;
  promptVersion: string | null;
  validation: Record<string, unknown>;
  usage: Usage[];
};

export async function runFixPropose(deps: ProposeDeps, payload: FixProposePayload): Promise<ProposeOutcome> {
  const now = deps.now ?? (() => new Date());
  const orgId: OrgId = unsafeOrgId(payload.orgId);
  const repos = createRepositories(deps.db);

  const site = await repos.sites.get(orgId, payload.siteId);
  if (!site) return { status: "skipped", reason: "site_not_found" };
  if (site.status === "archived") return { status: "skipped", reason: "site_archived" };
  if (site.connection !== "connector" || !site.ownershipVerifiedAt) return { status: "skipped", reason: "not_connected" };
  const billing = billingState(await repos.subscriptions.get(orgId), { billingEnabled: deps.billingEnabled ?? false });
  if (!billing.fixesAllowed) return { status: "skipped", reason: `billing_${billing.mode}` };
  const stored = await repos.sites.getConnectorSecret(orgId, site.id);
  if (!stored?.secretEnc || !deps.keyring) return { status: "skipped", reason: "no_secret" };

  const safeFetch: SafeFetch = createSafeFetch({ ...deps.net, userAgent: deps.userAgent, timeoutMs: 15_000 });
  // Decrypted in memory for this run only (SECURITY.md §2 Worker).
  const connector: ConnectorClient = createConnectorClient({
    siteUrl: site.url,
    secret: decrypt(deps.keyring, stored.secretEnc, connectorSecretContext(site.id)),
    restMode: site.connectorRestMode === "query" ? "query" : "pretty",
    transport: deps.connectorTransport ?? connectorTransport(safeFetch),
  });

  let status: ConnectorStatus;
  try {
    status = await connector.status();
  } catch (error) {
    logger.warn("fix.propose.connector_unavailable", { siteId: site.id, code: error instanceof ConnectorError ? error.code : "error" });
    return { status: "skipped", reason: "connector_unavailable" };
  }

  const candidates = await repos.fixRecords.proposalCandidates(orgId, site.id, {
    retryAfter: new Date(now().getTime() - RETRY_AFTER_MS),
    limit: CANDIDATES_PER_RUN,
    rules: PROPOSE_RULES,
  });
  if (candidates.length === 0) return { status: "done", proposed: 0, auto: 0, approval: 0, noFix: {}, aiCalls: 0, autoFixIds: [] };

  // SECURITY.md T13: per-org daily cap and a per-run cap on model calls.
  const used = await repos.aiUsage.callsSince(orgId, new Date(now().getTime() - DAY_MS));
  let aiBudget = Math.max(0, Math.min(AI_DAILY_GENERATIONS_PER_ORG - used, AI_GENERATIONS_PER_RUN));
  let aiCalls = 0;
  const canGenerate = () => deps.ai !== null && aiBudget >= MAX_ATTEMPTS;
  const spend = (usage: Usage[]) => {
    aiBudget -= usage.length;
    aiCalls += usage.length;
  };

  const noFix: Record<string, number> = {};
  const attempted: string[] = [];
  const unusedUsage: Usage[] = [];
  const skip = (issueIds: string[], reason: string, markTried = true) => {
    noFix[reason] = (noFix[reason] ?? 0) + issueIds.length;
    if (markTried) attempted.push(...issueIds);
  };

  const proposals: Proposal[] = [];
  const liveAttachments = await repos.fixRecords.liveAltAttachmentIds(orgId, site.id);
  // One meta fix per post and field: the same post can be crawled at several URLs (?replytocom=…),
  // and a second fix for a field would only end in a conflict once the first is applied.
  const liveMeta = await repos.fixRecords.liveMetaTargets(orgId, site.id);
  const byPage = new Map<string, Candidate[]>();
  for (const c of candidates) byPage.set(c.pageUrl, [...(byPage.get(c.pageUrl) ?? []), c]);
  const ownsBrowser = !deps.browser;
  const browser = deps.browser ?? (await chromium.launch());

  try {
    for (const [pageUrl, issues] of byPage) {
      const altIssues = issues.filter((i) => i.rule === "image-alt");
      const metaIssues = issues.filter((i) => fixCategoryForRule(i.rule) === "meta");
      const linkIssues = issues.filter((i) => i.rule === "link-broken-internal");

      const selectorOf = (i: Candidate) => (i.target as { selector?: string }).selector ?? "";
      const targetOf = (i: Candidate) => (i.target as { url?: string }).url ?? "";
      const page = await readPageContext(browser, safeFetch, pageUrl, {
        selectors: altIssues.map(selectorOf).filter(Boolean),
        linkTargets: linkIssues.map(targetOf).filter(Boolean),
        userAgent: deps.userAgent,
      });
      if (!page) {
        skip(issues.map((i) => i.id), "page_unavailable", false); // try again next scan
        continue;
      }

      for (const issue of altIssues) {
        const image = page.images[selectorOf(issue)];
        if (!image?.src) {
          skip([issue.id], "image_not_found", false);
          continue;
        }
        if (image.attachmentId === null) {
          skip([issue.id], "not_a_media_library_image");
          continue;
        }
        if (liveAttachments.has(image.attachmentId)) {
          skip([issue.id], "attachment_already_proposed", false); // resolves when that fix is applied
          continue;
        }
        if (!canGenerate()) {
          skip([issue.id], deps.ai ? "ai_budget_reached" : "ai_not_configured", false);
          continue;
        }
        const loaded = await loadImageForModel(safeFetch, browser, image.src);
        if (!loaded) {
          skip([issue.id], "image_unreadable");
          continue;
        }
        const ai = deps.ai as NonNullable<ProposeDeps["ai"]>;
        const result = await generateAltText(
          { image: loaded, pageTitle: page.title, heading: image.heading, caption: image.caption, surroundingText: image.surroundingText, fileName: image.fileName, link: image.link },
          { client: ai.client, model: ai.visionModel },
        );
        spend(result.usage);
        if (!result.ok) {
          unusedUsage.push(...result.usage);
          skip([issue.id], `generation_${result.reason}`);
          continue;
        }
        liveAttachments.add(image.attachmentId);
        proposals.push({
          issue,
          category: "alt_text",
          value: { kind: "alt", attachmentId: image.attachmentId, alt: result.value.alt, decorative: result.value.decorative, imageUrl: image.src },
          needsReview: result.value.decorative, // alt="" is always a human decision (§5.4)
          generatorModel: ai.visionModel,
          promptVersion: ALT_PROMPT_VERSION,
          validation: { ok: true, attempts: result.attempts },
          usage: result.usage,
        });
      }

      if (metaIssues.length) proposals.push(...(await proposeMeta(metaIssues, page)));
      for (const issue of linkIssues) {
        const proposal = await proposeLink(issue, page, targetOf(issue));
        if (proposal) proposals.push(proposal);
      }
    }
  } finally {
    if (ownsBrowser) await browser.close().catch(() => {});
  }

  async function proposeMeta(issues: Candidate[], page: PageContext): Promise<Proposal[]> {
    const ids = issues.map((i) => i.id);
    if (status.seoPlugin === "other") {
      skip(ids, "unsupported_seo_plugin");
      return [];
    }
    if (page.postId === null) {
      skip(ids, "not_a_wordpress_post");
      return [];
    }
    if (!page.mainText || page.mainText.length < 80) {
      skip(ids, "too_little_page_text");
      return [];
    }
    if (!canGenerate()) {
      skip(ids, deps.ai ? "ai_budget_reached" : "ai_not_configured", false);
      return [];
    }
    const postId = page.postId;
    const firstFree = (field: "title" | "description") => {
      const fieldIssues = issues.filter((i) => i.rule.startsWith(`meta-${field}`));
      if (fieldIssues.length === 0) return [];
      if (liveMeta.has(`${postId}:${field}`)) {
        skip(fieldIssues.map((i) => i.id), "meta_already_proposed", false); // resolves when that fix is applied
        return [];
      }
      if (fieldIssues.length > 1) skip(fieldIssues.slice(1).map((i) => i.id), "meta_already_proposed", false); // e.g. missing + too long: one fix
      return fieldIssues.slice(0, 1);
    };
    const titleIssues = firstFree("title");
    const descriptionIssues = firstFree("description");
    if (titleIssues.length === 0 && descriptionIssues.length === 0) return [];
    const ai = deps.ai as NonNullable<ProposeDeps["ai"]>;
    // One call per page writes whatever the page needs; each issue gets its own fix.
    const result = await generateMeta(
      {
        pageText: page.mainText,
        h1: page.h1,
        siteName: page.siteName,
        currentTitle: page.title,
        currentDescription: page.metaDescription,
        needs: { title: titleIssues.length > 0, description: descriptionIssues.length > 0 },
        avoid: {
          titles: issues.some((i) => i.rule === "meta-title-duplicate") && page.title ? [page.title] : [],
          descriptions: issues.some((i) => i.rule === "meta-description-duplicate") && page.metaDescription ? [page.metaDescription] : [],
        },
      },
      { client: ai.client, model: ai.textModel },
    );
    spend(result.usage);
    if (!result.ok) {
      unusedUsage.push(...result.usage);
      skip(ids, `generation_${result.reason}`);
      return [];
    }
    const current = { title: page.title, description: page.metaDescription };
    const out: Proposal[] = [];
    const base = { category: "meta" as const, needsReview: false, generatorModel: ai.textModel, promptVersion: META_PROMPT_VERSION, validation: { ok: true, attempts: result.attempts } };
    let usage: Usage[] = result.usage; // charged to the first fix from this call
    for (const issue of titleIssues) {
      out.push({ ...base, issue, value: { kind: "meta", postId, title: result.value.title, current }, usage });
      usage = [];
    }
    for (const issue of descriptionIssues) {
      out.push({ ...base, issue, value: { kind: "meta", postId, description: result.value.description, current }, usage });
      usage = [];
    }
    if (titleIssues.length) liveMeta.add(`${postId}:title`);
    if (descriptionIssues.length) liveMeta.add(`${postId}:description`);
    return out;
  }

  async function proposeLink(issue: Candidate, page: PageContext, target: string): Promise<Proposal | null> {
    if (page.postId === null) {
      skip([issue.id], "not_a_wordpress_post");
      return null;
    }
    const written = page.hrefs[target] ?? [];
    if (written.length !== 1) {
      skip([issue.id], written.length === 0 ? "link_not_in_page" : "link_written_several_ways");
      return null;
    }
    let path: string;
    try {
      path = new URL(target).pathname;
    } catch {
      skip([issue.id], "bad_target");
      return null;
    }
    let resolved;
    try {
      resolved = await connector.resolvePath(path);
    } catch {
      skip([issue.id], "resolver_failed", false);
      return null;
    }
    const candidates = resolved.candidates.filter((c) => c.url && c.url !== target).slice(0, 10);
    const newHref = resolved.resolved && resolved.resolved !== target ? resolved.resolved : null;
    if (!newHref && candidates.length === 0) {
      skip([issue.id], "no_replacement_found");
      return null;
    }
    return {
      issue,
      category: "internal_link",
      value: { kind: "link", postId: page.postId, oldHref: written[0] as string, newHref, source: newHref ? resolved.source : null, candidates },
      // Several possible targets: a human picks one (§5.3).
      needsReview: newHref === null,
      generatorModel: null,
      promptVersion: null,
      validation: { ok: true, resolver: resolved.source ?? "candidates" },
      usage: [],
    };
  }

  // Bucket and record. Deterministic (packages/core); the model has no say (hard rule 5).
  const states = new Map((await repos.siteCategories.list(orgId, site.id)).map((c) => [c.category, c.state]));
  let autoToday = await repos.fixRecords.autoFixesSince(orgId, site.id, new Date(now().getTime() - DAY_MS));
  const protectedUrls = wooProtectedUrls(status.woocommerce);
  let auto = 0;
  let approval = 0;
  const autoFixIds: string[] = [];

  for (const p of proposals) {
    const decision = decideBucket({
      category: p.category,
      categoryState: states.get(p.category) ?? "approval",
      pageUrl: p.issue.pageUrl,
      protectedPaths: site.protectedPaths,
      protectedUrls,
      autoWritesToday: autoToday,
      dailyCap: site.dailyWriteCap,
      needsReview: p.needsReview,
    });
    const fix = await repos.fixRecords.create(
      orgId,
      {
        siteId: site.id,
        issueId: p.issue.id,
        category: p.category,
        bucketAtCreation: decision.bucket,
        proposedValue: p.value,
        generatorModel: p.generatorModel,
        promptVersion: p.promptVersion,
        validation: { ...p.validation, bucketReason: decision.reason },
        costUsd: p.usage.reduce((sum, u) => sum + u.costUsd, 0),
      },
      "worker",
    );
    await repos.aiUsage.record(orgId, p.usage.map((u) => ({ ...u, siteId: site.id, fixId: fix?.id ?? null })));
    if (!fix) continue; // another run already proposed a fix for this issue
    if (decision.bucket === "auto") {
      await repos.fixRecords.transition(orgId, fix.id, { type: "auto_approve" }, "worker");
      autoToday++;
      auto++;
      autoFixIds.push(fix.id);
    } else {
      await repos.fixRecords.transition(orgId, fix.id, { type: "request_approval" }, "worker");
      approval++;
    }
  }

  await repos.aiUsage.record(orgId, unusedUsage.map((u) => ({ ...u, siteId: site.id, fixId: null })));
  await repos.fixRecords.markAttempted(orgId, attempted, now());
  logger.info("fix.propose.done", { siteId: site.id, scanId: payload.scanId, proposed: auto + approval, auto, approval, aiCalls });
  return { status: "done", proposed: auto + approval, auto, approval, noFix, aiCalls, autoFixIds };
}
