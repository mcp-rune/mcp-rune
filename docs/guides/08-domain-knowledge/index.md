# Domain Knowledge

Models tell the framework about your _data_. Domain tells the framework about your _business_. This section introduces the second declarative layer mcp-rune supports — the one that turns a polymorphic CRUD server into something an LLM can reason against, not just operate.

A domain declaration is a registry of `DomainConcept`s, `BusinessRule`s, `WorkflowDefinition`s, and `DiagramTemplate`s. The framework consumes them through tools like `get_domain_context`, `check_business_rules`, `suggest_workflow`, and through the GraphRAG `concept-touch` and `rule-violation` summary strategies covered in chapter 9. The `bookshelf-graph` example ships a small but realistic set of all four — concepts like `reading-pipeline` and `catalogue`, rules like "books with rating must have status `completed`," and a workflow for the curation flow.

**Read in this order:**

1. [Domain knowledge framework](./domain-knowledge.md) — `DomainConcept`, `BusinessRule`, `WorkflowDefinition`, `DiagramTemplate`, and the registry that ties them together.

When you finish this chapter, [chapter 9](../09-retrieval-and-graphrag/) picks up with retrieval — pgvector, summary strategies, proximity sampling, and the analysis tools that consume both your Models and your Domain to produce grounded answers.
