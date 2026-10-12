/* Generated from JSON Schema. Run npm run schema:types. */

export type Entity = Domain | Concept | Issue | Method | Paper | Claim | Evidence | Keyword | Tutorial | Resource;

export interface SurveyPatch {
  schema_version: "0.1.0";
  base_commit_id: string;
  message: string;
  /**
   * @minItems 1
   * @maxItems 2000
   */
  operations: [
    (
      | {
          op: "add_entity" | "replace_entity";
          entity: Entity;
        }
      | {
          op: "remove_entity";
          id: string;
        }
      | {
          op: "add_relation" | "replace_relation";
          relation: Relation;
        }
      | {
          op: "remove_relation";
          id: string;
        }
      | {
          op: "set_title";
          title: string;
        }
    ),
    ...(
      | {
          op: "add_entity" | "replace_entity";
          entity: Entity;
        }
      | {
          op: "remove_entity";
          id: string;
        }
      | {
          op: "add_relation" | "replace_relation";
          relation: Relation;
        }
      | {
          op: "remove_relation";
          id: string;
        }
      | {
          op: "set_title";
          title: string;
        }
    )[]
  ];
  /**
   * @maxItems 3
   */
  follow_ups?: [] | [string] | [string, string] | [string, string, string];
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
  /**
   * @maxItems 5
   */
  english_terms?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string];
  evidence?: string[];
}
export interface Issue {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Issue";
  description: string;
  kind: "fundamental" | "subproblem" | "method_dependent";
  /**
   * @maxItems 5
   */
  english_terms?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string];
  evidence?: string[];
}
export interface Method {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Method";
  description: string;
  /**
   * @maxItems 5
   */
  english_terms?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string];
  evidence?: string[];
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
  abstract?: string | null;
  abstract_source_url?: string | null;
  abstract_ja?: string | null;
  reading?: Reading | null;
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
  code_availability?: "public" | "not_found" | "unknown";
  code_url?: string | null;
  code_checked_at?: string | null;
  representative_figure?: Figure | null;
}
export interface Reading {
  contributions: string[];
  novelty: string;
  key_idea: string;
  validation: string;
  discussion: string;
  key_figures: string[];
  key_formulas?: string[];
  captions_ja?: string[];
  sources?: {
    url: string;
    locator: string;
  }[];
  evidence?: string[];
}
export interface Figure {
  asset_id: string;
  caption: string;
  source_name: string;
  source_url: string | null;
  source_pdf_sha256: string;
  page: number;
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  extracted_at: string;
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
  origin?: string | null;
}
export interface Keyword {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Keyword";
  aliases: string[];
  category:
    | "dataset"
    | "benchmark"
    | "hardware"
    | "simulator"
    | "metric"
    | "sota"
    | "model"
    | "baseline"
    | "task"
    | "concept"
    | "method"
    | "other";
  meaning: string;
  papers: string[];
  related: string[];
  official_url?: string | null;
  as_of?: string | null;
  definition_excerpt: string;
  source_url: string | null;
  locator: string | null;
  evidence?: string[];
}
export interface Tutorial {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Tutorial";
  sections: TutorialSection[];
}
export interface TutorialSection {
  role:
    | "definition"
    | "motivation"
    | "methods"
    | "summary"
    | "challenges"
    | "variants"
    | "hands_on"
    | "further_reading"
    | "conclusion";
  heading: string;
  body: string;
  refs: string[];
  media: {
    paper: string;
    label: string;
    /**
     * A faithful Japanese translation of the paper's caption for this label.
     */
    caption_ja?: string;
  }[];
  links: {
    url: string;
    title: string;
  }[];
}
export interface Resource {
  id: string;
  label: string;
  provenance: "fixture" | "user" | "codex";
  type: "Resource";
  kind: "survey" | "tutorial" | "blog" | "slides" | "talk" | "repository" | "website" | "book" | "course" | "other";
  title: string;
  url: string;
  /**
   * @maxItems 20
   */
  authors:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  published: string | null;
  language: string | null;
  summary: string;
  issues: string[];
  methods: string[];
  paper: string | null;
  checked_at: string | null;
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
