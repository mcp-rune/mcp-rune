# 0012. Boot validation runs automatically, where the declarations live

- Status: Accepted
- Date: 2026-07-03
- Related: #348, #361

## Context

The framework's pitch is fail-at-boot with clear messages, and the validators deliver that — cross-registry binding checks, per-class structure checks, typo suggestions via `closestMatch`. But whether they ever ran was a deployer convention: `validateRegistries` had zero callers inside the framework, docstrings instructed deployers to call it, and request-time errors apologized for it ("Call validateRegistries() at server boot to catch this earlier"). The known deployments split exactly as convention predicts: one calls it, one forgot. Two adjacent silent failures rode along: `ToolRegistry.registerTools` skipped-and-logged a tool whose input schema failed to serialize (a server silently ships without the tool), and an unknown `formStrategy` fell back to stateless at request time (a JS deployer's typo ships a prompt that quietly lost validation and progress).

## Decision

**The composition roots run `validateRegistries` automatically, each over the declarations it actually holds, with a `validate: 'throw' | 'warn' | 'off'` policy defaulting to `'throw'`.**

- **`createServer`** validates the tool registry's models (via a new public `ToolRegistry.models` getter) plus the prompt registry's model-bound classes, obtained through a new optional `PromptRegistry.getModelBoundClasses()` accessor that `BasePromptRegistry` implements. Bespoke `PromptRegistry` implementations may omit the accessor; their prompt declarations then sit outside boot validation's sight — feature detection, matching the interface's other optional capabilities.
- **`createDefaultAppRegistry`** validates its models, resolved form classes (explicit and synthesized), and prompt classes — forms only exist as declarations here; an `AppRegistry` holds built apps, so `createServer` structurally cannot validate them. Validation runs after `AppRegistry` construction so deployer kinds are registered before attribute types are checked.
- **Invalid tool schemas fail registration, unconditionally.** A schema that cannot serialize is a programming error, never an operational condition — there is no policy knob for it.
- `validatePromptClass` gains a `formStrategy` membership check against the strategies map (error-level, with a suggestion), closing the silent stateless fallback at the boot gate. The runtime fallback remains as belt-and-braces for the `'off'` path.
- `validateRegistries` stays a public pure function; existing explicit calls keep working and become redundant for `createServer` users.

## Options considered

**Validate in the registry constructors — rejected.** `ToolRegistry` cannot see forms; `AppRegistry` receives built apps, not form classes; only `BasePromptRegistry` knows its prompt classes. Constructor-time validation would triple-run model checks while still missing the cross-registry picture, and constructors should stay cheap and policy-free.

**Validate only in `createServer` — rejected.** It is the natural single chokepoint, but form declarations never reach it. Inventing a form-class retention path on `AppRegistry` purely so `createServer` could see them adds state with no other consumer. Two sites, each validating what it owns, is the honest topology.

**Keep opt-in and gate via scaffolding — rejected.** That is the honor system with extra steps; the deployment that forgot the call is the one that needed it.

**Policy knob for invalid tool schemas — rejected.** "Warn and ship without the tool" reintroduces the silent-absence failure this task exists to end.

## Consequences

- BREAKING: servers with latent declaration errors now fail at boot instead of at request time. `validate: 'warn'` is the migration hatch for deployments that need to boot while cleaning up.
- Structural stub registries (tests) validate as empty and pass — `createServer` guards missing `models`.
- The docstrings and guide passages that instructed manual calls now describe the auto-run and the policy knob.
- A future bespoke `PromptRegistry` that wants boot coverage implements `getModelBoundClasses()` — one method, feature-detected.
