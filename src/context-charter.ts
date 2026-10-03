import { createHash } from "node:crypto";
import { z } from "zod";

export const CONTEXT_CHARTER_VERSION = "agent.context/v1" as const;

const StabilitySchema = z.enum(["immutable", "mutable"]);
const NodeTypeSchema = z.enum(["agent", "context-pod", "provider", "resolver", "release", "event"]);
const EventTypeSchema = z.enum([
  "context.snapshot.created",
  "context.release.published",
  "context.release.revoked",
  "context.cache.created",
  "context.cache.hit",
  "context.cache.miss",
  "context.cache.invalidated",
  "context.cache.expired",
  "context.cache.revalidated",
  "context.mutable.created",
  "context.mutable.updated",
  "context.mutable.superseded",
  "context.mutable.redacted",
  "context.mutable.expired",
  "context.mutable.compacted",
  "context.conflict.detected",
  "context.resolution.selected",
  "context.resolution.escalated",
  "context.evidence.insufficient",
  "context.scope.changed",
  "context.source.revoked",
]);
const PipelineStepSchema = z.enum([
  "validate_provenance",
  "create_revision_candidate",
  "mark_release_immutable",
  "deny_future_retrieval",
  "deny_source_retrieval",
  "invalidate_related_cache",
  "exclude_from_future_releases",
  "exclude_superseded_revision",
  "revoke_affected_releases",
  "register_mutable_state",
  "update_compacted_state",
  "mark_requires_escalation",
  "mark_evidence_insufficient",
  "block_answer_ready_release",
  "clear_escalation",
  "mark_release_candidate",
  "recheck_scope",
  "observe_cache",
  "revalidate_cache",
]);

export const ContextGraphSchema = z.object({
  apiVersion: z.literal(CONTEXT_CHARTER_VERSION),
  kind: z.literal("AgentContextGraph"),
  metadata: z.object({ name: z.string().min(1) }).strict(),
  nodes: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    type: NodeTypeSchema,
    stability: StabilitySchema,
    capabilities: z.array(z.string()).readonly(),
    provider: z.object({
      protocol: z.literal("mcp"),
      endpoint: z.string().url(),
    }).strict().optional(),
    events: z.object({
      accepts: z.array(EventTypeSchema).readonly().optional(),
      emits: z.array(EventTypeSchema).readonly().optional(),
    }).strict().optional(),
    resolution: z.object({
      temporal: z.enum(["latest_valid", "as_of", "history", "first_known", "all_versions", "changed_since"]).optional(),
      conflict: z.enum(["prefer_authoritative", "return_all", "escalate"]).optional(),
    }).strict().optional(),
  }).strict()).min(1).readonly(),
  edges: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    relation: z.string().min(1),
  }).strict()).readonly(),
  pipelines: z.array(z.object({
    id: z.string().min(1),
    triggers: z.array(EventTypeSchema).min(1).readonly(),
    steps: z.array(PipelineStepSchema).min(1).readonly(),
  }).strict()).readonly().optional(),
}).strict();

export const ContextResolveRequestSchema = z.object({
  query: z.string().min(1),
  pod_ids: z.array(z.string().min(1)).optional(),
  temporal: z.enum(["latest_valid", "as_of", "history", "first_known", "all_versions", "changed_since"]).optional(),
  max_blocks: z.number().int().positive().max(10_000).optional(),
  cache: z.enum(["allow", "bypass"]).optional(),
}).strict();

export const ContextReleaseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["answer_ready", "requires_escalation", "empty"]),
  blocks: z.array(z.object({
    id: z.string().min(1),
    pod_id: z.string().min(1),
    text: z.string(),
    stability: StabilitySchema,
    source_refs: z.array(z.string()).readonly(),
  }).strict()).readonly(),
  citations: z.array(z.string()).readonly(),
  conflicts: z.array(z.string()).readonly(),
  excluded: z.array(z.string()).readonly().optional(),
}).strict();

export const ContextEventSchema = z.object({
  id: z.string().min(1),
  type: EventTypeSchema,
  occurred_at: z.string().datetime({ offset: true }),
  subject: z.object({
    pod: z.string().min(1),
    item: z.string().min(1),
    revision: z.string().min(1).optional(),
    release: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
  }).strict(),
  actor: z.object({ type: z.string().min(1), id: z.string().min(1) }).strict(),
  effect: z.object({
    retrieval: z.enum(["allow", "deny"]).optional(),
    future_releases: z.enum(["include", "exclude"]).optional(),
  }).strict(),
  provenance: z.object({ source: z.string().min(1) }).strict(),
  payload: z.record(z.unknown()).optional(),
}).strict();

export type ContextGraph = z.infer<typeof ContextGraphSchema>;
export type ContextResolveRequest = z.infer<typeof ContextResolveRequestSchema>;
export type ContextEvent = z.infer<typeof ContextEventSchema>;
export type ContextEventType = z.infer<typeof EventTypeSchema>;
export type ContextPipelineStep = z.infer<typeof PipelineStepSchema>;
export type ContextNode = ContextGraph["nodes"][number];
export type ContextRevision = Readonly<{ id: string; pod_id: string; created_at: string; supersedes?: string }>;
export type ContextBlock = Readonly<{
  id: string;
  pod_id: string;
  text: string;
  stability: "immutable" | "mutable";
  source_refs: readonly string[];
}>;
export type ContextRelease = Readonly<{
  id: string;
  status: "answer_ready" | "requires_escalation" | "empty";
  blocks: readonly ContextBlock[];
  citations: readonly string[];
  conflicts: readonly string[];
  excluded?: readonly string[];
}>;
export type ContextPipeline = Readonly<{
  id: string;
  triggers: readonly ContextEventType[];
  steps: readonly ContextPipelineStep[];
}>;
export type ContextEventAppendResult = Readonly<{
  event: ContextEvent;
  pipeline: ContextPipeline;
  blocking: boolean;
  cache_invalidated: boolean;
  idempotent_replay: boolean;
}>;

export class ContextEventRejectedError extends Error {
  readonly name = "ContextEventRejectedError";
  constructor(readonly eventType: ContextEventType, readonly reason: string) {
    super(`Context event rejected (${eventType}): ${reason}`);
  }
}

export interface ContextPodProvider {
  resolve(request: ContextResolveRequest): Promise<ContextRelease>;
  revisions(): Promise<readonly ContextRevision[]>;
  events(): Promise<readonly ContextEvent[]>;
  appendEvent(event: ContextEvent): Promise<ContextEvent>;
}

export interface ContextCharterStore {
  graph(): ContextGraph;
  provider(podId: string): ContextPodProvider;
}

export class UnknownContextPodError extends Error {
  readonly name = "UnknownContextPodError";
  constructor(readonly podId: string) {
    super(`ContextPod is not registered: ${podId}`);
  }
}

export class ContextCharterAdapter {
  private readonly appliedEvents = new Map<string, ContextEventAppendResult>();
  private readonly hydratedPods = new Set<string>();
  private readonly podState = new Map<string, {
    excludedItems: Set<string>;
    excludedSources: Set<string>;
    supersededItems: Set<string>;
    blockingReasons: Set<string>;
    cacheInvalidated: boolean;
    revokedReleases: Set<string>;
  }>();

  public constructor(private readonly store: ContextCharterStore) {}

  public describe(): ContextGraph {
    return ContextGraphSchema.parse(this.store.graph());
  }

  public async resolve(request: ContextResolveRequest): Promise<ContextRelease> {
    const graph = this.describe();
    const podIds = request.pod_ids ?? graph.nodes.filter((node) => node.type === "context-pod").map((node) => node.id);
    await Promise.all(podIds.map((podId) => this.ensureHydrated(podId)));
    const releases = await Promise.all(podIds.map(async (podId) => {
      const node = graph.nodes.find((candidate) => candidate.id === podId && candidate.type === "context-pod");
      if (!node) throw new UnknownContextPodError(podId);
      const state = this.stateFor(podId);
      const release = await this.store.provider(podId).resolve({
        ...request,
        cache: state.cacheInvalidated ? "bypass" : request.cache,
      });
      return ContextReleaseSchema.parse(release);
    }));
    const blocks = releases.flatMap((release) => release.blocks).filter((block) => {
      const state = this.stateFor(block.pod_id);
      const excluded = state.excludedItems.has(block.id) || block.source_refs.some((source) => state.excludedItems.has(source) || state.excludedSources.has(source));
      const historical = request.temporal === "history" || request.temporal === "all_versions";
      return !excluded && (historical || !state.supersededItems.has(block.id));
    });
    const conflicts = releases.flatMap((release) => release.conflicts);
    const limitedBlocks = request.max_blocks === undefined ? blocks : blocks.slice(0, request.max_blocks);
    const payload = JSON.stringify({ query: request.query, blocks: limitedBlocks, conflicts });
    const releaseId = `release:${createHash("sha256").update(payload).digest("hex").slice(0, 24)}`;
    const blocked = podIds.some((podId) => this.stateFor(podId).blockingReasons.size > 0) || conflicts.length > 0 || podIds.some((podId) => this.stateFor(podId).revokedReleases.has(releaseId));
    podIds.forEach((podId) => { this.stateFor(podId).cacheInvalidated = false; });
    return {
      id: releaseId,
      status: blocked ? "requires_escalation" : limitedBlocks.length > 0 ? "answer_ready" : "empty",
      blocks: blocked ? [] : limitedBlocks,
      citations: releases.flatMap((release) => release.citations),
      conflicts: [...conflicts, ...podIds.flatMap((podId) => [...this.stateFor(podId).blockingReasons])],
      excluded: releases.flatMap((release) => release.blocks).filter((block) => !limitedBlocks.some((selected) => selected.id === block.id)).map((block) => block.id),
    };
  }

  public async revisions(podId: string): Promise<readonly ContextRevision[]> {
    return this.providerFor(podId).revisions();
  }

  public async events(podId: string): Promise<readonly ContextEvent[]> {
    return this.providerFor(podId).events();
  }

  public async appendEvent(event: ContextEvent): Promise<ContextEventAppendResult> {
    ContextEventSchema.parse(event);
    await this.ensureHydrated(event.subject.pod);
    const replay = this.appliedEvents.get(event.id);
    if (replay) return { ...replay, idempotent_replay: true };
    this.validateEventTarget(event);
    const accepted = ContextEventSchema.parse(await this.providerFor(event.subject.pod).appendEvent(event));
    const pipeline = this.pipelineFor(event.type);
    const state = this.stateFor(event.subject.pod);
    this.applyPipeline(event, pipeline, state);
    return this.recordAppliedEvent(accepted, pipeline, state);
  }

  private validateEventTarget(event: ContextEvent): void {
    const node = this.describe().nodes.find((candidate) => candidate.id === event.subject.pod && candidate.type === "context-pod");
    if (!node) throw new UnknownContextPodError(event.subject.pod);
    if (node.stability === "immutable" && event.type.startsWith("context.mutable.")) {
      throw new ContextEventRejectedError(event.type, "mutable events require a mutable ContextPod");
    }
    const accepts = node.events?.accepts;
    if (accepts && !accepts.includes(event.type)) {
      throw new ContextEventRejectedError(event.type, "the ContextPod does not accept this event");
    }
    const requiredCapability = REQUIRED_EVENT_CAPABILITIES[event.type];
    if (requiredCapability && !node.capabilities.includes(requiredCapability)) {
      throw new ContextEventRejectedError(event.type, `missing capability: ${requiredCapability}`);
    }
  }

  private pipelineFor(eventType: ContextEventType): ContextPipeline {
    const defaults = DEFAULT_PIPELINES[eventType];
    const declared = this.describe().pipelines?.find((pipeline) => pipeline.triggers.includes(eventType));
    const steps = [...new Set([...(defaults?.steps ?? []), ...(declared?.steps ?? [])])];
    return { id: declared?.id ?? defaults?.id ?? `pipeline:${eventType}`, triggers: declared?.triggers ?? [eventType], steps };
  }

  private applyPipeline(event: ContextEvent, pipeline: ContextPipeline, state: ReturnType<ContextCharterAdapter["stateFor"]>): void {
    for (const step of pipeline.steps) {
      switch (step) {
        case "deny_future_retrieval":
        case "exclude_from_future_releases":
          state.excludedItems.add(event.subject.item);
          break;
        case "deny_source_retrieval":
          state.excludedSources.add(event.subject.source ?? event.subject.item);
          break;
        case "exclude_superseded_revision":
          state.supersededItems.add(event.subject.item);
          break;
        case "invalidate_related_cache":
          state.cacheInvalidated = true;
          break;
        case "mark_requires_escalation":
        case "mark_evidence_insufficient":
        case "block_answer_ready_release":
          state.blockingReasons.add(event.subject.item);
          break;
        case "clear_escalation":
          state.blockingReasons.delete(event.subject.item);
          break;
        case "revoke_affected_releases":
          state.revokedReleases.add(event.subject.release ?? event.subject.item);
          break;
        case "revalidate_cache":
          state.cacheInvalidated = false;
          break;
        default:
          break;
      }
    }
  }

  private stateFor(podId: string) {
    const existing = this.podState.get(podId);
    if (existing) return existing;
    const created = {
      excludedItems: new Set<string>(), excludedSources: new Set<string>(), supersededItems: new Set<string>(),
      blockingReasons: new Set<string>(), cacheInvalidated: false, revokedReleases: new Set<string>(),
    };
    this.podState.set(podId, created);
    return created;
  }

  private async ensureHydrated(podId: string): Promise<void> {
    if (this.hydratedPods.has(podId)) return;
    const events = (await this.providerFor(podId).events())
      .map((event) => ContextEventSchema.parse(event))
      .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
    const state = this.stateFor(podId);
    for (const event of events) {
      if (this.appliedEvents.has(event.id)) continue;
      const pipeline = this.pipelineFor(event.type);
      this.applyPipeline(event, pipeline, state);
      this.recordAppliedEvent(event, pipeline, state);
    }
    this.hydratedPods.add(podId);
  }

  private recordAppliedEvent(event: ContextEvent, pipeline: ContextPipeline, state: ReturnType<ContextCharterAdapter["stateFor"]>): ContextEventAppendResult {
    const result = {
      event,
      pipeline,
      blocking: state.blockingReasons.size > 0,
      cache_invalidated: state.cacheInvalidated,
      idempotent_replay: false,
    };
    this.appliedEvents.set(event.id, result);
    return result;
  }

  private providerFor(podId: string): ContextPodProvider {
    const node = this.describe().nodes.find((candidate) => candidate.id === podId && candidate.type === "context-pod");
    if (!node) throw new UnknownContextPodError(podId);
    return this.store.provider(podId);
  }
}

const DEFAULT_PIPELINES: Record<ContextEventType, ContextPipeline> = {
  "context.snapshot.created": { id: "snapshot", triggers: ["context.snapshot.created"], steps: ["validate_provenance", "create_revision_candidate"] },
  "context.release.published": { id: "release", triggers: ["context.release.published"], steps: ["mark_release_immutable"] },
  "context.release.revoked": { id: "release-revocation", triggers: ["context.release.revoked"], steps: ["revoke_affected_releases"] },
  "context.cache.created": { id: "cache", triggers: ["context.cache.created"], steps: ["observe_cache"] },
  "context.cache.hit": { id: "cache", triggers: ["context.cache.hit"], steps: ["observe_cache"] },
  "context.cache.miss": { id: "cache", triggers: ["context.cache.miss"], steps: ["observe_cache"] },
  "context.cache.invalidated": { id: "cache-invalidation", triggers: ["context.cache.invalidated"], steps: ["invalidate_related_cache"] },
  "context.cache.expired": { id: "cache-expiry", triggers: ["context.cache.expired"], steps: ["invalidate_related_cache"] },
  "context.cache.revalidated": { id: "cache-revalidation", triggers: ["context.cache.revalidated"], steps: ["revalidate_cache"] },
  "context.mutable.created": { id: "mutable-state", triggers: ["context.mutable.created"], steps: ["register_mutable_state", "create_revision_candidate"] },
  "context.mutable.updated": { id: "mutable-update", triggers: ["context.mutable.updated"], steps: ["register_mutable_state", "create_revision_candidate", "invalidate_related_cache"] },
  "context.mutable.superseded": { id: "supersession", triggers: ["context.mutable.superseded"], steps: ["exclude_superseded_revision", "invalidate_related_cache"] },
  "context.mutable.redacted": { id: "redaction-safety", triggers: ["context.mutable.redacted"], steps: ["deny_future_retrieval", "invalidate_related_cache", "exclude_from_future_releases", "revoke_affected_releases"] },
  "context.mutable.expired": { id: "mutable-expiry", triggers: ["context.mutable.expired"], steps: ["deny_future_retrieval", "invalidate_related_cache"] },
  "context.mutable.compacted": { id: "mutable-compaction", triggers: ["context.mutable.compacted"], steps: ["update_compacted_state", "create_revision_candidate"] },
  "context.conflict.detected": { id: "escalation", triggers: ["context.conflict.detected"], steps: ["mark_requires_escalation", "block_answer_ready_release"] },
  "context.resolution.selected": { id: "resolution", triggers: ["context.resolution.selected"], steps: ["clear_escalation", "mark_release_candidate"] },
  "context.resolution.escalated": { id: "escalation", triggers: ["context.resolution.escalated"], steps: ["mark_requires_escalation", "block_answer_ready_release"] },
  "context.evidence.insufficient": { id: "evidence", triggers: ["context.evidence.insufficient"], steps: ["mark_evidence_insufficient", "block_answer_ready_release"] },
  "context.scope.changed": { id: "scope", triggers: ["context.scope.changed"], steps: ["recheck_scope", "deny_future_retrieval", "invalidate_related_cache", "revoke_affected_releases"] },
  "context.source.revoked": { id: "source-revocation", triggers: ["context.source.revoked"], steps: ["deny_source_retrieval", "invalidate_related_cache", "revoke_affected_releases"] },
};

const REQUIRED_EVENT_CAPABILITIES: Partial<Record<ContextEventType, string>> = {
  "context.cache.created": "cache",
  "context.cache.hit": "cache",
  "context.cache.miss": "cache",
  "context.cache.invalidated": "cache",
  "context.cache.expired": "cache",
  "context.cache.revalidated": "cache",
  "context.mutable.redacted": "mutable_redaction",
  "context.conflict.detected": "conflict_detection",
  "context.mutable.superseded": "supersession",
  "context.source.revoked": "scope_filter",
  "context.scope.changed": "scope_filter",
};
