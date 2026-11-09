# ENGINEERING.md — Doowon Industrial Identification & Traceability Platform

> **Classification:** SAFE_FOR_DOOWON (sanitized engineering guide for the Doowon repository)
> **Version:** 0.7 · **Date:** 2026-10-07
> **Supplier:** Clavia · **Customer:** Doowon
> **Project type:** Industrial identification, label printing and traceability platform
> **Initial rollout:** 2 production stations / 2 machines
> **Status:** technical discovery pending
> **Language:** Brazilian Portuguese for the user-facing UI and customer communication; English for code, identifiers and technical documentation.

Status vocabulary used in this repository: **CONFIRMED** (explicitly agreed), **OPEN** (not decided), **RECOMMENDED** (engineering recommendation, pending approval), **BLOCKER** (work stops until answered).
Numeric thresholds not yet agreed are tagged **`PROPOSED — PENDING DOOWON VALIDATION`** (value suggested) or **`TBD — PENDING DOOWON DECISION`** (value depends on a decision). They are **not contractual commitments** until validated in writing.

---

## 0. Purpose and priorities

This is the engineering guide for the project: how the work is organized, which rules the code must obey and which quality gates apply. Priorities, in order:

1. **Correctness** — printing a wrong or duplicate label is a production-quality incident.
2. **Traceability** — every label is attributable and reconstructable.
3. **Security** — no exposure of Doowon data, credentials or infrastructure.
4. **Operational clarity** — factory-floor operators may have low digital literacy.
5. **Speed of implementation.**

Also required: reliability when printer, network, agent or cloud service fails; auditability; maintainability by people other than the original developer; professional delivery (source control, reviews, CI/CD, documentation, runbooks, explicit acceptance criteria).

---

## 1. Engineering working rules

### 1.1 Before changing code
For every material task establish: objective; requirement status (CONFIRMED / OPEN / RECOMMENDED / BLOCKER); whether Doowon information or approval is needed; files/components affected; what can fail; which tests prove the change; impact on security, traceability, printing, data or deployment. If a critical requirement is unknown, do not guess: raise it as a question to Doowon.

### 1.2 Never invent customer requirements
If documentation, messages and implementation conflict, stop and flag the conflict.

### 1.3 Dangerous actions need explicit approval
No automatic production deploy from an unreviewed branch; no manual production data changes; no deletion of databases, resources, branches, backups or logs; no credential/IAM rotation without a reviewed plan; no force-push of shared branches; no bypass of CI/security checks; no disabling of authentication, audit logging or TLS; no real production labels during development unless explicitly authorized; **no automatic retry of an uncertain physical print**.
Before a production-impacting action document: action, impact, rollback, validation, required approval.

### 1.4 Secrets
Never commit or print AWS keys, passwords, database credentials, session/JWT secrets, private keys/certificates, tokens, customer API keys or production connection strings. `.env` only locally and git-ignored; provide `.env.example` without values; use AWS Secrets Manager or SSM Parameter Store in AWS. Prefer GitHub Actions → AWS OIDC (temporary credentials) over long-lived keys.

### 1.5 Delivery report
Each meaningful task ends with: what changed; tests run and results; security implications; open items; next step; requests pending to Doowon.

---

## 2. Business context

### 2.1 Problem statement — CONFIRMED
Doowon needs an integrated system for identification and traceability of parts at the output of two production-line machines. Operator flow: authenticate → select machine/station (if D-040 confirms a fixed 1:1 station–machine link, the machine is shown, not selected) → select part/model → visually confirm data → request printing with large quick-action buttons → industrial printer prints → system records traceability and print history → reprints are controlled and audited. The operator interface targets a factory-floor audience; error prevention matters more than functional density.

### 2.2 Initial deployment — CONFIRMED
2 production workstations, 2 computers, 2 monitors, 2 industrial thermal label printers (supplied by Doowon). Printer model **OPEN**. Each station has a **dedicated** printer (Station 01 → Print Agent 01 → Printer 01; Station 02 → Print Agent 02 → Printer 02); printers are not shared between stations (D-018 resolved 2026-10-07; information relayed by Clavia, formal Doowon evidence pending). Application and database hosted in **Doowon's AWS environment**. Architecture must allow future expansion to more machines, operators and parts.

### 2.3 Hardware responsibility — CONFIRMED
Computers, monitors, printers, cables, power/network infrastructure, labels, ribbon and other consumables are supplied and maintained by Doowon. The software side recommends minimum technical requirements, validates compatibility and implements the logical/software integration.

### 2.4 Label — CONFIRMED (final visual homologation OPEN)
Size **30 mm × 20 mm**. Known information: part description (2 letters + 3 numbers, prominent), Part Number, logged-in operator, shift, production date/time, QR Code, unique traceability identifier. Which fields are visible vs. only in the QR is **OPEN** (to be homologated). DPI, media, ribbon, cutter/peeler mode and scanner capability may affect the layout.

**Field list is closed (2026-10-07, E-019):** only the fields above appear on the label. A "Lote de produção" (production lot) shown in an early illustrative prototype is **excluded** until Doowon confirms whether the concept exists and where its value comes from (D-039); it is not a PRINT_JOB. No other field is added without Doowon's confirmation.

### 2.5 Printing actions — CONFIRMED
Operator screen prominently offers `Imprimir 4 etiquetas`, `Imprimir 8 etiquetas`, `Imprimir 32 etiquetas` (changed from 1/10/30 on 2026-11-06 at the customer's request, so that no label of a 4-across row is wasted). No manual quantity typing. In V1 the only quantities are 4, 8 and 32 (E-016): there is **no free-quantity field** in the UI or the API. An arbitrary-quantity option would be a new requirement.

### 2.6 Additional confirmed items and V1 scope boundaries
- **Search** of labels and history by ID, part, Part Number, operator, machine and period; consultation and history remain in V1.
- **Printer availability validation** before the print command, within the capability of the printer model and connection.
- Application logs and print-event history for support and audit; database backup and retention per the agreed policy and the AWS environment.
- Training and documentation; integrated tests, joint homologation with the team Doowon indicates, and production start.
- **Reports:** a basic history report with Excel export was requested (reported 2026-10-22); columns and filters are PROVISIONAL until Doowon validates D-017 (E-020). Search, consultation and history stay.
- **Not in V1 until decided:** print queue, operator-selectable printer, printer sharing between stations, "Lote de produção" (D-039).

---

## 3. Users and permissions

- **ADMIN — CONFIRMED:** login; manage machines, operators, parts/models, shifts; review records; query traceability/history and reprints; access audit information. A basic history report with Excel export is provisional until D-017 is validated. The ADMIN can view the status of both printers but has **no printer CRUD** in V1; printer links and parameters are defined at deployment by Clavia/Doowon IT (E-022).
- **OPERATOR — CONFIRMED:** mandatory authentication; machine/station and part selection (machine is displayed instead if D-040 confirms a fixed 1:1 link); data confirmation; print 4/8/32; clear print status; confirm output; request controlled reprint with reason; minimal navigation. No administrative CRUD.
- **RBAC — REQUIRED:** minimum roles `ADMIN` and `OPERATOR`, enforced on the **server/API**, never only by hiding UI. Additional roles (supervisor, quality, auditor) would be new requirements.

---

## 4. Factory-floor UI principles

Operator UI: large targets, high contrast, few choices per screen, large type, icon + text for critical actions, clear selected state, explicit printer status, strong success/error feedback, one dominant primary action, minimal typing, plain Portuguese, no technical jargon in errors. Avoid nested menus, hidden gestures, tiny links, long tables, ambiguous icons, toast-only critical errors, destructive actions near the print button, color as the only status indicator.
Before printing the operator can verify: operator, machine, part, Part Number, shift (the current shift is shown read-only), printer ready state, quantity.
The printer is **dedicated to the station and is a technical configuration of the station**: the operator sees its status but **never selects** it (E-017, E-021, E-006); the destination is derived on the server. If the station's printer already has an active PRINT_JOB, the new command is blocked **before any PRINT_JOB is created**, with the clear message "Impressora em uso" (E-005, E-018). There is no print-queue screen in V1. The OPERATOR sees only the status of the printer of the own station; the ADMIN sees both (E-023, enforced on the server). The Print Agent version and technical status are shown only to the ADMIN/technical area, never to the OPERATOR. Accidental double-click/duplicate submission is prevented.
Admin UI may be denser but remains clean. Suggested navigation: Dashboard, Máquinas, Operadores, Peças / Modelos, Turnos, Histórico (with a Reimpressões tab/filter, no standalone module), Configurações.
The product name is **OPEN**; the placeholder used in early visuals must not be shipped automatically.

---

## 5. Traceability and printing domain model — critical

Official model (approved 2026-10-06): `PRINT_JOB → LABEL → PRINT_ATTEMPT`. Full detail: `docs/architecture/printing-state-machine.md` (v0.4).

### 5.1 PRINT_JOB × LABEL × PRINT_ATTEMPT
- **`PRINT_JOB`** = one operator print request (kind `ORIGINAL`, `RETRY` or `REPRINT`). Its status is **derived** from its labels.
- **`LABEL`** = one logical label with its own immutable `label_id` and immutable snapshot.
- **`PRINT_ATTEMPT`** = one physical print attempt of one label (`attempt_no` per label).
- A `PRINT_JOB` of kind `ORIGINAL` with quantity N creates **exactly N LABELs**: a request for **32 labels creates 1 PRINT_JOB and 32 independent LABELs** (32 distinct `label_id`s). `REPRINT`/`RETRY` jobs create new attempts for existing LABELs, not new LABELs. Never 32 indistinguishable records, and never a single record standing for 32 labels.
- **Vocabulary (final):** the three entities are `PRINT_JOB`, `LABEL` and `PRINT_ATTEMPT`. Do not use `PrintBatch`, `PrintJob`, `PrintAttempt` or "batch" as entity names. "Lote de produção" is a possible business attribute (D-039, excluded for now), never the PRINT_JOB. "Lote" appears only when quoting Doowon's own volume statement (D-008).

### 5.2 Snapshot
Each print event preserves an **immutable, by-value snapshot** of the data used to render the label (part description, Part Number, operator, machine/station, shift, timestamps, payload). Later changes to master data never alter past history. Snapshot, attempt and audit tables are append-only for the application role.

### 5.3 Attempt states
`CREATED → QUEUED → CLAIMED → SENDING → PRINTED_CONFIRMED | FAILED | UNKNOWN_OUTCOME`, plus `CANCELLED`. "Not sent" is a derived category (the attempt never reached `SENDING`, or was cancelled before it). Do not use `printed: boolean`.

### 5.4 UNKNOWN_OUTCOME — mandatory rules
A timeout after bytes were sent may mean the label printed. Therefore:
- **No automatic creation or execution of a new attempt for a label whose last attempt is `UNKNOWN_OUTCOME`** (including after restart, lease expiry or redelivery).
- `UNKNOWN_OUTCOME` leaves that state only by **audited human resolution** ("label came out" / "label did not come out").
- Remaining labels of the PRINT_JOB are held (`hold_reason=JOB_HELD`); nothing is sent automatically.
- **Resolution is performed by `ADMIN`** (RECOMMENDED, to be validated with Doowon — D-031). `OPERATOR` can see the state and **request action** (audited `RESOLUTION_REQUESTED`) but cannot resolve; enforced on the API. No third role is introduced without a decision (D-019).

### 5.5 Partial-success example (modelled)
PRINT_JOB of 30: L01–L17 `PRINTED_CONFIRMED` (17 confirmed); L18 `UNKNOWN_OUTCOME` (1); L19–L30 not sent, held (12). 17 + 1 + 12 = 30. PRINT_JOB is `REQUIRES_REVIEW`. The operator sees the three groups and requests action; the ADMIN resolves L18 by physical check, then continues or cancels the remaining 12.

### 5.6 Reprint
A reprint keeps the same logical `label_id` and payload and creates a new `PRINT_ATTEMPT` within a PRINT_JOB of kind `REPRINT`. It requires reason, actor and timestamp; previous attempts are never altered or erased. Same-ID-on-reprint is **RECOMMENDED**; a new ID would be an ADR-level change (D-011).

### 5.8 Integrity, versioning and traceability fields
- **Template versioning (E-008):** every label template has `template_id` and an immutable `template_version`; the snapshot records both.
- **QR schema versioning (D-036):** the QR carries a schema version, also stored in the snapshot; compatibility policy is OPEN.
- **`payload_hash` (E-009):** hash of the canonical payload stored on LABEL and PRINT_ATTEMPT for integrity and reproduction.
- **`correlation_id` (E-010):** generated at the browser request and propagated through API, PRINT_JOB, LABEL, PRINT_ATTEMPT, agent, audit and logs.
- **Append-only audit (E-013):** audit events, snapshots, attempts and dispatch records are insert-only; corrections are new events.
- **Master-data deactivation (E-014):** machines, operators, parts, shifts, printers and stations with history are deactivated, never deleted.

### 5.7 Core entities (to evaluate)
`User`, `Role`, `Machine`, `Station`, `Part`, `Shift`, `Printer`, `PrinterCapability`, operation context, `PRINT_JOB`, `LABEL`, `PRINT_ATTEMPT`, `DispatchRecord`, `ReprintReason`, `AuditEvent`, `SystemSetting`. Normalized identifiers and foreign keys.

---

## 6. Idempotency and duplicate prevention — critical

Operators may double-click, browsers retry, networks reconnect, PRINT_ATTEMPTs may be redelivered.
- Every print command carries a client-generated idempotency key, **bound to a fingerprint of the request**; reuse with a different fingerprint is rejected.
- Server flow: validate actor/session → validate part/machine/printer → check key → if already accepted, return the existing PRINT_JOB → otherwise create PRINT_JOB and LABELs transactionally → enqueue → return the authoritative PRINT_JOB id.
- **V1 rule (E-005; D-037 closed 2026-10-07):** only **one active (non-terminal) PRINT_JOB per printer**, and the printer is the station's own. While one is active, new print commands from that station are blocked with the message **"Impressora em uso"** and **no PRINT_JOB, LABEL or PRINT_ATTEMPT is created**. The check is enforced on the server, atomically with creation; the rejection is logged/audited (not a PRINT_JOB). A resubmission with the same idempotency key and fingerprint returns the existing PRINT_JOB. No queue. A block at one station never affects the other.
- The UI disables the action after submission, but **server-side idempotency is mandatory**.
- **Printer queue and concurrency (D-037, NOT APPLICABLE / CLOSED for V1):** each station has a dedicated printer, so there is no contention between stations. Queueing and shared printers are outside V1 and would follow the scope-change procedure.
- **Session and operator switch (D-038, OPEN):** each PRINT_JOB and LABEL records the operator authenticated at request time; an operator switch never changes the attribution of existing PRINT_JOBs; inactivity lock, shared PCs and shift-change rules are to be decided.
- The Print Agent claims work atomically (lease/lock). Multiple agents or restarts must not process the same attempt concurrently. Lease recovery must respect §5.4.
- **Ack before byte:** the agent sends bytes to the printer only after the server acknowledges the transition to `SENDING`.

---

## 7. Architecture (recommended; final topology OPEN)

```text
Operator/Admin Browser
        | HTTPS/TLS
        v
Doowon AWS Application (Web UI, API, Auth/RBAC, PostgreSQL, Audit/Logs)
        | outbound HTTPS, polling model for PRINT_ATTEMPT dispatch (preferred)
        v
Local Print Agent (production station)
        | local USB/TCP according to printer
        v
Industrial Printer (model TBD)
```

- **Local Print Agent** (RECOMMENDED, D-020): no reliance on the browser print dialog; runs on the workstation; talks to the cloud securely; translates a normalized label model into the printer language; reports status/failures; versioned and releasable independently.
- **Outbound HTTPS from the agent** is preferred over inbound access from AWS (firewall posture, attack surface). To be validated with Doowon network/security.
- **Station → Print Agent → printer binding (D-018, RESOLVED):** Station 01 → Print Agent 01 → Printer 01; Station 02 → Print Agent 02 → Printer 02, derived on the server from the authenticated station; the browser never supplies the target printer (E-006, E-021). The **station → machine** binding (fixed or selectable) is **OPEN** (D-040); the Clavia recommendation is a fixed 1:1 link (Station 01 → Machine 01; Station 02 → Machine 02), in which case the machine dropdown is removed from the operator UI.
- **Agent identity (D-027, RECOMMENDED):** per-station identity; one-time enrollment token; mTLS or short-lived signed token; server-side binding credential → station → printer; revocation supported.
- **Heartbeat and version (E-011):** authenticated periodic heartbeat carrying `agent_version` and `protocol_version`; missing heartbeat raises an alert and blocks new claims.
- **Agent ↔ backend compatibility (E-012):** the backend publishes the supported version range; an agent outside it cannot claim attempts.
- **Controlled agent update and rollback (E-015):** no update while a PRINT_JOB is active or an `UNKNOWN_OUTCOME` is open; the previous signed version is kept; rollback is rehearsed on both stations; mechanism and window are OPEN (D-028, D-029, D-032).
- **Network loss:** default is to **fail closed for new traceable prints** (D-012, RECOMMENDED). No offline printing or cached ID generation unless explicitly required and designed.
- **Restart recovery:** the agent keeps a local journal ("ack received" → "about to send" → send). After restart the reaper marks in-flight attempts `UNKNOWN_OUTCOME` as needed and **never creates new attempts**.

---

## 8. Printer abstraction — model not defined

Do not couple the core domain to any vendor or language. Use an adapter interface:

```ts
interface PrinterAdapter {
  validateCapabilities(config: PrinterConfig): Promise<CapabilityResult>;
  render(label: LabelPayload, context: RenderContext): Promise<PrinterCommand>;
  send(command: PrinterCommand, connection: PrinterConnection): Promise<SendResult>;
  getStatus?(): Promise<PrinterStatus>;
}
```

Implement only the adapter(s) required by the selected printer; no speculative protocols. Printer discovery information needed: manufacturer; exact model; DPI; print language(s); USB/Ethernet/Wi-Fi; IP addressing; driver/SDK/documentation; cutter/peeler/rewinder; media sensor; supported label sizes; ribbon/media specification; expected duty cycle/volume; whether status can be queried; availability of a test printer.
Label dimensions: `dots = mm × dpi / 25.4`; never hardcode dot sizes independent of DPI. The QR must respect minimum module size and quiet zone and be **physically scan-tested** on real 30×20 mm media.

---

## 9. Technology baseline (RECOMMENDED, pending Doowon standards)

TypeScript end-to-end where practical; React / Next.js; Node.js with NestJS (or another framework approved by ADR); PostgreSQL; Prisma or equivalent with versioned migrations; Print Agent as a Node.js/TypeScript service packaged for the workstation OS (managed Windows service where applicable); Terraform or AWS CDK; Docker for server components; GitHub Actions; AWS-native observability (e.g., CloudWatch). Prefer well-supported technology over novelty. Do not scaffold the final production architecture before discovery if Doowon has mandatory standards. Prefer a modular monolith plus an independent Print Agent; no microservices, Kafka, Kubernetes or event sourcing without a confirmed requirement.

---

## 10. Repository and source control

- **Preferred:** private repository in the Doowon GitHub organization from the start, with access granted to the supplier. Fallback (only if not available at start): private supplier repository, never public, full history preserved and transferred later.
- Suggested layout: `apps/{web,api,print-agent}`, `packages/{shared,ui,printer-contracts}`, `infrastructure/`, `docs/{adr,runbooks,security,uat}`, `tests/`, `.github/workflows/`, `.env.example`, `docker-compose.yml`, `README.md`, `ENGINEERING.md`.
- Branches (until Doowon provides a standard): `main` (released), `develop` (homologation), `feature/*`, `hotfix/*`. Flow: `feature/*` → PR → `develop` → HML → release approval → PR `develop` → `main` → PROD. No direct push to `main`.
- Protections where supported: PR required, CI passing, no force push, up-to-date branch, review/approval per team model.

---

## 11. Local development

Small vertical slices committed continuously. Cycle: sync → feature branch → implement → lint/typecheck/tests/security checks → review diff → commit → push → PR → CI → merge → deploy to HML. Use local/synthetic data only; never copy the production database to a developer machine. Local services: app components, PostgreSQL via Docker, simulator printer adapter, seeded data.
Developer workstation baseline: disk encryption, strong login, screen lock, OS updates, MFA for GitHub and AWS, keys managed securely, no project source in public-sync folders, no real secrets in shell history or notes.

---

## 12. CI/CD quality gates

Each PR runs: install with lockfile; format check; lint; typecheck; unit tests; integration tests where feasible; build; dependency vulnerability scan; secret scanning; SAST if available. Recommended: Dependabot, secret scanning, CodeQL, protected environments, OIDC to AWS.
Environments: `LOCAL`, `HML`, `PROD`, with separate databases and configuration; HML never points at the production database. Merge to `develop` → deploy HML; approved merge to `main` → controlled PROD deploy with rollback to the previous version.

---

## 13. AWS security and infrastructure

Account, region, VPC pattern and approved services are **OPEN** and must be confirmed by Doowon before provisioning: account/environment; region; VPC/subnets; public vs private vs VPN access; allowed compute standard; approved database service; DNS/domain/certificates; logging/SIEM; backup policy; IAM provisioning process; tags/cost center; security review and change process.
Default posture where architecture permits: TLS only; encrypted storage; database not publicly reachable; least-privilege security groups and IAM; no shared admin credentials; secrets in Secrets Manager/SSM; centralized logs; automated backup; explicit retention; separate HML/PROD secrets. Infrastructure as Code (Terraform or CDK); no undocumented manual production changes.

---

## 14. Authentication and application security

Local user/password authentication is the contracted baseline and is enough to start local development. Basic application authentication is in scope; SSO/AD is **not part of the confirmed scope** and, if mandatory by Doowon security policy, must be raised immediately: record the technical and scope impact (change control) before replacing the baseline.
Local authentication: Argon2id (or approved strong alternative); password policy agreed with Doowon; secure sessions (HttpOnly + Secure cookies, SameSite, CSRF where needed); session expiry; login rate limiting; account disable; no reversible passwords; no unnecessary username disclosure.
Web/API hardening: server-side schema validation; parameterized DB access; output encoding; strict CORS allowlist; secure headers; request size limits; rate limits on sensitive endpoints; authorization on every privileged endpoint; no sensitive data in URLs; safe error messages; correlation IDs; lockfiles; no `eval` of untrusted input; uploads disabled unless required. OWASP guidance as baseline.

---

## 15. Logging, audit and privacy

Logs are for diagnostics. Log: correlation/request ID, application version, environment, event type, actor ID where appropriate, station/machine ID, PRINT_JOB/LABEL/attempt IDs, structured error category, latency/status. Never log passwords, session tokens, secrets, full auth headers or unnecessary personal data.
Audit events cover: logins (per policy); user/operator/machine/part/shift changes; PRINT_JOB requested; LABEL IDs created; attempt outcomes; `UNKNOWN_OUTCOME` resolutions; reprint requested with reason; privileged configuration changes. Audit records are append-oriented and hard to alter through normal workflows.
Audit action names are normalized technical identifiers internally; the UI shows friendly Portuguese names.
LGPD: operator identity is personal data; store only what traceability requires. Doowon confirms retention period, display of names/IDs in reports, access controls for history and corporate LGPD requirements.

---

## 16. Database and migrations

Versioned migrations in Git, reviewed and tested in HML; rollback or roll-forward strategy; no destructive drop without plan and backup; indexes for traceability searches; expand/contract pattern so rolling back the application does not require rolling back the database.
Time: timestamps in UTC; rendered in the agreed local timezone (**OPEN**, likely `America/Sao_Paulo`, not to be assumed silently). The **server is the authoritative time source** for business events; the agent clock is informative and drift is reported (D-030, RECOMMENDED). Shift calculation must handle overnight shifts (e.g., 22:00 → 06:00).

---

## 17. Backup, recovery, continuity

Requirements are **OPEN**: RPO, RTO, frequency, retention, point-in-time recovery, restore-test requirement, backup owner. Baseline if no stricter policy: managed automated backups; PITR where available; retention agreed before PROD; **at least one restore test before go-live** with recorded evidence (D-034); infrastructure reproducible via IaC. A backup never restore-tested is not a recovery plan.

---

## 18. Performance and capacity

SLA is **OPEN**. Engineering targets are defined in `docs/quality/acceptance-criteria.md` and are all `PROPOSED — PENDING DOOWON VALIDATION` until agreed. Principles: responsive screens; quick acknowledgment of print requests; prompt agent pickup; two stations operating concurrently with no cross-routing; indexed, paginated history; no unbounded list endpoints; no N+1 on core screens.
**Operational volume (BLOCKER for capacity sign-off):** "approximately 1,300 to 1,500 labels per operational demand" is ambiguous (per shift/day? per production lot? one burst? peak labels/minute?) and must be clarified (D-008). Load tests must reflect the confirmed interpretation.

---

## 19. Testing strategy

- **Unit:** ID generation/format; shift determination; permissions; quantity validation; idempotency; payload construction; reprint rules; state transitions and invariants (INV-1…INV-10); adapter rendering. Coverage is a supporting metric; critical domain modules need very high branch coverage (project-level target `PROPOSED — PENDING DOOWON VALIDATION`).
- **Integration:** API + database; transactions; migrations; auth/RBAC; PRINT_JOB/LABEL creation; agent claiming; audit events; retry/error behavior.
- **E2E (simulated printer):** admin setup; operator login; machine and part selection; print 4/8/32; traceability search; controlled reprint.
- **Printer simulator:** accepts normalized print requests (PRINT_ATTEMPT payloads); stores rendered output; simulates success, failure, timeout and `UNKNOWN_OUTCOME`; no labels consumed.
- **Physical printer matrix (after printer selection):** 4/8/32 labels; confirmed volume; QR scan on real 30×20 mm media; smallest readable text; start/stop/restart; offline; out of media; out of ribbon (where applicable); printer error; USB/network disconnect; agent restart mid-PRINT_JOB; workstation restart; browser double-click and refresh; API timeout; **two stations concurrently**; wrong-station routing prevention; shift transition; reprint with reason; uncertain-outcome handling (including the 17/1/12 case).
- **Security:** admin API denied to operators; inactive user cannot log in; IDOR/BOLA on label/history IDs; injection tests; login abuse/rate limits; session expiry; secret scan; dependency scan; security headers/TLS.

---

## 20. Definition of Done

Requirement linked to confirmed scope/decision; implementation reviewed; formatted/linted; typecheck passes; unit/integration tests pass; security reviewed; audit/logging where needed; understandable user errors; diagnostic logs for technical errors; migration included if needed; documentation updated; HML verified; no secrets, TODO hacks or debug endpoints; acceptance criteria passed. Critical printing changes additionally require simulator and, once available, physical printer tests.

---

## 21. Error handling

Operator messages are short and actionable, e.g. `Impressora indisponível. Verifique o equipamento e tente novamente.` / `Não foi possível confirmar a impressão. Não imprima novamente até verificar a etiqueta.` / `Sua sessão expirou. Entre novamente para continuar.` Never expose stack traces, SQL errors, unnecessary AWS resource names, tokens or raw network exceptions. Every critical error carries correlation ID, PRINT_JOB/LABEL/attempt IDs, station ID, structured category, timestamp, application/agent version.

---

## 22. Versioning and releases

Semantic Versioning (`1.0.0` first production release, etc.); tagged production releases; changelog/release notes; the Print Agent reports its version; no ad-hoc file names such as `final-v2-new.exe`. **Agent distribution/update (D-028), executable signing (D-029) and SBOM/dependencies (D-033)** are decisions to be agreed; SBOM generated in CI per release and archived (recommended).

---

## 23. Rollback

Before each production release define: prior version/image; database migration compatibility; rollback vs roll-forward; agent rollback procedure; who authorizes rollback; smoke tests after rollback. No irreversible destructive migration in the same step as an application deploy (D-032, RECOMMENDED).

---

## 24. Technical Discovery

A 60–90 minute Technical Discovery with Doowon IT/security/infrastructure precedes full implementation. Topics: GitHub/source control; AWS; identity/security; workstations; printer (§8); master data; traceability (QR payload, visible fields, reprint authorization and reasons, reports); volume/SLA (§18, behavior without network/AWS, RPO/RTO). Answers are classified CONFIRMED / OPEN / BLOCKER and recorded in `docs/decisions/decision-log.md`; architecture-impacting decisions become ADRs. See `docs/discovery/technical-discovery-agenda.md` and `docs/discovery/customer-preread.md`.

---

## 25. Delivery phases (outline)

0 pre-kickoff and dependency checklist · 1 technical discovery · 2 repository and local foundation (simulator, CI) · 3 AWS HML foundation (after Doowon architecture approval) · 4 core functionality in vertical slices · 5 printer integration (only after the printer is defined) · 6 HML/UAT · 7 production readiness review · 8 go-live · 9 post-go-live stabilization.
Dates depend on the release of dependencies by Doowon (D-026) and are not defined here. Do not promise a printer-specific implementation before printer selection.

---

## 26. Acceptance / UAT baseline

Agreed with Doowon in `docs/quality/uat-plan.md` and `docs/quality/acceptance-criteria.md`. Baseline: admin management and access control; operator flow with 4/8/32 labels producing **1 PRINT_JOB and N independent LABELs**; double-click does not duplicate the PRINT_JOB; clear success/failure state; per-label traceability (ID, part, PN snapshot, operator, machine/station, shift, timestamp, originating PRINT_JOB, attempts/reprints, reprint reason); reprint requires reason and preserves history; offline printer never produces a false `PRINTED_CONFIRMED`; uncertain outcome handled safely without blind duplication.

---

## 27. Scope-change procedure

For a request that is not clearly in the confirmed scope: do not implement immediately; describe the request; identify affected components; estimate technical, schedule and security impact; classify (clarification, defect, minor in-scope adjustment, scope change); obtain written approval before any material scope expansion. Items **not** in the confirmed scope unless formalized: ERP/MES integration; SSO/AD/Entra ID; PLC integration; scanner/collector integration as part of the solution; third-party integrations; new machines, stations or modules; free-form label quantity; offline printing.

---

## 28. Open decisions (summary; authoritative list in `docs/decisions/decision-log.md`)

D-001 repository ownership · D-002/003/004 AWS account, topology, compute/database · D-005 local auth vs SSO · D-006 workstation OS/policy · **D-007 printer (BLOCKER)** · **D-008 volume meaning (BLOCKER)** · D-009 QR payload · D-010 visible fields · D-011 reprint ID semantics · D-012 offline/network-loss policy · D-013 timezone · D-014 backup RPO/RTO · D-015 log/audit retention · D-016 product name · D-017 reports/export · ~~D-018~~ RESOLVED station→printer binding (dedicated printer per station) · **D-040 station→machine binding (recommended: fixed 1:1)** · D-019 reprint authorization/roles · D-020 print architecture · D-021…D-026 identity, retention, master data, shifts, schedule · D-027…D-034 agent auth, distribution, signing, clock, partial PRINT_JOB, rollback, SBOM, restore test · **D-035 Production Readiness Gates A/B/C** · **D-036 QR schema versioning** · ~~D-037~~ CLOSED for V1 (not applicable: no shared printers) · **D-038 session and operator switch** · **D-039 "Lote de produção" (provisionally excluded from label and flows)**.

---

## 29. Documentation required before handover

`README.md`; this guide; architecture document/diagram; ADRs; API documentation where useful; migration history; Print Agent install/update guide; environment and deployment guide; security configuration notes; backup/restore notes; operational runbook; UAT script and evidence; troubleshooting guide; release notes; ownership/contact handover notes. Delivery is not complete with code alone.

---

## 30. Production readiness checklist

Go-live is not recommended until every applicable item is YES or N/A.

### 30.0 Production Readiness Gates A, B and C — D-035
Three distinct gates; an earlier gate never replaces a later one. No criterion below has been approved by Doowon: all are `PROPOSED — PENDING DOOWON VALIDATION` or `TBD — PENDING DOOWON DECISION`. Details in `docs/architecture/printing-reliability.md` §10.

- **GATE A — Ready to Develop Locally:** Doowon's mandatory architectural constraints known well enough not to build an incompatible solution (technology, licences, containers, network/security constraints that affect the architecture); repository defined (D-001) or temporary alternative approved in writing; model and invariants accepted; confirmed requirements recorded and traced. AWS account/region/topology need **not** be provisioned: D-002 to D-004 are required before closing and deploying the AWS architecture, not for local development. D-005 is not an absolute blocker: local user/password authentication is the contracted baseline. Printer-specific code stays blocked until D-007.
- **GATE B — physical integration with a representative printer:** the selected printer (D-007) or a representative one agreed in writing; documentation, test unit, 30×20 mm media and ribbon where applicable; 4/8/32 labels, QR read, smallest legible text and an agreed subset of the physical matrix; one station is enough. Does not replace GATE C.
- **GATE C — Production Readiness with the two final stations (mandatory, no exception; PRG-01 / GL-00):**
> **Nenhum go-live poderá ocorrer sem homologação física da impressora selecionada, mídia real e ribbon quando aplicável, utilizando os dois postos em condições representativas de produção.**

(Ribbon "when applicable": direct-thermal printers have no ribbon; that fact is recorded in writing in the homologation report. Duration, volume and numeric criteria are `TBD — PENDING DOOWON DECISION`.)

### 30.1 Checklist
- **Governance:** release approved by Doowon; repository ownership/access correct; no unreviewed changes on `main`; BLOCKER decisions resolved.
- **Security:** no secrets in Git history; MFA/access policy; least-privilege IAM reviewed; TLS; production database not publicly exposed unless approved; authentication/RBAC tests pass; scans acceptable; logs free of secrets.
- **Data:** production migrations tested in HML; backup configured; restore/recovery documented and restore-tested; retention and timezone agreed.
- **Printing:** printer model/DPI/protocol documented; 30×20 mm label physically homologated on real media; QR physically scanned; 4/8/32 tests passed (1 PRINT_JOB each, N LABELs); confirmed-volume test passed; double-click/idempotency passed; printer-offline passed; `UNKNOWN_OUTCOME` handling tested (including 17/1/12); both stations concurrent and correctly routed.
- **Operations:** agent version known per station; startup/restart verified; monitoring available; runbook ready; support contacts defined; rollback ready.
- **Acceptance:** admin UAT passed; operator UAT with real or representative users; formal Doowon acceptance for go-live.

---

## 31. Principle to remember

The most dangerous failure is not a visual bug. It is a system that **looks successful while producing the wrong label, a duplicate label, a wrong traceability record or a false confirmation of printing.**

> **Correctness > traceability > security > operational clarity > speed of implementation.**
