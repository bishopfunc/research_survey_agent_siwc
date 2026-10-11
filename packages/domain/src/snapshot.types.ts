/* Generated from JSON Schema. Run npm run schema:types. */

export type Entity = Domain | Concept | Issue | Method | Paper | Claim | Evidence;

export interface SurveySnapshot {
  schema_version: "0.1.0";
  title: string;
  /**
   * @maxItems 1000
   */
  entities: Entity[];
  /**
   * @maxItems 4000
   */
  relations: Relation[];
}
export interface Domain {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Domain";
  description: string;
}
export interface Concept {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Concept";
  description: string;
}
export interface Issue {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Issue";
  description: string;
  kind: "fundamental" | "subproblem" | "method_dependent";
}
export interface Method {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Method";
  description: string;
}
export interface Paper {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Paper";
  title: string;
  year: number | null;
  venue: string | null;
  venue_type: "conference" | "journal" | "preprint" | "other" | null;
  one_line_summary: string;
  citation_count: number | null;
  citation_source: string | null;
  citation_as_of: string | null;
  doi: string | null;
  arxiv_id: string | null;
  url: string | null;
  authors: string[];
  proposes: string[];
  addresses: string[];
  claims: string[];
  evidence: string[];
}
export interface Claim {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Claim";
  statement: string;
  status: "open" | "partially_solved" | "solved" | "disputed" | "unknown";
  scope: {
    task: string;
    setting: string;
    metric: string;
    assumptions: string[];
    limitations: string[];
  };
  as_of: string | null;
  evidence: string[];
}
export interface Evidence {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Evidence";
  source_url: string;
  locator: string;
  excerpt: string;
  verification: "unverified" | "abstract_only" | "verified";
  retrieved_at: string | null;
  content_hash: string | null;
}
export interface Relation {
  id: string;
  type:
    | "part_of"
    | "specializes"
    | "depends_on"
    | "related_to"
    | "caused_by"
    | "tradeoff_with"
    | "addresses"
    | "extends"
    | "builds_on"
    | "introduces_issue"
    | "assumes"
    | "instance_of"
    | "proposes"
    | "supports"
    | "contradicts"
    | "refines"
    | "about";
  from: string;
  to: string;
}
