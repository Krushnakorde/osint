# Multi-Vector Passive OSINT & Fraud Infrastructure Framework

MCA thesis project: *Design and Automated Evaluation of a Multi-Vector Passive OSINT and Infrastructure
Correlation Framework for Unmasking Cross-Platform Cyber Fraud Networks.*

This repository contains **everything** in the synopsis as working code: the TypeScript (Node.js) ingestion and correlation
engine, the MongoDB database, the React + Tailwind investigator dashboard, a test suite, and an evaluation
harness that produces the three metrics your synopsis promises (correlation accuracy, processing latency,
false-positive rate). This README walks from first setup to writing up the research.

> **Read this first (honesty note).** The project is written in **TypeScript** and was built in an environment
> **without internet**. Verified there: the backend passes `tsc` strict type-checking and its 22 tests pass
> (including live lookups against a *mocked* internet and the fraud-verdict rules); the dashboard's English/Marathi
> text and plain-language helpers pass their own 6 tests. **Not verified:** the React screens were never rendered
> or built, `npm install` was never run, and the real public services were never contacted (the mocks follow the
> services' documentation, so they prove the logic, not that every real service answers exactly like the mock).
> Do the first-run checklist in section 11; `npm run lookup -- <domain>` shows, source by source, what works from
> your network. The bundled demo dataset is **synthetic**: its numbers are **not thesis results** (section 10.3).

---

## Table of contents
1. [What this system does](#1-what-this-system-does)
2. [Quick start](#2-quick-start)
3. [Project structure](#3-project-structure) and [TypeScript setup](#3b-typescript-setup)
4. [Database setup](#4-database-setup)
5. [Configuration](#5-configuration)
6. [Backend usage and API](#6-backend-usage-and-api)
7. [Data sources, live mode, and the passive guarantee](#7-data-sources-live-mode-and-the-passive-guarantee)
8. [How the correlation algorithm works](#8-how-the-correlation-algorithm-works)
9. [Frontend dashboard](#9-frontend-dashboard)
10. [Research guide: solving the research problem](#10-research-guide-solving-the-research-problem)
11. [Testing and troubleshooting](#11-testing-and-troubleshooting)
12. [Roadmap](#12-roadmap)
13. [Ethics and responsible use](#13-ethics-and-responsible-use)

---

## 1. What this system does

Fraudsters reuse things: the same SSL certificate, hosting, tracking ID, Android signing key or wallet address
shows up across many scam assets. Each shared item is a **link**. The system:

1. **Ingests** indicators about three kinds of asset (from imports, public feeds, and **live lookups of anything you search for**): **web** (phishing/e-commerce domains), **crypto** (wallet
   addresses) and **mobile** (malicious APKs), plus the infrastructure around them (IPs, ASNs, certificates,
   nameservers, registrars, tracking IDs, signing certificates). Only public/passive data is used.
2. **Stores** them as a graph (nodes = indicators, edges = observed relationships).
3. **Correlates**: finds asset pairs that share infrastructure, weighs each shared item by how revealing it is,
   and merges linked assets into **threat clusters** with a **connection strength** (how sure we are they belong together). A separate, plain-language **verdict** (official / likely fraudulent / suspicious / ... ) comes from real fraud signals (section 8b).
4. **Shows** an investigator a relationship map for any searched indicator, answered purely from the local
   database (no packet is ever sent to the target).

| Synopsis objective | Where it lives |
|---|---|
| 1. Modular passive ingestion engine (Node.js) | `backend/src/ingest.ts`, `backend/src/live.ts` (real-time lookup), `backend/src/collectors/*`, `backend/src/feeds.ts`, `backend/src/certstream.ts`, `backend/src/scheduler.ts`, `backend/src/net-guard.ts` |
| Typosquatting matcher (Levenshtein) | `backend/src/typosquat.ts` |
| 2. Heuristic correlation algorithm | `backend/src/correlate.ts` |
| 3. React + Tailwind investigator dashboard | `frontend/` |
| 4. Evaluation: accuracy, latency, false positives | `backend/scripts/evaluate.ts`, `backend/scripts/generate-dataset.ts` |

---

## 2. Quick start

**Prerequisites:** Node.js **22.6 or newer** (`node -v`) and **MongoDB** (running locally on port 27017 or via `docker compose up -d`).

```bash
# 1) Backend: create the database, load demo data, run the tests
cd backend
npm install                     # installs dependencies (mongoose, typescript, @types/node)
cp .env.example .env            # optional; defaults connect to mongodb://127.0.0.1:27017/osint
npm run init-db                 # connects to MongoDB and initializes collections and indexes
npm run seed                    # seeds demo dataset into MongoDB
npm test                        # runs test suite
npm run typecheck               # tsc --noEmit (strict mode)
npm start                       # API on http://localhost:4000

# 2) Frontend (new terminal)
cd frontend
npm install
npm run dev                     # dashboard on http://localhost:5173
```

Open http://localhost:5173 and search **any** domain, URL, IP, Bitcoin/Ethereum address or 64-hex hash. If it is not in
the database, the backend queries public passive sources live (a few seconds), saves what it finds, and draws the
relationship map. No seeding needed. (Check the sources work from your network first: `cd backend && npm run lookup -- some-domain.example`.)
If `npm install` fails in `frontend/`, the backend still runs without installing anything (`npm start`, API on port 4000).

**Single-process mode:** `cd frontend && npm run build` (type-checks, then builds), then `cd backend && npm start`. The backend serves the
built dashboard at http://localhost:4000.

**Run the evaluation:** `cd backend && npm run evaluate` (writes `results/evaluation.md` and `.json`).

---

## 3. Project structure

```
osint-fraud-framework/
|-- README.md                      <- you are here
|-- package.json                   convenience scripts (setup/backend/frontend/test/evaluate)
|-- backend/
|   |-- package.json  tsconfig.json  .env.example
|   |-- data/brands.json           brand list for the typosquatting matcher (edit/extend it)
|   |-- results/                   evaluation output (example from the synthetic run is included)
|   |-- src/
|   |   |-- config.ts              settings + .env loader + passive allow-list of hosts
|   |   |-- types.ts               shared domain types (Observation, NodeType, API shapes); also used by the frontend
|   |   |-- domain/                core domain logic (correlate, normalize, typosquat, assess, ml)
|   |   |-- application/           application services (search, ingest, auth, investigation, live)
|   |   `-- infrastructure/        MongoDB adapters (models.ts, MongoGraphStore.ts, MongoRepositories.ts), collectors, HTTP
|   |-- scripts/
|   |   |-- init-db.ts seed.ts import-observations.ts
|   |   |-- extract-apk-meta.ts    local .apk -> observation JSON
|   |   |-- generate-dataset.ts    synthetic data WITH ground truth
|   |   `-- evaluate.ts            metrics, threshold sweep, ablation
|   `-- test/*.test.ts             unit, domain, auth, live, and contract test suites
`-- frontend/                      Vite + React + TypeScript + Tailwind (dark theme) + react-force-graph-2d
    |-- tsconfig.json  vite.config.ts  tailwind.config.ts
    `-- src/  App.tsx  api.ts  types.ts  components/*.tsx
```

---

## 3b. TypeScript setup

* **No build step for the backend.** Node strips the type annotations at start-up, so `npm start`, `npm test`
  and every script run the `.ts` files directly. The npm scripts pass `--experimental-strip-types` (needed on
  Node 22.6-22.17; harmless on newer versions, where it is on by default) and hide the experimental warning.
* **Type-checking is separate:** `cd backend && npm install && npm run typecheck` runs `tsc --noEmit` in strict mode
  (`backend/tsconfig.json`). The same for the frontend (`cd frontend && npm run typecheck`; its `npm run build`
  type-checks first).
* **Shared types:** `backend/src/types.ts` defines `Observation`, `NodeType`, `Investigation`, ... and the
  frontend imports them (type-only), so the API contract is checked at compile time.
* **Rules because Node only *erases* types** (enforced by `erasableSyntaxOnly`): write `import type { X }` for
  type-only imports, import local files with the `.ts` extension (`from './config.ts'`), and do not use `enum`,
  `namespace` or constructor parameter properties (use string-literal unions and plain fields instead).
* **Database & Clean Architecture:** MongoDB models and Mongoose schemas reside in `src/infrastructure/mongo/models.ts` with strongly-typed repository contracts implemented in `MongoGraphStore.ts` and `MongoRepositories.ts`.

---

## 4. Database setup

### 4.1 Engine
**MongoDB**, connected via Mongoose (`mongodb://127.0.0.1:27017/osint`). Why: scalable document model for graph nodes and relationships, indexed querying for real-time investigation, persistent user accounts with JWT security, and BI search analytics.

### 4.2 Initialize it
```bash
cd backend
npm run init-db
```
This connects to your MongoDB instance (configured via `MONGO_URL` in `.env`) and creates all collections and indexes. It is safe to run repeatedly.

### 4.3 Collections
| Collection | Purpose |
|---|---|
| `nodes` | One document per indicator. `_id` = `<type>:<normalized value>` (e.g. `domain:evil.example`). |
| `edges` | Observed relationships (`resolves_to`, `uses_cert`, `solicits`, `signed_by`, ...). `weight` is confidence (0-1, default 1). |
| `observations` | The raw input records, kept verbatim so any result can be replayed and audited. |
| `cluster_members` | Which cluster each **asset** (domain/wallet/apk) belongs to. Rebuilt on every correlation run. |
| `cluster_summaries` | Summary per cluster: size, vectors (web/crypto/mobile), connection strength (`confidence`) and risk score. |
| `links` | Related asset pairs with a score and the evidence behind it ("why linked"). |
| `users` | Investigator and administrator accounts with salted `scrypt` password hashes and roles. |
| `revoked_tokens` | Logged-out JWTs managed with MongoDB TTL indexes. |
| `search_events` | User search audit history and BI query analytics. |
| `ai_models` | Trained logistic regression classifier artifacts and metrics. |

### 4.4 Node types
| Type | Example | Role | Base weight* |
|---|---|---|---|
| `domain` | `p4ypal-claim79.live` | **asset** (web) | n/a |
| `wallet` | `bc1q...` | **asset** (crypto) | 0.90 |
| `apk` | SHA-256 of the file | **asset** (mobile) | 0.90 |
| `signer` | SHA-256 of APK signing cert | evidence | 0.85 |
| `tracker` | `UA-123456-1` | evidence | 0.85 |
| `cert` | CT cert id (`issuer-serial`) or fingerprint | evidence | 0.75 |
| `package` | `com.brand.app` | evidence | 0.50 |
| `ip` | `203.0.113.7` | evidence | 0.45 |
| `nameserver` | `ns1.host.example` | evidence | 0.35 |
| `brand` | `paypal` (typosquat target) | evidence | 0.30 |
| `registrar` | `NameCheap Inc` | evidence | 0.15 |
| `asn` | `13335` | evidence | 0.10 |

\*How strongly a **shared** node of that type suggests the same operator (section 8).

### 4.5 Look inside the database
Open **MongoDB Compass** and connect to `mongodb://127.0.0.1:27017`, then navigate to the `osint` database. Alternatively, use `mongosh`:
```javascript
mongosh mongodb://127.0.0.1:27017/osint
> show collections
> db.nodes.aggregate([{ $group: { _id: "$type", count: { $sum: 1 } } }])
> db.cluster_summaries.find().sort({ size: -1 }).limit(5)
> db.links.find().sort({ score: -1 }).limit(5)
// Find everything connected to a signing certificate:
> db.edges.find({ rel: "signed_by", dst: "signer:<hash>" })
```

### 4.6 Reset and backup
```bash
# Reset database collections
npm --prefix backend run init-db && npm --prefix backend run seed

# Backup with mongodump (server may stay running)
mongodump --uri="mongodb://127.0.0.1:27017/osint" --out=./backup
```

### 4.7 Loading your own (real) data
Everything enters as **observations**: small JSON records. All fields except `source` are optional.
```json
{
  "id": "report-001",
  "source": "my-feed-name",
  "domain": "paypa1-login.top",
  "sans": ["www.paypa1-login.top"],
  "ips": [{ "ip": "203.0.113.7", "asn": "AS64500" }],
  "certs": ["R3-04a1b2c3"],
  "registrar": "NameCheap Inc",
  "nameservers": ["ns1.example-dns.net"],
  "trackers": ["UA-123456-1"],
  "wallets": ["bc1qexamplewalletaddress"],
  "wallet_links": [["bc1qaaa", "bc1qbbb"]],
  "apk": {
    "sha256": "<64 hex>", "package": "com.paypa1.secure", "signer_sha256": "<64 hex>",
    "hosted_on": ["paypa1-login.top"], "wallets": ["bc1qexamplewalletaddress"]
  }
}
```
Load a file (one object or an array) with:
```bash
cd backend && npm run import -- ../my-observations.json
```
Records can be **partial**: one record may name only a domain and a wallet, another only an APK and the same
wallet. The correlation step joins them through shared nodes. That is the whole point of the framework.

**APKs:** download samples from a research repository (see 10.3), then extract metadata *offline* (the file is
never installed or run). Requires Android build-tools (`aapt`, `apksigner`) on your PATH:
```bash
npm --prefix backend run extract-apk -- sample.apk --hosted-on bad.example --wallet bc1q... > apk-obs.json
npm --prefix backend run import -- apk-obs.json
```

---

## 5. Configuration

Edit `backend/.env` (copy from `.env.example`). Real environment variables override the file.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 4000 | API port |
| `DB_PATH` | `./data/osint.db` | database file |
| `COLLECTOR_MODE` | `live` | `live` = unknown indicators are looked up on public passive sources and saved. `offline` = no network at all |
| `VT_API_KEY`, `URLSCAN_API_KEY` | empty | optional keys; the system works without them |
| `ALLOW_DOH` | true | resolve A/NS records through public DNS-over-HTTPS resolvers (see 7.2 for the caveat) |
| `MAX_PIVOT_DOMAINS` | 10 | co-hosted domains a lookup may add by pivoting on the IP; 0 = off |
| `ENRICH_TTL_HOURS` | 24 | a known indicator is re-queried live when its last lookup is older than this |
| `LIVE_TIMEOUT_MS` | 25000 | max wait per public source |
| `FEED_REFRESH_HOURS`, `FEED_MAX_DOMAINS`, `FEED_ENRICH_PER_RUN` | 6, 100, 10 | OpenPhish feed intake (0 hours = off) |
| `CERTSTREAM` | false | watch the live Certificate Transparency stream for brand look-alike domains |
| `EXTRA_BRANDS` | empty | extra brand names to watch (comma separated) on top of the ~95 built in |
| `LINK_THRESHOLD` | 0.6 | minimum pair score to link two assets (section 8) |
| `MAX_HUB_SIZE` | 50 | a shared node touching more assets than this is ignored (CDN IPs, debug signing key, ...) |

---

## 6. Backend usage and API

`npm start` serves JSON on `http://localhost:4000`.

| Method and path | What it does |
|---|---|
| `GET /api/health` | liveness + current mode |
| `GET /api/stats` | node counts by type, edges, observations, clusters |
| `GET /api/search?q=<indicator>` | investigate any indicator. If unknown/stale it is **looked up live first** and saved. Returns `{ query, assessment{level,score,reasons[]}, facts, assets[] (each with its own verdict), clusters[], graph, evidence[], flags[], live{sources[]}, latencyMs }`; 404 with `messageCode` (`unrecognised`/`offline`/`unreachable`/`nodata`) and the per-source report if nothing is found. Options: `&refresh=1` force a new live lookup, `&live=0` database only |
| `GET /api/clusters?limit=20` | strongest-connected groups (with a sample member to search) |
| `GET /api/recent?limit=12` | recently stored domains that carry real fraud signals, with their verdict |
| `POST /api/observations` | ingest one observation or an array, then re-correlate |
| `POST /api/feeds/refresh` | pull the OpenPhish feed now and enrich a few of its domains |
| `POST /api/correlate` | recompute clusters (e.g. after changing the threshold) |

```bash
curl "localhost:4000/api/search?q=p4ypal-claim79.live"
curl -X POST localhost:4000/api/observations -H 'Content-Type: application/json' \
     -d '{"domain":"paypa1-test.top","wallets":["bc1qtest"]}'
```
The search never makes a network call; it reads the database only (typically around 1 ms in testing).

---

## 7. Data sources, live mode, and the passive guarantee

### 7.1 How a live search works
`GET /api/search?q=X` -> `detect.ts` works out what X is (domain, URL, IPv4, Bitcoin address, Ethereum address,
64-hex hash, tracking ID) -> if X is not in the database (or its last lookup is older than `ENRICH_TTL_HOURS`) the
matching collectors run **in parallel** (`live.ts`) -> their findings are merged into observations and **saved
automatically** -> clusters are recomputed -> the map is returned together with a per-source report
(found / empty / failed, milliseconds), which the dashboard shows as chips. If no source knows the indicator,
nothing is saved. Two people searching the same thing share one set of requests.

| You search | Sources queried (no key needed unless stated) | What is stored |
|---|---|---|
| **Domain / URL** | DNS-over-HTTPS (A, NS, ASN via Team Cymru mapping), **RDAP** (registrar, nameservers, registration date), **crt.sh** (certificates + co-hosted names), **urlscan.io** (other people's existing scans: IP, ASN, plus up to `MAX_PIVOT_DOMAINS` domains on the same IP), **AlienVault OTX** (threat reports that mention it, passive DNS), **blocklists** (MetaMask phishing list, OpenPhish), VirusTotal *(key)* | domain, IPs, ASNs, nameservers, registrar, registration date, certificates, report ids, blocklist labels, brand look-alike tag |
| **IP** | ASN lookup, urlscan.io, OTX passive DNS | IP, ASN, domains seen on it |
| **Bitcoin address** | mempool.space ledger: transaction count + common-input co-spending wallets | wallet and linked wallets |
| **Ethereum address** | Blockscout public API: wallets that funded it (weak evidence, weight 0.5) | wallet and funders |
| **64-hex hash** | crt.sh (as a certificate fingerprint), VirusTotal *(key)* for an APK's package and signing certificate | covered domains / APK metadata |
| Tracking ID (`UA-...`) | no free public reverse lookup exists | local database only |

### 7.2 What "passive" means here, and one honest caveat
The system never contacts a suspected target's own servers: no page visits, no port scans, no downloads from scam
hosts, no URL/file submissions to scanners. It asks third parties (CT logs, RDAP registries, urlscan.io, OTX,
blockchain explorers, public blocklists) what they already know.

**Caveat: DNS.** To learn a *new* domain's IP and nameservers when no archive knows it yet, the system resolves it
through Google/Cloudflare DNS-over-HTTPS. Your computer never talks to the target, but the resolver asks the
domain's authoritative nameserver, which a fraudster who runs it could see (from Google's/Cloudflare's address,
not yours). This is the usual "passive recon" convention, but if your ethics board wants zero lookups, set
`ALLOW_DOH=false`: you then rely only on archives (urlscan, OTX, CT, RDAP).

**Enforced by code:** all HTTP goes through `src/net-guard.ts`, which only allows the hosts in `config.allowedHosts`
(`crt.sh`, `rdap.org` and registry `rdap.*` servers, `dns.google`, `cloudflare-dns.com`, `urlscan.io`,
`otx.alienvault.com`, `mempool.space`, `eth.blockscout.com`, `raw.githubusercontent.com`, `openphish.com`,
`www.virustotal.com`, `certstream.calidog.io`), checks **every redirect hop**, and rate-limits per host. Any other
host throws `Blocked by passive-only guard` (unit-tested, including redirects). Limitation: the `rdap.` host
pattern is prefix-based, so it is only as safe as the code that builds the URLs.

### 7.3 Real-time intake in the background (no searching needed)
* **OpenPhish feed** (`feeds.ts`): every `FEED_REFRESH_HOURS` (default 6) the server downloads the public feed,
  stores up to `FEED_MAX_DOMAINS` reported phishing domains, and runs a full live lookup on `FEED_ENRICH_PER_RUN`
  of them. Run it once by hand: `npm run feeds`. The database therefore fills with real, current data by itself.
* **Certstream** (`certstream.ts`, `CERTSTREAM=true`): connects to the public Certificate Transparency live stream
  and stores every newly issued certificate whose domain imitates one of ~95 brands (HDFC, SBI, PhonePe, PayPal,
  Binance, MetaMask, ...), together with the other names on the same certificate. Writes are batched and clusters
  recomputed at most once a minute. Add brands in `backend/data/brands.json` or `EXTRA_BRANDS`.
* **Blocklists** (MetaMask phishing list, OpenPhish) only **label** domains ("reported"); they never count as
  correlation evidence, because being on the same big list does not make two domains the same operator.

### 7.4 Limits you should know about
* **No free source links a wallet to a scam domain.** A Bitcoin lookup finds wallets that move money together, but
  the *domain-to-wallet* edge has to come from a report that names both (imports, vendor write-ups, APK analysis).
* **APK metadata needs a key or a local file.** Free keyless APK reputation APIs no longer exist; use VirusTotal
  (key) or `npm run extract-apk -- file.apk` on a sample you obtained from a research repository.
* **Free public services rate-limit and change.** A source that fails shows as a red chip with the reason; the rest
  still work. urlscan.io and OTX limits are tighter without keys. Their JSON formats were coded from documentation
  and may need small fixes (section 11).
* **Pivoting adds unrelated neighbours.** Domains found on the same IP are added with weak evidence only; a shared
  hosting IP alone never links them (specificity discount and hub cap, section 8).
* **Newly registered domains** carry their RDAP registration date, shown in the dashboard; it is not yet part of the score.

---

## 8. How the correlation algorithm works

Source: `backend/src/correlate.ts` (about 100 lines; read it, you will be asked about it in your viva).

**Assets** are `domain`, `wallet`, `apk`. Everything else is **evidence**. The algorithm asks, for each pair of
assets: *how much evidence says they belong to the same operator?*

1. **Direct evidence.** Two assets named together in one report (domain solicits wallet, APK hosted on domain,
   APK embeds wallet, co-spent wallets) contribute `0.85 x edge weight`.
2. **Shared-node evidence.** If a node (a certificate, signer, tracker, IP, ...) touches several assets, every
   pair of those assets gets a contribution:

   `c = base_weight(type) x specificity(n) x min(edge weights)`
   `specificity(n) = 1 / (1 + 0.25 x ln(n))`, where `n` = number of assets touching that node.

   Meaning: a rare, specific shared item is strong; the same item shared by many assets is discounted.
   A node touching more than `MAX_HUB_SIZE` assets (a CDN IP, the shared Android debug key) is **ignored**.
3. **Combine** all contributions for a pair with a *noisy-OR*: `score = 1 - product(1 - c)`. Independent weak
   signals add up (an IP + nameserver + brand match can cross the threshold), but one weak signal never does.
4. **Link** pairs with `score >= LINK_THRESHOLD` (default 0.6).
5. **Cluster** with union-find over the links (connected components). Each cluster gets a stable id.
6. **Connection strength.** `confidence` = mean link score inside the cluster. The engine also stores `risk = 100 x min(1, confidence x (1 + 0.05 x (vectors - 1)))`
   (vectors = how many of web/crypto/mobile appear). **This number measures how sure we are that assets belong together, NOT how dangerous they are** (a real brand's
   own domains can be tightly connected too), so the dashboard does not use it as a verdict. See 8b.
   A cluster with no links has **no score** (`null`): the dashboard says "no cross-link evidence" instead of
   showing a misleading "0 = safe".

**Worked example.** Two domains share a certificate and a tracking ID. `n = 2`, `specificity = 0.852`.
cert: `0.75 x 0.852 = 0.639`; tracker: `0.85 x 0.852 = 0.724`. Score: `1 - (1-0.639)(1-0.724) = 0.90` -> linked.
If instead they only share an ASN: `0.10 x 0.852 = 0.085` -> not linked.

### 8b. The verdict: how "fraudulent" is decided (and why real brands are not flagged)

Source: `backend/src/assess.ts` (tested in `test/assess.test.ts`). Two different questions, two different numbers:

| Question | Number | Where |
|---|---|---|
| Do these assets belong to the same operator? | **Connection strength** (0-100%) | section 8, shown under "Technical details" |
| Does this asset look fraudulent? | **Verdict** from **warning points** | `assess.ts`, the big card at the top |

Warning points come only from **real fraud signals** about a domain:

| Signal | Points | Note |
|---|---|---|
| Listed on a phishing/scam blocklist (OpenPhish, MetaMask list, VirusTotal malicious) | +70 | strongest signal |
| Name imitates a brand (look-alike by edit distance / digits like `paypa1`) | +30 (+15 if only "contains the brand name") | +10 if it also has words like login, verify, claim, kyc, airdrop |
| Mentioned in public threat reports (AlienVault OTX) | +20 (+30 for 3 or more) | only narrow reports (<= 100 indicators) |
| Registered recently (RDAP) | +20 (<= 30 days), +10 (<= 90 days) | only counted when another signal exists, so a new bakery site is not flagged |
| Connected to another domain already scoring 60+ | +35 | wallets and apps in such a group become "suspicious" |
| Lives on a shared platform (github.io, forms.gle, ...) | capped at 45 | one bad page does not condemn the whole platform |

Verdict levels: **Official** (domain, or a subdomain of one, listed for a known brand in `data/brands.json`; always 0 points,
so `paypal.com` or `www.phonepe.com` is never flagged) -> **Likely fraudulent** (60+) -> **Suspicious** (30-59) -> **Some warning signs** (1-29) ->
**No fraud signals found** (0). The last one never says "safe": public sources may simply not know the site yet.
Every verdict lists its reasons in plain words. Weights are heuristics; tune them in `assess.ts` and re-test.
Brands whose official domains are not in `brands.json` are the main remaining source of false alarms: add them there.

**Typosquatting** (`typosquat.ts`): the second-level label is normalised (digits like `1` -> `l`, `rn` -> `m`),
then compared with each brand in `data/brands.json` by Levenshtein distance (max 1 for short brands, 2 for
longer) or containment (`paypal-secure-login`). A hit adds a `brand` node, which is weak evidence by itself.

**All weights are expert starting values.** Tuning them and measuring each type's contribution (ablation) is a
legitimate part of your research (10.5). Do not tune them on the same data you report final numbers on.

**Known limitations:** connected components can *chain* (A-B and B-C merge A and C even if A and C are unrelated);
wallet clustering heuristics have known errors (for example CoinJoin transactions); CT `issuer-serial` identifies a
certificate but is not a fingerprint; correlation is a *heuristic*, not proof of common ownership.

---

## 9. Frontend dashboard

`frontend/`: Vite + React 18 + **TypeScript** + Tailwind CSS 3 (dark theme) + `react-force-graph-2d`. Written for non-experts:
plain words instead of graph jargon, **English and Marathi (मराठी)** with a language switch (top right; the choice is remembered).

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxies /api to localhost:4000)
npm test             # 6 tests; needs NO install (translations, plain-language explanations)
npm run typecheck    # tsc --noEmit
npm run build        # type-check, then production build -> frontend/dist (served by the backend)
```

**What is on the screen**
* **Start screen:** how it works in three steps, example searches, and recently found suspicious websites (from the live feeds).
* **Verdict card (top left):** what you searched, a coloured verdict, one plain sentence, and the reasons ("Why?"). A reminder that this
  is automated and not proof, with the Indian cybercrime helpline (1930) and portal (cybercrime.gov.in).
* **Key facts:** registration date and age, registrar, server address, DNS servers, blocklists, threat reports.
* **What else is connected?** the other websites / wallets / apps in the same group, each with its own verdict, and **why they are
  connected in plain sentences** ("They use the same SSL certificate", "The website asks for payment to this wallet", ...) with a
  Strong / Moderate / Possible badge. Click any item to check it.
* **Connection map (right):** every circle is one item; a line means two items are directly connected. Big circles = websites, wallets and
  apps; small circles = what links them (server, certificate, ...). A coloured ring shows the verdict (red = likely fraud). Hover a circle or a
  line to see in words what it is; the legend on the map explains the colours. Click a circle for details.
* **"Public sources checked"** (collapsible bar): which sources answered; **Technical details** (collapsible): group id, connection strength, latency.

**Marathi / adding a language.** All text is in `src/i18n.ts`. The Marathi table is typed against the English one, so a missing
translation is a compile error, and `npm test` checks that both languages have the same keys and `{placeholders}` and that Marathi is
really Devanagari. To add a language, copy the `mr` table, translate it, and add it to `DICT` and to the switch in `Header.tsx`.
Have a native speaker review the Marathi wording before showing it to clients.

Files: `src/App.tsx` (page + state), `src/api.ts`, `src/types.ts` (re-exports the backend's API types), `src/i18n.ts`, `src/explain.ts`
(evidence -> sentence keys), `src/style.ts` (colours), `src/I18n.tsx` (language context), `src/components/` (`Header`, `Home`, `VerdictCard`,
`FactsCard`, `Connections`, `GraphView`, `NodeDetails`, `LiveStatus`, `TechnicalDetails`).

---

## 10. Research guide: solving the research problem

### 10.1 The problem and research questions
**Problem (from your synopsis):** fraud campaigns run across web, crypto and mobile at once, and operators hide
behind proxies and fragmented hosting, so manual tracking is slow, reactive and fragmented.

Turn that into questions you can answer with data:

* **RQ1 (effectiveness).** Can passive-only indicators from web, crypto and mobile sources be correlated
  automatically to recover fraud campaigns, and with what accuracy?
* **RQ2 (reliability).** What false-positive rate does this correlation have when unrelated assets share common
  infrastructure (CDNs, popular registrars, shared signing keys)?
* **RQ3 (efficiency).** What processing and query latency does the framework achieve?
* **RQ4 (contribution of evidence).** Which evidence types (certificates, trackers, signers, IPs, ...) contribute
  most, and does adding more vectors improve results?

**Hypotheses (examples):** H1: cross-vector evidence recovers more of a campaign than web-only evidence.
H2: the specificity discount and hub cap reduce false positives without large accuracy loss.

### 10.2 Method in one paragraph
Design-science / experimental. Build the artifact (this repo), build a labelled dataset (campaigns with known
members), run the artifact on it, and compare its clusters with the ground truth using pairwise metrics, with
a threshold sweep and an ablation study to answer RQ1-RQ4.

### 10.3 Build the real dataset (this is the most important step)
The synthetic generator is only for development. For the thesis you need **real, historical, de-anonymised
samples** where you *independently* know which assets belong together. Ground truth must **not** come from
your own algorithm.

1. **Find campaigns.** Public threat-intelligence write-ups and academic papers that publish the full set of
   assets for a campaign (domains + wallet addresses + APK hashes). Examples of sources to check (verify access
   and terms yourself): PhishTank/OpenPhish feeds for phishing URLs, public scam-report databases for wallet
   addresses, the AndroZoo research repository (access by request) for APK samples, and vendor/academic reports
   such as those cited in 10.7.
2. **Label.** For each asset, record the campaign label from the *report*, not from infrastructure overlap.
   Keep unrelated assets too (negatives): the false-positive rate needs them.
3. **Convert** to the format `evaluate.ts` reads (also usable with `npm run import`):
   ```json
   {
     "observations": [ { "id": "...", "source": "...", "domain": "...", "...": "..." } ],
     "truth": { "domain:paypa1-login.top": "campaign-A", "wallet:bc1q...": "campaign-A", "apk:<sha256>": "campaign-A" }
   }
   ```
   Truth keys are `<type>:<normalized value>` for assets only (`domain`, `wallet`, `apk`); normalised forms are
   in `src/normalize.ts` (lowercase domains, lowercase hex).
4. **Use passive enrichment** (`npm run lookup -- <indicator>` for each asset, `COLLECTOR_MODE=live`) to fill in certificates, IPs and wallet links for those
   assets, then export them as observations so the evaluation is replayable offline.
5. **Record provenance and dates** (where each sample came from, when). Prefer a temporal split: tune on older
   campaigns, report on newer ones.
6. **Ethics:** handle only public data, do not visit the scam sites, do not install the APKs, store nothing
   about victims (section 13).

### 10.4 Run the evaluation and read the metrics
```bash
cd backend
npm run evaluate                                   # synthetic data (development only)
npm run evaluate -- --dataset=../my-dataset.json   # YOUR data (use this for thesis numbers)
```
Output: `backend/results/evaluation.md` and `.json`.

**Metric definitions** (pairwise, over all asset pairs): a pair is *related* if both assets have the same truth
label, and *linked* if the system put them in the same cluster.

| Synopsis metric | Computed as |
|---|---|
| **Correlation accuracy (%)** | related pairs that were linked / all related pairs (this is recall) |
| Cross-vector accuracy (%) | same, restricted to pairs of *different* asset types (domain-wallet, domain-apk, ...) |
| **False positive rate (%)** | unrelated pairs wrongly linked / all unrelated pairs |
| Precision, F1 | supporting metrics (precision = linked pairs that are truly related) |
| **Processing latency (ms)** | mean / p50 / p95 time to ingest one observation; time to correlate the whole graph; mean / p95 time to answer an investigator query |

Report the whole table, not only the best number, and explain the trade-off the **threshold sweep** shows
(lower threshold = more links found but more false positives).

*Example output on the bundled SYNTHETIC data (seed 42, 521 assets) so you know what to expect, not as results:*

| Metric | Value |
|---|---|
| Correlation accuracy | 69.3% |
| Cross-vector accuracy | 69.5% |
| False positive rate | 0% |
| Precision | 100% |
| Ingest per observation | well under 1 ms |
| Investigator query | about 1 ms |

| threshold | accuracy % | FPR % | precision % |
|---|---|---|---|
| 0.3 | 85.2 | 9.89 | 7.6 |
| 0.5 | 73.8 | 0 | 100 |
| 0.6 | 69.3 | 0 | 100 |
| 0.8 | 44.8 | 0 | 100 |

### 10.5 Experiments that answer the research questions
All of these reuse `evaluate()` in `scripts/evaluate.ts`; edit the `main()` function or call it from a new script.

* **Threshold sweep** (built in): picks the operating point; plot precision vs recall.
* **Ablation** (built in): sets one evidence type's weight to 0 and reports the drop. Answers RQ4.
* **Baselines** to compare against (your contribution must beat something):
  *(a) shared-IP-only*: `evaluate(ds, { weights: { /* all types 0 except ip */ } })`;
  *(b) no hub cap*: `evaluate(ds, { maxHub: 1e9 })`;
  *(c) single vector*: ingest only domain observations and compare with all three vectors (answers H1).
* **Specificity ablation:** set `SPECIFICITY_K` to 0 in `correlate.ts` and re-run (answers H2).
* **Robustness:** re-run with different `--seed` values on synthetic data, or bootstrap-resample your real campaigns,
  and report mean and spread.
* **Scalability:** `node scripts/evaluate.ts --campaigns=400 --noise=1500` and report how latency grows.

### 10.6 Threats to validity (write this chapter honestly)
* **Dataset size and representativeness:** real labelled campaigns are few; say so.
* **Label noise:** published campaign write-ups can be incomplete or wrong.
* **Synthetic data:** only for development; never mix it into reported results.
* **Passive data limits:** CT and passive DNS can be stale or incomplete; hosting hubs create look-alike overlaps.
* **Heuristic weights:** expert-set, so tune only on a separate split.
* **Transitive chaining** in connected components, and wallet-clustering heuristics (CoinJoin) can create wrong links.
* **Cross-vector sparsity:** earlier work found domains and fake apps are only weakly linked, so cross-vector recall may be limited by data, not by the algorithm.

### 10.7 Related work and the gap (verify before citing)
Found in a literature search; confirm authors, years and numbers in the originals before citing:
* *Characterizing Cryptocurrency Exchange Scams* (arXiv 2003.07314, 2020): clusters scam domains and fake apps through shared IPs and blockchain addresses; weak domain-to-app linkage.
* *CtPhishCapture* (NDSS 2026): large-scale detection of wallet-phishing sites and apps; **actively visits** sites and uses LLM-based detection.
* *Dissecting the Infrastructure Used in Web-based Cryptojacking* (arXiv 2408.03426, 2024): measurement study of IPs, registrars, name servers; no correlation tool.
* Practitioner write-ups (Qintel on CT + passive DNS, DomainTools "Inside a Crypto Scam Nexus", Cyble) link web, app and wallet assets **manually**.

**Gap you claim:** academic work either scans actively or only measures; practitioners correlate by hand; no
open framework offers *automated, scored, passive-only* web + crypto + mobile correlation with a reported
accuracy / latency / false-positive evaluation. Check Google Scholar and IEEE Xplore before claiming novelty.

### 10.8 Thesis chapters mapped to this repository
| Chapter | Material |
|---|---|
| 1 Introduction | Section 1, problem statement, RQs (10.1) |
| 2 Literature review | 10.7 plus your own search |
| 3 Methodology | 10.2, 10.3 (dataset), section 7 (passive guarantee), section 13 (ethics) |
| 4 System design | Section 1 diagram, section 3, section 4 (data model), section 8 (algorithm) |
| 5 Implementation | Code walkthrough: `ingest.ts`, `correlate.ts`, `typosquat.ts`, dashboard screenshots |
| 6 Evaluation | 10.4 and 10.5 tables and plots from `results/` |
| 7 Discussion | 10.6, limitations, comparison with related work |
| 8 Conclusion and future work | Section 12 |

### 10.9 Suggested plan
1. **Week 1:** run everything here; read `correlate.ts` until you can explain it without notes.
2. **Week 2:** try live mode on domains you own; fix collector problems.
3. **Weeks 3-4:** collect and label the real dataset (10.3); this takes the longest.
4. **Week 5:** run evaluation, threshold sweep, ablation, baselines.
5. **Week 6:** improve the algorithm only if results show a clear weakness; re-run on a held-out split.
6. **Weeks 7-8:** write chapters 5-7 from the generated tables; screenshots of the dashboard.

### 10.10 Viva questions to prepare
* Why a heuristic and not machine learning? (small labelled data, explainable evidence, auditability; ML is future work)
* How do you know your clusters are right? (independent ground truth, pairwise metrics, ablation)
* How is it passive? (net-guard allow-list, no target contact; show the test)
* What happens with shared hosting / CDNs? (specificity discount, hub cap, FPR results)
* What are the limits? (10.6)

---

## 11. Testing and troubleshooting

`cd backend && npm test` runs 22 tests: Levenshtein, typosquat detector and the ~95-brand list, indicator detection, passive guard
(including redirects), clustering of strong vs weak evidence, hub handling, cross-vector clustering, the investigate
function, the fraud-signal verdict (official brands never flagged, shared platforms capped, linked-to-flagged), the evaluation harness, response parsers, and **live lookups against a mocked internet** (unseeded domain is
fetched, stored and correlated; nothing stored when unknown; Bitcoin co-spending; certstream filtering).

**First-run checklist on your machine (things I could not run):**
1. `cd frontend && npm install && npm run typecheck && npm run dev`, then open the dashboard and search the seeded domain. (The dashboard was never type-checked or built where this was written, so fix any compile error `tsc` reports; most likely spots: the `react-force-graph-2d` callback types in `GraphView.tsx`.)
2. Live sources: `cd backend && npm run lookup -- <a domain you know>` and read the per-source lines (FOUND / empty / FAILED + reason). Fix any FAILED source from its message; check documents in MongoDB Compass.
3. `npm run extract-apk -- file.apk` with a real APK once Android build-tools are installed.

| Problem | Fix |
|---|---|
| Cannot connect to MongoDB | Ensure MongoDB is running (`docker compose up -d` or your local MongoDB service) |
| Dashboard says "Backend not reachable" | start `npm start` in `backend/`; backend must be on port 4000 (or change the proxy in `frontend/vite.config.ts`) |
| Search says "Could not reach any public source" | this computer has no internet / a firewall or proxy blocks it; try `npm run lookup -- example.com` |
| One source chip is red | read its reason (hover); the others still work. Free services rate-limit (HTTP 429): wait and retry, or add `URLSCAN_API_KEY` |
| Search says "No public source returned data" | the indicator is genuinely unknown to them (very new or never reported) |
| Everything lands in one giant cluster | raise `LINK_THRESHOLD` or lower `MAX_HUB_SIZE`; look at `links.evidence` to see which shared node chains them |
| Nothing is linked | lower `LINK_THRESHOLD`; check records actually share infrastructure values after normalisation |
| `Blocked by passive-only guard` | working as designed; only add a host to `config.allowedHosts` if it is a public data source, never a target |
| crt.sh timeouts | normal; retry later (collectors fail soft and just skip that source) |
| `EADDRINUSE` | another process uses the port; change `PORT` |

---

## 12. Roadmap

* More vectors: Ethereum/Tron wallets, phone numbers, Telegram handles, favicon / page-hash (from passive archives).
* Better cluster logic: replace connected components with community detection to avoid chaining; learn weights from labelled data (logistic regression) and compare with the heuristic.
* Temporal analysis: use first-seen dates to track campaign evolution.
* PostgreSQL or a graph database (Neo4j) for large-scale data.
* Docker Compose + CI for deployment and automated tests (a good DevOps extension).
* Export clusters as STIX / CSV for sharing with CERT teams.

---

## 13. Ethics and responsible use

* Use only public, lawfully accessible data. Do not contact, scan, log in to or interact with suspected fraud infrastructure.
* Do not run or install malicious APKs; static metadata only, preferably inside an isolated environment.
* Do not store victim data. Wallet addresses and domains are indicators, not personal data, but treat reports carefully.
* A cluster is a **lead for investigation, not proof** of guilt. Do not publicly accuse individuals based on it.
* Check your institution's research-ethics requirements and each data source's terms of use before collecting data.
* Respect API rate limits (the guard already rate-limits per host).
