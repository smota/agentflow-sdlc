# Vendor terms for unattended subscription use

Purpose: design item W0-18 of `docs/designs/governed-factory.md`. This is a dated finding, read on 2026-11-25, with quoted clauses and a go or no-go reading per vendor. The question is whether one person may run an AI coding CLI unattended (scheduled, headless, no person at the keyboard, inside a local sandbox, building their own open-source project) while signed in with a consumer subscription login instead of a paid API key. The text is quoted; the interpretation is labeled as interpretation. This is not legal advice.

Method notes: pages were fetched with a tool that returns short verbatim fragments, so a quote below may be one fragment of a longer sentence. "Last updated" is the date the page itself shows; where none is shown, that is stated. Forum threads and blog posts were used only to locate primary pages, and are not treated as terms.

## Anthropic: Claude Code with a Claude Pro or Max login

### Sources read (all on 2026-11-25)

| Page                                                        | URL                                                                                            | Date shown on page                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Consumer Terms of Service                                   | https://www.anthropic.com/legal/consumer-terms                                                 | "Effective Oct 8, 2025"; no "last updated" label                    |
| Usage Policy                                                | https://www.anthropic.com/legal/aup                                                            | Effective Nov 12, 2026                                              |
| Claude Code, Legal and compliance                           | https://code.claude.com/docs/en/legal-and-compliance                                           | none shown                                                          |
| Claude Code, Authentication                                 | https://code.claude.com/docs/en/authentication                                                 | none shown                                                          |
| Claude Code, Run programmatically (`claude -p`)             | https://code.claude.com/docs/en/headless                                                       | none shown                                                          |
| Claude Code, Run prompts on a schedule                      | https://code.claude.com/docs/en/scheduled-tasks                                                | none shown                                                          |
| Agent SDK overview                                          | https://code.claude.com/docs/en/agent-sdk/overview                                             | none shown                                                          |
| Help Center, Use the Claude Agent SDK with your Claude plan | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan | "Updated over 3 weeks ago"; notices dated 2026-06-15 and 2026-10-07 |
| Help Center, Using Claude Code with your Pro or Max plan    | https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan    | "Updated over 3 weeks ago"                                          |

Not read: the Desktop scheduled tasks page and the GitHub Actions page (linked from the schedule page).

### Quoted clauses

Consumer Terms, Section 3 (prohibited uses), item 7:

> "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."

Consumer Terms, Section 2 (accounts):

> "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else or make your Account available to anyone else."

Claude Code, Legal and compliance, "License":

> "Consumer Terms of Service - for Free, Pro, Max, and Ultra users"

Claude Code, Legal and compliance, "Acceptable use":

> "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK."

Claude Code, Legal and compliance, "Authentication and credential use":

> "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."

> "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users."

> "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under Can customers offer Claude Code in their products? above."

Claude Code, Authentication, "Generate a long-lived token":

> "For CI pipelines, scripts, or other environments where interactive browser login isn't available, generate a one-year OAuth token with `claude setup-token`"

> "This token authenticates with your Claude subscription and requires a Pro, Max, Ultra, Team, or Enterprise plan."

Claude Code, Authentication, precedence item 5:

> "`CLAUDE_CODE_OAUTH_TOKEN` environment variable. A long-lived OAuth token generated by `claude setup-token`. Use this for CI pipelines and scripts where browser login isn't available."

Claude Code, Run programmatically:

> "It's available as a CLI for scripts and CI/CD"

> "Pass `--permission-prompts none` when nobody is available to answer permission prompts, for example in a scheduled job."

> "In bare mode, Claude Code never reads OAuth credentials or the system keychain." (Bare mode, the mode the page recommends for scripted calls, therefore needs an API key.)

Claude Code, Run prompts on a schedule: a Desktop scheduled task "Runs on: Your machine", with "Requires open session: No".

Agent SDK overview:

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."

Help Center, Agent SDK with your plan (notices of 2026-06-15 and 2026-10-07): "Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription limits." The 2026-06-15 notice says Anthropic "paused the previously-announced changes to Claude Agent SDK usage."

Usage Policy (effective 2026-11-12): the only automation clause found is "Utilize automation in account creation or to engage in spammy behavior". It also lists "Resell, proxy, or otherwise provide access to Claude through unauthorized means".

### Interpretation

The Consumer Terms ban access "through automated or non-human means, whether through a bot, script, or otherwise" unless the access is by API key or "where we otherwise explicitly permit it". Read alone, that clause covers an unattended scheduled `claude -p` job on a subscription login. Anthropic's own Claude Code documentation then tells subscription users to run `claude -p` in "scripts and CI/CD", to mint a subscription token with `claude setup-token` for "CI pipelines and scripts", and to use a scheduled task that runs on their machine with no open session. A reasonable reading is that this documentation is the "explicitly permit" exception for the unmodified Claude Code binary. The text does not say so in one place, and the Consumer Terms have not been amended to name it. The legal page also bounds the arrangement: limits "assume ordinary, individual usage", and OAuth is for "ordinary use of Claude Code". A factory that runs many sessions around the clock is a different volume from ordinary interactive use, and the text gives no number that separates the two. The restrictions on third-party developers routing plan credentials for their users do not apply to a single person running the official binary on their own machine for their own project. They would apply if the project let other people run its automation on the author's login, or if a wrapper handled the OAuth token (the page bars developers from collecting, storing or intermediating "Claude.ai credentials or session tokens"). Sharing the login with a second person or machine user is barred by Section 2.

Recommended reading: unclear. The documentation supports scripted and scheduled use of the unmodified binary on a subscription, but the Consumer Terms still ban non-human access by default, no page grants unattended use in terms, and the "ordinary, individual usage" limit is undefined.

## Google: Antigravity CLI (`agy`) with a Google consumer account or Google AI plan

### Sources read (all on 2026-11-25)

| Page                                                                       | URL                                                                                               | Date shown on page                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Google Antigravity Additional Terms of Service                             | https://antigravity.google/terms/                                                                 | none shown                                                                       |
| Antigravity FAQ                                                            | https://antigravity.google/docs/faq/                                                              | none shown                                                                       |
| Antigravity CLI, Headless mode                                             | https://antigravity.google/docs/cli/headless                                                      | none shown                                                                       |
| Antigravity, Plans                                                         | https://antigravity.google/docs/plans                                                             | none shown                                                                       |
| Google Terms of Service (Belgium version)                                  | https://policies.google.com/terms                                                                 | "Effective July 30, 2026"                                                        |
| Generative AI Additional Terms of Service                                  | https://policies.google.com/terms/generative-ai                                                   | "Last Modified: August 9, 2023"; the page says it stopped applying on 2024-05-22 |
| Generative AI Prohibited Use Policy                                        | https://policies.google.com/terms/generative-ai/use-policy                                        | "Last Modified: December 17, 2024"                                               |
| Forum thread, Clarifying headless agy CLI usage with gemini subs (not API) | https://discuss.ai.google.dev/t/clarifying-headless-agy-cli-usage-with-gemini-subs-not-api/203835 | posts of 2026-11-22 and 2026-11-23                                               |

The forum reply is a community-forum post by an unlabeled poster. The page does not confirm that the poster speaks for Google, so it is context, not a term.

### Quoted clauses

Antigravity Additional Terms, Section 1: three documents govern use, namely the Google Terms of Service ("Universal Terms"), the Antigravity Additional Terms and the Google Privacy Policy. The Generative AI Additional Terms are not mentioned.

Antigravity Additional Terms, Section 6:

> "You must not abuse, harm, interfere with, or disrupt the Service."

> "This includes, but is not limited to, using the Service in connection with products not provided by us."

> "Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement."

> "Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts."

Antigravity Additional Terms, Section 4: "solely responsible for: (a) the actions and tasks performed by an AI Agent" (the fetch returned only this fragment of the clause).

Antigravity FAQ:

> "Antigravity CLI headless mode (`agy -p`) is intended for direct scripting and CI workflows."

> "Wrapping `agy` inside third-party coding agents or applications, or automating account rotation, is not supported under consumer plans."

> "Using third-party software, tools, or services to access Antigravity is a violation of our Terms of Service" (the answer to why third-party software such as Claude Code, OpenClaw or OpenCode cannot be used with an Antigravity login; it recommends "a Gemini Enterprise or Google AI Studio API key" instead).

Antigravity CLI, Headless mode: "Headless mode uses your cached credentials." You sign in once in an interactive `agy` session. `--print-timeout` defaults to `0s`, meaning no limit. In CI with no existing auth the run exits with an `authentication required` error. The page has no quota or billing text.

Antigravity Plans: paid Google AI Pro quota is "refreshed every five hours until the weekly limit is reached". The plans list includes "Access to all product features, such as scheduled tasks and the CLI". "Usage limits for this service are subject to modification." Bring-your-own-key is listed as unsupported for additional rate limits. Plans apply only to personal Google Accounts.

Google Terms of Service (effective 2026-07-30), "Don't abuse our services":

> "You must not abuse, harm, interfere with, or disrupt our services or systems"

The same page lists "using automated means to access content from any of our services in violation of the machine-readable instructions" (a robots.txt clause about content crawling).

Generative AI Prohibited Use Policy: no clause on automated use as such; items 2.2 and 2.3 cover "Abuse of, harm to, interference with, or disruption to Google's or others' infrastructure or services" and "Circumvention of abuse protections or safety filters".

Forum reply of 2026-11-23, unlabeled poster (not a primary source): "Running `agy -p` directly in your own standalone scripts or CI workflows for tasks you initiate yourself is supported", and delegating to `agy -p` or `agy acp` "from another AI coding agent or external harness" "is not supported under consumer plans". Other posters in the thread say the terms, FAQ, older replies and a Google employee's social post contradict each other.

### Interpretation

The FAQ states that `agy -p` is "intended for direct scripting and CI workflows", and the headless page documents unattended operation on cached credentials. That supports running `agy -p` from the author's own script or scheduler on a consumer plan, on the author's machine, for the author's own project. Two limits come from the same text. First, Section 6 and the FAQ treat access through third-party software as a breach and call wrapping `agy` inside third-party coding agents "not supported under consumer plans". If Claude Code, Codex or another AI agent starts `agy` as a worker, that is the case the FAQ excludes. A plain runner script written by the author, with no AI agent in the call path, is not described by either clause. Second, no page defines "direct scripting", says whether a scheduler counts, or states a usage ceiling beyond "subject to modification". The Generative AI Additional Terms page says it stopped applying in May 2024, so it does not govern. The published pages do not state that an unattended scheduled run on a consumer subscription is permitted or forbidden; the forum answers point the other way depending on date and poster, and the thread of 2026-11-22 reports that Google's own messaging conflicts.

Recommended reading: unclear. The FAQ supports `agy -p` in the author's own scripts and CI, but the same FAQ excludes wrapping by another coding agent and no page addresses scheduled or round-the-clock use, so go applies only if the author's own runner launches `agy` with no AI agent in between.

## Decision

**Decided by the author on 2026-11-25: go, with subscription logins.** Unattended runs use the
author's own subscription logins, running the unmodified vendor binaries launched by the factory's
own runner (deterministic code, no AI agent between the scheduler and the CLI), and the logins are
never shared. In `sbx`, the Claude login is the host-side OAuth sign-in made with `/login`; the token
does not enter the sandbox. The conditions below that would move a vendor to no-go are part of the
decision: if one occurs, unattended runs for that vendor stop until the author decides again.

The reading on 2026-11-25 was unclear for both vendors. What would change it:

- Switching to an API key (Anthropic Console key, Google AI Studio or Vertex key, or Gemini Enterprise). Anthropic's Consumer Terms exempt API-key access from the automation ban, and Google's FAQ names API keys as the route for third-party agents. This turns both vendors to go, at pay-per-token cost.
- A written confirmation from either vendor's support that unattended scheduled use of the official binary on a consumer plan is permitted, kept with this file.
- A change to the Anthropic Consumer Terms, Section 3 item 7, to name Claude Code scripting, or a numeric definition of "ordinary, individual usage".
- A Google clarification of "direct scripting", or the early-December terms change that forum posters expect (unverified).
- A design that puts an AI agent between the scheduler and `agy`, or that lets anyone other than the author use the login. Either moves Google to no-go on the FAQ text, and sharing the login moves Anthropic to no-go on Section 2.
- Enforcement evidence. Anthropic and Google both reserve account suspension; a ban on the author's personal account would also cut off its interactive use.

This finding is re-checked before the M2 exit (design item M2-9). Vendor pages in this area changed several times in 2026, so each quote above is dated 2026-11-25 and should be re-read, not trusted, at that point.
