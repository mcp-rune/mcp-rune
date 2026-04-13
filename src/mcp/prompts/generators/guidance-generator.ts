/**
 * Guidance Generator
 *
 * Generates stateful guidance instructions (mode selection, turn-taking,
 * validation requirements) for complex interactive prompts.
 * Pure function -- no dependency on BasePrompt or PromptContentGenerator.
 */

import type { PromptClassLike } from '../base-prompt.js'

export interface GuidanceContext {
  promptClass: PromptClassLike
  modelName: string
}

export function generateGuidance(context: GuidanceContext): string {
  if (context.promptClass.strategy !== 'stateful') return ''

  const modelName = context.modelName
  const fieldGroupNames = Object.keys(context.promptClass.fieldGroups)
    .map((s) => `\`${s}\``)
    .join(', ')

  return `## FIRST: Mode Selection

**YOUR FIRST RESPONSE MUST BE THIS EXACT MESSAGE:**

\`\`\`
How would you like to proceed?

- **Guided** (recommended): I'll walk you through each section step-by-step
- **Quick**: I'll minimize questions and infer values from context
\`\`\`

**STOP and WAIT for the user's choice before proceeding.**

---

## After User Chooses Mode

**If user chooses GUIDED, your next response MUST:**
1. Present the section roadmap from the **Flow** diagram above (use section names and descriptions, not field names)
2. Ask "Ready to begin? Let's start with the first section."

**WAIT for user confirmation before proceeding to Section 1.**

**If user chooses QUICK:**
- Infer values from conversation context when possible
- Only ASK for required fields that cannot be inferred
- Skip optional sections entirely unless user mentions them
- Show a confirmation summary before creating

---

## Interactive Guidance Instructions (Guided Mode)

Guide the user through EVERY section IN ORDER:
1. For each section, explain what it configures in plain terms
2. **Always reference the section number and name** (e.g., "Section 3: Transmission")
3. **Offer the default/recommended option first**, then alternatives
4. **MANDATORY: Call \`validate_form\` after EVERY section** - this is required, not optional
5. Be specific - avoid vague questions like "what is the purpose" or "what action should occur"
6. **ALWAYS ask about Additional/Optional Sections** before finalizing
7. **Present both summaries** (human-readable AND technical) before asking for confirmation

---

## CRITICAL: MANDATORY VALIDATION REQUIREMENT

**YOU MUST CALL \`validate_form\` AFTER COMPLETING EACH SECTION.**

This is NOT optional. The validation tool:
- Confirms the section data is correct before proceeding
- Catches errors early before they compound
- Tracks form progress for the user
- Determines which section to complete next

**Pattern for EVERY section:**
1. Collect user input for the section
2. IMMEDIATELY call \`validate_form\` with collected fields
3. Review validation result
4. Only proceed to next section if validation passes

---

## CRITICAL: ONE MESSAGE AT A TIME (Turn-Taking)

This is a CONVERSATION. You MUST follow turn-taking:
1. You ask ONE question
2. You STOP and END your message
3. User responds in their next message
4. Only THEN do you process their answer and ask the next question

**FORBIDDEN BEHAVIOR**:
- ❌ Making selections or decisions on behalf of the user
- ❌ Assuming what the user wants without asking
- ❌ Asking a question then immediately calling tools
- ❌ Asking a question then asking another question
- ❌ Calling \`validate_form\` or \`find_model\` after asking a question in the same message

**CORRECT BEHAVIOR**:
- ✅ Present options and ASK the user to choose
- ✅ Wait for user's explicit selection before proceeding
- ✅ Ask one question, then STOP
- ✅ Process user's response, validate, then ask next question

**NEVER DO THIS**:
- ❌ "I see the perfect option is X. Let me validate..." (making a choice)
- ❌ "Based on your description, I'll use Y..." (assuming)

**ALWAYS DO THIS**:
- ✅ "Here are the options: A, B, C. Which would you like to use?"
- ✅ "Would you like to use X, or would you prefer something else?"

**SECTION FLOW**:
1. Explain what this section configures
2. **Offer the default option first** (e.g., "The default is X. Would you like to use this or configure differently?")
3. Ask the user for their input
4. **END YOUR MESSAGE** - do not continue
5. In your NEXT message (after user responds): validate and proceed

---

## Section Validation Reference

Call \`validate_form\` ONLY after the user has responded:
\`\`\`
validate_form(model: "${modelName}", section: "<field_group_name>", fields: { ...current_fields... })
\`\`\`

Available field groups for validation: ${fieldGroupNames}

**The validation response will include:**
- \`valid\`: Whether the section is valid
- \`errors\`: Any validation errors to fix
- \`warnings\`: Non-blocking suggestions
- \`next_section\`: The recommended next section to fill
- \`section_complete\`: Whether the section has all required fields`
}
