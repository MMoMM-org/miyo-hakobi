---
title: "Debug logging switch and quiet default console output"
status: draft
version: "1.0"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (not assumptions)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| specId | string | Yes | Spec identifier (NNN-name format) |
| title | string | Yes | Feature title |
| status | enum: `DRAFT`, `IN_REVIEW`, `COMPLETE` | Yes | Document readiness |
| sections | SectionStatus[] | Yes | Status of each PRD section |
| clarificationsRemaining | number | Yes | Count of `[NEEDS CLARIFICATION]` markers |
| acceptanceCriteria | number | Yes | Total testable acceptance criteria defined |
| openQuestions | string[] | No | Unresolved items requiring stakeholder input |

### SectionStatus

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Section name |
| status | enum: `COMPLETE`, `NEEDS_CLARIFICATION`, `IN_PROGRESS` | Yes | Current state |
| detail | string | No | What clarification is needed or what's in progress |

---

## Product Overview

### Vision
Hakobi's developer console stays quiet during normal operation and gives a once-a-day health summary. A single switch turns on full per-run detail when someone needs to diagnose a problem.

### Problem Statement
Every run of every rule writes a "tick begin" line and a "tick end" (or "tick skip") line to the developer console. This happens for timer runs, manual "Run now" runs and command-palette runs alike (GitHub issue #18). A user with 5 rules on a 5-minute interval therefore gets about 2,900 Hakobi lines per day. The lines that actually matter are buried among them: plugin load, configuration load and genuine failures. There is also no way to turn the per-run detail on or off. It is always emitted, so users debugging another plugin have to filter Hakobi out, and Hakobi users cannot see at a glance whether the ferry did anything useful over a day.

A second problem is privacy. The per-run lines print the user-chosen rule name in clear text on every run. Hakobi's privacy documentation (PRIVACY.md) warns that rule names can describe sensitive folder structures, yet it does not mention the console at all.

### Value Proposition
- **Quiet by default:** the console shows only what a user needs to know without asking: that Hakobi loaded, what went wrong, and one daily summary of what the ferry did.
- **Detail on demand:** one switch, placed and worded like the existing debug switch in MiYo Kado, so users of both plugins already know it.
- **Privacy-aware:** rule names show up in routine output only after the user has turned on debug logging.

## User Personas

### Primary Persona: Everyday ferry user
- **Demographics:** Obsidian desktop user, any age. Technical comfort ranges from moderate (sets up rules in the settings tab) to high (opens the developer console now and then). Has one or more import or export rules on a schedule.
- **Goals:** Trust that the ferry is working without watching it. Occasionally confirm, in a single glance, that files actually moved.
- **Pain Points:** The console is flooded with per-run lines that say nothing new. There is no compact answer to "did anything happen today?". Rule names show up in a log the user never asked for.

### Secondary Personas

#### Diagnosing user / maintainer
- **Demographics:** A Hakobi user with a problem who is preparing a bug report, or the plugin maintainer reproducing one. Highly technical and comfortable with developer-console log levels.
- **Goals:** See exactly which rule ran, when, and with what result, for the duration of an investigation, then go back to quiet output.
- **Pain Points:** Today the detail cannot be turned off afterwards. The troubleshooting docs point to `[Hakobi]` lines without explaining that they only appear at the console's "Verbose" level.

## User Journey Maps

### Primary User Journey: Quiet operation with a daily check
1. **Awareness:** The user opens the developer console, for example while working on another plugin, and finds it dominated by Hakobi lines.
2. **Consideration:** They look for a way to reduce the noise and find the debug logging switch in Hakobi's General settings, off by default.
3. **Adoption:** After updating, no further action is needed. Per-run lines are gone while the switch is off.
4. **Usage:** Once a day the console shows one Hakobi summary line with how many runs happened and how many files were copied, skipped or failed. Load lines and genuine failures still appear.
5. **Retention:** The console stays readable, and the summary line becomes the habitual "is it working?" check.

### Secondary User Journeys

#### Diagnosing a problem
1. **Awareness:** A rule seems not to run, or files go missing. The status bar shows a failure, or the daily summary reports failed runs.
2. **Consideration:** The user reads the troubleshooting or debug-logging docs. They learn to turn on the switch and set the console to "Verbose".
3. **Adoption:** They turn on debug logging in General settings. It takes effect immediately, without reloading the plugin.
4. **Usage:** They reproduce the problem with "Run now" or by waiting for a timer run, watch the per-run lines with rule names and results, and copy the relevant lines into a bug report.
5. **Retention:** They turn the switch off again, and the console immediately returns to quiet output.

## Feature Requirements

### Must Have Features

#### Feature 1: Debug logging switch
- **User Story:** As a diagnosing user, I want one switch in Hakobi's settings that turns detailed console logging on and off, so that I get per-run detail only while I am investigating.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a fresh install or an existing install without the setting, When the user opens General settings, Then a "Debug logging" switch appears under a "Developer" heading and is off
  - [ ] Given the switch is off, When the user turns it on, Then the next run writes per-run detail to the console without a plugin reload
  - [ ] Given the switch is on, When the user turns it off, Then subsequent runs write no per-run detail, and runs already in progress may still finish their detail lines
  - [ ] Given the user changed the switch, When Obsidian restarts, Then the switch keeps the value the user last set
  - [ ] Given Obsidian Sync replicates plugin settings, When the switch is changed on one device, Then it takes the same value on the user's other devices after sync (same behaviour as every other General setting)
  - [ ] Given the switch's description, When the user reads it, Then it says the switch is off by default and that the messages only appear at the developer console's "Verbose" log level

#### Feature 2: Quiet default console output
- **User Story:** As an everyday ferry user, I want the console to show only Hakobi's load events, its warnings and errors, and the daily summary by default, so that the console stays readable.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given debug logging is off, When any rule run starts, ends or is skipped for overlap (timer, "Run now" or command), Then no line is written to the console for that run
  - [ ] Given debug logging is off, When the plugin loads, Then the load events still appear: plugin loading (with version), configuration loaded (number of rules, number enabled on this device), the initial run's start and end, and plugin loaded
  - [ ] Given debug logging is off, When the plugin unloads, Then the "plugin unloading" event still appears
  - [ ] Given debug logging is off, When a run fails or an unexpected error occurs, Then the failure is still written to the console as a warning or error
  - [ ] Given debug logging is on, When a rule run starts, ends or is skipped for overlap, Then a line naming the rule, its direction and its result appears, as it does today
  - [ ] Given any switch state, When Hakobi writes load events or the daily summary, Then they use the developer console's debug level, so they are hidden unless "Verbose" is enabled, while warnings and errors stay visible without "Verbose"

#### Feature 3: Daily activity summary
- **User Story:** As an everyday ferry user, I want one console line per day that sums up what the ferry did, so that I can confirm it is working without reading per-run detail.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the plugin has been loaded for 24 hours, When the 24-hour mark passes, Then exactly one summary line appears covering all rules together
  - [ ] Given runs happened during the period, When the summary line is written, Then it reports: completed runs, failed runs, overlap skips, and files copied, skipped and failed
  - [ ] Given dry runs happened during the period, When the summary line is written, Then dry runs are reported as their own count, and their would-be file results are not added to the copied, skipped or failed numbers
  - [ ] Given no runs happened during the period, When the 24-hour mark passes, Then a summary line with all counts at zero still appears, which shows the plugin is alive
  - [ ] Given a summary line was written, When the next period starts, Then its counts start again from zero
  - [ ] Given any switch state, When the summary line is written, Then it contains no rule names or file paths
  - [ ] Given Obsidian is reloaded or closed before the 24-hour mark, When the plugin loads again, Then counting restarts from zero, and the activity of the interrupted period is not reported

#### Feature 4: Privacy rules for console output
- **User Story:** As an everyday ferry user, I want my rule names kept out of Hakobi's routine console output unless I asked for debug detail, so that a console screenshot or log shared for another reason does not reveal how my folders are organised.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given debug logging is off, When Hakobi writes load events or the daily summary, Then no rule name, file name or path appears in them
  - [ ] Given a run fails, When the failure is written to the console, Then it names the failing rule and keeps the underlying error message verbatim, because both are needed to act on it, in any switch state
  - [ ] Given debug logging is on, When per-run lines are written, Then they may contain rule names, but never note content, frontmatter values or file contents
  - [ ] Given the user reads PRIVACY.md, When they look for the developer console, Then a section explains what Hakobi writes there in each switch state, including that error messages may contain filesystem paths

### Should Have Features

#### Feature 5: User documentation for debug logging
- **User Story:** As a diagnosing user, I want the docs to explain how to turn on debug logging and see its output, so that I can capture useful detail for a bug report without guessing.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the docs, When the user looks for debug logging, Then a dedicated page explains the switch, the console's "Verbose" level, which lines appear in each switch state (with examples), and how to turn it off again
  - [ ] Given the troubleshooting guide's console step, When the user follows it, Then it mentions the "Verbose" level and the switch, and gives the correct shortcut for each OS (macOS: Cmd+Option+I; Windows/Linux: Ctrl+Shift+I)
  - [ ] Given the configuration reference, When the user looks up General settings, Then the debug logging switch is listed with its default

### Could Have Features

- **Summary on unload:** when the plugin unloads before the 24-hour mark, write the summary for the partial period instead of dropping it.

### Won't Have (This Phase)

- A summary entry in the audit log. The audit log stays a closed, per-run allowlist (requirements of spec 001, F5; PRIVACY.md).
- Keeping counts across reloads or restarts.
- Per-rule summary lines.
- Automatic switch-off after a time limit or on restart.
- A status-bar indicator for debug mode.
- More than two verbosity states (for example a separate "trace" level).
- Removing paths from error messages.
- Routine lines at the console's warning level just to make them visible without "Verbose".
- A device-local (non-synced) switch.

## Detailed Feature Specifications

### Feature: Daily activity summary
**Description:** The plugin keeps running counts in memory from the moment it loads. Every 24 hours it writes one aggregate line to the console at the debug level and then resets the counts. The line is written whatever the debug logging switch is set to, because it is part of the quiet default output.

**User Flow:**
1. User leaves Obsidian running with Hakobi rules enabled.
2. System counts every run outcome, whether the run was started by the timer, by "Run now" or by a command.
3. At 24 hours after plugin load, and every 24 hours after that, the system writes one summary line and starts a new count.
4. User, with the console at "Verbose", sees the line and reads the day's totals.

**Business Rules:**
- Rule 1: A period starts when the plugin loads and ends exactly 24 hours later, then repeats. It is not aligned to calendar days or midnight.
- Rule 2: Every run that ends normally counts as one completed run, and its files add to the copied, skipped and failed totals.
- Rule 3: Every run that ends with an unexpected failure counts as one failed run. It adds no file totals, because none are available.
- Rule 4: Every run skipped because the same rule is still running counts as one overlap skip.
- Rule 5: Dry runs count only toward a separate dry-run count. Their would-be results never enter the file totals.
- Rule 6: The initial run on plugin start counts like any other run.
- Rule 7: Timers that do not fire because the rule is disabled on this device produce no run and are not counted.
- Rule 8: The summary line never names a rule, file or path.

**Edge Cases:**
- Scenario 1: The computer sleeps across the 24-hour mark. → Expected: one summary line when the plugin resumes, never a burst of catch-up lines (consistent with Hakobi's no-catch-up timer behaviour).
- Scenario 2: Rules are added, edited or removed during the period. → Expected: counts are kept, and the summary covers all runs regardless of rule changes.
- Scenario 3: The user turns debug logging on or off during the period. → Expected: counts and timing are unaffected.
- Scenario 4: Obsidian is open for several days. → Expected: one summary line per 24 hours, each covering only its own period.
- Scenario 5: The plugin is disabled and re-enabled. → Expected: treated as a new load, so the counts and the 24-hour clock restart.

## Success Metrics

### Key Performance Indicators

- **Adoption:** The switch is off by default, so 100% of users get quiet output after updating with no action. Hakobi collects no usage data, so adoption of the switch itself is not measured.
- **Engagement:** With debug logging off, Hakobi writes at most (load events + 1 summary line + failures) per 24 hours, down from 2 lines per run. Reference setup: 5 rules every 5 minutes, about 2,900 lines/day today, at most about 10 plus failures after the change.
- **Quality:** No per-run line appears with the switch off, verified by automated tests for each run trigger (timer, "Run now", command). Turning the switch on or off takes effect on the next run, with no reload.
- **Business Impact:** Fewer "console noise" complaints, and bug reports that include debug lines. This is judged qualitatively from GitHub issues; there is no telemetry.

### Tracking Requirements

Hakobi collects no analytics or telemetry (MiYo Constitution L1). Metrics are checked locally, through tests and manual inspection of the developer console. The "events" below are console lines, not tracked analytics.

| Event | Properties | Purpose |
|-------|------------|---------|
| Load event (console, debug level) | Plugin version, rule counts, initial-run start/end | Confirms the plugin started; part of the quiet default |
| Daily summary (console, debug level) | Completed runs, failed runs, overlap skips, dry runs, files copied/skipped/failed | Validates the Engagement KPI and gives users the daily check |
| Run detail (console, debug level, switch on only) | Rule name, direction, dry-run flag, result counts | Diagnosis while investigating |
| Run failure (console, warning/error level) | Rule name, error message | Visible without "Verbose"; drives bug reports |

---

## Constraints and Assumptions

### Constraints
- The Obsidian community-plugin lint allows only the console's debug, warning and error levels. The info and plain log levels are not available.
- Constitution L1 forbids telemetry and analytics, and Constitution L2 restricts logs and operation traces to metadata only: no note content, frontmatter values, file bytes or credentials.
- The settings layout follows MiYo Kado's information architecture (Hakobi `decisions.md`). Kado's "Developer" heading and "Debug logging" switch are the reference.
- Desktop only (`isDesktopOnly: true`), so the developer console is available on every supported platform.
- The existing audit log, its schema and its viewer stay unchanged.

### Assumptions
- Users who want console output know how to open the developer console, or are pointed to the docs.
- Whether the console's "Verbose" level is enabled is the user's own choice in the console, and Hakobi cannot influence it.
- Syncing the switch across devices is acceptable. Users who want debug output on only one device turn it off again after investigating.
- A 24-hour period counted from plugin load is good enough for a "daily" check. Users do not need calendar-day alignment.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Users following the old troubleshooting step see no Hakobi lines and assume the plugin is broken | Medium | Medium | Feature 5 updates the troubleshooting step to mention "Verbose" and the switch |
| Debug mode left on indefinitely, so the console is noisy again on every synced device | Low | Medium | Switch is off by default; the docs say to turn it off after investigating; the description states the default |
| Counts lost on reload, so users see an incomplete picture | Low | High | Documented behaviour; the summary covers only its own period; "summary on unload" is listed as a Could Have |
| Error messages with absolute paths end up in shared console screenshots | Medium | Low | Documented in PRIVACY.md (Feature 4); removing paths explicitly deferred (Won't Have) |
| The daily line is mistaken for an audit-log record | Low | Low | Docs separate the console summary from the audit log; the audit log stays unchanged |

## Open Questions

- [x] What "visible by default" means: debug level, as in Kado (decided 2026-11-27).
- [x] Shape of the summary: one aggregate line every 24 hours, in memory only, console only (decided 2026-11-27).
- [x] Where the switch is stored: synced with the other General settings (decided 2026-11-27).
- [x] Console privacy: rule names only in debug lines and failures; errors kept verbatim (decided 2026-11-27).
- [ ] Should spec 001's design rule "console for errors only" (solution.md, Logging / Auditing) be formally superseded? Proposed: yes, in this spec's SDD.

---

## Supporting Research

### Competitive Analysis
- **MiYo Kado** (sibling plugin, same owner) already has this pattern. Under a "Developer" heading there is a "Debug logging" switch, off by default, with the description "Emit debug messages to the developer console (off by default). Requires the developer tools 'Verbose' log level". A dedicated user doc page lists the lines for each state, and genuine errors always appear. Hakobi mirrors this for consistency across MiYo.
- Obsidian community plugins commonly hide routine output behind a debug or verbose switch, because the plugin review guidelines treat unconditional console output as noise.

### User Research
- GitHub issue #18 (maintainer): "add a switch to enable debug logging; move the tick events into the debug log, only show load/errors and periodic (probably 24 hours) totals by default."
- Current code: every run, whatever triggered it, writes per-run lines with the rule name. Load events, warnings and errors are separate lines. Nothing sums up activity across runs today.
- `docs/troubleshooting.md` already sends users to the console for `[Hakobi]` lines but does not mention the "Verbose" level, and it gives the wrong macOS shortcut.

### Market Data
Not applicable. This is a quality-of-life change to an existing open-source plugin, with no market-sizing angle.
