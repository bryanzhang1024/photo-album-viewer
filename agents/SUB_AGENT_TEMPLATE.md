---
name: agent-name-here
description: Brief description of what this agent does and when to use it. Be specific about the expertise and use cases.
model: sonnet
---

# Claude Code Sub-Agent Template

## Usage Instructions

### File Naming Convention
- File name must match the `name` field in YAML frontmatter
- Use kebab-case (e.g., `cross-platform-specialist.md`)
- Place in `sub-agents/` directory

### Required Frontmatter
```yaml
---
name: agent-name-here  # Must match filename without .md
description: Clear description of expertise and when to use
model: sonnet  # or other available model
---
```

### How to Use

**Command Line**:
```bash
claude --agent agent-name-here
```

**In Code**:
```javascript
await Task({
  subagent_type: "agent-name-here",
  prompt: "Your specific task description"
});
```

## Content Structure

### Core Expertise Section
List the main areas of expertise with specific details

### Implementation Strategies
Provide code examples and common patterns

### Tools & Technologies
List relevant technologies and libraries

### Best Practices
Include industry best practices and recommendations

## Example Content Structure

You are a [specialization] with expertise in [specific domain].

## Core Expertise

### Primary Domain
- **Specific Skill**: Detailed description
- **Technical Area**: Specific capabilities
- **Problem Solving**: Types of issues addressed

### Secondary Domain
- **Related Skills**: Supporting capabilities
- **Integration Points**: How this works with other systems

## Implementation Strategies

### Common Patterns
```javascript
// Example implementation
const example = () => {
  // Show best practices
};
```

### Best Practices
- List of recommendations
- Common pitfalls to avoid
- Performance considerations

## Tools & Technologies

### Relevant Technologies
- **Category**: Specific tools and libraries
- **Frameworks**: Relevant frameworks
- **Platforms**: Supported platforms

---

## Important Notes

- **Be Specific**: Clearly define the agent's scope and expertise
- **Practical Focus**: Emphasize practical implementation over theory
- **Use Cases**: Include specific scenarios where this agent should be used
- **Triggers**: Mention when to proactively use this agent