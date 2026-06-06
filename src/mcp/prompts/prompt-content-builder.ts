/**
 * PromptContentBuilder - Fluent pipeline for assembling prompt documentation
 *
 * Thin orchestrator that delegates all rendering to composable generators
 * in the generators/ directory. Each generator is a pure function that takes
 * a context object and returns markdown.
 *
 * Always invoked from a prompt class's `get promptContent()` getter. The
 * canonical shape is:
 *
 *   .for(ThisClass, '<model>')   // factory, binds class + model name
 *   .add(`# <X> Creation Guide ...`)  // hand-written intro / What-is
 *   .standard()                  // flow + guidance + sections + summary
 *   .toolUsage()                 // auto-generated tool docs
 *   .attributeReference()        // field table
 *   .build()
 *
 * The five patterns the API is designed to support:
 *
 * 1. Plain — follow the canonical shape above verbatim. Reach for this first.
 *
 * 2. Custom appendix sections after `.toolUsage()`. The generated docs cover
 *    the form; instance helpers append extra prose just before the attribute
 *    table:
 *
 *      .standard()
 *      .toolUsage()
 *      .add(this.generateExtraSection())
 *      .attributeReference()
 *
 * 3. State-dependent section skipping — `.standard({ skip })` omits
 *    entries from `promptClass.sections` (by section key) that don't apply
 *    to the current instance:
 *
 *      .standard({ skip: this.isVariantA ? ['section_a', 'section_b'] : [] })
 *
 * 4. Pre-rendered section that replaces a generated one — when something is
 *    already decided at construction (so the auto-generated "choose X"
 *    section is misleading), inject a hand-rendered panel via
 *    `beforeSections` and `skip` the matching auto-section so it isn't
 *    rendered twice. One common example: a prompt for a nested resource
 *    that already knows its parent record (the value that will go into
 *    `create_model`'s `parent_path`) renders an "already chosen" parent
 *    panel and passes `parentPath` to `toolUsage` so the generated tool-call
 *    example shows the nested URL. Same shape applies to any pre-decided
 *    state — pre-selected type, pre-bound owner, etc.:
 *
 *      .standard({
 *        beforeSections: preDecidedSection ? [preDecidedSection] : [],
 *        skip: this.isPreDecided ? ['matching_section'] : [],
 *      })
 *      .toolUsage({ parentPath: this.parentPath })  // if nested
 *
 * 5. Capability flag at construction — `.for(Cls, name, { appsEnabled })`
 *    lets generators vary their output based on whether the deployer wired
 *    up the apps registry.
 *
 * Escape hatch: skip `.standard()` and compose manually when you don't want
 * the guidance/summary blocks:
 *
 *   .flowDiagram().allSections().add(...).toolUsage().attributeReference()
 *
 * Prefer `.standard()` unless you have a concrete reason — the default
 * composition is what keeps prompts consistent across models.
 */

import { generateAttributeReference } from './generators/attribute-reference-generator.js'
import { generateFlowDiagram } from './generators/flow-diagram-generator.js'
import { generateGuidance } from './generators/guidance-generator.js'
import { generateAllSections, generateSection } from './generators/section-generator.js'
import { generateSummary } from './generators/summary-generator.js'
import { generateToolUsage } from './generators/tool-usage-generator.js'
import type { PromptClassLike } from './prompt-definitions.js'

interface GeneratorContext {
  promptClass: PromptClassLike
  modelName: string
  appsEnabled: boolean
}

interface GeneratorOptions {
  appsEnabled?: boolean
}

interface StandardOptions {
  beforeSections?: string[]
  skip?: string[]
  customSections?: Record<string, (sectionNum: number) => string>
}

interface AllSectionsOptions {
  skip?: string[]
  customSections?: Record<string, (sectionNum: number) => string>
}

export class PromptContentBuilder {
  promptClass: PromptClassLike
  modelName: string
  appsEnabled: boolean
  parts: string[]
  _context: GeneratorContext

  constructor(promptClass: PromptClassLike, modelName: string, options: GeneratorOptions = {}) {
    this.promptClass = promptClass
    this.modelName = modelName
    this.appsEnabled = options.appsEnabled === true
    this.parts = []
    this._context = { promptClass, modelName, appsEnabled: this.appsEnabled }
  }

  /** Factory method for fluent API */
  static for(
    promptClass: PromptClassLike,
    modelName: string,
    options: GeneratorOptions = {}
  ): PromptContentBuilder {
    return new PromptContentBuilder(promptClass, modelName, options)
  }

  // ===========================================================================
  // FLUENT PIPELINE METHODS
  // ===========================================================================

  /** Add custom markdown content. */
  add(content: string): PromptContentBuilder {
    if (content) this.parts.push(content)
    return this
  }

  /** Add flow diagram overview from sections/fieldGroups config. */
  flowDiagram(): PromptContentBuilder {
    const content = generateFlowDiagram(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /** Add stateful guidance instructions (mode selection, turn-taking, validation). */
  guidance(): PromptContentBuilder {
    const content = generateGuidance(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /** Add a single section's documentation. */
  section(
    groupName: string,
    sectionNumber: number,
    options: Record<string, unknown> = {}
  ): PromptContentBuilder {
    const content = generateSection(this._context, groupName, sectionNumber, options)
    if (content) this.parts.push(content)
    return this
  }

  /** Add all sections documentation, auto-generated from sections config. */
  allSections(options: AllSectionsOptions = {}): PromptContentBuilder {
    const content = generateAllSections(this._context, options)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Standard pipeline: flowDiagram -> guidance -> beforeSections -> allSections -> summary.
   */
  standard(options: StandardOptions = {}): PromptContentBuilder {
    const { beforeSections = [], skip = [], customSections = {} } = options
    this.flowDiagram()
    this.guidance()
    for (const section of beforeSections) this.add(section)
    this.allSections({ skip, customSections })
    this.summary()
    return this
  }

  /** Add standard summary template. */
  summary(): PromptContentBuilder {
    const content = generateSummary(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /** Add attribute reference table. */
  attributeReference(): PromptContentBuilder {
    const content = generateAttributeReference(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /** Add auto-generated tool usage documentation from `static toolUsage` config. */
  toolUsage(instanceOverrides: Record<string, unknown> = {}): PromptContentBuilder {
    const content = generateToolUsage(this._context, instanceOverrides)
    if (content) this.parts.push(content)
    return this
  }

  /** Build the final prompt content by joining all parts. */
  build(separator = '\n\n---\n\n'): string {
    return this.parts.filter(Boolean).join(separator)
  }
}
