export type NodeType =
  | 'domain' | 'ip' | 'asn' | 'cert' | 'wallet' | 'apk'
  | 'signer' | 'package' | 'tracker' | 'registrar' | 'nameserver' | 'brand'
  | 'report' | 'blocklist' | 'email' | 'phone';
export type AssetType = 'domain' | 'wallet' | 'apk' | 'email' | 'phone';
export type Vector = 'web' | 'crypto' | 'mobile' | 'email' | 'telecom';

export interface IpInput { ip: string; asn?: string | number | null; weight?: number }
export interface ApkInput {
  sha256: string; package?: string; signer_sha256?: string;
  hosted_on?: string[]; wallets?: string[]; trackers?: string[];
}
export interface WalletLinkObj { a: string; b: string; rel?: string; weight?: number }

/** One input record. Every field is optional; records may be partial. */
export interface Observation {
  id?: string; source?: string;
  domain?: string; sans?: string[];
  ips?: Array<string | IpInput>; certs?: string[]; registrar?: string;
  nameservers?: string[]; trackers?: string[];
  wallets?: string[]; wallet_links?: Array<[string, string] | WalletLinkObj>;
  emails?: string[]; phones?: string[];
  registered?: string;          // domain registration date (ISO), from RDAP
  reports?: string[];           // threat-report ids that mention the domain (e.g. "otx:abc123")
  blocklists?: string[];        // public blocklists/feeds that list the domain (e.g. "openphish")
  apk?: ApkInput;
}

export interface NodeRow { id: string; type: NodeType; value: string }
export interface IngestStats { nodes: number; edges: number }
export interface Brand { name: string; domains?: string[] }

export interface Contribution { via: string; type: string; c: number }
export interface ClusterInfo {
  id: string; size: number; vectors: Vector[];
  confidence: number | null; risk_score: number | null;
}
export interface TopCluster extends ClusterInfo { sample?: string }
export interface LinkEvidence { a: string; b: string; score: number; evidence: Contribution[] }

export interface GraphNode extends NodeRow { cluster: string | null; isQuery: boolean; meta: Record<string, unknown> }
export interface GraphLink { source: string; target: string; rel: string; weight: number }

export type Level = 'official' | 'high' | 'suspicious' | 'signals' | 'none' | 'info';
export type ReasonCode =
  | 'official_brand' | 'blocklisted' | 'lookalike' | 'new_domain' | 'reports'
  | 'linked_flagged' | 'shared_platform' | 'no_signals' | 'infra_summary' | 'ai_model';
/** Structured so the UI can say it in any language. */
export interface Reason { code: ReasonCode; params?: Record<string, string | number> }
export interface Assessment { level: Level; score: number | null; reasons: Reason[] }
export interface AssetView extends NodeRow { assessment: Assessment }
export interface RecentItem { value: string; assessment: Assessment }
export interface Facts {
  registered?: string; registrar?: string; nameservers: string[]; ips: string[];
  blocklists: string[]; reports: string[]; brand?: string; certificates: number;
}

export interface EmailFacts {
  email: string; domain: string; isDisposable: boolean; isFreeWebmail: boolean;
  hasMx?: boolean; impersonatesBrand?: string;
}

export interface PhoneFacts {
  phone: string; countryCode?: string; countryName?: string;
  isVoip?: boolean; isOfficialHeader?: boolean; headerSender?: string;
}

export interface ChangeVector {
  activeVectors: Vector[];
  vectorTransitions: string[];
  churn: {
    ipMigrations: number;
    certChanges: number;
    historicalReports: number;
    lookalikeDomains: number;
    nameserverRotations: number;
  };
  summary: string;
}

export interface SmishingAnalysis {
  isSmishing: boolean;
  riskScore: number;
  urgencyLevel: 'high' | 'medium' | 'low';
  senderHeader: { raw: string; isOfficialHeader: boolean; note: string };
  extracted: {
    domains: string[];
    phones: string[];
    emails: string[];
    upi: string[];
  };
  threatIndicators: string[];
  reasons: string[];
}

export interface SourceReport { source: string; ok: boolean; found: boolean; ms: number; note?: string }
export interface LiveSummary { kind: string; stored: boolean; sources: SourceReport[] }
export interface Flag { asset: string; type: 'blocklist' | 'report'; value: string }

export type MessageCode = 'unrecognised' | 'offline' | 'unreachable' | 'nodata';
export interface NotFound { found: false; suggestions: NodeRow[]; live?: LiveSummary; message?: string; messageCode?: MessageCode }
export interface Investigation {
  found: true; query: NodeRow; clusters: ClusterInfo[];
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  evidence: LinkEvidence[]; flags: Flag[]; truncated: boolean; latencyMs?: number; live?: LiveSummary;
  assessment: Assessment; assets: AssetView[]; facts: Facts | null;
  changeVector?: ChangeVector;
  emailFacts?: EmailFacts | null;
  phoneFacts?: PhoneFacts | null;
  smishing?: SmishingAnalysis | null;
}
export type InvestigationResult = Investigation | NotFound;

export type Role = 'user' | 'admin';
export interface PublicUser { id: string; email: string; name: string; role: Role }
export interface Stats {
  nodes: Record<string, number>; edges: number; observations: number; clusters: number; correlatedClusters: number;
}
