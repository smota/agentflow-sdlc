# Capability Map: [Initiative Name]

## 1. Scope Check
- Single Capability Feature: [Yes / No]
- Decomposition Required: [Yes / No]

## 2. Capability Modules
| Module ID (kebab-case) | Responsibility & Scope | Depends On | Interface Boundary |
| :--- | :--- | :--- | :--- |
| `module-a` | [Primary responsibility] | — | [Exported contracts / APIs] |
| `module-b` | [Primary responsibility] | `module-a` | [Consumed contracts] |

## 3. Dependency Graph & Build Order
- **Dependency Flow**: `module-a` ---> `module-b`
- **Build Sequence**:
  1. `module-a`
  2. `module-b`
- **Cycle Check**: Zero circular dependencies verified.

## 4. Cross-Module Invariants
- Invariant 1: [Shared rule spanning module boundaries]
