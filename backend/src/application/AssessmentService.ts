import { applyGroupEffects, scoreDomain, SIGNAL_RELS } from '../domain/assess.ts';
import { verifyEmail } from '../domain/emailVerify.ts';
import { verifyPhone } from '../domain/phoneVerify.ts';
import { isAsset } from '../domain/normalize.ts';
import type { Assessment, Brand } from '../domain/types.ts';
import type { Clock, DomainClassifier, GraphReader } from './ports.ts';
import { systemClock } from './ports.ts';

/** Single responsibility: produce the plain-language verdict for assets (rules + optional ML probability). */
export class AssessmentService {
  private readonly reader: GraphReader;
  private readonly brands: Brand[];
  private readonly classifier: DomainClassifier;
  private readonly clock: Clock;
  constructor(reader: GraphReader, brands: Brand[], classifier: DomainClassifier, clock: Clock = systemClock) {
    this.reader = reader; this.brands = brands; this.classifier = classifier; this.clock = clock;
  }

  /** Verdict for every member of one connected group. */
  async assessGroup(memberIds: string[]): Promise<Map<string, Assessment>> {
    const nodes = await this.reader.getNodes(memberIds);
    const domains = nodes.filter((n) => n.type === 'domain');
    const edges = await this.reader.edgesFrom(domains.map((d) => d.id), SIGNAL_RELS);
    const own = domains.map((node) => ({
      id: node.id,
      assessment: scoreDomain({ node, edges: edges.filter((e) => e.src === node.id), brands: this.brands, now: this.clock.now(), ai: this.classifier.predict(node.value) }),
    }));

    const otherAssets = nodes.filter((n) => isAsset(n.type) && n.type !== 'domain');
    const results = applyGroupEffects(own, otherAssets.map((n) => n.id));

    // If an email or phone has its own standalone signal, merge the higher score or official verdict
    for (const n of otherAssets) {
      if (n.type === 'email') {
        const { assessment } = verifyEmail(n.value, this.brands);
        const current = results.get(n.id);
        if (!current || assessment.level === 'official' || (assessment.score ?? 0) > (current.score ?? 0)) {
          results.set(n.id, assessment);
        }
      } else if (n.type === 'phone') {
        const { assessment } = verifyPhone(n.value);
        const current = results.get(n.id);
        if (!current || assessment.level === 'official' || (assessment.score ?? 0) > (current.score ?? 0)) {
          results.set(n.id, assessment);
        }
      }
    }

    return results;
  }

  /** Domains stored recently that carry real fraud signals (start screen). */
  async recentFlagged(limit: number): Promise<Array<{ value: string; assessment: Assessment }>> {
    const nodes = await this.reader.recentNodes('domain', 400);
    const edges = await this.reader.edgesFrom(nodes.map((n) => n.id), SIGNAL_RELS);
    const bySrc = new Map<string, typeof edges>();
    for (const e of edges) { const l = bySrc.get(e.src); if (l) l.push(e); else bySrc.set(e.src, [e]); }
    return nodes
      .map((node) => ({ value: node.value, assessment: scoreDomain({ node, edges: bySrc.get(node.id) ?? [], brands: this.brands, now: this.clock.now(), ai: this.classifier.predict(node.value) }) }))
      .filter((i) => (i.assessment.score ?? 0) >= 30)
      .sort((a, b) => (b.assessment.score ?? 0) - (a.assessment.score ?? 0))
      .slice(0, limit);
  }
}
