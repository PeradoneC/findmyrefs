// Shared domain types. Backend DTOs mirror src-tauri/src/models.rs (camelCase).

export type Priority = "high" | "medium" | "low";

export type ReferenceCategory = {
  id: string;
  name: string;
  purpose: string;
  searchQueries: string[];
  priority: Priority;
  /** Categories can be switched off before searching. Defaults to true. */
  enabled?: boolean;
};

/** Who produced the structured brief. */
export type BriefSource = "mock" | "basic-parser" | "anthropic" | "manual";

export type ArtBrief = {
  originalPrompt: string;
  subject: string[];
  environment: string[];
  palette: string[];
  lighting: string[];
  mood: string[];
  composition: string[];
  cameraAngle: string[];
  style: string[];
  materialsOrTextures: string[];
  exclusions: string[];
  referenceCategories: ReferenceCategory[];
  generatedBy?: BriefSource;
};

/** Brief fields the user can fill in by hand on the Discover screen. */
export type BriefFieldKey =
  | "subject"
  | "environment"
  | "palette"
  | "mood"
  | "lighting"
  | "composition"
  | "cameraAngle"
  | "style"
  | "materialsOrTextures"
  | "exclusions";

export type ReferenceAnalysis = {
  summary: string;
  detectedCategories: string[];
  palette?: string[];
  lighting?: string;
  composition?: string;
  mood?: string[];
  relevanceExplanation: string;
};

// ------------------------------------------------------------------ search

export type ImageSearchQuery = {
  query: string;
  page?: number;
  safeSearch?: boolean;
};

export type ImageSearchResult = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  provider: string;
  creatorName?: string;
  width?: number;
  height?: number;
  publishedAt?: string;
  licenseLabel?: string;
  /** True for mock/demo results. Never true for live providers. */
  isDemo: boolean;
  /** Optional provider metadata kept for ranking and display. */
  tags?: string[];
  providerSource?: string;
  creatorUrl?: string;
  licenseUrl?: string;
};

/** A deduplicated, ranked result as shown in the grid. */
export type SearchHit = {
  /** Stable identity used for hide/dedupe/analysis: "<provider>:<id>". */
  key: string;
  result: ImageSearchResult;
  /** Category ids this result was found for. */
  categories: string[];
  queries: string[];
  /** 0..1 text/metadata match estimate, or null when no basis exists. */
  score: number | null;
};

export type QueryError = {
  categoryId: string;
  query: string;
  message: string;
  retryable: boolean;
};

// ---------------------------------------------------------- persistence DTOs

export type Project = {
  id: string;
  name: string;
  originalPrompt: string;
  structuredBriefJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectPatch = {
  name?: string;
  originalPrompt?: string;
  structuredBriefJson?: string | null;
};

export type SearchSession = {
  id: string;
  projectId: string;
  query: string;
  provider: string;
  category: string | null;
  resultCount: number | null;
  createdAt: string;
};

export type NewSearchSession = Omit<SearchSession, "id" | "createdAt">;

export type SavedReference = {
  id: string;
  projectId: string;
  provider: string;
  providerResultId: string;
  title: string;
  thumbnailUrl: string | null;
  sourceUrl: string;
  creatorName: string | null;
  width: number | null;
  height: number | null;
  licenseLabel: string | null;
  category: string | null;
  isDemo: boolean;
  userNotes: string;
  analysisJson: string | null;
  createdAt: string;
};

export type NewReference = Omit<SavedReference, "id" | "userNotes" | "analysisJson" | "createdAt">;

export type BoardItem = {
  id: string;
  projectId: string;
  referenceId: string;
  groupName: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type NewBoardItem = Pick<
  BoardItem,
  "projectId" | "referenceId" | "groupName" | "positionX" | "positionY" | "width" | "height"
>;

export type BoardItemPatch = Partial<
  Pick<BoardItem, "groupName" | "positionX" | "positionY" | "width" | "height" | "sortOrder">
>;

// ------------------------------------------------------------ settings & AI

export type AiProviderId = "mock" | "anthropic";
export type SearchProviderId = "mock" | "openverse" | "pinterest";

export type AppSettings = {
  aiProvider: AiProviderId;
  anthropicModel: string;
  paidAiDisabled: boolean;
  paidWarningAcknowledged: boolean;
  maxImagesPerBatch: number;
  monthlyRequestLimit: number;
  monthlySpendTargetUsd: number;
  limitOverrideMonth: string | null;
  searchProvider: SearchProviderId;
  safeSearch: boolean;
  queriesPerCategory: number;
  /** Two-letter country code Pinterest requires for keyword search. */
  pinterestCountry: string;
};

export type PinterestStatus = {
  hasToken: boolean;
  secureStorage: string;
  country: string;
};

export type PinterestSearchParams = {
  term: string;
  bookmark?: string | null;
  limit?: number;
};

export type MonthUsage = {
  month: string;
  requests: number;
  estimatedCostUsd: number;
  requestsWithoutCost: number;
};

export type PaidAiStatus = {
  available: boolean;
  blockedCode: string | null;
  blockedReason: string | null;
  needsWarningAcknowledgement: boolean;
};

export type AiStatus = {
  aiProvider: AiProviderId;
  model: string;
  hasApiKey: boolean;
  secureStorage: string;
  paid: PaidAiStatus;
  month: MonthUsage;
  pricesAsOf: string;
};

export type UsageRecord = {
  id: string;
  createdAt: string;
  provider: string;
  model: string;
  feature: "brief_analysis" | "image_analysis" | string;
  imageCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  status: "ok" | "error" | string;
  errorCode: string | null;
};

export type CachedAnalysis = {
  cacheKey: string;
  provider: string;
  model: string;
  sourceId: string;
  analysisVersion: number;
  analysisJson: string;
  createdAt: string;
};

export type ImageAnalysisItem = {
  sourceId: string;
  imageUrl: string;
  title: string;
  categoryHint: string;
  briefSummary: string;
};

export type ImageAnalysisItemResult = {
  sourceId: string;
  cacheKey: string;
  status: "ok" | "error" | "skipped";
  fromCache: boolean;
  analysisJson: string | null;
  error: { kind: string; code: string; message: string } | null;
};

export type BriefAnalysisOutput = {
  briefJson: string;
  usage: UsageRecord;
};

export type AppInfo = {
  version: string;
  dbPath: string;
  schemaVersion: number;
};
