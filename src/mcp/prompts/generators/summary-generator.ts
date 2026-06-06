/**
 * Summary Generator
 *
 * Generates the standard summary/confirmation template for prompt workflows.
 * Pure function -- no dependency on BasePrompt or PromptContentBuilder.
 */

export interface SummaryContext {
  modelName: string
}

export function generateSummary(context: SummaryContext): string {
  return `## SUMMARY AND CONFIRMATION

After collecting all information, present a summary in TWO formats:

**1. Human-Readable Summary:**
Present the configuration in natural language that the user can easily verify.

**2. Technical Summary (API Attributes):**
Show the exact JSON that will be sent to the API for debugging/verification.

**>>> MANDATORY: Call validate_form for FULL FORM <<<**
\`\`\`
validate_form(model: "${context.modelName}", fields: { ...all_fields... })
\`\`\`

Check that \`ready_to_submit: true\` before calling \`create_model\`.

Ask the user to confirm:
1. **Create** - Proceed with \`create_model\`
2. **Modify** - Go back to a specific section
3. **Start over** - Clear all values and restart`
}
